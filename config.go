package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode/utf8"
)

const configVersion = 1

// Config is everything Praxis persists to disk.
type Config struct {
	Version  int      `json:"version"`
	Settings Settings `json:"settings"`
	Macros   []Macro  `json:"macros"`
}

type Settings struct {
	RunAtStartup     bool           `json:"runAtStartup"`
	OpenDeckOnLaunch bool           `json:"openDeckOnLaunch"`
	NotifyOnRun      bool           `json:"notifyOnRun"`
	HideTray         bool           `json:"hideTray"` // discreet: no tray icon; relaunch the exe to open the deck
	KeepLog          bool           `json:"keepLog"`  // write activity history to disk (off: memory only)
	PrewarmApps      bool           `json:"prewarmApps"`
	Port             int            `json:"port"`
	Remote           RemoteSettings `json:"remote"`
}

type RemoteSettings struct {
	Enabled bool   `json:"enabled"`
	Port    int    `json:"port"`
	PINHash string `json:"pinHash,omitempty"` // salt:sha256(salt+pin), never sent to the UI
	HasPIN  bool   `json:"hasPin"`            // UI-facing only
}

type Macro struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Icon     string   `json:"icon"`
	Color    string   `json:"color"`
	Hotkey   string   `json:"hotkey"`
	Toggle   bool     `json:"toggle"`   // pressing again restores
	Undoable bool     `json:"undoable"` // recorded so "Restore" can revert it
	Remote   bool     `json:"remote"`   // shown on the phone/remote deck
	Actions  []Action `json:"actions"`
}

type Action struct {
	Type           string `json:"type"`
	Target         string `json:"target,omitempty"`
	Args           string `json:"args,omitempty"`
	Match          string `json:"match,omitempty"`
	Mode           string `json:"mode,omitempty"`
	Monitors       []int  `json:"monitors,omitempty"` // 1-based; empty means all
	Value          int    `json:"value,omitempty"`
	Text           string `json:"text,omitempty"`
	Keys           string `json:"keys,omitempty"`
	Launch         bool   `json:"launch,omitempty"`
	Timeout        int    `json:"timeout,omitempty"`
	CloseOnRestore bool   `json:"closeOnRestore,omitempty"`
	Undo           bool   `json:"undo,omitempty"`
	Disabled       bool   `json:"disabled,omitempty"`
}

// actionTypes lists every supported action. Keep in sync with web/index.html.
var actionTypes = map[string]bool{
	"mute": true, "unmute": true, "toggle_mute": true, "set_volume": true, "volume_step": true,
	"mic_mute": true, "mic_unmute": true, "mic_toggle": true, "media": true,
	"minimize_foreground": true, "minimize_apps": true, "minimize_all": true,
	"fill_screens": true, "launch": true, "open_url": true, "focus_app": true, "close_app": true,
	"send_keys": true, "type_text": true, "wait": true, "lock": true, "monitors_off": true,
	"clear_clipboard": true, "run_command": true, "notify": true, "restore": true,
}

const (
	maxMacros     = 200
	maxActions    = 100
	maxFieldLen   = 1024
	maxTextLen    = 4000
	maxWaitMs     = 60000
	defaultPort   = 47800
	defaultRPort  = 47801
	defaultTimout = 6000
)

func defaultConfig() Config {
	return Config{
		Version: configVersion,
		Settings: Settings{
			OpenDeckOnLaunch: true,
			Port:             defaultPort,
			Remote:           RemoteSettings{Port: defaultRPort},
		},
		Macros: []Macro{
			{
				ID: "switch", Name: "Switch", Icon: "monitor", Color: "#D7036A", Hotkey: "Pause",
				Toggle: true, Undoable: true, Remote: true,
				Actions: []Action{
					{Type: "mute"},
					{Type: "media", Target: "play_pause"},
					{Type: "minimize_foreground", Mode: "minimize"},
					{Type: "minimize_apps", Match: "Netflix, YouTube, Prime Video, Disney+, Twitch, vlc.exe", Mode: "minimize"},
					{Type: "fill_screens", Target: "notepad.exe", Match: "notepad.exe", Mode: "maximize", Launch: true, Timeout: defaultTimout},
				},
			},
			{
				ID: "return", Name: "Return", Icon: "return", Color: "#34C759", Hotkey: "Shift+Pause", Remote: true,
				Actions: []Action{{Type: "restore"}},
			},
			{
				ID: "mute", Name: "Sound", Icon: "volume-off", Color: "#007AFF", Hotkey: "Ctrl+Alt+M", Remote: true,
				Actions: []Action{{Type: "toggle_mute"}},
			},
			{
				ID: "mic", Name: "Microphone", Icon: "mic-off", Color: "#5856D6", Hotkey: "Ctrl+Alt+N", Remote: true,
				Actions: []Action{{Type: "mic_toggle"}},
			},
			{
				ID: "playpause", Name: "Play / Pause", Icon: "play", Color: "#FF9500", Remote: true,
				Actions: []Action{{Type: "media", Target: "play_pause"}},
			},
			{
				ID: "lock", Name: "Lock", Icon: "lock", Color: "#8E8E93", Hotkey: "Ctrl+Alt+L", Remote: true,
				Actions: []Action{{Type: "mute"}, {Type: "mic_mute"}, {Type: "lock"}},
			},
		},
	}
}

