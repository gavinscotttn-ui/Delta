//go:build !windows

package main

import (
	"errors"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"
)

// simPlatform lets the deck be developed and tested off-Windows. Nothing is
// actually muted or moved; every action is logged as simulated.
type simPlatform struct {
	app *App
	mu  sync.Mutex
	a   AudioState
}

func newPlatform(app *App) Platform {
	return &simPlatform{app: app, a: AudioState{Volume: 40, Available: true}}
}

func (p *simPlatform) Monitors() ([]Monitor, error) {
	return []Monitor{
		{Index: 1, Name: "SIM1", Primary: true, X: 0, Y: 0, W: 2560, H: 1440},
		{Index: 2, Name: "SIM2", X: 2560, Y: 200, W: 1920, H: 1080},
	}, nil
}

func (p *simPlatform) Windows() ([]WinInfo, error) {
	return []WinInfo{
		{Title: "Netflix - Google Chrome", Exe: "chrome.exe", Path: `C:\Program Files\Google\Chrome\Application\chrome.exe`},
		{Title: "Book1 - Excel", Exe: "EXCEL.EXE", Path: `C:\Program Files\Microsoft Office\root\Office16\EXCEL.EXE`},
	}, nil
}

func (p *simPlatform) Audio() AudioState {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.a
}

func (p *simPlatform) SetMute(mic, muted bool) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if mic {
		p.a.MicMuted = muted
	} else {
		p.a.Muted = muted
	}
	return nil
}

func (p *simPlatform) SetVolume(v int) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.a.Volume = v
	return nil
}

type simFrame struct{ muted bool }

func (p *simPlatform) Run(m *Macro, restore func()) (any, error) {
	f := &simFrame{muted: p.Audio().Muted}
	for i, a := range m.Actions {
		if a.Disabled {
			continue
		}
		switch a.Type {
		case "mute":
			_ = p.SetMute(false, true)
		case "unmute":
			_ = p.SetMute(false, false)
		case "toggle_mute":
			_ = p.SetMute(false, !p.Audio().Muted)
		case "mic_mute":
			_ = p.SetMute(true, true)
		case "mic_unmute":
			_ = p.SetMute(true, false)
		case "mic_toggle":
			_ = p.SetMute(true, !p.Audio().MicMuted)
		case "set_volume":
			_ = p.SetVolume(a.Value)
		case "open_lite":
			p.OpenLite(p.app.srv.URL() + "astra/popup.html")
		case "triage_clipboard":
			p.app.srv.Show("triage-clipboard")
		case "restore":
			restore()
		}
		p.app.log.Info("  [sim] step %d: %s", i+1, a.Type)
	}
	return f, nil
}

func (p *simPlatform) Undo(frame any) {
	if f, ok := frame.(*simFrame); ok {
		_ = p.SetMute(false, f.muted)
	}
}

func (p *simPlatform) ApplyHotkeys(macros []Macro, paused bool) map[string]string {
	out := map[string]string{}
	for _, m := range macros {
		if m.Hotkey == "" {
			continue
		}
		if paused {
			out[m.ID] = "paused"
		} else {
			out[m.ID] = "ok"
		}
	}
	return out
}

func (p *simPlatform) Identify()                  { p.app.log.Info("[sim] identify screens") }
func (p *simPlatform) SetRunAtStartup(bool) error { return errors.New("only supported on Windows") }
func (p *simPlatform) Notify(title, msg string)   { p.app.log.Info("[sim] notify: %s", msg) }
func (p *simPlatform) Prewarm(macros []Macro)     {}
func (p *simPlatform) OpenLite(u string)          { p.app.log.Info("[sim] lite %s", u) }
func (p *simPlatform) FocusDeck(u string)         { p.app.log.Info("[sim] focus %s", u) }
func (p *simPlatform) OpenBar(u string)           { p.app.log.Info("[sim] bar %s", u) }
func (p *simPlatform) SetTrayVisible(bool)        {}
func acquireSingleInstance() bool                 { return true }
func openDeck(u string)                           { fmt.Println("Deck:", u) }
func showError(msg string)                        {}
func runSelfTest() int                            { fmt.Println("self-test is Windows-only"); return 0 }

func platformInit(app *App) error { return nil }

func runMain(app *App) {
	app.eng.ApplyHotkeys()
	fmt.Println("Praxis (simulation mode) deck:", app.srv.URL())
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, os.Interrupt, syscall.SIGTERM)
	<-ch
}
