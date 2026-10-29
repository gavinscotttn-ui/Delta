package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

type winPlatform struct {
	app *App

	hwnd     uintptr
	uiThread uintptr
	hInst    uintptr
	icon     uintptr
	tbMsg    uintptr // "TaskbarCreated"

	callMu sync.Mutex
	calls  []func()
	done   chan struct{}

	hotkeyIDs map[int]string // UI-thread only
	overlays  map[uintptr][2]string
}

var thePlatform *winPlatform

func newPlatform(app *App) Platform {
	thePlatform = &winPlatform{app: app, done: make(chan struct{}), hotkeyIDs: map[int]string{}, overlays: map[uintptr][2]string{}}
	return thePlatform
}

// invoke runs fn on the UI thread (needed for RegisterHotKey and window creation).
func (p *winPlatform) invoke(fn func()) {
	if cur, _, _ := pGetCurrentThreadId.Call(); p.hwnd == 0 || cur == p.uiThread {
		fn()
		return
	}
	res := make(chan struct{})
	p.callMu.Lock()
	p.calls = append(p.calls, func() { fn(); close(res) })
	p.callMu.Unlock()
	pPostMessageW.Call(p.hwnd, WM_APP_CALL, 0, 0)
	select {
	case <-res:
	case <-p.done:
	}
}

func (p *winPlatform) Monitors() ([]Monitor, error) {
	ms, err := listMonitors()
	out := make([]Monitor, len(ms))
	for i, m := range ms {
		out[i] = m.Monitor
	}
	return out, err
}

func (p *winPlatform) Windows() ([]WinInfo, error) {
	var out []WinInfo
	for _, w := range appWindows() {
		out = append(out, WinInfo{Title: w.title, Exe: w.exe, Path: w.path})
	}
	return out, nil
}

func (p *winPlatform) Audio() AudioState {
	var s AudioState
	m, v, err := audioGetBoth()
	if err != nil {
		s.Error = err.Error()
	} else {
		s.Available, s.Muted, s.Volume = true, m, v
	}
	if mm, err := audioGetMute(true); err != nil {
		s.MicError = err.Error()
	} else {
		s.MicMuted = mm
	}
	return s
}

func (p *winPlatform) SetMute(mic, muted bool) error { return audioSetMute(mic, muted) }
func (p *winPlatform) SetVolume(v int) error         { return audioSetVolume(v) }

// ApplyHotkeys (re)registers every macro hotkey on the UI thread.
func (p *winPlatform) ApplyHotkeys(macros []Macro, paused bool) map[string]string {
	res := map[string]string{}
	p.invoke(func() {
		for id := range p.hotkeyIDs {
			pUnregisterHotKey.Call(p.hwnd, uintptr(id))
		}
		p.hotkeyIDs = map[int]string{}
		next := 1
		for _, m := range macros {
			if m.Hotkey == "" {
				continue
			}
			if paused {
				res[m.ID] = "paused"
				continue
			}
			hk, err := ParseHotkey(m.Hotkey)
			if err != nil {
				res[m.ID] = err.Error()
				continue
			}
			r, _, e := pRegisterHotKey.Call(p.hwnd, uintptr(next), uintptr(hk.Mods|MOD_NOREPEAT), uintptr(hk.VK))
			if r == 0 {
				res[m.ID] = fmt.Sprintf("already in use by another app or Windows (%v)", e)
				continue
			}
			p.hotkeyIDs[next] = m.ID
			res[m.ID] = "ok"
			next++
		}
	})
	return res
}

func (p *winPlatform) Notify(title, msg string) {
	if p.hwnd == 0 {
		return
	}
	nid := p.nid()
	nid.UFlags = NIF_INFO
	copyU16(nid.SzInfoTitle[:], title) // empty title keeps toasts anonymous
	copyU16(nid.SzInfo[:], msg)
	nid.DwInfoFlags = NIIF_USER | NIIF_NOSOUND
	pShellNotifyIconW.Call(NIM_MODIFY, uintptr(unsafe.Pointer(&nid)))
}