// iconNames are the line icons the deck can draw. Anything else (e.g. emoji
// from an older config) is cleared and the tile shows the macro's initial.
var iconNames = map[string]bool{
	"bolt": true, "eye-off": true, "volume-off": true, "volume": true, "mic-off": true, "play": true,
	"lock": true, "briefcase": true, "moon": true, "monitor": true, "keyboard": true, "globe": true,
	"mail": true, "phone": true, "chart": true, "return": true, "star": true,
}

func randomID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Normalize fills defaults and validates. It returns a descriptive error for the UI.
func (c *Config) Normalize() error {
	if c.Version == 0 {
		c.Version = configVersion
	}
	s := &c.Settings
	s.Remote.HasPIN = s.Remote.PINHash != ""
	if s.Port == 0 {
		s.Port = defaultPort
	}
	if s.Remote.Port == 0 {
		s.Remote.Port = defaultRPort
	}
	if s.Port < 1024 || s.Port > 65535 || s.Remote.Port < 1024 || s.Remote.Port > 65535 {
		return errors.New("ports must be between 1024 and 65535")
	}
	if s.Port == s.Remote.Port {
		return errors.New("the deck port and remote deck port must differ")
	}
	if s.Remote.Enabled && s.Remote.PINHash == "" {
		return errors.New("set a remote PIN before enabling the remote deck")
	}
	if len(c.Macros) > maxMacros {
		return fmt.Errorf("too many macros (max %d)", maxMacros)
	}
	ids := map[string]bool{}
	hotkeys := map[string]string{}
	for i := range c.Macros {
		m := &c.Macros[i]
		if m.ID == "" {
			m.ID = randomID()
		}
		if !validID(m.ID) || ids[m.ID] {
			return fmt.Errorf("macro %d has an invalid or duplicate id", i+1)
		}
		ids[m.ID] = true
		m.Name = strings.TrimSpace(m.Name)
		if m.Name == "" {
			m.Name = "Macro " + fmt.Sprint(i+1)
		}
		if err := checkLen("name", m.Name, 80); err != nil {
			return fmt.Errorf("%q: %w", m.Name, err)
		}
		if !iconNames[m.Icon] {
			m.Icon = ""
		}
		if m.Color == "" || !validColor(m.Color) {
			m.Color = "#D7036A"
		}
		if strings.TrimSpace(m.Hotkey) != "" {
			hk, err := ParseHotkey(m.Hotkey)
			if err != nil {
				return fmt.Errorf("%q hotkey: %w", m.Name, err)
			}
			if other, dup := hotkeys[hk.String()]; dup {
				return fmt.Errorf("hotkey %s is used by both %q and %q", hk, other, m.Name)
			}
			hotkeys[hk.String()] = m.Name
			m.Hotkey = hk.String()
		} else {
			m.Hotkey = ""
		}
		if len(m.Actions) > maxActions {
			return fmt.Errorf("%q has too many actions (max %d)", m.Name, maxActions)
		}
		for j := range m.Actions {
			if err := m.Actions[j].normalize(); err != nil {
				return fmt.Errorf("%q step %d: %w", m.Name, j+1, err)
			}
		}
	}
	return nil
}

