package main

import (
	"crypto/rand"
	"crypto/subtle"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

//go:embed web/index.html
var indexHTML string

//go:embed web/bar.html
var barHTML string

//go:embed assets/logo.png
var logoPNG []byte

//go:embed assets/icon.png
var iconPNG []byte

// version is stamped by the release build (-X main.version=...).
var version = "dev"

type Server struct {
	eng   *Engine
	cfg   *ConfigStore
	plat  Platform
	log   *Logger
	token string
	port  int

	onConfigChanged func(old, new Config)

	items map[string]*ItemStore // "notes", "templates"
	kv    *KVStore              // Astra's workspace

	showMu  sync.Mutex
	pending string // for the main window: "guide=<id>", "reply=<id>" or "triage-clipboard"

	audioMu  sync.Mutex
	audioAt  time.Time
	audioVal AudioState
}

func newToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}
	return hex.EncodeToString(b)
}

func NewServer(eng *Engine, cfg *ConfigStore, plat Platform, log *Logger) *Server {
	dir := filepath.Dir(cfg.path)
	return &Server{eng: eng, cfg: cfg, plat: plat, log: log, token: newToken(),
		items: map[string]*ItemStore{"notes": LoadItemStore(dir, "notes.json"), "templates": LoadItemStore(dir, "templates.json")},
		kv:    LoadKVStore(dir)}
}

func securityHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Cache-Control", "no-store")
	h.Set("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func readJSON(r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	return dec.Decode(v)
}

// Listen binds the local deck to loopback, falling back to a random port if busy.
func (s *Server) Listen(port int) (net.Listener, error) {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		s.log.Warn("port %d busy (%v); using a random port", port, err)
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return nil, err
		}
	}
	s.port = ln.Addr().(*net.TCPAddr).Port
	return ln, nil
}

func (s *Server) URL() string { return fmt.Sprintf("http://127.0.0.1:%d/", s.port) }

// Handler for the local (loopback-only) deck.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		securityHeaders(w)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(strings.Replace(indexHTML, "__PRAXIS_TOKEN__", s.token, 1)))
	})
	mux.HandleFunc("GET /bar", func(w http.ResponseWriter, r *http.Request) {
		securityHeaders(w)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(strings.Replace(barHTML, "__PRAXIS_TOKEN__", s.token, 1)))
	})
	mux.Handle("GET /astra/", s.astraHandler())
	mux.Handle("GET /astra", http.RedirectHandler("/astra/", http.StatusMovedPermanently))
	mux.HandleFunc("GET /logo.png", servePNG(logoPNG))
	mux.HandleFunc("GET /favicon.ico", servePNG(iconPNG))
	mux.HandleFunc("GET /icon.png", servePNG(iconPNG))

	api := http.NewServeMux()
	api.HandleFunc("GET /api/state", s.handleState)
	api.HandleFunc("GET /api/status", func(w http.ResponseWriter, r *http.Request) {
		// polled while the window is open: no config, no log, cached audio
		st := map[string]any{
			"hotkeys": s.eng.HotkeyStatus(),
			"paused":  s.eng.Paused(),
			"active":  s.eng.ActiveMacros(),
			"audio":   s.audio(false),
		}
		if r.URL.Query().Get("show") == "1" { // the main window only; the button bar polls too
			st["show"] = s.takeShow()
		}
		writeJSON(w, 200, st)
	})
	for _, kind := range []string{"notes", "templates"} {
		store := s.items[kind]
		api.HandleFunc("GET /api/"+kind, func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, 200, store.List())
		})
		api.HandleFunc("PUT /api/"+kind, func(w http.ResponseWriter, r *http.Request) {
			var it Item
			if err := readJSON(r, &it); err != nil {
				writeErr(w, 400, "bad request")
				return
			}
			saved, err := store.Put(it)
			if err != nil {
				writeErr(w, 400, err.Error())
				return
			}
			writeJSON(w, 200, saved)
		})
		api.HandleFunc("DELETE /api/"+kind+"/{id}", func(w http.ResponseWriter, r *http.Request) {
			if err := store.Delete(r.PathValue("id")); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
			writeJSON(w, 200, map[string]bool{"ok": true})
		})
	}
	api.HandleFunc("POST /api/bar", func(w http.ResponseWriter, r *http.Request) {
		s.plat.OpenBar(s.URL() + "bar")
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	s.kvRoutes(api)
	api.HandleFunc("POST /api/show", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Target string `json:"target"`
		}
		if err := readJSON(r, &body); err != nil || !validShow(body.Target) {
			writeErr(w, 400, "bad request")
			return
		}
		s.Show(body.Target)
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	api.HandleFunc("POST /api/lite", func(w http.ResponseWriter, r *http.Request) {
		s.plat.OpenLite(s.URL() + "astra/popup.html")
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	api.HandleFunc("GET /api/log", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, s.log.Entries())
	})
	api.HandleFunc("PUT /api/config", s.handlePutConfig)
	api.HandleFunc("POST /api/run/{id}", func(w http.ResponseWriter, r *http.Request) {
		s.runAsync(w, r.PathValue("id"), "deck")
	})
	api.HandleFunc("POST /api/restore", func(w http.ResponseWriter, r *http.Request) {
		go s.eng.Restore("deck")
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	api.HandleFunc("POST /api/audio", s.handleAudio)
	api.HandleFunc("GET /api/windows", func(w http.ResponseWriter, r *http.Request) {
		wins, err := s.plat.Windows()
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, wins)
	})
	api.HandleFunc("POST /api/identify", func(w http.ResponseWriter, r *http.Request) {
		s.plat.Identify()
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	api.HandleFunc("POST /api/hotkeys", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Paused bool `json:"paused"`
		}
		if err := readJSON(r, &body); err != nil {
			writeErr(w, 400, "bad request")
			return
		}
		s.eng.SetPaused(body.Paused)
		writeJSON(w, 200, map[string]bool{"paused": s.eng.Paused()})
	})
	api.HandleFunc("POST /api/defaults", func(w http.ResponseWriter, r *http.Request) {
		d := defaultConfig()
		cur := s.cfg.Get()
		d.Settings = cur.Settings
		s.applyConfig(w, d)
	})

	mux.Handle("/api/", s.guard(api))
	return s.hostCheck(mux)
}

func servePNG(b []byte) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "max-age=3600")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_, _ = w.Write(b)
	}
}

