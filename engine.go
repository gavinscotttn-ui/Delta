package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Monitor is a physical display, numbered 1..n left-to-right (primary first on ties).
type Monitor struct {
	Index   int    `json:"index"`
	Name    string `json:"name"`
	Primary bool   `json:"primary"`
	X       int    `json:"x"`
	Y       int    `json:"y"`
	W       int    `json:"w"`
	H       int    `json:"h"`
}

type WinInfo struct {
	Title string `json:"title"`
	Exe   string `json:"exe"`
	Path  string `json:"path"`
}

type AudioState struct {
	Muted     bool   `json:"muted"`
	Volume    int    `json:"volume"`
	MicMuted  bool   `json:"micMuted"`
	Error     string `json:"error,omitempty"`
	MicError  string `json:"micError,omitempty"`
	Available bool   `json:"available"`
}

// Platform is implemented per OS (platform_windows.go, platform_other.go).
type Platform interface {
	Monitors() ([]Monitor, error)
	Windows() ([]WinInfo, error)
	Audio() AudioState
	SetMute(mic bool, muted bool) error
	SetVolume(pct int) error
	// Run executes a macro's actions. The returned frame (may be nil) can be passed to Undo.
	Run(m *Macro, restore func()) (frame any, err error)
	Undo(frame any)
	ApplyHotkeys(macros []Macro, paused bool) map[string]string
	Identify()
	SetRunAtStartup(enabled bool) error
	Notify(title, msg string)
	Prewarm(macros []Macro)
	SetTrayVisible(visible bool)
	OpenBar(url string) // small always-on-top window of shortcut buttons
}

// ---- activity log ----

type LogEntry struct {
	Time  time.Time `json:"time"`
	Level string    `json:"level"`
	Msg   string    `json:"msg"`
}

type Logger struct {
	mu   sync.Mutex
	ring []LogEntry
	file *os.File
	dir  string
}

// NewLogger keeps history in memory only; SetPersist(true) also appends to praxis.log.
func NewLogger(dir string) *Logger { return &Logger{dir: dir} }

func (l *Logger) SetPersist(on bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if !on {
		if l.file != nil {
			_ = l.file.Close()
			l.file = nil
		}
		return
	}
	if l.file != nil || l.dir == "" {
		return
	}
	p := filepath.Join(l.dir, "praxis.log")
	if st, err := os.Stat(p); err == nil && st.Size() > 1<<20 {
		_ = os.Rename(p, p+".1")
	}
	if f, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600); err == nil {
		l.file = f
	}
}

func (l *Logger) add(level, format string, args ...any) {
	e := LogEntry{Time: time.Now(), Level: level, Msg: fmt.Sprintf(format, args...)}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.ring = append(l.ring, e)
	if len(l.ring) > 200 {
		l.ring = l.ring[len(l.ring)-200:]
	}
	if l.file != nil {
		fmt.Fprintf(l.file, "%s [%s] %s\n", e.Time.Format(time.RFC3339), level, e.Msg)
	}
}

// Close releases the log file (Windows cannot delete an open file).
func (l *Logger) Close() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file != nil {
		_ = l.file.Close()
		l.file = nil
	}
}

func (l *Logger) Info(f string, a ...any)  { l.add("info", f, a...) }
func (l *Logger) Warn(f string, a ...any)  { l.add("warn", f, a...) }
func (l *Logger) Error(f string, a ...any) { l.add("error", f, a...) }

func (l *Logger) Entries() []LogEntry {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]LogEntry(nil), l.ring...)
}

// ---- engine: serialises macro runs and owns the undo stack ----

type undoEntry struct {
	macroID string
	frame   any
}

type Engine struct {
	cfg  *ConfigStore
	plat Platform
	log  *Logger

	runMu sync.Mutex // one macro at a time

	mu      sync.Mutex
	stack   []undoEntry
	paused  bool
	hotkeys map[string]string
}