func (a *Action) normalize() error {
	if !actionTypes[a.Type] {
		return fmt.Errorf("unknown action %q", a.Type)
	}
	for name, v := range map[string]string{"target": a.Target, "args": a.Args, "match": a.Match, "mode": a.Mode, "keys": a.Keys} {
		if err := checkLen(name, v, maxFieldLen); err != nil {
			return err
		}
	}
	if err := checkLen("text", a.Text, maxTextLen); err != nil {
		return err
	}
	if len(a.Monitors) > 16 {
		return errors.New("too many monitors selected")
	}
	for _, m := range a.Monitors {
		if m < 1 || m > 16 {
			return errors.New("monitor numbers must be 1-16")
		}
	}
	req := func(field, v string) error {
		if strings.TrimSpace(v) == "" {
			return fmt.Errorf("%s is required", field)
		}
		return nil
	}
	switch a.Type {
	case "set_volume":
		if a.Value < 0 || a.Value > 100 {
			return errors.New("volume must be 0-100")
		}
	case "volume_step":
		if a.Value < -100 || a.Value > 100 || a.Value == 0 {
			return errors.New("volume step must be between -100 and 100 and not 0")
		}
	case "media":
		switch a.Target {
		case "":
			a.Target = "play_pause"
		case "play_pause", "stop", "next", "prev":
		default:
			return fmt.Errorf("unknown media key %q", a.Target)
		}
	case "minimize_foreground", "minimize_apps":
		if a.Mode == "" {
			a.Mode = "minimize"
		}
		if a.Mode != "minimize" && a.Mode != "hide" {
			return errors.New("mode must be minimize or hide")
		}
		if a.Type == "minimize_apps" {
			return req("match", a.Match)
		}
	case "fill_screens":
		if a.Mode == "" {
			a.Mode = "maximize"
		}
		if a.Mode != "maximize" && a.Mode != "cover" {
			return errors.New("mode must be maximize or cover")
		}
		if a.Timeout <= 0 {
			a.Timeout = defaultTimout
		}
		if a.Timeout > maxWaitMs {
			return fmt.Errorf("timeout must be at most %d ms", maxWaitMs)
		}
		if isWebTarget(a.Target) {
			if err := checkURL(a.Target); err != nil {
				return err
			}
			a.Match = "" // a fresh browser window is always opened for websites
			return nil
		}
		if strings.TrimSpace(a.Match) == "" {
			a.Match = matchFromTarget(a.Target)
		}
		if a.Match == "" {
			return errors.New("choose an app or a website")
		}
		if a.Launch {
			return req("app path", a.Target)
		}
	case "launch":
		if a.Mode == "" {
			a.Mode = "normal"
		}
		if a.Mode != "normal" && a.Mode != "minimized" && a.Mode != "maximized" {
			return errors.New("mode must be normal, minimized or maximized")
		}
		return req("app path", a.Target)
	case "open_url":
		return checkURL(a.Target)
	case "focus_app", "close_app":
		return req("match", a.Match)
	case "send_keys":
		if _, err := ParseKeyChord(a.Keys); err != nil {
			return err
		}
	case "type_text", "notify":
		return req("text", a.Text)
	case "wait":
		if a.Value < 0 || a.Value > maxWaitMs {
			return fmt.Errorf("wait must be 0-%d ms", maxWaitMs)
		}
	case "run_command":
		return req("command", a.Target)
	}
	return nil
}

func isWebTarget(t string) bool {
	t = strings.ToLower(strings.TrimSpace(t))
	return strings.HasPrefix(t, "http://") || strings.HasPrefix(t, "https://")
}

func checkURL(t string) error {
	u, err := url.Parse(strings.TrimSpace(t))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return errors.New("web addresses must start with http:// or https://")
	}
	return nil
}

// matchFromTarget derives an exe-name match ("excel.exe") from an app path.
func matchFromTarget(target string) string {
	t := strings.Trim(strings.TrimSpace(target), `"`)
	if t == "" {
		return ""
	}
	base := t
	if i := strings.LastIndexAny(t, `\/`); i >= 0 {
		base = t[i+1:]
	}
	if strings.HasSuffix(strings.ToLower(base), ".exe") {
		return base
	}
	return ""
}

func checkLen(name, v string, max int) error {
	if !utf8.ValidString(v) {
		return fmt.Errorf("%s is not valid text", name)
	}
	if len(v) > max {
		return fmt.Errorf("%s is too long (max %d)", name, max)
	}
	return nil
}

