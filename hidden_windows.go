package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// The hidden ledger lists windows Praxis has hidden (removed from the taskbar), on
// disk, so that if Praxis is killed mid-switch they are shown again at next start
// instead of being stranded invisible.
type hiddenEntry struct {
	HWND uint64 `json:"hwnd"`
	PID  uint32 `json:"pid"`
	Path string `json:"path"`
	Boot int64  `json:"boot"` // unix seconds the PC booted; HWNDs mean nothing after a restart
}

var ledger struct {
	mu      sync.Mutex
	path    string
	entries map[uintptr]hiddenEntry
}

var pGetTickCount64 = kernel32.NewProc("GetTickCount64")

func bootTime() int64 {
	ms, _, _ := pGetTickCount64.Call()
	return time.Now().Add(-time.Duration(ms) * time.Millisecond).Unix()
}

// ledgerInit restores anything a previous run left hidden, then starts a fresh ledger.
func ledgerInit(dir string, log *Logger) {
	ledger.mu.Lock()
	defer ledger.mu.Unlock()
	ledger.entries = map[uintptr]hiddenEntry{}
	if dir == "" {
		return
	}
	ledger.path = filepath.Join(dir, "hidden.json")
	b, err := os.ReadFile(ledger.path)
	if err != nil {
		return
	}
	var list []hiddenEntry
	_ = json.Unmarshal(b, &list)
	boot, shown := bootTime(), 0
	for _, e := range list {
		h := uintptr(e.HWND)
		d := boot - e.Boot
		if d < -60 || d > 60 || !isWindow(h) {
			continue // a different boot, or the window has gone
		}
		// the same window and program as before, not a reused handle
		if windowPID(h) != e.PID || processPath(e.PID) != e.Path {
			continue
		}
		if v, _, _ := pIsWindowVisible.Call(h); v == 0 {
			showWindow(h, SW_SHOWNOACTIVATE)
			shown++
		}
	}
	_ = os.Remove(ledger.path)
	if shown > 0 && log != nil {
		log.Info("brought back %d window(s) left hidden when Praxis last closed", shown)
	}
}

func ledgerAdd(h uintptr) {
	pid := windowPID(h)
	e := hiddenEntry{HWND: uint64(h), PID: pid, Path: processPath(pid), Boot: bootTime()}
	ledger.mu.Lock()
	defer ledger.mu.Unlock()
	if ledger.entries == nil {
		ledger.entries = map[uintptr]hiddenEntry{}
	}
	ledger.entries[h] = e
	ledgerWrite()
}

func ledgerRemove(h uintptr) {
	ledger.mu.Lock()
	defer ledger.mu.Unlock()
	if _, ok := ledger.entries[h]; !ok {
		return
	}
	delete(ledger.entries, h)
	ledgerWrite()
}

func ledgerWrite() {
	if ledger.path == "" {
		return
	}
	if len(ledger.entries) == 0 {
		_ = os.Remove(ledger.path)
		return
	}
	list := make([]hiddenEntry, 0, len(ledger.entries))
	for _, e := range ledger.entries {
		list = append(list, e)
	}
	b, _ := json.Marshal(list)
	tmp := ledger.path + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		_ = os.Rename(tmp, ledger.path)
	}
}