const runKey = `Software\Microsoft\Windows\CurrentVersion\Run`

func (p *winPlatform) SetRunAtStartup(enabled bool) error {
	var key uintptr
	if r, _, _ := pRegOpenKeyExW.Call(HKEY_CURRENT_USER, uintptr(unsafe.Pointer(u16(runKey))), 0, KEY_SET_VALUE, uintptr(unsafe.Pointer(&key))); r != 0 {
		return fmt.Errorf("could not open the Run registry key (error %d)", r)
	}
	defer pRegCloseKey.Call(key)
	if !enabled {
		r, _, _ := pRegDeleteValueW.Call(key, uintptr(unsafe.Pointer(u16("Praxis"))))
		if r != 0 && r != 2 { // 2 = not found
			return fmt.Errorf("could not remove startup entry (error %d)", r)
		}
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	val, _ := syscall.UTF16FromString(`"` + exe + `" --minimized`)
	r, _, _ := pRegSetValueExW.Call(key, uintptr(unsafe.Pointer(u16("Praxis"))), 0, REG_SZ,
		uintptr(unsafe.Pointer(&val[0])), uintptr(len(val)*2))
	if r != 0 {
		return fmt.Errorf("could not write startup entry (error %d)", r)
	}
	return nil
}

// ---------------- single instance / deck window ----------------

var instanceMutex uintptr

func acquireSingleInstance() bool {
	h, _, err := pCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(u16(`Local\Praxis-Deck-SingleInstance`))))
	if h == 0 {
		return true // could not create; don't block startup
	}
	if errno, ok := err.(syscall.Errno); ok && errno == ERROR_ALREADY_EXISTS {
		pCloseHandle.Call(h)
		return false
	}
	instanceMutex = h
	return true
}