func validID(s string) bool {
	if len(s) == 0 || len(s) > 40 {
		return false
	}
	for _, r := range s {
		if !(r == '-' || r == '_' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
			return false
		}
	}
	return true
}

func validColor(s string) bool {
	if len(s) != 7 || s[0] != '#' {
		return false
	}
	_, err := hex.DecodeString(s[1:])
	return err == nil
}

// ---- PIN hashing (salted SHA-256; adequate for a rate-limited LAN PIN) ----

func hashPIN(pin string) string {
	salt := make([]byte, 16)
	_, _ = rand.Read(salt)
	sum := sha256.Sum256(append(salt, []byte(pin)...))
	return hex.EncodeToString(salt) + ":" + hex.EncodeToString(sum[:])
}

func checkPIN(stored, pin string) bool {
	parts := strings.SplitN(stored, ":", 2)
	if len(parts) != 2 {
		return false
	}
	salt, err1 := hex.DecodeString(parts[0])
	want, err2 := hex.DecodeString(parts[1])
	if err1 != nil || err2 != nil {
		return false
	}
	sum := sha256.Sum256(append(salt, []byte(pin)...))
	return subtle.ConstantTimeCompare(sum[:], want) == 1
}

// ---- Store ----

type ConfigStore struct {
	mu   sync.RWMutex
	path string
	cfg  Config
}

func configDir() string {
	if d := os.Getenv("PRAXIS_HOME"); d != "" {
		return d
	}
	base, err := os.UserConfigDir() // %APPDATA% on Windows
	if err != nil {
		base = "."
	}
	return filepath.Join(base, "Praxis")
}

func LoadConfigStore(dir string) (*ConfigStore, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &ConfigStore{path: filepath.Join(dir, "config.json")}
	data, err := os.ReadFile(s.path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		s.cfg = defaultConfig()
		_ = s.cfg.Normalize()
		return s, s.saveLocked()
	case err != nil:
		return nil, err
	}
	var c Config
	if err := json.Unmarshal(data, &c); err != nil {
		// Keep the broken file for the user rather than silently discarding it.
		_ = os.Rename(s.path, s.path+".broken")
		s.cfg = defaultConfig()
		_ = s.cfg.Normalize()
		return s, fmt.Errorf("config was unreadable (saved as config.json.broken), defaults loaded: %w", err)
	}
	if err := c.Normalize(); err != nil {
		_ = os.WriteFile(s.path+".invalid", data, 0o600)
		s.cfg = defaultConfig()
		_ = s.cfg.Normalize()
		return s, fmt.Errorf("config was invalid (saved as config.json.invalid), defaults loaded: %w", err)
	}
	s.cfg = c
	return s, nil
}

// Get returns a deep copy.
func (s *ConfigStore) Get() Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneConfig(s.cfg)
}

func cloneConfig(c Config) Config {
	b, _ := json.Marshal(c)
	var out Config
	_ = json.Unmarshal(b, &out)
	return out
}

// Replace validates and persists a new config, preserving server-only secrets.
func (s *ConfigStore) Replace(c Config) (Config, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c.Settings.Remote.PINHash = s.cfg.Settings.Remote.PINHash
	if err := c.Normalize(); err != nil {
		return Config{}, err
	}
	old := s.cfg
	s.cfg = c
	if err := s.saveLocked(); err != nil {
		s.cfg = old
		return Config{}, err
	}
	return cloneConfig(c), nil
}

func (s *ConfigStore) SetPIN(pin string) error {
	if len(pin) < 6 || len(pin) > 32 {
		return errors.New("PIN must be 6-32 characters")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	old := s.cfg.Settings.Remote.PINHash
	s.cfg.Settings.Remote.PINHash = hashPIN(pin)
	if err := s.saveLocked(); err != nil {
		s.cfg.Settings.Remote.PINHash = old
		return err
	}
	return nil
}

func (s *ConfigStore) saveLocked() error {
	data, err := json.MarshalIndent(s.cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// Public strips secrets for the UI.
func (c Config) Public() Config {
	out := cloneConfig(c)
	out.Settings.Remote.HasPIN = out.Settings.Remote.PINHash != ""
	out.Settings.Remote.PINHash = ""
	return out
}

func (c *Config) Find(id string) *Macro {
	for i := range c.Macros {
		if c.Macros[i].ID == id {
			return &c.Macros[i]
		}
	}
	return nil
}
