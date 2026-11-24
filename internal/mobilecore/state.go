package mobilecore

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"mygo-music/internal/i18n"
	"mygo-music/internal/music"
)

// AppVersion matches mygo.config.ts so plugins declaring minAppVersion load cleanly.
const AppVersion = "0.1.25"

// Settings holds persisted mobile app preferences.
type Settings struct {
	ActiveSource string `json:"activeSource"`
	Quality      string `json:"quality"`
	Language     string `json:"language"`
	Theme        string `json:"theme"`
	CacheLimitMB int    `json:"cacheLimitMB"`
}

func defaultSettings() Settings {
	return Settings{
		ActiveSource: "local",
		Quality:      "high",
		Language:     i18n.System,
		Theme:        "system",
		CacheLimitMB: 512,
	}
}

// Session holds persisted playback queue state across app restarts.
type Session struct {
	Queue         []music.Track `json:"queue"`
	Index         int           `json:"index"`
	PositionMs    int64         `json:"positionMs"`
	RepeatMode    string        `json:"repeatMode"` // off, all, one
	Shuffle       bool          `json:"shuffle"`
	StationID     string        `json:"stationId,omitempty"`
	StationSource string        `json:"stationSource,omitempty"`
	StationName   string        `json:"stationName,omitempty"`
}

func defaultSession() Session {
	return Session{
		Index:      -1,
		RepeatMode: "off",
	}
}

type stateStore struct {
	mu          sync.RWMutex
	dataDir     string
	systemLangs []string
	settings    Settings
	session     Session
}

func newStateStore(dataDir string, systemLangs []string) *stateStore {
	st := &stateStore{
		dataDir:     dataDir,
		systemLangs: systemLangs,
		settings:    defaultSettings(),
		session:     defaultSession(),
	}
	st.load()
	st.applyLanguage()
	return st
}

func (s *stateStore) settingsPath() string {
	return filepath.Join(s.dataDir, "mobile_settings.json")
}

func (s *stateStore) sessionPath() string {
	return filepath.Join(s.dataDir, "mobile_session.json")
}

func (s *stateStore) load() {
	if b, err := os.ReadFile(s.settingsPath()); err == nil {
		var loaded Settings
		if json.Unmarshal(b, &loaded) == nil {
			if loaded.ActiveSource != "" {
				s.settings.ActiveSource = loaded.ActiveSource
			}
			if loaded.Quality != "" {
				s.settings.Quality = loaded.Quality
			}
			if loaded.Language != "" {
				s.settings.Language = loaded.Language
			}
			if loaded.Theme != "" {
				s.settings.Theme = loaded.Theme
			}
			if loaded.CacheLimitMB >= 64 {
				s.settings.CacheLimitMB = loaded.CacheLimitMB
			}
		}
	}
	if b, err := os.ReadFile(s.sessionPath()); err == nil {
		var sess Session
		if json.Unmarshal(b, &sess) == nil {
			if sess.RepeatMode == "" {
				sess.RepeatMode = "off"
			}
			s.session = sess
		}
	}
}

func (s *stateStore) applyLanguage() {
	resolved := i18n.Resolve(s.settings.Language, s.systemLangs)
	i18n.SetLanguage(resolved)
}

func (s *stateStore) Settings() Settings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.settings
}

func (s *stateStore) UpdateSettings(patch func(*Settings)) (Settings, error) {
	s.mu.Lock()
	patch(&s.settings)
	if s.settings.CacheLimitMB < 64 {
		s.settings.CacheLimitMB = 64
	}
	if s.settings.Quality == "" {
		s.settings.Quality = "high"
	}
	if s.settings.Theme == "" {
		s.settings.Theme = "system"
	}
	if s.settings.Language == "" {
		s.settings.Language = i18n.System
	}
	s.applyLanguage()
	out := s.settings
	s.mu.Unlock()
	return out, writeJSONAtomic(s.settingsPath(), out)
}

func (s *stateStore) Session() Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.session
}

func (s *stateStore) SaveSession(sess Session) error {
	if sess.RepeatMode == "" {
		sess.RepeatMode = "off"
	}
	s.mu.Lock()
	s.session = sess
	s.mu.Unlock()
	return writeJSONAtomic(s.sessionPath(), sess)
}

func writeJSONAtomic(path string, v any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
