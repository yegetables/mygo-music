package mobilecore

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"mygo-music/internal/local"
	"mygo-music/internal/music"
	"mygo-music/internal/plugin"
)

var capabilityList = []string{
	"signIn", "signOut", "account",
	"search", "suggest",
	"playlists", "playlist", "album", "artist", "liked", "recent",
	"home", "browse",
	"isLiked", "like", "likeEpisode",
	"createPlaylist", "renamePlaylist", "deletePlaylist",
	"addToPlaylist", "removeFromPlaylist", "movePlaylistTrack", "savePlaylist",
	"followArtist", "saveAlbum", "savedAlbums",
	"shows", "show", "subscribeShow",
	"stations", "stationNext",
	"comments", "likeComment", "postComment",
	"lyrics", "stream", "played",
}

// SourceSummary describes a source (local or plugin) for the mobile UI.
type SourceSummary struct {
	Info         music.Info          `json:"info"`
	Builtin      bool                `json:"builtin"`
	Active       bool                `json:"active"`
	Capabilities map[string]bool     `json:"capabilities"`
	Settings     map[string]string   `json:"settings"`
	Origin       *plugin.Origin      `json:"origin,omitempty"`
	Permissions  *plugin.Permissions `json:"permissions,omitempty"`
}

// PendingSummary describes a downloaded/uploaded plugin awaiting confirmation.
type PendingSummary struct {
	PendingID      string             `json:"pendingId"`
	Repo           string             `json:"repo,omitempty"`
	Version        string             `json:"version,omitempty"`
	ID             string             `json:"id"`
	Name           string             `json:"name"`
	MinAppVersion  string             `json:"minAppVersion,omitempty"`
	Permissions    plugin.Permissions `json:"permissions"`
	Updating       bool               `json:"updating"`
	ProcessWarning bool               `json:"processWarning,omitempty"`
}

type pendingEntry struct {
	pending *plugin.Pending
	created time.Time
}

type sourceManager struct {
	mu            sync.RWMutex
	pluginsDir    string
	pluginDataDir string
	localDir      string
	importsDir    string
	localSrc      *local.Source
	plugins       map[string]*plugin.Plugin
	pending       map[string]*pendingEntry
	emit          func(event string, payload any)
}

func newSourceManager(dataDir string, emit func(string, any)) *sourceManager {
	pluginsDir := filepath.Join(dataDir, "plugins")
	pluginDataDir := filepath.Join(dataDir, "plugin-data")
	localDir := filepath.Join(dataDir, "local")
	importsDir := filepath.Join(dataDir, "local-imports")

	_ = os.MkdirAll(pluginsDir, 0o755)
	_ = os.MkdirAll(pluginDataDir, 0o755)
	_ = os.MkdirAll(localDir, 0o755)

	localSrc := local.New(localDir)
	localSrc.OnChange(func() {
		if emit != nil {
			emit("localChanged", map[string]any{})
		}
	})

	sm := &sourceManager{
		pluginsDir:    pluginsDir,
		pluginDataDir: pluginDataDir,
		localDir:      localDir,
		importsDir:    importsDir,
		localSrc:      localSrc,
		plugins:       map[string]*plugin.Plugin{},
		pending:       map[string]*pendingEntry{},
		emit:          emit,
	}

	sm.discover()
	// Hook image headers across all loaded plugins so cover proxy attaches cookies/headers.
	music.ImageHeaders = sm.imageHeaders

	if len(localSrc.Folders()) > 0 {
		go localSrc.Rescan()
	}

	return sm
}

func (sm *sourceManager) discover() {
	loaded := plugin.Discover(sm.pluginsDir, sm.pluginDataDir)
	sm.mu.Lock()
	defer sm.mu.Unlock()
	for _, p := range loaded {
		sm.attachPluginHooks(p)
		sm.plugins[p.Info().ID] = p
	}
}

func (sm *sourceManager) attachPluginHooks(p *plugin.Plugin) {
	id := p.Info().ID
	p.OnSignInPrompt(func(prompt music.SignInPrompt) {
		if sm.emit != nil {
			sm.emit("signInPrompt", map[string]any{
				"source": id,
				"qr":     prompt.QR,
				"text":   prompt.Text,
			})
		}
	})
}

func (sm *sourceManager) imageHeaders(u *url.URL) map[string]string {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	for _, p := range sm.plugins {
		if h := p.HeadersFor(u, plugin.KindImage); len(h) > 0 {
			return h
		}
	}
	return nil
}

func (sm *sourceManager) Close() {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	for _, p := range sm.plugins {
		p.Close()
	}
	for id, entry := range sm.pending {
		entry.pending.Discard()
		delete(sm.pending, id)
	}
}

