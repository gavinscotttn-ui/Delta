package main

import (
	"errors"
	"fmt"
	"strings"
)

// Win32 modifier flags as used by RegisterHotKey.
const (
	modAlt     = 0x0001
	modControl = 0x0002
	modShift   = 0x0004
	modWin     = 0x0008
)

type Hotkey struct {
	Mods uint32
	VK   uint32
	Key  string // canonical key name
}

func (h Hotkey) String() string {
	var parts []string
	if h.Mods&modControl != 0 {
		parts = append(parts, "Ctrl")
	}
	if h.Mods&modAlt != 0 {
		parts = append(parts, "Alt")
	}
	if h.Mods&modShift != 0 {
		parts = append(parts, "Shift")
	}
	if h.Mods&modWin != 0 {
		parts = append(parts, "Win")
	}
	return strings.Join(append(parts, h.Key), "+")
}

var keyTable = func() map[string]uint32 {
	m := map[string]uint32{
		"Space": 0x20, "Enter": 0x0D, "Esc": 0x1B, "Tab": 0x09, "Backspace": 0x08,
		"Pause": 0x13, "ScrollLock": 0x91, "PrintScreen": 0x2C, "Insert": 0x2D, "Delete": 0x2E,
		"Home": 0x24, "End": 0x23, "PageUp": 0x21, "PageDown": 0x22,
		"Left": 0x25, "Up": 0x26, "Right": 0x27, "Down": 0x28,
		"NumMul": 0x6A, "NumAdd": 0x6B, "NumSub": 0x6D, "NumDec": 0x6E, "NumDiv": 0x6F,
		"Semicolon": 0xBA, "Equal": 0xBB, "Comma": 0xBC, "Minus": 0xBD, "Period": 0xBE,
		"Slash": 0xBF, "Backquote": 0xC0, "BracketLeft": 0xDB, "Backslash": 0xDC,
		"BracketRight": 0xDD, "Quote": 0xDE,
		"VolumeMute": 0xAD, "VolumeDown": 0xAE, "VolumeUp": 0xAF,
		"MediaNext": 0xB0, "MediaPrev": 0xB1, "MediaStop": 0xB2, "MediaPlayPause": 0xB3,
	}
	for c := 'A'; c <= 'Z'; c++ {
		m[string(c)] = uint32(c)
	}
	for c := '0'; c <= '9'; c++ {
		m[string(c)] = uint32(c)
		m["Num"+string(c)] = 0x60 + uint32(c-'0')
	}
	for i := 1; i <= 24; i++ {
		m[fmt.Sprintf("F%d", i)] = 0x70 + uint32(i-1)
	}
	return m
}()

var keyAliases = map[string]string{
	"escape": "Esc", "return": "Enter", "spacebar": "Space", "del": "Delete", "ins": "Insert",
	"pgup": "PageUp", "pgdn": "PageDown", "break": "Pause", "prtsc": "PrintScreen",
	"arrowleft": "Left", "arrowright": "Right", "arrowup": "Up", "arrowdown": "Down",
}

func canonicalKey(tok string) (string, bool) {
	if a, ok := keyAliases[strings.ToLower(tok)]; ok {
		return a, true
	}
	for name := range keyTable {
		if strings.EqualFold(name, tok) {
			return name, true
		}
	}
	return "", false
}

func parseChord(s string) (Hotkey, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return Hotkey{}, errors.New("empty key combination")
	}
	var h Hotkey
	toks := strings.Split(s, "+")
	for i, raw := range toks {
		tok := strings.TrimSpace(raw)
		if tok == "" {
			return Hotkey{}, fmt.Errorf("malformed key combination %q", s)
		}
		last := i == len(toks)-1
		switch strings.ToLower(tok) {
		case "ctrl", "control":
			h.Mods |= modControl
			continue
		case "alt":
			h.Mods |= modAlt
			continue
		case "shift":
			h.Mods |= modShift
			continue
		case "win", "meta", "super", "cmd":
			h.Mods |= modWin
			continue
		}
		if !last {
			return Hotkey{}, fmt.Errorf("%q must be the last key in %q", tok, s)
		}
		name, ok := canonicalKey(tok)
		if !ok {
			return Hotkey{}, fmt.Errorf("unknown key %q", tok)
		}
		h.Key, h.VK = name, keyTable[name]
	}
	if h.Key == "" {
		return Hotkey{}, fmt.Errorf("%q has no main key", s)
	}
	return h, nil
}

// ParseHotkey parses a global hotkey such as "Ctrl+Alt+P" or "Pause".
func ParseHotkey(s string) (Hotkey, error) {
	h, err := parseChord(s)
	if err != nil {
		return h, err
	}
	if h.Key == "Pause" && h.Mods&modControl != 0 {
		return Hotkey{}, errors.New("Ctrl+Pause is sent as Break by Windows and cannot be used; try Shift+Pause or Alt+Pause")
	}
	return h, nil
}

// ParseKeyChord parses keys to send (no restrictions on bare keys).
func ParseKeyChord(s string) (Hotkey, error) { return parseChord(s) }