func findBrowser() string {
	var cands []string
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LocalAppData"} {
		if base := os.Getenv(env); base != "" {
			cands = append(cands,
				filepath.Join(base, `Microsoft\Edge\Application\msedge.exe`),
				filepath.Join(base, `Google\Chrome\Application\chrome.exe`))
		}
	}
	for _, c := range cands {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

// browserWindow finds an open Praxis window (deck, bar or Lite) by its exact title.
func browserWindow(title string) uintptr {
	for _, w := range appWindows() {
		if w.title == title && isBrowserExe(w.exe) {
			return w.hwnd
		}
	}
	// minimised windows are still listed; a window off the taskbar is not ours to find
	return 0
}

// openDeck shows the Praxis window: the one already open comes forward, so there is only ever one.
func openDeck(u string) {
	if h := browserWindow("Praxis"); h != 0 {
		forceForeground(h)
		return
	}
	if b := findBrowser(); b != "" {
		if shellOpen(b, `--app=`+u+` --window-size=1360,880`, SW_SHOWNORMAL) == nil {
			return
		}
	}
	_ = shellOpen(u, "", SW_SHOWNORMAL)
}

// floatWindow shows a small always-on-top window (the button bar, Praxis Lite), opening it if needed.
func (p *winPlatform) floatWindow(title, u string, w, h int) {
	go func() {
		defer guard(p.app.log, title)
		hw := browserWindow(title)
		if hw == 0 {
			b := findBrowser()
			if b == "" {
				p.app.log.Warn("%s needs Microsoft Edge or Google Chrome", title)
				return
			}
			if err := shellOpen(b, fmt.Sprintf("--app=%s --window-size=%d,%d", u, w, h), SW_SHOWNORMAL); err != nil {
				p.app.log.Warn("%s: %v", title, err)
				return
			}
			for i := 0; i < 80 && hw == 0; i++ { // up to 8 s for a cold browser start
				time.Sleep(100 * time.Millisecond)
				hw = browserWindow(title)
			}
			if hw == 0 {
				return
			}
			if mons, err := listMonitors(); err == nil {
				for _, m := range mons {
					if m.Primary {
						var rc RECT
						pGetWindowRect.Call(hw, uintptr(unsafe.Pointer(&rc)))
						pSetWindowPos.Call(hw, 0, uintptr(m.work.Right-(rc.Right-rc.Left)-16), uintptr(m.work.Top+16), 0, 0, SWP_NOSIZE|SWP_NOZORDER|SWP_NOACTIVATE)
					}
				}
			}
		}
		if isIconic(hw) {
			showWindow(hw, SW_RESTORE)
		}
		// HWND_TOPMOST (-1): stays above other windows
		pSetWindowPos.Call(hw, ^uintptr(0), 0, 0, 0, 0, SWP_NOMOVE|SWP_NOSIZE|SWP_SHOWWINDOW)
		forceForeground(hw)
	}()
}

// OpenBar shows the floating button bar.
func (p *winPlatform) OpenBar(u string) { p.floatWindow("Praxis Bar", u, 460, 132) }

// OpenLite shows Praxis Lite: one search box over replies, templates, guides and numbers.
func (p *winPlatform) OpenLite(u string) { p.floatWindow("Praxis Lite", u, 440, 640) }

// FocusDeck brings the Praxis window forward (opening it if closed).
func (p *winPlatform) FocusDeck(u string) { go openDeck(u) }

func showError(msg string) { messageBox("Praxis", msg, MB_OK|MB_ICONERROR|MB_TOPMOST) }

// ---------------- tray + message loop ----------------

const (
	cmdOpen = 1 + iota
	cmdRestore
	cmdPause
	cmdIdentify
	cmdQuit
	cmdBar
	cmdLite
	cmdMacroBase = 100
)

var wndProcCB = syscall.NewCallback(func(hwnd, msg, wp, lp uintptr) uintptr {
	return thePlatform.wndProc(hwnd, uint32(msg), wp, lp)
})

var overlayProcCB = syscall.NewCallback(func(hwnd, msg, wp, lp uintptr) uintptr {
	return thePlatform.overlayProc(hwnd, uint32(msg), wp, lp)
})

func (p *winPlatform) nid() NOTIFYICONDATAW {
	var n NOTIFYICONDATAW
	n.CbSize = uint32(unsafe.Sizeof(n))
	n.HWnd = p.hwnd
	n.UID = 1
	return n
}

func (p *winPlatform) addTray() {
	n := p.nid()
	n.UFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
	n.UCallbackMessage = WM_APP_TRAY
	n.HIcon = p.icon
	copyU16(n.SzTip[:], "Praxis")
	pShellNotifyIconW.Call(NIM_ADD, uintptr(unsafe.Pointer(&n)))
}

func (p *winPlatform) removeTray() {
	n := p.nid()
	pShellNotifyIconW.Call(NIM_DELETE, uintptr(unsafe.Pointer(&n)))
}

func (p *winPlatform) setupWindow() error {
	p.hInst, _, _ = pGetModuleHandleW.Call(0)
	// go-winres embeds the icon group as "APP"
	p.icon, _, _ = pLoadImageW.Call(p.hInst, uintptr(unsafe.Pointer(u16("APP"))), IMAGE_ICON, 0, 0, LR_DEFAULTSIZE|LR_SHARED)
	if p.icon == 0 {
		p.icon, _, _ = pLoadIconW.Call(0, 32512) // IDI_APPLICATION
	}
	cursor, _, _ := pLoadCursorW.Call(0, 32512) // IDC_ARROW

	main := WNDCLASSEXW{LpfnWndProc: wndProcCB, HInstance: p.hInst, HIcon: p.icon, HIconSm: p.icon, LpszClassName: u16("PraxisMain")}
	main.CbSize = uint32(unsafe.Sizeof(main))
	if r, _, err := pRegisterClassExW.Call(uintptr(unsafe.Pointer(&main))); r == 0 {
		return fmt.Errorf("RegisterClassEx: %v", err)
	}
	ov := WNDCLASSEXW{LpfnWndProc: overlayProcCB, HInstance: p.hInst, HCursor: cursor, LpszClassName: u16("PraxisOverlay")}
	ov.CbSize = uint32(unsafe.Sizeof(ov))
	pRegisterClassExW.Call(uintptr(unsafe.Pointer(&ov)))

	h, _, err := pCreateWindowExW.Call(0, uintptr(unsafe.Pointer(u16("PraxisMain"))), uintptr(unsafe.Pointer(u16("Praxis"))),
		0, 0, 0, 0, 0, 0, 0, p.hInst, 0)
	if h == 0 {
		return fmt.Errorf("CreateWindowEx: %v", err)
	}
	p.hwnd = h
	p.tbMsg, _, _ = pRegisterWindowMessageW.Call(uintptr(unsafe.Pointer(u16("TaskbarCreated"))))
	return nil
}

// The main goroutine stays on the main OS thread, which owns the tray window,
// the hotkeys and the message loop.
func init() { runtime.LockOSThread() }

// platformInit runs on the main thread before the deck server starts.
func platformInit(app *App) error {
	p := thePlatform
	// Physical pixel coordinates on every monitor (the manifest also declares this).
	if pSetProcessDpiAwarenessCtx.Find() == nil { // missing before Windows 10 1703
		pSetProcessDpiAwarenessCtx.Call(^uintptr(3)) // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 (-4)
	}
	p.uiThread, _, _ = pGetCurrentThreadId.Call()
	ledgerInit(app.dir, app.log)
	if err := p.setupWindow(); err != nil {
		return fmt.Errorf("could not create the tray window: %w", err)
	}
	if !app.cfg.Get().Settings.HideTray {
		p.addTray()
	}
	return nil
}

func (p *winPlatform) SetTrayVisible(visible bool) {
	p.invoke(func() {
		p.removeTray()
		if visible {
			p.addTray()
		}
	})
}

func runMain(app *App) {
	p := thePlatform
	app.eng.ApplyHotkeys()

	cfg := app.cfg.Get()
	if cfg.Settings.RunAtStartup {
		if err := p.SetRunAtStartup(true); err != nil { // refresh path in case the exe moved
			app.log.Warn("run at startup: %v", err)
		}
	}
	go func() { _, _, _ = audioGetBoth() }() // first COM audio call loads DLLs (~100 ms); do it now, not mid-switch
	if cfg.Settings.PrewarmApps {
		go p.Prewarm(cfg.Macros)
	}
	if !app.minimized && cfg.Settings.OpenDeckOnLaunch {
		openDeck(app.srv.URL())
	}

	var msg MSG
	for {
		r, _, _ := pGetMessageW.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		pTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		pDispatchMessageW.Call(uintptr(unsafe.Pointer(&msg)))
	}
	close(p.done)

	// Never leave windows hidden or the PC muted because Praxis was closed mid-panic.
	if len(app.eng.ActiveMacros()) > 0 {
		app.eng.Restore("exit")
	}
	for id := range p.hotkeyIDs {
		pUnregisterHotKey.Call(p.hwnd, uintptr(id))
	}
	p.removeTray()
	pDestroyWindow.Call(p.hwnd)
}

func (p *winPlatform) wndProc(hwnd uintptr, msg uint32, wp, lp uintptr) (ret uintptr) {
	defer func() {
		if r := recover(); r != nil {
			p.app.log.Error("window message %#x fault: %v", msg, r)
			ret, _, _ = pDefWindowProcW.Call(hwnd, uintptr(msg), wp, lp)
		}
	}()
	switch msg {
	case WM_HOTKEY:
		if id, ok := p.hotkeyIDs[int(wp)]; ok {
			go func() { _ = p.app.eng.Trigger(id, "hotkey") }()
		}
		return 0
	case WM_APP_CALL:
		p.callMu.Lock()
		calls := p.calls
		p.calls = nil
		p.callMu.Unlock()
		for _, fn := range calls {
			fn()
		}
		return 0
	case WM_APP_TRAY:
		switch uint32(lp & 0xFFFF) {
		case WM_LBUTTONUP:
			openDeck(p.app.srv.URL())
		case WM_RBUTTONUP, WM_CONTEXTMENU:
			p.showMenu()
		}
		return 0
	case WM_TIMER:
		if wp == 1 {
			pKillTimer.Call(hwnd, 1)
			for h := range p.overlays {
				pDestroyWindow.Call(h)
			}
			p.overlays = map[uintptr][2]string{}
		}
		return 0
	}
	if p.tbMsg != 0 && uintptr(msg) == p.tbMsg {
		if !p.app.cfg.Get().Settings.HideTray {
			p.addTray() // Explorer restarted
		}
		return 0
	}
	r, _, _ := pDefWindowProcW.Call(hwnd, uintptr(msg), wp, lp)
	return r
}

func (p *winPlatform) showMenu() {
	cfg := p.app.cfg.Get()
	m, _, _ := pCreatePopupMenu.Call()
	defer pDestroyMenu.Call(m)
	add := func(flags uintptr, id int, text string) {
		pAppendMenuW.Call(m, flags, uintptr(id), uintptr(unsafe.Pointer(u16(text))))
	}
	add(MF_STRING, cmdOpen, "Open Praxis")
	add(MF_STRING, cmdBar, "Button bar")
	add(MF_STRING, cmdLite, "Praxis Lite")
	add(MF_SEPARATOR, 0, "")
	n := 0
	for i, mac := range cfg.Macros {
		if n >= 15 {
			break
		}
		label := mac.Name
		if mac.Hotkey != "" {
			label += "\t" + mac.Hotkey
		}
		add(MF_STRING, cmdMacroBase+i, label)
		n++
	}
	if n > 0 {
		add(MF_SEPARATOR, 0, "")
	}
	restoreFlags := uintptr(MF_STRING)
	if len(p.app.eng.ActiveMacros()) == 0 {
		restoreFlags |= MF_GRAYED
	}
	add(restoreFlags, cmdRestore, "Return")
	pauseFlags := uintptr(MF_STRING)
	if p.app.eng.Paused() {
		pauseFlags |= MF_CHECKED
	}
	add(pauseFlags, cmdPause, "Pause hotkeys")
	add(MF_STRING, cmdIdentify, "Identify screens")
	add(MF_SEPARATOR, 0, "")
	add(MF_STRING, cmdQuit, "Quit Praxis")

	var pt POINT
	pGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	pSetForegroundWindow.Call(p.hwnd) // required so the menu closes when clicking away
	cmd, _, _ := pTrackPopupMenu.Call(m, TPM_RETURNCMD|TPM_RIGHTBUTTON|TPM_BOTTOMALIGN, uintptr(pt.X), uintptr(pt.Y), 0, p.hwnd, 0)
	pPostMessageW.Call(p.hwnd, WM_NULL, 0, 0)

	switch c := int(cmd); {
	case c == 0:
	case c == cmdOpen:
		openDeck(p.app.srv.URL())
	case c == cmdRestore:
		go p.app.eng.Restore("tray")
	case c == cmdPause:
		go p.app.eng.SetPaused(!p.app.eng.Paused())
	case c == cmdIdentify:
		p.Identify()
	case c == cmdBar:
		p.OpenBar(p.app.srv.URL() + "bar")
	case c == cmdLite:
		p.OpenLite(p.app.srv.URL() + "astra/popup.html")
	case c == cmdQuit:
		pPostQuitMessage.Call(0)
	case c >= cmdMacroBase && c-cmdMacroBase < len(cfg.Macros):
		id := cfg.Macros[c-cmdMacroBase].ID
		go func() { _ = p.app.eng.Trigger(id, "tray") }()
	}
}

// ---------------- identify-screens overlay ----------------

func (p *winPlatform) Identify() {
	mons, err := listMonitors()
	if err != nil {
		p.app.log.Error("identify: %v", err)
		return
	}
	p.invoke(func() {
		for h := range p.overlays {
			pDestroyWindow.Call(h)
		}
		p.overlays = map[uintptr][2]string{}
		for _, m := range mons {
			size := int32(m.H / 3)
			if size < 200 {
				size = 200
			}
			x := int32(m.X) + (int32(m.W)-size)/2
			y := int32(m.Y) + (int32(m.H)-size)/2
			h, _, _ := pCreateWindowExW.Call(WS_EX_TOPMOST|WS_EX_TOOLWINDOW|WS_EX_LAYERED|WS_EX_NOACTIVATE|WS_EX_TRANSPARENT,
				uintptr(unsafe.Pointer(u16("PraxisOverlay"))), 0, WS_POPUP,
				uintptr(x), uintptr(y), uintptr(size), uintptr(size), 0, 0, p.hInst, 0)
			if h == 0 {
				continue
			}
			p.overlays[h] = [2]string{fmt.Sprint(m.Index), fmt.Sprintf("%d × %d", m.W, m.H)}
			pSetLayeredWindowAttrs.Call(h, 0, 235, LWA_ALPHA)
			showWindow(h, SW_SHOWNOACTIVATE)
		}
		pSetTimer.Call(p.hwnd, 1, 2500, 0)
	})
}

func (p *winPlatform) overlayProc(hwnd uintptr, msg uint32, wp, lp uintptr) (ret uintptr) {
	defer func() {
		if recover() != nil {
			ret, _, _ = pDefWindowProcW.Call(hwnd, uintptr(msg), wp, lp)
		}
	}()
	if msg == WM_PAINT {
		var ps PAINTSTRUCT
		hdc, _, _ := pBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		var rc RECT
		pGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
		brush, _, _ := pCreateSolidBrush.Call(0x6A03D7) // #D7036A as 0x00BBGGRR
		pFillRect.Call(hdc, uintptr(unsafe.Pointer(&rc)), brush)
		pDeleteObject.Call(brush)
		pSetBkMode.Call(hdc, TRANSPARENT)
		pSetTextColor.Call(hdc, 0xFFFFFF)
		txt := p.overlays[hwnd]
		h := rc.Bottom - rc.Top
		big, _, _ := pCreateFontW.Call(uintptr(h*6/10), 0, 0, 0, 800, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(u16("Segoe UI"))))
		old, _, _ := pSelectObject.Call(hdc, big)
		top := rc
		top.Bottom = rc.Top + h*8/10
		pDrawTextW.Call(hdc, uintptr(unsafe.Pointer(u16(txt[0]))), ^uintptr(0), uintptr(unsafe.Pointer(&top)), DT_CENTER|DT_VCENTER|DT_SINGLELINE)
		small, _, _ := pCreateFontW.Call(uintptr(h/10), 0, 0, 0, 600, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(u16("Segoe UI"))))
		pSelectObject.Call(hdc, small)
		bottom := rc
		bottom.Top = rc.Top + h*7/10
		pDrawTextW.Call(hdc, uintptr(unsafe.Pointer(u16(txt[1]))), ^uintptr(0), uintptr(unsafe.Pointer(&bottom)), DT_CENTER|DT_VCENTER|DT_SINGLELINE)
		pSelectObject.Call(hdc, old)
		pDeleteObject.Call(big)
		pDeleteObject.Call(small)
		pEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		return 0
	}
	r, _, _ := pDefWindowProcW.Call(hwnd, uintptr(msg), wp, lp)
	return r
}
