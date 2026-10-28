package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseHotkey(t *testing.T) {
	ok := map[string]string{
		"ctrl+alt+p": "Ctrl+Alt+P", "Pause": "Pause", "shift+pause": "Shift+Pause",
		"Win+Shift+S": "Shift+Win+S", "F13": "F13", "alt+escape": "Alt+Esc", "MediaPlayPause": "MediaPlayPause",
		"Ctrl+Num5": "Ctrl+Num5",
	}
	for in, want := range ok {
		h, err := ParseHotkey(in)
		if err != nil || h.String() != want {
			t.Errorf("ParseHotkey(%q) = %q, %v; want %q", in, h, err, want)
		}
	}
	for _, bare := range []string{"Home", "End", "Insert", "P"} {
		if _, err := ParseHotkey(bare); err != nil {
			t.Errorf("bare %s should be allowed (with a warning in the deck): %v", bare, err)
		}
	}
	for _, bad := range []string{"", "Ctrl+", "Ctrl+Pause", "Ctrl+Foo", "P+Ctrl", "Ctrl++P"} {
		if _, err := ParseHotkey(bad); err == nil {
			t.Errorf("ParseHotkey(%q) should fail", bad)
		}
	}
	if h, _ := ParseHotkey("Pause"); h.VK != 0x13 || h.Mods != 0 {
		t.Errorf("Pause vk=%x mods=%x", h.VK, h.Mods)
	}
	if _, err := ParseKeyChord("Enter"); err != nil {
		t.Errorf("bare Enter is fine to send: %v", err)
	}
}

func TestDefaultConfigValid(t *testing.T) {
	c := defaultConfig()
	if err := c.Normalize(); err != nil {
		t.Fatal(err)
	}
}

func TestNormalizeRejects(t *testing.T) {
	cases := map[string]func(*Config){
		"dup hotkey":   func(c *Config) { c.Macros[1].Hotkey = "pause" },
		"bad type":     func(c *Config) { c.Macros[0].Actions[0].Type = "format_c" },
		"bad url":      func(c *Config) { c.Macros[0].Actions = []Action{{Type: "open_url", Target: "javascript:alert(1)"}} },
		"vol range":    func(c *Config) { c.Macros[0].Actions = []Action{{Type: "set_volume", Value: 101}} },
		"monitor":      func(c *Config) { c.Macros[0].Actions[4].Monitors = []int{0} },
		"remote nopin": func(c *Config) { c.Settings.Remote.Enabled = true },
		"same ports":   func(c *Config) { c.Settings.Remote.Port = c.Settings.Port },
		"dup id":       func(c *Config) { c.Macros[1].ID = c.Macros[0].ID },
	}
	for name, mut := range cases {
		c := defaultConfig()
		mut(&c)
		if err := c.Normalize(); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}

func TestFillWebsite(t *testing.T) {
	a := Action{Type: "fill_screens", Target: "https://outlook.office.com/mail", Monitors: []int{2}, Launch: true}
	if err := a.normalize(); err != nil {
		t.Fatalf("website fill rejected: %v", err)
	}
	bad := Action{Type: "fill_screens", Target: "https://", Launch: true}
	if err := bad.normalize(); err == nil {
		t.Error("empty host accepted")
	}
}

func TestMatchFromTarget(t *testing.T) {
	if got := matchFromTarget(`"C:\Program Files\Office\EXCEL.EXE"`); got != "EXCEL.EXE" {
		t.Errorf("got %q", got)
	}
	if got := matchFromTarget(`https://x`); got != "" {
		t.Errorf("got %q", got)
	}
}

func TestPIN(t *testing.T) {
	h := hashPIN("123456")
	if !checkPIN(h, "123456") || checkPIN(h, "123457") || checkPIN("junk", "123456") {
		t.Fatal("PIN check wrong")
	}
}

func newTestServer(t *testing.T) (*Server, *httptest.Server) {
	dir := t.TempDir()
	store, err := LoadConfigStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	log := NewLogger(dir)
	t.Cleanup(log.Close)
	app := &App{log: log, cfg: store}
	plat := newPlatform(app)
	eng := NewEngine(store, plat, log)
	srv := NewServer(eng, store, plat, log)
	return srv, httptest.NewServer(srv.Handler())
}

func TestAPIGuards(t *testing.T) {
	srv, ts := newTestServer(t)
	defer ts.Close()
	do := func(method, path, host, token string, body string) int {
		req, _ := http.NewRequest(method, ts.URL+path, strings.NewReader(body))
		req.Host = host
		if token != "" {
			req.Header.Set("X-Praxis-Token", token)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if c := do("GET", "/api/state", "127.0.0.1", "", ""); c != 401 {
		t.Errorf("no token: %d", c)
	}
	if c := do("GET", "/api/state", "127.0.0.1", "wrong", ""); c != 401 {
		t.Errorf("bad token: %d", c)
	}
	if c := do("GET", "/api/state", "evil.example", srv.token, ""); c != 403 {
		t.Errorf("rebinding host: %d", c)
	}
	if c := do("GET", "/api/state", "localhost:1234", srv.token, ""); c != 200 {
		t.Errorf("good: %d", c)
	}
	if c := do("PUT", "/api/config", "127.0.0.1", srv.token, `{"macros":[{"name":"x","actions":[{"type":"nope"}]}]}`); c != 400 {
		t.Errorf("invalid config accepted: %d", c)
	}
	if c := do("POST", "/api/run/does-not-exist", "127.0.0.1", srv.token, ""); c != 404 {
		t.Errorf("unknown macro: %d", c)
	}
	// index page carries the token, API never leaks the PIN hash
	if err := srv.cfg.SetPIN("abcdef"); err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequest("GET", ts.URL+"/api/state", nil)
	req.Header.Set("X-Praxis-Token", srv.token)
	resp, _ := http.DefaultClient.Do(req)
	var st struct {
		Config Config `json:"config"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&st)
	resp.Body.Close()
	if st.Config.Settings.Remote.PINHash != "" || !st.Config.Settings.Remote.HasPIN {
		t.Error("PIN hash leaked or hasPin missing")
	}
}

func TestRemoteLockout(t *testing.T) {
	srv, _ := newTestServer(t)
	_ = srv.cfg.SetPIN("135790")
	h := srv.remoteHandler()
	try := func(pin string) int {
		req := httptest.NewRequest("POST", "/r/login", strings.NewReader(`{"pin":"`+pin+`"}`))
		req.RemoteAddr = "192.168.1.50:5555"
		req.Header.Set("X-Praxis-Remote", "1")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w.Code
	}
	for i := 0; i < 5; i++ {
		if c := try("000000"); c != 401 {
			t.Fatalf("attempt %d: %d", i, c)
		}
	}
	if c := try("135790"); c != 429 {
		t.Errorf("expected lockout, got %d", c)
	}
	// public addresses are refused outright
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "8.8.8.8:1"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 403 {
		t.Errorf("public client allowed: %d", w.Code)
	}
}
