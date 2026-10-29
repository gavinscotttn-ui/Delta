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
	"strings"
	"sync"
	"time"
)

//go:embed web/index.html
var indexHTML string

//go:embed web/remote.html
var remoteHTML string

//go:embed web/bar.html
var barHTML string

//go:embed assets/logo.png
var logoPNG []byte

//go:embed assets/icon.png
var iconPNG []byte

const version = "1.0.0"

type Server struct {
	eng   *Engine
	cfg   *ConfigStore
	plat  Platform
	log   *Logger
	token string
	port  int

	onConfigChanged func(old, new Config)

	items map[string]*ItemStore // "notes", "templates"

	audioMu  sync.Mutex
	audioAt  time.Time
	audioVal AudioState

	remoteMu  sync.Mutex
	remoteSrv *http.Server
	sessions  map[string]time.Time
	failures  map[string]*failState
}

type failState struct {
	count int
	until time.Time
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
		items:    map[string]*ItemStore{"notes": LoadItemStore(dir, "notes.json"), "templates": LoadItemStore(dir, "templates.json")},
		sessions: map[string]time.Time{}, failures: map[string]*failState{}}
}

func securityHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Cache-Control", "no-store")
	h.Set("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
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
	mux.HandleFunc("GET /logo.png", servePNG(logoPNG))
	mux.HandleFunc("GET /favicon.ico", servePNG(iconPNG))
	mux.HandleFunc("GET /icon.png", servePNG(iconPNG))

	api := http.NewServeMux()
	api.HandleFunc("GET /api/state", s.handleState)
	api.HandleFunc("GET /api/status", func(w http.ResponseWriter, r *http.Request) {
		// polled while the window is open: no config, no log, cached audio
		writeJSON(w, 200, map[string]any{
			"hotkeys": s.eng.HotkeyStatus(),
			"paused":  s.eng.Paused(),
			"active":  s.eng.ActiveMacros(),
			"audio":   s.audio(false),
		})
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
	api.HandleFunc("POST /api/pin", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			PIN string `json:"pin"`
		}
		if err := readJSON(r, &body); err != nil {
			writeErr(w, 400, "bad request")
			return
		}
		if err := s.cfg.SetPIN(body.PIN); err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		s.dropSessions()
		s.log.Info("remote deck PIN changed")
		writeJSON(w, 200, map[string]bool{"ok": true})
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

// hostCheck defeats DNS-rebinding: only loopback host names are accepted.
func (s *Server) hostCheck(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		if host != "127.0.0.1" && host != "localhost" {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
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
		"remote":   s.remoteInfo(cfg),
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

// ---------------- remote (LAN) deck ----------------

func (s *Server) remoteInfo(cfg Config) map[string]any {
	s.remoteMu.Lock()
	running := s.remoteSrv != nil
	s.remoteMu.Unlock()
	var urls []string
	if running {
		for _, ip := range lanIPs() {
			urls = append(urls, fmt.Sprintf("http://%s:%d/", ip, cfg.Settings.Remote.Port))
		}
	}
	return map[string]any{"running": running, "urls": urls}
}

func lanIPs() []string {
	var out []string
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil
	}
	for _, a := range addrs {
		if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil && !ipn.IP.IsLoopback() && ipn.IP.IsPrivate() {
			out = append(out, ipn.IP.String())
		}
	}
	return out
}

// SyncRemote starts/stops the LAN deck to match settings.
func (s *Server) SyncRemote(cfg Config) {
	s.remoteMu.Lock()
	defer s.remoteMu.Unlock()
	want := cfg.Settings.Remote.Enabled && cfg.Settings.Remote.PINHash != ""
	if s.remoteSrv != nil {
		if want && s.remoteSrv.Addr == fmt.Sprintf(":%d", cfg.Settings.Remote.Port) {
			return
		}
		_ = s.remoteSrv.Close()
		s.remoteSrv = nil
		s.log.Info("remote deck stopped")
	}
	if !want {
		return
	}
	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Settings.Remote.Port),
		Handler:           s.remoteHandler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
	}
	ln, err := net.Listen("tcp", srv.Addr)
	if err != nil {
		s.log.Error("remote deck could not start on port %d: %v", cfg.Settings.Remote.Port, err)
		return
	}
	s.remoteSrv = srv
	go func() { _ = srv.Serve(ln) }()
	s.log.Info("remote deck listening on port %d", cfg.Settings.Remote.Port)
}

func (s *Server) dropSessions() {
	s.remoteMu.Lock()
	s.sessions = map[string]time.Time{}
	s.remoteMu.Unlock()
}

const remoteCookie = "praxis_remote"

func (s *Server) remoteAuthed(r *http.Request) bool {
	c, err := r.Cookie(remoteCookie)
	if err != nil {
		return false
	}
	s.remoteMu.Lock()
	defer s.remoteMu.Unlock()
	exp, ok := s.sessions[c.Value]
	if !ok || time.Now().After(exp) {
		delete(s.sessions, c.Value)
		return false
	}
	return true
}

func clientIP(r *http.Request) string {
	h, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return h
}

// allowRemoteClient restricts the LAN deck to private/loopback addresses.
func allowRemoteClient(r *http.Request) bool {
	ip := net.ParseIP(clientIP(r))
	return ip != nil && (ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast())
}

func (s *Server) remoteHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		securityHeaders(w)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(remoteHTML))
	})
	mux.HandleFunc("GET /logo.png", servePNG(logoPNG))
	mux.HandleFunc("GET /icon.png", servePNG(iconPNG))
	mux.HandleFunc("POST /r/login", s.remoteLogin)
	mux.HandleFunc("GET /r/macros", s.remoteOnly(func(w http.ResponseWriter, r *http.Request) {
		cfg := s.cfg.Get()
		type tile struct {
			ID, Name, Icon, Color string
			Active                bool
		}
		active := map[string]bool{}
		for _, id := range s.eng.ActiveMacros() {
			active[id] = true
		}
		out := []tile{}
		for _, m := range cfg.Macros {
			if m.Remote {
				out = append(out, tile{m.ID, m.Name, m.Icon, m.Color, active[m.ID]})
			}
		}
		writeJSON(w, 200, map[string]any{"macros": out, "audio": s.audio(false)})
	}))
	mux.HandleFunc("POST /r/run/{id}", s.remoteOnly(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		cfg := s.cfg.Get()
		m := cfg.Find(id)
		if m == nil || !m.Remote {
			writeErr(w, 404, "unknown macro")
			return
		}
		s.runAsync(w, id, "remote "+clientIP(r))
	}))
	mux.HandleFunc("POST /r/restore", s.remoteOnly(func(w http.ResponseWriter, r *http.Request) {
		go s.eng.Restore("remote " + clientIP(r))
		writeJSON(w, 200, map[string]bool{"ok": true})
	}))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !allowRemoteClient(r) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func (s *Server) remoteOnly(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		securityHeaders(w)
		// custom header forces a CORS preflight for cross-site requests (CSRF defence)
		if r.Header.Get("X-Praxis-Remote") != "1" || !s.remoteAuthed(r) {
			writeErr(w, 401, "unauthorised")
			return
		}
		h(w, r)
	}
}

