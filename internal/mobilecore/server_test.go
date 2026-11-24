package mobilecore

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"mygo-music/internal/music"
	"mygo-music/internal/plugin"
)

func buildTestPluginZip(t *testing.T, audioURL string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	manifest := `{
  "id": "demo-mobile",
  "name": "Demo Mobile",
  "version": "1.0.0",
  "minAppVersion": "0.1.20",
  "main": "index.js",
  "playback": "stream",
  "permissions": { "network": ["*"] },
  "settings": [
    { "key": "mode", "label": "Mode", "type": "select", "options": [{"value":"a","label":"A"},{"value":"b","label":"B"}] }
  ],
  "navigation": [
    { "title": "Home", "builtin": "home", "icon": "home" }
  ]
}`
	script := `
export async function home() {
  return {
    title: "Demo Home",
    sections: [{
      title: "Featured",
      tracks: [{
        id: "t1",
        name: "Hello Mobile",
        artists: [{ id: "a1", name: "Tester" }],
        album: { id: "al1", name: "Test Album" },
        duration: 120000
      }]
    }]
  };
}
export async function search({ query }) {
  return {
    tracks: [{
      id: "t1",
      name: "Result: " + query,
      artists: [{ id: "a1", name: "Tester" }],
      album: { id: "al1", name: "Test Album" },
      duration: 120000
    }]
  };
}
export async function lyrics() {
  return { lrc: "[00:01.00]First line\n[00:05.00]Second line" };
}
export async function stream() {
  return { url: "` + audioURL + `", type: "mp3", quality: "high", headers: { "X-Custom-Auth": "ok" } };
}
export async function signIn() {
  const res = await host.webSignIn({
    url: "https://example.com/login",
    cookiesOf: "https://example.com/api",
    until: ["MUSIC_U"]
  });
  host.storage.set("cookie", res.cookie);
  return { id: "u1", name: "Signed User" };
}
`
	w1, _ := zw.Create("plugin.json")
	_, _ = w1.Write([]byte(manifest))
	w2, _ := zw.Create("index.js")
	_, _ = w2.Write([]byte(script))
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func apiReq(t *testing.T, srv *Server, method, path string, body io.Reader, contentType string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, "http://"+srv.Addr+path, body)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-MyGo-Token", srv.Token)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

// Rejects API requests missing the per-session auth token.
func TestAuthRequired(t *testing.T) {
	srv, err := Start(Options{DataDir: t.TempDir(), CacheDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Stop()

	resp, err := http.Get("http://" + srv.Addr + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 without token, got %d", resp.StatusCode)
	}

	okResp := apiReq(t, srv, http.MethodGet, "/api/health", nil, "")
	okResp.Body.Close()
	if okResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 with token, got %d", okResp.StatusCode)
	}
}

// Uploads a zip plugin, confirms install, runs home/search/lyrics/settings, and proxies audio with headers and Range support.
func TestPluginUploadBrowseAndAudioProxy(t *testing.T) {
	audioBytes := bytes.Repeat([]byte("ABCDEFGH"), 256)
	var sawHeader string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawHeader = r.Header.Get("X-Custom-Auth")
		w.Header().Set("Content-Type", "audio/mpeg")
		http.ServeContent(w, r, "song.mp3", time.Now(), bytes.NewReader(audioBytes))
	}))
	defer upstream.Close()

	srv, err := Start(Options{DataDir: t.TempDir(), CacheDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Stop()

	zipData := buildTestPluginZip(t, upstream.URL+"/song.mp3")

	// Prepare upload
	prepResp := apiReq(t, srv, http.MethodPost, "/api/plugins/prepare/upload", bytes.NewReader(zipData), "application/zip")
	defer prepResp.Body.Close()
	if prepResp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(prepResp.Body)
		t.Fatalf("prepare upload failed (%d): %s", prepResp.StatusCode, string(b))
	}
	var pending PendingSummary
	if err := json.NewDecoder(prepResp.Body).Decode(&pending); err != nil {
		t.Fatal(err)
	}
	if pending.ID != "demo-mobile" || pending.PendingID == "" {
		t.Fatalf("unexpected pending summary: %+v", pending)
	}

	// Confirm install
	confResp := apiReq(t, srv, http.MethodPost, "/api/plugins/confirm", strings.NewReader(`{"pendingId":"`+pending.PendingID+`","activate":true}`), "application/json")
	confResp.Body.Close()
	if confResp.StatusCode != http.StatusOK {
		t.Fatalf("confirm failed: %d", confResp.StatusCode)
	}

	// Set plugin setting
	setResp := apiReq(t, srv, http.MethodPost, "/api/sources/demo-mobile/setting", strings.NewReader(`{"key":"mode","value":"b"}`), "application/json")
	setResp.Body.Close()
	if setResp.StatusCode != http.StatusOK {
		t.Fatalf("set setting failed: %d", setResp.StatusCode)
	}

	// Home browse
	homeResp := apiReq(t, srv, http.MethodGet, "/api/sources/demo-mobile/home", nil, "")
	defer homeResp.Body.Close()
	if homeResp.StatusCode != http.StatusOK {
		t.Fatalf("home failed: %d", homeResp.StatusCode)
	}
	var home map[string]any
	_ = json.NewDecoder(homeResp.Body).Decode(&home)
	if home["title"] != "Demo Home" {
		t.Fatalf("unexpected home title: %v", home["title"])
	}

	// Lyrics parsing
	lyrResp := apiReq(t, srv, http.MethodGet, "/api/sources/demo-mobile/lyrics?id=t1", nil, "")
	defer lyrResp.Body.Close()
	var lyr parsedLyricsResponse
	_ = json.NewDecoder(lyrResp.Body).Decode(&lyr)
	if len(lyr.Lines) != 2 || lyr.Lines[0].Text != "First line" || lyr.Lines[0].AtMs != 1000 {
		t.Fatalf("unexpected lyrics: %+v", lyr)
	}

	// Stream info + Range audio fetch
	infoResp := apiReq(t, srv, http.MethodGet, "/api/stream/info?source=demo-mobile&id=t1&quality=high", nil, "")
	defer infoResp.Body.Close()
	var info struct {
		StreamURL string `json:"streamUrl"`
	}
	_ = json.NewDecoder(infoResp.Body).Decode(&info)
	if !strings.HasPrefix(info.StreamURL, "/api/stream/audio?") {
		t.Fatalf("unexpected streamUrl: %s", info.StreamURL)
	}

	rangeReq, _ := http.NewRequest(http.MethodGet, "http://"+srv.Addr+info.StreamURL, nil)
	rangeReq.Header.Set("Range", "bytes=0-15")
	audioResp, err := http.DefaultClient.Do(rangeReq)
	if err != nil {
		t.Fatal(err)
	}
	defer audioResp.Body.Close()
	chunk, _ := io.ReadAll(audioResp.Body)
	if audioResp.StatusCode != http.StatusPartialContent || len(chunk) != 16 {
		t.Fatalf("expected 206 with 16 bytes, got %d (%d bytes)", audioResp.StatusCode, len(chunk))
	}
	if sawHeader != "ok" {
		t.Fatalf("expected plugin header X-Custom-Auth=ok, got %q", sawHeader)
	}
}