// hostCheck keeps the deck strictly local: the caller must be this PC, the Host
// must be a loopback name (defeats DNS rebinding), and a request carrying an
// Origin must come from the deck itself (no other web page can drive it).
func (s *Server) hostCheck(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if ip, _, err := net.SplitHostPort(r.RemoteAddr); err != nil || !net.ParseIP(ip).IsLoopback() {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		host := r.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		if host != "127.0.0.1" && host != "localhost" {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}
		if o := r.Header.Get("Origin"); o != "" && o != "null" {
			if o != "http://"+r.Host && o != fmt.Sprintf("http://127.0.0.1:%d", s.port) && o != fmt.Sprintf("http://localhost:%d", s.port) {
				http.Error(w, "forbidden origin", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// guard requires the per-launch token in a custom header (also blocks CSRF: a
// cross-site page cannot set custom headers without a CORS preflight we never allow).
func (s *Server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		securityHeaders(w)
		tok := r.Header.Get("X-Praxis-Token")
		if subtle.ConstantTimeCompare([]byte(tok), []byte(s.token)) != 1 {
			writeErr(w, 401, "unauthorised")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) runAsync(w http.ResponseWriter, id, source string) {
	cfg := s.cfg.Get()
	if cfg.Find(id) == nil {
		writeErr(w, 404, "unknown macro")
		return
	}
	go func() { _ = s.eng.Trigger(id, source) }()
	writeJSON(w, 202, map[string]bool{"ok": true})
}

func (s *Server) handleState(w http.ResponseWriter, r *http.Request) {
	cfg := s.cfg.Get()
	mons, merr := s.plat.Monitors()
	resp := map[string]any{
		"version":  version,
		"config":   cfg.Public(),
		"hotkeys":  s.eng.HotkeyStatus(),
		"paused":   s.eng.Paused(),
		"active":   s.eng.ActiveMacros(),
		"audio":    s.audio(true),
		"monitors": mons,
		"log":      s.log.Entries(),
	}
	if merr != nil {
		resp["monitorError"] = merr.Error()
	}
	writeJSON(w, 200, resp)
}

func (s *Server) handlePutConfig(w http.ResponseWriter, r *http.Request) {
	var c Config
	if err := readJSON(r, &c); err != nil {
		writeErr(w, 400, "invalid JSON: "+err.Error())
		return
	}
	s.applyConfig(w, c)
}

func (s *Server) applyConfig(w http.ResponseWriter, c Config) {
	old := s.cfg.Get()
	saved, err := s.cfg.Replace(c)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	s.eng.ApplyHotkeys()
	if s.onConfigChanged != nil {
		s.onConfigChanged(old, saved)
	}
	s.log.Info("configuration saved (%d macros)", len(saved.Macros))
	writeJSON(w, 200, saved.Public())
}

func (s *Server) handleAudio(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Mute    *bool `json:"mute"`
		MicMute *bool `json:"micMute"`
		Volume  *int  `json:"volume"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	var errs []string
	if body.Volume != nil {
		if *body.Volume < 0 || *body.Volume > 100 {
			writeErr(w, 400, "volume must be 0-100")
			return
		}
		if err := s.plat.SetVolume(*body.Volume); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if body.Mute != nil {
		if err := s.plat.SetMute(false, *body.Mute); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if body.MicMute != nil {
		if err := s.plat.SetMute(true, *body.MicMute); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if len(errs) > 0 {
		writeErr(w, 500, strings.Join(errs, "; "))
		return
	}
	writeJSON(w, 200, s.audio(true))
}

var showTarget = regexp.MustCompile(`^((guide|reply)=[\w.|-]{1,120}|triage-clipboard)?$`)

func validShow(t string) bool { return showTarget.MatchString(t) }

// Show brings the main window forward and leaves it one instruction: open a guide or reply,
// or triage what is on the clipboard. The window picks it up as soon as it has focus.
func (s *Server) Show(target string) {
	s.showMu.Lock()
	s.pending = target
	s.showMu.Unlock()
	s.plat.FocusDeck(s.URL())
}

func (s *Server) takeShow() string {
	s.showMu.Lock()
	defer s.showMu.Unlock()
	t := s.pending
	s.pending = ""
	return t
}

// audio returns the speaker/mic state, reusing a reading younger than a second
// unless fresh is requested (after a change made through the window).
func (s *Server) audio(fresh bool) AudioState {
	s.audioMu.Lock()
	defer s.audioMu.Unlock()
	if fresh || time.Since(s.audioAt) > time.Second {
		s.audioVal, s.audioAt = s.plat.Audio(), time.Now()
	}
	return s.audioVal
}
