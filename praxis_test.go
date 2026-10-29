package main

import (
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
		"dup hotkey": func(c *Config) { c.Macros[1].Hotkey = "pause" },
		"bad type":   func(c *Config) { c.Macros[0].Actions[0].Type = "format_c" },
		"bad url":    func(c *Config) { c.Macros[0].Actions = []Action{{Type: "open_url", Target: "javascript:alert(1)"}} },
		"vol range":  func(c *Config) { c.Macros[0].Actions = []Action{{Type: "set_volume", Value: 101}} },
		"monitor":    func(c *Config) { c.Macros[0].Actions[4].Monitors = []int{0} },
		"bad port":   func(c *Config) { c.Settings.Port = 80 },
		"dup id":     func(c *Config) { c.Macros[1].ID = c.Macros[0].ID },
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
	// another web page cannot drive the deck, even with the token
	req, _ := http.NewRequest("POST", ts.URL+"/api/restore", nil)
	req.Header.Set("X-Praxis-Token", srv.token)
	req.Header.Set("Origin", "https://evil.example")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Errorf("foreign origin: %d", resp.StatusCode)
	}
}

func TestItemStore(t *testing.T) {
	dir := t.TempDir()
	s := LoadItemStore(dir, "notes.json")
	a, err := s.Put(Item{Title: "first", Body: "hello"})
	if err != nil || a.ID == "" || a.Updated == 0 {
		t.Fatalf("put: %+v %v", a, err)
	}
	b, _ := s.Put(Item{Title: "second"})
	a.Body = "edited"
	if _, err := s.Put(a); err != nil {
		t.Fatal(err)
	}
	got := LoadItemStore(dir, "notes.json").List() // reload from disk
	if len(got) != 2 || got[0].ID != a.ID || got[0].Body != "edited" || got[1].ID != b.ID {
		t.Fatalf("order or persistence wrong: %+v", got)
	}
	if err := s.Delete(b.ID); err != nil || len(s.List()) != 1 {
		t.Fatal("delete failed")
	}
	if _, err := s.Put(Item{ID: "../x"}); err == nil {
		t.Error("bad id accepted")
	}
	if _, err := s.Put(Item{Body: strings.Repeat("x", maxItemBody+1)}); err == nil {
		t.Error("oversized body accepted")
	}
}
