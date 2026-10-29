package main

import (
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

type savedWin struct {
	hwnd      uintptr
	placement WINDOWPLACEMENT
}

// winFrame records everything a macro run changed so Restore can put it back.
type winFrame struct {
	audioSaved    bool
	muted         bool
	volume        int
	micSaved      bool
	micMuted      bool
	minimized     []savedWin
	hidden        []uintptr
	moved         []savedWin
	launched      []uintptr
	webWindows    []uintptr
	closeLaunched bool
	closeWeb      bool
	mediaUndo     []string
	prevFG        uintptr

	snap []winRef // window list for this run; nil until first needed, reset after launches
}

// windows returns the run's window snapshot, enumerating at most once until a launch.
func (f *winFrame) windows() []winRef {
	if f.snap == nil {
		f.snap = appWindows()
	}
	return f.snap
}

func (f *winFrame) find(spec string) []winRef { return filterWindows(f.windows(), spec) }

func (f *winFrame) empty() bool {
	return !f.audioSaved && !f.micSaved && len(f.minimized) == 0 && len(f.hidden) == 0 &&
		len(f.moved) == 0 && len(f.launched) == 0 && len(f.mediaUndo) == 0
}

func (f *winFrame) saveAudio() {
	if f.audioSaved {
		return
	}
	m, err1 := audioGetMute(false)
	v, err2 := audioGetVolume()
	if err1 == nil && err2 == nil {
		f.audioSaved, f.muted, f.volume = true, m, v
	}
}

func (f *winFrame) saveMic() {
	if f.micSaved {
		return
	}
	if m, err := audioGetMute(true); err == nil {
		f.micSaved, f.micMuted = true, m
	}
}

var mediaVK = map[string]uint16{"play_pause": 0xB3, "stop": 0xB2, "next": 0xB0, "prev": 0xB1}

func (p *winPlatform) Run(m *Macro, restore func()) (any, error) {
	runtime.LockOSThread() // AttachThreadInput is per-thread
	defer runtime.UnlockOSThread()

	f := &winFrame{prevFG: foreground()}
	if m.Undoable {
		// Discretion: the Praxis window itself never stays on screen during a switch.
		for _, w := range f.windows() {
			if (w.title == "Praxis" || w.title == "Praxis Bar") && isBrowserExe(w.exe) {
				f.stash(w.hwnd, false)
			}
		}
	}
	used := map[uintptr]bool{} // windows already placed in this run
	var errs []string
	for i, a := range m.Actions {
		if a.Disabled {
			continue
		}
		if err := p.runAction(&a, f, used, restore); err != nil {
			errs = append(errs, fmt.Sprintf("step %d (%s): %v", i+1, a.Type, err))
			p.app.log.Warn("%s step %d (%s): %v", m.Name, i+1, a.Type, err)
		}
	}
	var err error
	if len(errs) > 0 {
		err = errors.New(strings.Join(errs, "; "))
	}
	if f.empty() {
		return nil, err
	}
	return f, err
}

func (p *winPlatform) runAction(a *Action, f *winFrame, used map[uintptr]bool, restore func()) error {
	switch a.Type {
	case "mute", "unmute", "toggle_mute":
		f.saveAudio()
		want := a.Type == "mute"
		if a.Type == "toggle_mute" {
			cur, err := audioGetMute(false)
			if err != nil {
				return err
			}
			want = !cur
		}
		return audioSetMute(false, want)
	case "set_volume":
		f.saveAudio()
		return audioSetVolume(a.Value)
	case "volume_step":
		f.saveAudio()
		v, err := audioGetVolume()
		if err != nil {
			return err
		}
		return audioSetVolume(v + a.Value)
	case "mic_mute", "mic_unmute", "mic_toggle":
		f.saveMic()
		want := a.Type == "mic_mute"
		if a.Type == "mic_toggle" {
			cur, err := audioGetMute(true)
			if err != nil {
				return err
			}
			want = !cur
		}
		return audioSetMute(true, want)
	case "media":
		if err := sendKeyEvents([]INPUT{keyInput(mediaVK[a.Target], false), keyInput(mediaVK[a.Target], true)}); err != nil {
			return err
		}
		if a.Undo {
			f.mediaUndo = append(f.mediaUndo, a.Target)
		}
	case "minimize_foreground":
		h := foreground()
		if h == 0 || !isAppWindow(h, false) || windowPID(h) == ownPID {
			return nil
		}
		f.stash(h, a.Mode == "hide")
	case "minimize_apps":
		for _, w := range f.find(a.Match) {
			f.stash(w.hwnd, a.Mode == "hide")
		}
	case "minimize_all":
		for _, w := range f.windows() {
			if !isIconic(w.hwnd) {
				f.stash(w.hwnd, false)
			}
		}
	case "fill_screens":
		return p.fillScreens(a, f, used)
	case "launch":
		show := map[string]int{"normal": SW_SHOWNORMAL, "minimized": SW_SHOWMINNOACTIVE, "maximized": SW_MAXIMIZE}[a.Mode]
		return shellOpen(a.Target, a.Args, show)
	case "open_url":
		return shellOpen(strings.TrimSpace(a.Target), "", SW_SHOWNORMAL)
	case "focus_app":
		ws := f.find(a.Match)
		if len(ws) == 0 {
			// minimised windows are still "visible" so this covers them too
			return fmt.Errorf("no window matches %q", a.Match)
		}
		forceForeground(ws[0].hwnd)
	case "close_app":
		for _, w := range f.find(a.Match) {
			pPostMessageW.Call(w.hwnd, WM_CLOSE, 0, 0)
		}
	case "send_keys":
		h, err := ParseKeyChord(a.Keys)
		if err != nil {
			return err
		}
		return sendChord(h)
	case "type_text":
		return typeText(a.Text)
	case "wait":
		time.Sleep(time.Duration(a.Value) * time.Millisecond)
	case "lock":
		if r, _, err := pLockWorkStation.Call(); r == 0 {
			return err
		}
	case "monitors_off":
		// HWND_BROADCAST, SC_MONITORPOWER, 2 = off. Posted so a hung window cannot block us.
		pPostMessageW.Call(0xFFFF, WM_SYSCOMMAND, 0xF170, 2)
	case "clear_clipboard":
		if r, _, err := pOpenClipboard.Call(0); r == 0 {
			return fmt.Errorf("clipboard busy: %v", err)
		}
		pEmptyClipboard.Call()
		pCloseClipboard.Call()
	case "run_command":
		cmd := exec.Command("cmd.exe", "/C", a.Target)
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
		if err := cmd.Start(); err != nil {
			return err
		}
		go func() { _ = cmd.Wait() }()
	case "notify":
		p.Notify("Praxis", a.Text)
	case "restore":
		restore()
	default:
		return fmt.Errorf("unsupported action %q", a.Type)
	}
	return nil
}

// stash minimises or hides a window and records how to bring it back.
func (f *winFrame) stash(h uintptr, hide bool) {
	for _, s := range f.minimized {
		if s.hwnd == h {
			return
		}
	}
	for _, x := range f.hidden {
		if x == h {
			return
		}
	}
	wp, ok := getPlacement(h)
	if hide {
		f.hidden = append(f.hidden, h)
		if ok {
			f.minimized = append(f.minimized, savedWin{h, wp})
		}
		ledgerAdd(h) // recorded first, so a crash after this point can't strand it
		showWindow(h, SW_HIDE)
		return
	}
	if !ok {
		return
	}
	f.minimized = append(f.minimized, savedWin{h, wp})
	showWindow(h, SW_MINIMIZE)
}

func (p *winPlatform) fillScreens(a *Action, f *winFrame, used map[uintptr]bool) error {
	all, err := listMonitors()
	if err != nil {
		return err
	}
	var mons []monInfo
	if len(a.Monitors) == 0 {
		mons = all
	} else {
		for _, n := range a.Monitors {
			if n >= 1 && n <= len(all) {
				mons = append(mons, all[n-1])
			}
		}
		if len(mons) == 0 {
			return fmt.Errorf("none of screens %v are connected (found %d)", a.Monitors, len(all))
		}
	}
	match := a.Match
	if match == "" {
		match = matchFromTarget(a.Target)
	}
	target, args := a.Target, a.Args
	web := isWebTarget(a.Target)
	if web {
		browser := findBrowser()
		if browser == "" {
			return errors.New("websites need Microsoft Edge or Google Chrome installed")
		}
		target = browser
		args = "--new-window " + syscall.EscapeArg(strings.TrimSpace(a.Target))
		match = filepath.Base(browser)
		f.closeWeb = true // close the page window on Return rather than leaving it behind
	}
	if a.CloseOnRestore {
		f.closeLaunched = true
	}

	var existing []winRef
	if !web { // never reuse an existing browser window: it shows something else
		for _, w := range f.find(match) {
			if !used[w.hwnd] {
				existing = append(existing, w)
			}
		}
	}
	var placed []uintptr
	var errs []string
	for i, mon := range mons {
		var h uintptr
		if i < len(existing) {
			h = existing[i].hwnd
		} else if a.Launch {
			known := map[uintptr]bool{}
			for _, w := range f.find(match) {
				known[w.hwnd] = true
			}
			for k := range used {
				known[k] = true
			}
			if err := shellOpen(target, args, SW_SHOWNORMAL); err != nil {
				return err
			}
			w, ok := waitForNewWindow(match, known, time.Duration(a.Timeout)*time.Millisecond)
			if !ok {
				errs = append(errs, fmt.Sprintf("no new %q window appeared for screen %d within %d ms", match, mon.Index, a.Timeout))
				break
			}
			h = w.hwnd
			f.launched = append(f.launched, h)
			f.snap = nil // a new window exists now
			if web {
				f.webWindows = append(f.webWindows, h)
			}
		} else {
			if i == 0 {
				errs = append(errs, fmt.Sprintf("%q is not running (enable 'launch if needed')", match))
			}
			break
		}
		// If an earlier step stashed this window it is being re-used: remember its
		// pre-macro placement (not the minimised one) for Restore.
		prior, wasStashed := f.unstash(h)
		if !contains(f.launched, h) {
			if wasStashed {
				f.moved = append(f.moved, savedWin{h, prior})
			} else if wp, ok := getPlacement(h); ok {
				f.moved = append(f.moved, savedWin{h, wp})
			}
		}
		used[h] = true
		placeOnMonitor(h, mon, a.Mode)
		placed = append(placed, h)
	}
	// Focus the window on the first selected screen last so it ends up on top.
	for i := len(placed) - 1; i >= 0; i-- {
		forceForeground(placed[i])
	}
	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}
	return nil
}

