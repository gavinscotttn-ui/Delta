package main

import (
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

// ---------------- monitors ----------------

type monInfo struct {
	Monitor
	work RECT
	full RECT
}

var (
	enumMu       sync.Mutex
	enumMonitors []monInfo
	enumWindows  []uintptr
	monitorCB    = syscall.NewCallback(func(hmon, hdc, lprc, lparam uintptr) uintptr {
		var mi MONITORINFOEXW
		mi.CbSize = uint32(unsafe.Sizeof(mi))
		if r, _, _ := pGetMonitorInfoW.Call(hmon, uintptr(unsafe.Pointer(&mi))); r != 0 {
			m := monInfo{work: mi.RcWork, full: mi.RcMonitor}
			m.Name = strings.TrimPrefix(syscall.UTF16ToString(mi.SzDevice[:]), `\\.\`)
			m.Primary = mi.DwFlags&1 != 0
			m.X, m.Y = int(mi.RcMonitor.Left), int(mi.RcMonitor.Top)
			m.W, m.H = int(mi.RcMonitor.Right-mi.RcMonitor.Left), int(mi.RcMonitor.Bottom-mi.RcMonitor.Top)
			enumMonitors = append(enumMonitors, m)
		}
		return 1
	})
	windowCB = syscall.NewCallback(func(hwnd, lparam uintptr) uintptr {
		enumWindows = append(enumWindows, hwnd)
		return 1
	})
)

// listMonitors returns displays numbered left-to-right, then top-to-bottom.
func listMonitors() ([]monInfo, error) {
	enumMu.Lock()
	enumMonitors = nil
	r, _, err := pEnumDisplayMonitors.Call(0, 0, monitorCB, 0)
	mons := enumMonitors
	enumMonitors = nil
	enumMu.Unlock()
	if r == 0 {
		return nil, fmt.Errorf("EnumDisplayMonitors: %v", err)
	}
	sort.SliceStable(mons, func(i, j int) bool {
		if mons[i].X != mons[j].X {
			return mons[i].X < mons[j].X
		}
		return mons[i].Y < mons[j].Y
	})
	for i := range mons {
		mons[i].Index = i + 1
	}
	return mons, nil
}

// ---------------- windows ----------------

type winRef struct {
	hwnd  uintptr
	title string
	exe   string // base name, e.g. EXCEL.EXE
	path  string
	pid   uint32
}

func allTopWindows() []uintptr {
	enumMu.Lock()
	defer enumMu.Unlock()
	enumWindows = nil
	pEnumWindows.Call(windowCB, 0)
	out := enumWindows
	enumWindows = nil
	return out
}

func windowText(h uintptr) string {
	n, _, _ := pGetWindowTextLengthW.Call(h)
	if n == 0 {
		return ""
	}
	buf := make([]uint16, n+1)
	pGetWindowTextW.Call(h, uintptr(unsafe.Pointer(&buf[0])), n+1)
	return syscall.UTF16ToString(buf)
}

func className(h uintptr) string {
	buf := make([]uint16, 256)
	pGetClassNameW.Call(h, uintptr(unsafe.Pointer(&buf[0])), 256)
	return syscall.UTF16ToString(buf)
}

func windowPID(h uintptr) uint32 {
	var pid uint32
	pGetWindowThreadProcessId.Call(h, uintptr(unsafe.Pointer(&pid)))
	return pid
}

var (
	exeCacheMu sync.Mutex
	exeCache   = map[uint32]string{}
)

func processPath(pid uint32) string {
	exeCacheMu.Lock()
	if p, ok := exeCache[pid]; ok {
		exeCacheMu.Unlock()
		return p
	}
	exeCacheMu.Unlock()
	h, _, _ := pOpenProcess.Call(PROCESS_QUERY_LIMITED_INFORMATION, 0, uintptr(pid))
	if h == 0 {
		return ""
	}
	defer pCloseHandle.Call(h)
	buf := make([]uint16, 1024)
	size := uint32(len(buf))
	if r, _, _ := pQueryFullProcessImageNameW.Call(h, 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size))); r == 0 {
		return ""
	}
	p := syscall.UTF16ToString(buf[:size])
	exeCacheMu.Lock()
	if len(exeCache) > 2000 {
		exeCache = map[uint32]string{}
	}
	exeCache[pid] = p
	exeCacheMu.Unlock()
	return p
}

func isCloaked(h uintptr) bool {
	if pDwmGetWindowAttribute.Find() != nil {
		return false
	}
	var v uint32
	r, _, _ := pDwmGetWindowAttribute.Call(h, DWMWA_CLOAKED, uintptr(unsafe.Pointer(&v)), 4)
	return r == 0 && v != 0
}

var shellClasses = map[string]bool{"Progman": true, "WorkerW": true, "Shell_TrayWnd": true, "Shell_SecondaryTrayWnd": true}

var ownPID = func() uint32 { r, _, _ := pGetCurrentProcessId.Call(); return uint32(r) }()

// isAppWindow approximates "a window that shows on the taskbar / Alt+Tab".
func isAppWindow(h uintptr, includeHidden bool) bool {
	if !includeHidden {
		if v, _, _ := pIsWindowVisible.Call(h); v == 0 {
			return false
		}
		if isCloaked(h) {
			return false
		}
	}
	if owner, _, _ := pGetWindow.Call(h, GW_OWNER); owner != 0 {
		return false
	}
	idx := GWL_EXSTYLE
	ex, _, _ := pGetWindowLongPtrW.Call(h, uintptr(idx))
	if ex&WS_EX_TOOLWINDOW != 0 {
		return false
	}
	if shellClasses[className(h)] {
		return false
	}
	return windowText(h) != ""
}

func describe(h uintptr) winRef {
	pid := windowPID(h)
	p := processPath(pid)
	return winRef{hwnd: h, title: windowText(h), exe: filepath.Base(p), path: p, pid: pid}
}

// appWindows lists visible app windows in Z-order (topmost first), excluding Praxis itself.
func appWindows() []winRef {
	var out []winRef
	for _, h := range allTopWindows() {
		if !isAppWindow(h, false) {
			continue
		}
		w := describe(h)
		if w.pid == ownPID {
			continue
		}
		out = append(out, w)
	}
	return out
}

// matchTerms splits "Netflix, vlc.exe" into lowercase terms.
func matchTerms(spec string) []string {
	var out []string
	for _, t := range strings.Split(spec, ",") {
		if t = strings.ToLower(strings.TrimSpace(t)); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// matches: a term ending in .exe must equal the process name; any other term
// matches the process name (without .exe) or appears in the window title.
func (w winRef) matches(terms []string) bool {
	exe := strings.ToLower(w.exe)
	title := strings.ToLower(w.title)
	for _, t := range terms {
		if strings.HasSuffix(t, ".exe") {
			if exe == t {
				return true
			}
			continue
		}
		if strings.TrimSuffix(exe, ".exe") == t || strings.Contains(title, t) {
			return true
		}
	}
	return false
}

func findWindows(spec string) []winRef {
	terms := matchTerms(spec)
	if len(terms) == 0 {
		return nil
	}
	var out []winRef
	for _, w := range appWindows() {
		if w.matches(terms) {
			out = append(out, w)
		}
	}
	return out
}

func isWindow(h uintptr) bool       { r, _, _ := pIsWindow.Call(h); return r != 0 }
func isIconic(h uintptr) bool       { r, _, _ := pIsIconic.Call(h); return r != 0 }
func isZoomed(h uintptr) bool       { r, _, _ := pIsZoomed.Call(h); return r != 0 }
func showWindow(h uintptr, cmd int) { pShowWindow.Call(h, uintptr(cmd)) }
func foreground() uintptr           { r, _, _ := pGetForegroundWindow.Call(); return r }

func getPlacement(h uintptr) (WINDOWPLACEMENT, bool) {
	var wp WINDOWPLACEMENT
	wp.Length = uint32(unsafe.Sizeof(wp))
	r, _, _ := pGetWindowPlacement.Call(h, uintptr(unsafe.Pointer(&wp)))
	return wp, r != 0
}

func setPlacement(h uintptr, wp WINDOWPLACEMENT) {
	wp.Length = uint32(unsafe.Sizeof(wp))
	pSetWindowPlacement.Call(h, uintptr(unsafe.Pointer(&wp)))
}

// placeOnMonitor moves h onto a monitor: maximised there, or covering the whole screen.
func placeOnMonitor(h uintptr, m monInfo, mode string) {
	if isIconic(h) || isZoomed(h) {
		showWindow(h, SW_RESTORE)
	}
	r := m.work
	if mode == "cover" {
		r = m.full
	}
	pSetWindowPos.Call(h, 0, uintptr(r.Left), uintptr(r.Top), uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top),
		SWP_NOZORDER|SWP_NOACTIVATE|SWP_FRAMECHANGED|SWP_SHOWWINDOW)
	if mode != "cover" {
		showWindow(h, SW_MAXIMIZE)
	}
}

// forceForeground brings h to the front despite Windows' focus-stealing rules.
func forceForeground(h uintptr) {
	if h == 0 || !isWindow(h) {
		return
	}
	if isIconic(h) {
		showWindow(h, SW_RESTORE)
	}
	fg := foreground()
	cur, _, _ := pGetCurrentThreadId.Call()
	fgThread, _, _ := pGetWindowThreadProcessId.Call(fg, 0)
	attached := false
	if fg != 0 && fgThread != cur {
		r, _, _ := pAttachThreadInput.Call(cur, fgThread, 1)
		attached = r != 0
	}
	pBringWindowToTop.Call(h)
	r, _, _ := pSetForegroundWindow.Call(h)
	if attached {
		pAttachThreadInput.Call(cur, fgThread, 0)
	}
	if r == 0 || foreground() != h {
		// Fallback: a synthetic Alt tap grants this process foreground rights.
		sendKeyEvents([]INPUT{keyInput(0x12, false), keyInput(0x12, true)})
		pSetForegroundWindow.Call(h)
	}
}

// ---------------- launching ----------------

// shellOpen launches an exe, shortcut, document or URL via ShellExecute.
func shellOpen(target, args string, show int) error {
	target = strings.Trim(strings.TrimSpace(target), `"`)
	if target == "" {
		return errors.New("nothing to launch")
	}
	var a uintptr
	if args != "" {
		a = uintptr(unsafe.Pointer(u16(args)))
	}
	r, _, _ := pShellExecuteW.Call(0, uintptr(unsafe.Pointer(u16("open"))), uintptr(unsafe.Pointer(u16(target))), a, 0, uintptr(show))
	if r <= 32 {
		return fmt.Errorf("could not launch %q (ShellExecute error %d)", target, r)
	}
	return nil
}

// waitForNewWindow polls for a matching app window not in `known`.
func waitForNewWindow(spec string, known map[uintptr]bool, timeout time.Duration) (winRef, bool) {
	deadline := time.Now().Add(timeout)
	for {
		for _, w := range findWindows(spec) {
			if !known[w.hwnd] {
				return w, true
			}
		}
		if time.Now().After(deadline) {
			return winRef{}, false
		}
		time.Sleep(60 * time.Millisecond)
	}
}

// ---------------- keyboard ----------------

func keyInput(vk uint16, up bool) INPUT {
	in := INPUT{Type: INPUT_KEYBOARD}
	in.Ki.Vk = vk
	if up {
		in.Ki.Flags |= KEYEVENTF_KEYUP
	}
	if isExtendedVK(vk) {
		in.Ki.Flags |= KEYEVENTF_EXTENDEDKEY
	}
	return in
}

func isExtendedVK(vk uint16) bool {
	switch vk {
	case 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x6F, 0x5B, 0x5C, 0x2C,
		0xAD, 0xAE, 0xAF, 0xB0, 0xB1, 0xB2, 0xB3:
		return true
	}
	return false
}

func sendKeyEvents(ins []INPUT) error {
	if len(ins) == 0 {
		return nil
	}
	n, _, err := pSendInput.Call(uintptr(len(ins)), uintptr(unsafe.Pointer(&ins[0])), unsafe.Sizeof(ins[0]))
	if int(n) != len(ins) {
		return fmt.Errorf("SendInput blocked (%v); the target may be running as administrator", err)
	}
	return nil
}

func sendChord(h Hotkey) error {
	var mods []uint16
	if h.Mods&modControl != 0 {
		mods = append(mods, 0x11)
	}
	if h.Mods&modAlt != 0 {
		mods = append(mods, 0x12)
	}
	if h.Mods&modShift != 0 {
		mods = append(mods, 0x10)
	}
	if h.Mods&modWin != 0 {
		mods = append(mods, 0x5B)
	}
	var ins []INPUT
	for _, m := range mods {
		ins = append(ins, keyInput(m, false))
	}
	ins = append(ins, keyInput(uint16(h.VK), false), keyInput(uint16(h.VK), true))
	for i := len(mods) - 1; i >= 0; i-- {
		ins = append(ins, keyInput(mods[i], true))
	}
	return sendKeyEvents(ins)
}

func typeText(s string) error {
	var ins []INPUT
	for _, c := range syscall.StringToUTF16(s) {
		if c == 0 {
			continue
		}
		if c == '\n' {
			ins = append(ins, keyInput(0x0D, false), keyInput(0x0D, true))
			continue
		}
		if c == '\r' {
			continue
		}
		down := INPUT{Type: INPUT_KEYBOARD}
		down.Ki.Scan = c
		down.Ki.Flags = KEYEVENTF_UNICODE
		up := down
		up.Ki.Flags |= KEYEVENTF_KEYUP
		ins = append(ins, down, up)
	}
	return sendKeyEvents(ins)
}
