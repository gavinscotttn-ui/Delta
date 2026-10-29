package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
	"unicode/utf8"
)

// Item is a note or an email template. Templates use Subject; notes leave it empty.
type Item struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Subject string `json:"subject,omitempty"`
	Body    string `json:"body"`
	Updated int64  `json:"updated"` // unix ms
}

const (
	maxItems     = 1000
	maxItemBody  = 200_000
	maxItemTitle = 200
)

// ItemStore persists one list (notes.json or templates.json) next to config.json.
type ItemStore struct {
	mu    sync.Mutex
	path  string
	items []Item
}

func LoadItemStore(dir, name string) *ItemStore {
	s := &ItemStore{path: filepath.Join(dir, name)}
	if b, err := os.ReadFile(s.path); err == nil {
		if json.Unmarshal(b, &s.items) != nil {
			_ = os.Rename(s.path, s.path+".broken")
			s.items = nil
		}
	}
	if s.items == nil {
		s.items = []Item{}
	}
	return s
}

func (s *ItemStore) List() []Item {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Item{}, s.items...) // never nil: the UI expects a JSON array
}

// Put inserts or replaces one item by id (empty id creates one).
func (s *ItemStore) Put(it Item) (Item, error) {
	if err := it.validate(); err != nil {
		return Item{}, err
	}
	if it.ID == "" {
		it.ID = randomID()
	}
	if !validID(it.ID) {
		return Item{}, errors.New("invalid id")
	}
	it.Updated = time.Now().UnixMilli()
	s.mu.Lock()
	defer s.mu.Unlock()
	next := make([]Item, 0, len(s.items)+1)
	next = append(next, it) // most recent first
	for _, x := range s.items {
		if x.ID != it.ID {
			next = append(next, x)
		}
	}
	if len(next) > maxItems {
		return Item{}, fmt.Errorf("limit of %d reached", maxItems)
	}
	if err := s.save(next); err != nil {
		return Item{}, err
	}
	s.items = next
	return it, nil
}

func (s *ItemStore) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := make([]Item, 0, len(s.items))
	for _, x := range s.items {
		if x.ID != id {
			next = append(next, x)
		}
	}
	if err := s.save(next); err != nil {
		return err
	}
	s.items = next
	return nil
}

func (s *ItemStore) save(items []Item) error {
	b, err := json.Marshal(items)
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (it *Item) validate() error {
	for _, f := range []struct {
		v   string
		max int
	}{{it.Title, maxItemTitle}, {it.Subject, maxItemTitle * 5}, {it.Body, maxItemBody}} {
		if !utf8.ValidString(f.v) {
			return errors.New("text is not valid")
		}
		if len(f.v) > f.max {
			return errors.New("too long")
		}
	}
	return nil
}