func (sm *sourceManager) Get(id string) (music.Source, bool) {
	if id == "" || id == local.ID {
		return sm.localSrc, true
	}
	sm.mu.RLock()
	p, ok := sm.plugins[id]
	sm.mu.RUnlock()
	if !ok {
		return nil, false
	}
	return p, true
}

func (sm *sourceManager) GetPlugin(id string) (*plugin.Plugin, bool) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	p, ok := sm.plugins[id]
	return p, ok
}

func (sm *sourceManager) List(activeID string) []SourceSummary {
	sm.mu.RLock()
	plugins := make([]*plugin.Plugin, 0, len(sm.plugins))
	for _, p := range sm.plugins {
		plugins = append(plugins, p)
	}
	sm.mu.RUnlock()

	sort.Slice(plugins, func(i, j int) bool {
		return strings.ToLower(plugins[i].Info().Name) < strings.ToLower(plugins[j].Info().Name)
	})

	out := make([]SourceSummary, 0, len(plugins)+1)
	for _, p := range plugins {
		out = append(out, sm.summarizePlugin(p, p.Info().ID == activeID))
	}
	out = append(out, sm.summarizeLocal(activeID == "" || activeID == local.ID))
	return out
}

func (sm *sourceManager) summarizeLocal(active bool) SourceSummary {
	info := sm.localSrc.Info()
	caps := map[string]bool{}
	for _, c := range capabilityList {
		if sm.localSrc.Can(c) {
			caps[c] = true
		}
	}
	return SourceSummary{
		Info:         info,
		Builtin:      true,
		Active:       active,
		Capabilities: caps,
		Settings:     map[string]string{},
	}
}

func (sm *sourceManager) summarizePlugin(p *plugin.Plugin, active bool) SourceSummary {
	info := p.Info()
	caps := map[string]bool{}
	for _, c := range capabilityList {
		if p.Can(c) {
			caps[c] = true
		}
	}
	settings := map[string]string{}
	for _, st := range info.Settings {
		settings[st.Key] = p.Setting(st.Key)
	}
	perms := p.Permissions()
	return SourceSummary{
		Info:         info,
		Builtin:      false,
		Active:       active,
		Capabilities: caps,
		Settings:     settings,
		Origin:       p.Origin(),
		Permissions:  &perms,
	}
}

func (sm *sourceManager) registerPending(p *plugin.Pending) PendingSummary {
	id := randomHex(12)
	sm.mu.Lock()
	// Prune stale pending entries older than 30 minutes.
	cutoff := time.Now().Add(-30 * time.Minute)
	for k, e := range sm.pending {
		if e.created.Before(cutoff) {
			e.pending.Discard()
			delete(sm.pending, k)
		}
	}
	_, exists := sm.plugins[p.Manifest.ID]
	sm.pending[id] = &pendingEntry{pending: p, created: time.Now()}
	sm.mu.Unlock()

	return PendingSummary{
		PendingID:      id,
		Repo:           p.Repo,
		Version:        p.Version,
		ID:             p.Manifest.ID,
		Name:           p.Manifest.Name,
		MinAppVersion:  p.Manifest.MinAppVersion,
		Permissions:    p.Manifest.Permissions,
		Updating:       exists,
		ProcessWarning: len(p.Manifest.Permissions.Process) > 0,
	}
}

func (sm *sourceManager) PrepareGitHub(repoInput string) (*PendingSummary, error) {
	repo, err := plugin.ParseRepo(repoInput)
	if err != nil {
		return nil, err
	}
	pending, err := plugin.Fetch(repo, sm.pluginsDir)
	if err != nil {
		return nil, err
	}
	summary := sm.registerPending(pending)
	return &summary, nil
}

func (sm *sourceManager) PrepareLocalPath(path string) (*PendingSummary, error) {
	pending, err := plugin.Open(path, sm.pluginsDir)
	if err != nil {
		return nil, err
	}
	summary := sm.registerPending(pending)
	return &summary, nil
}

func (sm *sourceManager) PrepareZipReader(r io.Reader) (*PendingSummary, error) {
	tmpFile, err := os.CreateTemp("", "mygo-plugin-*.zip")
	if err != nil {
		return nil, err
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	if _, err := io.Copy(tmpFile, io.LimitReader(r, 256<<20)); err != nil {
		tmpFile.Close()
		return nil, err
	}
	if err := tmpFile.Close(); err != nil {
		return nil, err
	}
	return sm.PrepareLocalPath(tmpPath)
}

func (sm *sourceManager) PrepareURL(rawURL string) (*PendingSummary, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("invalid plugin archive URL: %s", rawURL)
	}
	client := &http.Client{Timeout: 2 * time.Minute}
	req, err := http.NewRequest("GET", u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", music.Agent)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download failed: %s", resp.Status)
	}
	return sm.PrepareZipReader(resp.Body)
}