func (f *winFrame) unstash(h uintptr) (WINDOWPLACEMENT, bool) {
	var wp WINDOWPLACEMENT
	found := false
	for i, s := range f.minimized {
		if s.hwnd == h {
			wp, found = s.placement, true
			f.minimized = append(f.minimized[:i], f.minimized[i+1:]...)
			break
		}
	}
	for i, x := range f.hidden {
		if x == h {
			f.hidden = append(f.hidden[:i], f.hidden[i+1:]...)
			showWindow(h, SW_SHOWNOACTIVATE)
			ledgerRemove(h)
			break
		}
	}
	return wp, found
}

func isBrowserExe(exe string) bool {
	e := strings.ToLower(exe)
	return e == "msedge.exe" || e == "chrome.exe"
}

func contains(s []uintptr, h uintptr) bool {
	for _, x := range s {
		if x == h {
			return true
		}
	}
	return false
}

func (p *winPlatform) Undo(frame any) {
	f, ok := frame.(*winFrame)
	if !ok || f == nil {
		return
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	for _, h := range f.launched {
		if !isWindow(h) {
			continue
		}
		if f.closeLaunched || (f.closeWeb && contains(f.webWindows, h)) {
			pPostMessageW.Call(h, WM_CLOSE, 0, 0)
		} else {
			showWindow(h, SW_MINIMIZE)
		}
	}
	for i := len(f.moved) - 1; i >= 0; i-- {
		if s := f.moved[i]; isWindow(s.hwnd) {
			setPlacement(s.hwnd, s.placement)
		}
	}
	for _, h := range f.hidden {
		if isWindow(h) {
			showWindow(h, SW_SHOWNOACTIVATE)
		}
		ledgerRemove(h)
	}
	for i := len(f.minimized) - 1; i >= 0; i-- {
		s := f.minimized[i]
		if !isWindow(s.hwnd) {
			continue
		}
		wp := s.placement
		switch wp.ShowCmd {
		case SW_SHOWMINIMIZED, SW_MINIMIZE, SW_SHOWMINNOACTIVE:
			wp.ShowCmd = SW_SHOWMINNOACTIVE
		case SW_MAXIMIZE:
			// keep maximised
		default:
			wp.ShowCmd = SW_SHOWNOACTIVATE
		}
		setPlacement(s.hwnd, wp)
	}
	if f.audioSaved {
		_ = audioSetVolume(f.volume)
		_ = audioSetMute(false, f.muted)
	}
	if f.micSaved {
		_ = audioSetMute(true, f.micMuted)
	}
	for _, k := range f.mediaUndo {
		_ = sendKeyEvents([]INPUT{keyInput(mediaVK[k], false), keyInput(mediaVK[k], true)})
	}
	if f.prevFG != 0 && isWindow(f.prevFG) {
		forceForeground(f.prevFG)
	}
}

// Prewarm launches fill-screen apps minimised so a later panic is instant.
func (p *winPlatform) Prewarm(macros []Macro) {
	seen := map[string]bool{}
	for _, m := range macros {
		for _, a := range m.Actions {
			if a.Type != "fill_screens" || a.Disabled || !a.Launch || a.Target == "" || isWebTarget(a.Target) {
				continue
			}
			match := a.Match
			if match == "" {
				match = matchFromTarget(a.Target)
			}
			key := strings.ToLower(match)
			if seen[key] {
				continue
			}
			seen[key] = true
			if len(findWindows(match)) > 0 {
				continue
			}
			if err := shellOpen(a.Target, a.Args, SW_SHOWMINNOACTIVE); err != nil {
				p.app.log.Warn("pre-launch %s: %v", a.Target, err)
			} else {
				p.app.log.Info("pre-launched %s (minimised) for instant panic", a.Target)
			}
		}
	}
}