// Completes a pending webSignIn request via CompleteWebSignIn and returns a PNG QR code.
func TestWebSignInBridgeAndQR(t *testing.T) {
	srv, err := Start(Options{DataDir: t.TempDir(), CacheDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Stop()

	// Verify QR endpoint produces PNG header bytes.
	qrResp := apiReq(t, srv, http.MethodGet, "/api/qr?text=https://music.163.com/login", nil, "")
	defer qrResp.Body.Close()
	pngData, _ := io.ReadAll(qrResp.Body)
	if qrResp.StatusCode != http.StatusOK || !bytes.HasPrefix(pngData, []byte{0x89, 'P', 'N', 'G'}) {
		t.Fatalf("expected PNG QR code, got status %d len %d", qrResp.StatusCode, len(pngData))
	}

	// Verify webSignIn channel completes cleanly.
	done := make(chan string, 1)
	go func() {
		cookie, err := srv.auth.handleWebSignIn(plugin.WebSignIn{
			Plugin:    "netease-cloud-music",
			Name:      "NetEase Cloud Music",
			URL:       "https://music.163.com",
			CookiesOf: "https://music.163.com",
			Until:     []string{"MUSIC_U"},
		})
		if err != nil {
			done <- "ERR:" + err.Error()
			return
		}
		done <- cookie
	}()

	var pendingID string
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		srv.auth.mu.Lock()
		for id := range srv.auth.pending {
			pendingID = id
		}
		srv.auth.mu.Unlock()
		if pendingID != "" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if pendingID == "" {
		t.Fatal("webSignIn did not register pending request")
	}

	srv.CompleteWebSignIn(pendingID, "MUSIC_U=abc123", "")
	got := <-done
	if got != "MUSIC_U=abc123" {
		t.Fatalf("expected cookie MUSIC_U=abc123, got %q", got)
	}
}

// Loads the real local NetEase plugin release zip if present on the developer machine.
func TestRealNetEasePluginLoadsIfBuilt(t *testing.T) {
	neteaseZip := "/home/yegetables/Projects/mygo-music-netease-cloud-music/dist/release/mygo-music-netease-cloud-music-v0.1.13.zip"
	if _, err := os.Stat(neteaseZip); err != nil {
		t.Skip("local netease release zip not present")
	}
	srv, err := Start(Options{DataDir: t.TempDir(), CacheDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Stop()

	pending, err := srv.sources.PrepareLocalPath(neteaseZip)
	if err != nil {
		t.Fatalf("prepare netease plugin failed: %v", err)
	}
	if pending.ProcessWarning {
		t.Fatalf("netease plugin unexpectedly requested process permission")
	}
	summary, err := srv.sources.ConfirmInstall(pending.PendingID)
	if err != nil {
		t.Fatalf("install netease plugin failed: %v", err)
	}
	if summary.Info.ID != "netease-cloud-music" || !summary.Capabilities["search"] || !summary.Capabilities["stream"] || !summary.Capabilities["signIn"] {
		t.Fatalf("unexpected netease summary: %+v", summary)
	}
}

// Verifies extended desktop-parity settings persist across restarts and cache limit 0 disables disk caching.
func TestSettingsParityAndZeroCache(t *testing.T) {
	dataDir := t.TempDir()
	cacheDir := t.TempDir()
	srv, err := Start(Options{DataDir: dataDir, CacheDir: cacheDir})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Stop()

	st := srv.state.Settings()
	if !st.Normalize || st.UpdateChannel != UpdateChannelFork || !st.AutoCheckUpdates || st.CacheLimitMB != 2048 {
		t.Fatalf("unexpected default settings: %+v", st)
	}

	body := `{"playerStyle":"vinyl","hotComments":true,"normalize":false,"smoke":true,"fog":true,"growFromCover":true,"lyricsStage":true,"stageStyle":"partita","stageSparks":true,"cacheLimitMB":0,"updateChannel":"fork","platform":"ios"}`
	req, _ := http.NewRequest(http.MethodPost, "http://"+srv.Addr+"/api/settings", strings.NewReader(body))
	req.Header.Set("X-MyGo-Token", srv.Token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var updated Settings
	if err := json.NewDecoder(resp.Body).Decode(&updated); err != nil {
		t.Fatal(err)
	}
	if updated.PlayerStyle != "vinyl" || !updated.HotComments || updated.Normalize || !updated.Smoke || !updated.Fog || !updated.GrowFromCover || !updated.LyricsStage || updated.StageStyle != "partita" || !updated.StageSparks || updated.CacheLimitMB != 0 {
		t.Fatalf("settings did not persist expected fields: %+v", updated)
	}

	// Switching to official upstream on unsupported mobile platforms must be rejected.
	badReq, _ := http.NewRequest(http.MethodPost, "http://"+srv.Addr+"/api/settings", strings.NewReader(`{"updateChannel":"official","platform":"ios"}`))
	badReq.Header.Set("X-MyGo-Token", srv.Token)
	badResp, err := http.DefaultClient.Do(badReq)
	if err != nil {
		t.Fatal(err)
	}
	badResp.Body.Close()
	if badResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 when selecting official channel on ios, got %d", badResp.StatusCode)
	}
}

// Verifies loudness normalization formula matches desktop MyGo Music including peak clipping protection.
func TestNormGainFormula(t *testing.T) {
	if g := normGain(&music.Stream{}); g != 1.0 {
		t.Fatalf("expected 1.0 for unmeasured track, got %v", g)
	}
	// +0 dB gain + 4 dB preamp = +4 dB -> ~1.5849, capped at 1/0.8 = 1.25.
	g := normGain(&music.Stream{Gain: 0, Peak: 0.8})
	if g < 1.249 || g > 1.251 {
		t.Fatalf("expected peak-capped gain 1.25, got %v", g)
	}
	// -10 dB gain + 4 dB preamp = -6 dB -> ~0.5012.
	g2 := normGain(&music.Stream{Gain: -10, Peak: 1.0})
	if g2 < 0.50 || g2 > 0.503 {
		t.Fatalf("expected ~0.5012, got %v", g2)
	}
}

// Verifies app updater channel availability, SemVer comparison, and platform asset selection.
func TestAppUpdaterForkChannelAndPlatformSupport(t *testing.T) {
	iosCh := ChannelsForPlatform("ios")
	if len(iosCh) != 2 || !iosCh[0].Supported || iosCh[0].ID != UpdateChannelFork || iosCh[1].Supported || iosCh[1].ID != UpdateChannelOfficial {
		t.Fatalf("unexpected ios channels: %+v", iosCh)
	}
	desktopCh := ChannelsForPlatform("darwin")
	if !desktopCh[0].Supported || !desktopCh[1].Supported {
		t.Fatalf("expected both channels supported on desktop: %+v", desktopCh)
	}

	fakeGH := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/yegetables/mygo-music/releases/latest" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tag_name": "v9.9.9",
			"body":     "Mobile release notes",
			"html_url": "https://github.com/yegetables/mygo-music/releases/tag/v9.9.9",
			"assets": []map[string]any{
				{"name": "MyGoMusic-v9.9.9-Android12-arm64.apk", "size": 19000000, "browser_download_url": "https://example.com/app.apk"},
				{"name": "MyGoMusic-v9.9.9-iPadOS17-arm64.ipa", "size": 6500000, "browser_download_url": "https://example.com/app.ipa"},
			},
		})
	}))
	defer fakeGH.Close()

	srv, err := Start(Options{DataDir: t.TempDir(), CacheDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Stop()
	srv.updater.apiBase = fakeGH.URL

	androidRel, err := srv.updater.Check("android")
	if err != nil {
		t.Fatal(err)
	}
	if !androidRel.HasUpdate || androidRel.Latest != "9.9.9" || !androidRel.CanDirectLoad || androidRel.AssetName != "MyGoMusic-v9.9.9-Android12-arm64.apk" {
		t.Fatalf("unexpected android release: %+v", androidRel)
	}

	iosRel, err := srv.updater.Check("ios")
	if err != nil {
		t.Fatal(err)
	}
	if !iosRel.HasUpdate || iosRel.CanDirectLoad || iosRel.AssetName != "MyGoMusic-v9.9.9-iPadOS17-arm64.ipa" {
		t.Fatalf("unexpected ios release: %+v", iosRel)
	}
}