func (sm *sourceManager) ConfirmInstall(pendingID string) (*SourceSummary, error) {
	sm.mu.Lock()
	entry, ok := sm.pending[pendingID]
	if ok {
		delete(sm.pending, pendingID)
	}
	sm.mu.Unlock()
	if !ok {
		return nil, errors.New("pending plugin installation expired or not found")
	}

	pluginID := entry.pending.Manifest.ID

	// Close existing plugin instance before replacing its directory on disk.
	sm.mu.Lock()
	if existing, has := sm.plugins[pluginID]; has {
		existing.Close()
	}
	sm.mu.Unlock()

	if err := entry.pending.Install(sm.pluginsDir); err != nil {
		return nil, err
	}
	loaded, err := plugin.Load(filepath.Join(sm.pluginsDir, pluginID), sm.pluginDataDir)
	if err != nil {
		return nil, err
	}
	sm.attachPluginHooks(loaded)

	sm.mu.Lock()
	sm.plugins[pluginID] = loaded
	sm.mu.Unlock()

	if sm.emit != nil {
		sm.emit("sourcesChanged", map[string]any{"installed": pluginID})
	}
	summary := sm.summarizePlugin(loaded, false)
	return &summary, nil
}

func (sm *sourceManager) DiscardPending(pendingID string) {
	sm.mu.Lock()
	entry, ok := sm.pending[pendingID]
	if ok {
		delete(sm.pending, pendingID)
	}
	sm.mu.Unlock()
	if ok {
		entry.pending.Discard()
	}
}

func (sm *sourceManager) RemovePlugin(id string) error {
	sm.mu.Lock()
	p, ok := sm.plugins[id]
	if ok {
		delete(sm.plugins, id)
	}
	sm.mu.Unlock()
	if !ok {
		return fmt.Errorf("plugin %q not found", id)
	}
	if err := p.Remove(nil); err != nil {
		return err
	}
	if sm.emit != nil {
		sm.emit("sourcesChanged", map[string]any{"removed": id})
	}
	return nil
}

func (sm *sourceManager) ReloadPlugin(id string) (*SourceSummary, error) {
	sm.mu.Lock()
	p, ok := sm.plugins[id]
	sm.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("plugin %q not found", id)
	}
	reloaded, err := p.Reloaded(sm.pluginDataDir)
	if err != nil {
		return nil, err
	}
	sm.attachPluginHooks(reloaded)
	sm.mu.Lock()
	sm.plugins[id] = reloaded
	sm.mu.Unlock()

	if sm.emit != nil {
		sm.emit("sourcesChanged", map[string]any{"reloaded": id})
	}
	summary := sm.summarizePlugin(reloaded, false)
	return &summary, nil
}

func (sm *sourceManager) CheckUpdate(id string) (map[string]any, error) {
	p, ok := sm.GetPlugin(id)
	if !ok {
		return nil, fmt.Errorf("plugin %q not found", id)
	}
	origin := p.Origin()
	if origin == nil || origin.Repo == "" {
		return map[string]any{"hasUpdate": false, "localOnly": true}, nil
	}
	latest, err := plugin.Latest(origin.Repo)
	if err != nil {
		return nil, err
	}
	hasUpdate := plugin.IsNewer(latest.Version, origin.Version)
	return map[string]any{
		"hasUpdate":        hasUpdate,
		"repo":             origin.Repo,
		"installedVersion": origin.Version,
		"latestVersion":    latest.Version,
	}, nil
}

func (sm *sourceManager) ImportAudioFile(filename string, r io.Reader) (string, error) {
	if err := os.MkdirAll(sm.importsDir, 0o755); err != nil {
		return "", err
	}
	base := filepath.Base(filename)
	base = strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == 0 {
			return '_'
		}
		return r
	}, base)
	if base == "" || base == "." || base == ".." {
		base = "track-" + randomHex(4) + ".mp3"
	}
	dest := filepath.Join(sm.importsDir, base)
	f, err := os.Create(dest)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(f, io.LimitReader(r, 512<<20)); err != nil {
		f.Close()
		os.Remove(dest)
		return "", err
	}
	if err := f.Close(); err != nil {
		return "", err
	}
	if !slices.Contains(sm.localSrc.Folders(), sm.importsDir) {
		sm.localSrc.AddFolders(sm.importsDir)
	} else {
		sm.localSrc.Rescan()
	}
	return dest, nil
}

func randomHex(bytesLen int) string {
	b := make([]byte, bytesLen)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
