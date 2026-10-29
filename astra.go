package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Astra, the service-desk workspace, ships inside Praxis and is served from this PC only.
// Its files are embedded as they are in astra/; Praxis adds a start-up script and styles, and
// replaces the two AI modules (which would need a download) with offline stand-ins.

//go:embed astra/index.html astra/popup.html astra/css astra/js astra/assets astra/library
var astraFiles embed.FS

//go:embed web/astra/praxis-embed.js web/astra/praxis-embed.css web/astra/local-ai.js web/astra/model-store.js
var astraOverrides embed.FS

var astraReplaced = map[string]string{
	"praxis-embed.js":        "web/astra/praxis-embed.js",
	"praxis-embed.css":       "web/astra/praxis-embed.css",
	"js/local-ai.js":         "web/astra/local-ai.js",
	"js/model-store.js":      "web/astra/model-store.js",
	"js/local-llm.worker.js": "", // never served: the assistant is not included
}

// Fixed types: Windows' registry can map .js to text/plain, which the browser would refuse to run.
var astraTypes = map[string]string{
	".js":   "text/javascript; charset=utf-8",
	".css":  "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".json": "application/json",
	".png":  "image/png",
	".svg":  "image/svg+xml",
	".pdf":  "application/pdf",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

// Astra's own pages allow its AI download host; Praxis allows nothing beyond this PC.
var astraConnectSrc = regexp.MustCompile(`connect-src [^;"]*`)

const astraCSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; " +
	"media-src 'self' blob:; connect-src 'self'; font-src 'none'; object-src 'none'; frame-src 'none'; " +
	"worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"

func (s *Server) astraHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/astra/")
		if p == "" {
			p = "index.html"
		}
		if !fs.ValidPath(p) {
			http.NotFound(w, r)
			return
		}
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Frame-Options", "SAMEORIGIN")
		h.Set("Content-Security-Policy", astraCSP)

		var data []byte
		var err error
		if src, ok := astraReplaced[p]; ok {
			if src == "" {
				http.NotFound(w, r)
				return
			}
			data, err = astraOverrides.ReadFile(src)
		} else {
			data, err = astraFiles.ReadFile("astra/" + p)
		}
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if p == "index.html" || p == "popup.html" {
			h.Set("Cache-Control", "no-store")
			h.Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write(s.astraPage(data))
			return
		}
		ct := astraTypes[path.Ext(p)]
		if ct == "" {
			ct = "application/octet-stream"
		}
		h.Set("Content-Type", ct)
		if strings.HasPrefix(p, "library/") {
			h.Set("Cache-Control", "private, max-age=86400")
		} else {
			h.Set("Cache-Control", "no-cache")
		}
		// ServeContent handles Range requests, which the PDF viewer uses to open at a page.
		http.ServeContent(w, r, p, time.Time{}, bytes.NewReader(data))
	})
}

// astraPage adds Praxis's token, the saved workspace and the start-up script to an Astra page,
// and limits its connections to this PC.
func (s *Server) astraPage(page []byte) []byte {
	kv, _ := json.Marshal(s.kv.All()) // json escapes < > &, so this cannot end the script element early
	inject := `<meta name="praxis-token" content="` + s.token + `">` +
		`<script type="application/json" id="praxis-kv">` + string(kv) + `</script>` +
		`<script src="praxis-embed.js"></script>` +
		`<link rel="stylesheet" href="praxis-embed.css">`
	out := astraConnectSrc.ReplaceAll(page, []byte("connect-src 'self'"))
	out = bytes.ReplaceAll(out, []byte(" 'wasm-unsafe-eval'"), nil)
	// before Astra's first script, so the workspace is in place when Astra reads it
	if i := bytes.Index(out, []byte("<script")); i >= 0 {
		return append(append(append([]byte{}, out[:i]...), inject...), out[i:]...)
	}
	return append(out, inject...)
}

// ---- workspace storage ----

// KVStore keeps Astra's browser storage in Praxis's folder (kv.json).
type KVStore struct {
	mu   sync.Mutex
	path string
	data map[string]string
}

const (
	maxKVKey   = 200
	maxKVValue = 16 << 20
)

func LoadKVStore(dir string) *KVStore {
	s := &KVStore{path: filepath.Join(dir, "kv.json"), data: map[string]string{}}
	if b, err := os.ReadFile(s.path); err == nil {
		if json.Unmarshal(b, &s.data) != nil {
			_ = os.Rename(s.path, s.path+".broken")
			s.data = map[string]string{}
		}
	}
	return s
}

func (s *KVStore) All() map[string]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]string, len(s.data))
	for k, v := range s.data {
		out[k] = v
	}
	return out
}

func validKVKey(k string) bool {
	return strings.HasPrefix(k, "astra.") && len(k) <= maxKVKey && !strings.ContainsAny(k, "\x00\r\n")
}

// Set stores a value; nil deletes the key.
func (s *KVStore) Set(k string, v *string) error {
	if !validKVKey(k) {
		return errors.New("invalid key")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	old, had := s.data[k]
	if v == nil {
		delete(s.data, k)
	} else {
		s.data[k] = *v
	}
	if err := s.save(); err != nil {
		if had {
			s.data[k] = old
		} else {
			delete(s.data, k)
		}
		return err
	}
	return nil
}

func (s *KVStore) save() error {
	b, err := json.Marshal(s.data)
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *Server) kvRoutes(api *http.ServeMux) {
	api.HandleFunc("PUT /api/kv/{key}", func(w http.ResponseWriter, r *http.Request) {
		b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxKVValue))
		if err != nil {
			writeErr(w, 413, "too large")
			return
		}
		v := string(b)
		if err := s.kv.Set(r.PathValue("key"), &v); err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	api.HandleFunc("DELETE /api/kv/{key}", func(w http.ResponseWriter, r *http.Request) {
		if err := s.kv.Set(r.PathValue("key"), nil); err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
}
