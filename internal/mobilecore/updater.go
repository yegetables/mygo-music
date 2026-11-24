package mobilecore

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"mygo-music/internal/music"
)

const (
	ForkRepo     = "yegetables/mygo-music"
	OfficialRepo = "egoist/mygo-music"
)

// UpdateChannelInfo describes an available update source and whether it
// publishes builds for the current platform.
type UpdateChannelInfo struct {
	ID        string `json:"id"`
	Repo      string `json:"repo"`
	Supported bool   `json:"supported"`
	Reason    string `json:"reason,omitempty"`
}

// UpdateRelease describes the latest release discovered on the active channel.
type UpdateRelease struct {
	Channel       string `json:"channel"`
	Repo          string `json:"repo"`
	Current       string `json:"currentVersion"`
	Latest        string `json:"latestVersion"`
	HasUpdate     bool   `json:"hasUpdate"`
	Skipped       bool   `json:"skipped"`
	Notes         string `json:"notes,omitempty"`
	ReleaseURL    string `json:"releaseUrl,omitempty"`
	AssetName     string `json:"assetName,omitempty"`
	DownloadURL   string `json:"downloadUrl,omitempty"`
	AssetSize     int64  `json:"assetSize,omitempty"`
	PublishedAt   string `json:"publishedAt,omitempty"`
	CheckedAt     string `json:"checkedAt"`
	CanDirectLoad bool   `json:"canDirectInstall"` // true on Android with APK asset
}

