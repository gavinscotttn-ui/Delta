package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"time"
)

// setupCrashLog makes every crash leave evidence: fatal errors from any
// goroutine are written to crash.log, and the next launch reports them.
func setupCrashLog(dir string) {
	p := filepath.Join(dir, "crash.log")
	if b, err := os.ReadFile(p); err == nil && len(strings.TrimSpace(string(b))) > 0 {
		_ = os.Rename(p, filepath.Join(dir, "crash-previous.log"))
		first := string(b)
		if len(first) > 600 {
			first = first[:600] + "…"
		}
		showError("Praxis closed unexpectedly last time. It has restarted normally.\n\n" +
			"Details were saved to:\n" + filepath.Join(dir, "crash-previous.log") + "\n\n" + first)
	}
	f, err := os.OpenFile(p, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return
	}
	_ = debug.SetCrashOutput(f, debug.CrashOptions{})
	f.Close() // SetCrashOutput keeps its own duplicate handle
}

// guard recovers a panic, logs it and keeps Praxis alive.
func guard(log *Logger, where string) {
	if r := recover(); r != nil {
		msg := fmt.Sprintf("%v\n%s", r, debug.Stack())
		if log != nil {
			log.Error("recovered from a fault in %s: %v", where, r)
		}
		if dir := configDir(); dir != "" {
			_ = os.WriteFile(filepath.Join(dir, "fault-"+time.Now().Format("20060102-150405")+".log"), []byte(where+": "+msg), 0o600)
		}
	}
}
