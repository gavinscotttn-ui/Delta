package main

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"time"
)

// runSelfTest exercises the real Win32 integration (used by CI on a Windows runner).
// Hard failures return 1; environment gaps (e.g. no audio device on a server) are warnings.
func runSelfTest() int {
	failed := false
	pass := func(f string, a ...any) { fmt.Printf("PASS  "+f+"\n", a...) }
	warn := func(f string, a ...any) { fmt.Printf("WARN  "+f+"\n", a...) }
	fail := func(f string, a ...any) { failed = true; fmt.Printf("FAIL  "+f+"\n", a...) }

	// config + hotkeys
	c := defaultConfig()
	if err := c.Normalize(); err != nil {
		fail("default config invalid: %v", err)
	} else {
		pass("default config valid (%d macros)", len(c.Macros))
	}

	// monitors
	mons, err := listMonitors()
	if err != nil || len(mons) == 0 {
		fail("monitor enumeration: %v (n=%d)", err, len(mons))
	} else {
		for _, m := range mons {
			pass("monitor %d %s %dx%d at %d,%d primary=%v", m.Index, m.Name, m.W, m.H, m.X, m.Y, m.Primary)
		}
	}

	// audio (may legitimately be missing on headless servers)
	if m, err := audioGetMute(false); err != nil {
		warn("speaker endpoint: %v", err)
	} else {
		v, _ := audioGetVolume()
		if err := audioSetMute(false, !m); err != nil {
			fail("SetMute: %v", err)
		} else if m2, _ := audioGetMute(false); m2 == m {
			fail("mute state did not change")
		} else {
			_ = audioSetMute(false, m)
			pass("speaker mute toggled and restored (volume %d%%)", v)
		}
		if err := audioSetVolume(v); err != nil {
			fail("SetVolume: %v", err)
		} else if v2, _ := audioGetVolume(); v2 != v {
			fail("volume round-trip %d -> %d", v, v2)
		} else {
			pass("volume set/get round-trip at %d%%", v)
		}
	}

	// hotkey registration on a real window
	app := &App{log: NewLogger(os.TempDir())}
	newPlatform(app)
	if err := platformInit(app); err != nil {
		fail("tray window: %v", err)
		return 1
	}
	res := thePlatform.ApplyHotkeys([]Macro{{ID: "t", Hotkey: "Ctrl+Alt+Shift+F24"}}, false)
	if res["t"] != "ok" {
		fail("RegisterHotKey: %s", res["t"])
	} else {
		pass("global hotkey registered")
	}
	thePlatform.ApplyHotkeys(nil, false)

	// fill a screen with notepad, then restore
	if len(mons) > 0 {
		app.cfg = &ConfigStore{cfg: c}
		m := &Macro{ID: "fill", Name: "selftest", Undoable: true, Actions: []Action{
			{Type: "fill_screens", Target: "notepad.exe", Match: "notepad.exe", Mode: "maximize", Launch: true, Timeout: 15000, Monitors: []int{1}, CloseOnRestore: true},
		}}
		start := time.Now()
		frame, err := thePlatform.Run(m, func() {})
		ws := findWindows("notepad.exe")
		switch {
		case err != nil:
			warn("fill_screens: %v (desktop session may be unavailable)", err)
		case len(ws) == 0:
			fail("fill_screens reported success but no notepad window found")
		default:
			var rc RECT
			pGetWindowRect.Call(ws[0].hwnd, ptr(&rc))
			if isZoomed(ws[0].hwnd) {
				pass("notepad launched and maximised on screen 1 in %d ms (rect %v)", time.Since(start).Milliseconds(), rc)
			} else {
				fail("notepad not maximised (rect %v)", rc)
			}
		}
		thePlatform.Undo(frame)
		time.Sleep(500 * time.Millisecond)
		pass("undo ran (notepad sent WM_CLOSE)")
	}

	// window enumeration
	wins := appWindows()
	pass("enumerated %d app windows", len(wins))

	// deck HTTP API with token guard
	cfgDir, _ := os.MkdirTemp("", "praxis-selftest")
	defer os.RemoveAll(cfgDir)
	store, err := LoadConfigStore(cfgDir)
	if err != nil {
		fail("config store: %v", err)
	} else {
		eng := NewEngine(store, thePlatform, app.log)
		srv := NewServer(eng, store, thePlatform, app.log)
		ts := httptest.NewServer(srv.Handler())
		defer ts.Close()
		u := strings.Replace(ts.URL, "127.0.0.1", "localhost", 1)
		req, _ := http.NewRequest("GET", u+"/api/state", nil)
		req.Header.Set("X-Praxis-Token", srv.token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil || resp.StatusCode != 200 {
			fail("GET /api/state: %v %v", err, resp)
		} else {
			b, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			pass("deck API responded (%d bytes)", len(b))
		}
	}

	if failed {
		fmt.Println("SELFTEST FAILED")
		return 1
	}
	fmt.Println("SELFTEST OK")
	return 0
}