func NewEngine(cfg *ConfigStore, plat Platform, log *Logger) *Engine {
	return &Engine{cfg: cfg, plat: plat, log: log, hotkeys: map[string]string{}}
}

var errUnknownMacro = errors.New("unknown macro")

// Trigger runs a macro (or reverts it if it is a toggle that is currently active).
func (e *Engine) Trigger(id, source string) error {
	cfg := e.cfg.Get()
	m := cfg.Find(id)
	if m == nil {
		return errUnknownMacro
	}
	e.runMu.Lock()
	defer e.runMu.Unlock()
	defer guard(e.log, "macro "+m.Name)

	if m.Toggle && e.isActive(id) {
		e.log.Info("%s → %s (toggle off: restoring)", source, m.Name)
		e.restoreLocked()
		return nil
	}
	start := time.Now()
	frame, err := e.plat.Run(m, e.restoreLocked)
	if m.Undoable && frame != nil {
		e.mu.Lock()
		e.stack = append(e.stack, undoEntry{macroID: id, frame: frame})
		if len(e.stack) > 50 {
			e.stack = e.stack[len(e.stack)-50:]
		}
		e.mu.Unlock()
	}
	ms := time.Since(start).Milliseconds()
	if err != nil {
		e.log.Warn("%s → %s finished with problems in %d ms: %v", source, m.Name, ms, err)
	} else {
		e.log.Info("%s → %s done in %d ms", source, m.Name, ms)
	}
	if cfg.Settings.NotifyOnRun {
		e.plat.Notify("", m.Name)
	}
	return err
}

func (e *Engine) isActive(id string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, u := range e.stack {
		if u.macroID == id {
			return true
		}
	}
	return false
}

// Restore reverts every recorded undoable macro, newest first.
func (e *Engine) Restore(source string) {
	e.runMu.Lock()
	defer e.runMu.Unlock()
	defer guard(e.log, "restore")
	e.log.Info("%s → restore", source)
	e.restoreLocked()
}

func (e *Engine) restoreLocked() {
	e.mu.Lock()
	stack := e.stack
	e.stack = nil
	e.mu.Unlock()
	if len(stack) == 0 {
		e.log.Info("nothing to restore")
		return
	}
	for i := len(stack) - 1; i >= 0; i-- {
		e.plat.Undo(stack[i].frame)
	}
	e.log.Info("restored %d macro run(s)", len(stack))
}

func (e *Engine) ActiveMacros() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	seen := map[string]bool{}
	out := []string{}
	for _, u := range e.stack {
		if !seen[u.macroID] {
			seen[u.macroID] = true
			out = append(out, u.macroID)
		}
	}
	return out
}

func (e *Engine) ApplyHotkeys() {
	cfg := e.cfg.Get()
	e.mu.Lock()
	paused := e.paused
	e.mu.Unlock()
	res := e.plat.ApplyHotkeys(cfg.Macros, paused)
	e.mu.Lock()
	e.hotkeys = res
	e.mu.Unlock()
	for id, st := range res {
		if st != "ok" && st != "paused" {
			if m := cfg.Find(id); m != nil {
				e.log.Warn("hotkey %s for %q: %s", m.Hotkey, m.Name, st)
			}
		}
	}
}

func (e *Engine) SetPaused(p bool) {
	e.mu.Lock()
	changed := e.paused != p
	e.paused = p
	e.mu.Unlock()
	if changed {
		e.ApplyHotkeys()
		if p {
			e.log.Info("hotkeys paused")
		} else {
			e.log.Info("hotkeys resumed")
		}
	}
}

func (e *Engine) Paused() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.paused
}

func (e *Engine) HotkeyStatus() map[string]string {
	e.mu.Lock()
	defer e.mu.Unlock()
	out := make(map[string]string, len(e.hotkeys))
	for k, v := range e.hotkeys {
		out[k] = v
	}
	return out
}
