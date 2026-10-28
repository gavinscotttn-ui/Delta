package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"time"
)

type App struct {
	dir  string
	cfg  *ConfigStore
	log  *Logger
	eng  *Engine
	srv  *Server
	plat Platform
	http *http.Server

	minimized bool
}

func main() {
	minimized := flag.Bool("minimized", false, "start in the tray without opening the deck")
	selftest := flag.Bool("selftest", false, "run Windows integration self-test and exit")
	flag.Parse()

	if *selftest {
		os.Exit(runSelfTest())
	}

	dir := configDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		fatal("Praxis could not create its settings folder:\n" + err.Error())
	}
	setupCrashLog(dir)
	defer func() {
		if r := recover(); r != nil {
			msg := fmt.Sprintf("%v\n\n%s", r, debug.Stack())
			_ = os.WriteFile(filepath.Join(dir, "crash.log"), []byte(msg), 0o600)
			fatal("Praxis hit a problem and has to close:\n\n" + fmt.Sprint(r) + "\n\nDetails: " + filepath.Join(dir, "crash.log"))
		}
	}()
	if !acquireSingleInstance() {
		// Another Praxis is running: just bring its deck up.
		if u := readDeckURL(dir); u != "" {
			openDeck(u)
		}
		return
	}

	log := NewLogger(dir)
	cfg, err := LoadConfigStore(dir)
	if cfg == nil {
		fatal("Praxis could not load its settings:\n" + err.Error())
	}
	if err != nil {
		log.Warn("%v", err)
	}
	app := &App{dir: dir, cfg: cfg, log: log, minimized: *minimized}
	app.plat = newPlatform(app)
	app.eng = NewEngine(cfg, app.plat, log)
	app.srv = NewServer(app.eng, cfg, app.plat, log)
	app.srv.onConfigChanged = app.configChanged
	if err := platformInit(app); err != nil {
		fatal("Praxis could not start:\n" + err.Error())
	}

	c := cfg.Get()
	ln, err := app.srv.Listen(c.Settings.Port)
	if err != nil {
		fatal("Praxis could not start its control deck:\n" + err.Error())
	}
	app.http = &http.Server{Handler: app.srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := app.http.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("deck server stopped: %v", err)
		}
	}()
	writeDeckURL(dir, app.srv.URL())
	app.srv.SyncRemote(c)
	log.Info("Praxis %s started; deck at %s", version, app.srv.URL())

	runMain(app) // blocks until quit (tray loop on Windows)

	app.shutdown()
}

func (a *App) configChanged(old, new Config) {
	if old.Settings.RunAtStartup != new.Settings.RunAtStartup {
		if err := a.plat.SetRunAtStartup(new.Settings.RunAtStartup); err != nil {
			a.log.Error("run at startup: %v", err)
		}
	}
	a.srv.SyncRemote(new)
}

func (a *App) shutdown() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = a.http.Shutdown(ctx)
	a.srv.SyncRemote(Config{})
	_ = os.Remove(filepath.Join(a.dir, "deck.url"))
	if st, err := os.Stat(filepath.Join(a.dir, "crash.log")); err == nil && st.Size() == 0 {
		_ = os.Remove(filepath.Join(a.dir, "crash.log"))
	}
	a.log.Info("Praxis stopped")
}

func writeDeckURL(dir, u string) {
	_ = os.WriteFile(filepath.Join(dir, "deck.url"), []byte(u), 0o600)
}

func readDeckURL(dir string) string {
	b, err := os.ReadFile(filepath.Join(dir, "deck.url"))
	if err != nil {
		return ""
	}
	u := strings.TrimSpace(string(b))
	if !strings.HasPrefix(u, "http://127.0.0.1:") {
		return ""
	}
	return u
}

func fatal(msg string) {
	showError(msg)
	fmt.Fprintln(os.Stderr, msg)
	os.Exit(1)
}
