package mobilecore

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"sync"

	"mygo-music/internal/i18n"
	"mygo-music/internal/music"
)

// AppVersion matches mygo.config.ts so plugins declaring minAppVersion load cleanly.
// Build scripts can override it via -ldflags "-X mygo-music/internal/mobilecore.AppVersion=...".
var AppVersion = "0.1.25"

const (
	UpdateChannelFork     = "fork"
	UpdateChannelOfficial = "official"
)

// Settings holds persisted mobile app preferences matching desktop MyGo Music.
type Settings struct {
	ActiveSource     string   `json:"activeSource"`
	Quality          string   `json:"quality"`
	Language         string   `json:"language"`
	Theme            string   `json:"theme"`
	CacheLimitMB     int      `json:"cacheLimitMB"`
	PlayerStyle      string   `json:"playerStyle"` // "", "vinyl", "cassette"
	HotComments      bool     `json:"hotComments"`
	Normalize        bool     `json:"normalize"`
	Smoke            bool     `json:"smoke"`
	Fog              bool     `json:"fog"`
	GrowFromCover    bool     `json:"growFromCover"`
	LyricsStage      bool     `json:"lyricsStage"`
	StageStyle       string   `json:"stageStyle"` // "", "partita", "tilt"
	StageSparks      bool     `json:"stageSparks"`
	DisabledPlugins  []string `json:"disabledPlugins,omitempty"`
	UpdateChannel    string   `json:"updateChannel"` // "fork" (default) | "official"
	AutoCheckUpdates bool     `json:"autoCheckUpdates"`
	LastUpdateCheck  string   `json:"lastUpdateCheck,omitempty"`
	SkippedVersion   string   `json:"skippedVersion,omitempty"`
}

func defaultSettings() Settings {
	return Settings{
		ActiveSource:     "local",
		Quality:          "high",
		Language:         i18n.System,
		Theme:            "system",
		CacheLimitMB:     2048,
		PlayerStyle:      "",
		HotComments:      false,
		Normalize:        true,
		Smoke:            false,
		Fog:              false,
		GrowFromCover:    false,
		LyricsStage:      false,
		StageStyle:       "",
		StageSparks:      false,
		UpdateChannel:    UpdateChannelFork,
		AutoCheckUpdates: true,
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

func sanitizePlayerStyle(v string) string {
	switch v {
	case "", "vinyl", "cassette":
		return v
	default:
		return ""
	}
}

func sanitizeStageStyle(v string) string {
	switch v {
	case "", "partita", "tilt":
		return v
	default:
		return ""
	}
}

func sanitizeUpdateChannel(v string) string {
	switch v {
	case UpdateChannelFork, UpdateChannelOfficial:
		return v
	default:
		return UpdateChannelFork
	}
}

func (s *stateStore) load() {
	if b, err := os.ReadFile(s.settingsPath()); err == nil {
		// Unmarshal directly onto defaults so omitted boolean fields (e.g.
		// normalize, autoCheckUpdates from older configs) keep their defaults.
		loaded := defaultSettings()
		if json.Unmarshal(b, &loaded) == nil {
			if loaded.ActiveSource == "" {
				loaded.ActiveSource = "local"
			}
			if loaded.Quality == "" {
				loaded.Quality = "high"
			}
			if loaded.Language == "" {
				loaded.Language = i18n.System
			}
			if loaded.Theme == "" {
				loaded.Theme = "system"
			}
			if loaded.CacheLimitMB < 0 {
				loaded.CacheLimitMB = 0
			}
			loaded.PlayerStyle = sanitizePlayerStyle(loaded.PlayerStyle)
			loaded.StageStyle = sanitizeStageStyle(loaded.StageStyle)
			loaded.UpdateChannel = sanitizeUpdateChannel(loaded.UpdateChannel)
			s.settings = loaded
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
	out := s.settings
	if len(s.settings.DisabledPlugins) > 0 {
		out.DisabledPlugins = slices.Clone(s.settings.DisabledPlugins)
	}
	return out
}

func (s *stateStore) UpdateSettings(patch func(*Settings)) (Settings, error) {
	s.mu.Lock()
	patch(&s.settings)
	if s.settings.CacheLimitMB < 0 {
		s.settings.CacheLimitMB = 0
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
	s.settings.PlayerStyle = sanitizePlayerStyle(s.settings.PlayerStyle)
	s.settings.StageStyle = sanitizeStageStyle(s.settings.StageStyle)
	s.settings.UpdateChannel = sanitizeUpdateChannel(s.settings.UpdateChannel)
	s.applyLanguage()
	out := s.settings
	if len(s.settings.DisabledPlugins) > 0 {
		out.DisabledPlugins = slices.Clone(s.settings.DisabledPlugins)
	}
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