func (s *Server) remoteLogin(w http.ResponseWriter, r *http.Request) {
	securityHeaders(w)
	if r.Header.Get("X-Praxis-Remote") != "1" {
		writeErr(w, 401, "unauthorised")
		return
	}
	ip := clientIP(r)
	s.remoteMu.Lock()
	f := s.failures[ip]
	if f != nil && time.Now().Before(f.until) {
		s.remoteMu.Unlock()
		writeErr(w, 429, "too many attempts; try again in a few minutes")
		return
	}
	s.remoteMu.Unlock()

	var body struct {
		PIN string `json:"pin"`
	}
	if err := readJSON(r, &body); err != nil || len(body.PIN) > 64 {
		writeErr(w, 400, "bad request")
		return
	}
	cfg := s.cfg.Get()
	if !checkPIN(cfg.Settings.Remote.PINHash, body.PIN) {
		s.remoteMu.Lock()
		if f == nil {
			if len(s.failures) > 1000 {
				s.failures = map[string]*failState{}
			}
			f = &failState{}
			s.failures[ip] = f
		}
		f.count++
		if f.count >= 5 {
			f.until = time.Now().Add(5 * time.Minute)
			f.count = 0
			s.log.Warn("remote deck: %s locked out after repeated wrong PINs", ip)
		}
		s.remoteMu.Unlock()
		time.Sleep(400 * time.Millisecond)
		writeErr(w, 401, "wrong PIN")
		return
	}
	tok := newToken()
	s.remoteMu.Lock()
	delete(s.failures, ip)
	now := time.Now()
	for k, exp := range s.sessions {
		if now.After(exp) {
			delete(s.sessions, k)
		}
	}
	s.sessions[tok] = now.Add(12 * time.Hour)
	s.remoteMu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: remoteCookie, Value: tok, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteStrictMode, MaxAge: 12 * 3600})
	s.log.Info("remote deck: %s signed in", ip)
	writeJSON(w, 200, map[string]bool{"ok": true})
}