type githubReleaseAsset struct {
	Name               string `json:"name"`
	Size               int64  `json:"size"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

type githubReleaseResp struct {
	TagName     string               `json:"tag_name"`
	Name        string               `json:"name"`
	Body        string               `json:"body"`
	HTMLURL     string               `json:"html_url"`
	Draft       bool                 `json:"draft"`
	Prerelease  bool                 `json:"prerelease"`
	PublishedAt string               `json:"published_at"`
	Assets      []githubReleaseAsset `json:"assets"`
}

type appUpdater struct {
	state      *stateStore
	httpClient *http.Client
	apiBase    string // overridable in tests; defaults to https://api.github.com

	mu         sync.RWMutex
	lastResult *UpdateRelease
}

func newAppUpdater(state *stateStore) *appUpdater {
	return &appUpdater{
		state: state,
		httpClient: &http.Client{
			Timeout: 20 * time.Second,
		},
		apiBase: "https://api.github.com",
	}
}

func normalizePlatform(p string) string {
	p = strings.ToLower(strings.TrimSpace(p))
	switch p {
	case "ios", "ipados":
		return "ios"
	case "android":
		return "android"
	case "darwin", "macos":
		return "darwin"
	case "windows":
		return "windows"
	case "linux":
		return "linux"
	default:
		switch runtime.GOOS {
		case "ios":
			return "ios"
		case "android":
			return "android"
		default:
			return "web"
		}
	}
}

// ChannelsForPlatform lists the Fork and Official channels with platform
// availability. Official upstream only ships desktop binaries, so on iOS/iPadOS
// and Android it is marked unsupported (disabled/greyed out in the UI).
func ChannelsForPlatform(platform string) []UpdateChannelInfo {
	plat := normalizePlatform(platform)
	officialSupported := plat == "darwin" || plat == "windows" || plat == "linux"
	officialReason := ""
	if !officialSupported {
		switch plat {
		case "ios":
			officialReason = "Official upstream does not publish iPadOS / iOS builds"
		case "android":
			officialReason = "Official upstream does not publish Android builds"
		default:
			officialReason = "Official upstream only publishes desktop builds"
		}
	}
	return []UpdateChannelInfo{
		{
			ID:        UpdateChannelFork,
			Repo:      ForkRepo,
			Supported: true,
		},
		{
			ID:        UpdateChannelOfficial,
			Repo:      OfficialRepo,
			Supported: officialSupported,
			Reason:    officialReason,
		},
	}
}

func (u *appUpdater) effectiveChannel(platform string) UpdateChannelInfo {
	channels := ChannelsForPlatform(platform)
	wanted := u.state.Settings().UpdateChannel
	for _, ch := range channels {
		if ch.ID == wanted && ch.Supported {
			return ch
		}
	}
	return channels[0] // fallback to fork
}

func (u *appUpdater) Status(platform string) map[string]any {
	plat := normalizePlatform(platform)
	st := u.state.Settings()
	ch := u.effectiveChannel(plat)
	u.mu.RLock()
	last := u.lastResult
	u.mu.RUnlock()
	return map[string]any{
		"currentVersion":   AppVersion,
		"platform":         plat,
		"channel":          ch.ID,
		"channels":         ChannelsForPlatform(plat),
		"autoCheckUpdates": st.AutoCheckUpdates,
		"lastUpdateCheck":  st.LastUpdateCheck,
		"skippedVersion":   st.SkippedVersion,
		"latest":           last,
	}
}

func (u *appUpdater) Check(platform string) (*UpdateRelease, error) {
	plat := normalizePlatform(platform)
	ch := u.effectiveChannel(plat)
	if !ch.Supported {
		return nil, errors.New("selected update channel is not supported on this platform")
	}

	endpoint := fmt.Sprintf("%s/repos/%s/releases/latest", strings.TrimRight(u.apiBase, "/"), ch.Repo)
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", music.Agent)

	resp, err := u.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	nowStr := time.Now().UTC().Format(time.RFC3339)

	// If the fork repository has not published any release yet, report up-to-date cleanly.
	if resp.StatusCode == http.StatusNotFound {
		_, _ = u.state.UpdateSettings(func(s *Settings) {
			s.LastUpdateCheck = nowStr
		})
		res := &UpdateRelease{
			Channel:   ch.ID,
			Repo:      ch.Repo,
			Current:   AppVersion,
			Latest:    AppVersion,
			HasUpdate: false,
			CheckedAt: nowStr,
		}
		u.mu.Lock()
		u.lastResult = res
		u.mu.Unlock()
		return res, nil
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("GitHub API %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}

	var rel githubReleaseResp
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, err
	}

	latestVer := strings.TrimPrefix(strings.TrimSpace(rel.TagName), "v")
	if latestVer == "" {
		latestVer = strings.TrimPrefix(strings.TrimSpace(rel.Name), "v")
	}
	hasUpdate := compareSemver(latestVer, AppVersion) > 0
	asset := pickReleaseAsset(rel.Assets, plat)

	st, _ := u.state.UpdateSettings(func(s *Settings) {
		s.LastUpdateCheck = nowStr
	})

	res := &UpdateRelease{
		Channel:       ch.ID,
		Repo:          ch.Repo,
		Current:       AppVersion,
		Latest:        latestVer,
		HasUpdate:     hasUpdate,
		Skipped:       hasUpdate && st.SkippedVersion != "" && compareSemver(latestVer, st.SkippedVersion) == 0,
		Notes:         rel.Body,
		ReleaseURL:    rel.HTMLURL,
		PublishedAt:   rel.PublishedAt,
		CheckedAt:     nowStr,
		CanDirectLoad: plat == "android" && asset != nil && strings.HasSuffix(strings.ToLower(asset.Name), ".apk"),
	}
	if asset != nil {
		res.AssetName = asset.Name
		res.DownloadURL = asset.BrowserDownloadURL
		res.AssetSize = asset.Size
	}

	u.mu.Lock()
	u.lastResult = res
	u.mu.Unlock()
	return res, nil
}

func pickReleaseAsset(assets []githubReleaseAsset, platform string) *githubReleaseAsset {
	var ext string
	switch platform {
	case "android":
		ext = ".apk"
	case "ios":
		ext = ".ipa"
	default:
		return nil
	}
	var fallback *githubReleaseAsset
	for i := range assets {
		a := &assets[i]
		lower := strings.ToLower(a.Name)
		if !strings.HasSuffix(lower, ext) {
			continue
		}
		if strings.Contains(lower, "arm64") {
			return a
		}
		if fallback == nil {
			fallback = a
		}
	}
	return fallback
}

// compareSemver returns >0 when a > b, <0 when a < b, 0 when equal.
func compareSemver(a, b string) int {
	pa := parseSemverParts(a)
	pb := parseSemverParts(b)
	for i := 0; i < 3; i++ {
		if pa[i] != pb[i] {
			if pa[i] > pb[i] {
				return 1
			}
			return -1
		}
	}
	return 0
}

func parseSemverParts(v string) [3]int {
	v = strings.TrimSpace(v)
	v = strings.TrimPrefix(v, "v")
	if idx := strings.IndexAny(v, "-+"); idx >= 0 {
		v = v[:idx]
	}
	parts := strings.Split(v, ".")
	var out [3]int
	for i := 0; i < 3 && i < len(parts); i++ {
		n, _ := strconv.Atoi(parts[i])
		out[i] = n
	}
	return out
}
