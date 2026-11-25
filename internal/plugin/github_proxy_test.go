package plugin

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// Verifies proxy-wrapped GitHub URLs are parsed into canonical owner/repo plus proxy prefix.
func TestParseRepoWithProxyAndSplitProxyURL(t *testing.T) {
	cases := []struct {
		in        string
		wantRepo  string
		wantProxy string
		wantErr   bool
	}{
		{
			in:        "https://gh-proxy.com/github.com/aaaa/bbb",
			wantRepo:  "aaaa/bbb",
			wantProxy: "https://gh-proxy.com",
		},
		{
			in:        "https://gh-proxy.org/https://github.com/aaaaaa/bbbbb",
			wantRepo:  "aaaaaa/bbbbb",
			wantProxy: "https://gh-proxy.org",
		},
		{
			in:        "https://gh-proxy.com/https:/github.com/aaaa/bbb/tree/main",
			wantRepo:  "aaaa/bbb",
			wantProxy: "https://gh-proxy.com",
		},
		{
			in:        "https://my-proxy.example.com/prefix/https://github.com/owner/repo.git",
			wantRepo:  "owner/repo",
			wantProxy: "https://my-proxy.example.com/prefix",
		},
		{
			in:        "gh-proxy.com/github.com/owner/repo",
			wantRepo:  "owner/repo",
			wantProxy: "https://gh-proxy.com",
		},
		{
			in:        "https://github.com/owner/repo",
			wantRepo:  "owner/repo",
			wantProxy: "",
		},
		{
			in:        "owner/repo",
			wantRepo:  "owner/repo",
			wantProxy: "",
		},
		{
			in:      "https://gh-proxy.com/not-a-github-host/a/b",
			wantErr: true,
		},
	}

	for _, tc := range cases {
		repo, proxyBase, err := ParseRepoWithProxy(tc.in)
		if tc.wantErr {
			if err == nil {
				t.Errorf("ParseRepoWithProxy(%q): expected error, got repo=%q proxy=%q", tc.in, repo, proxyBase)
			}
			continue
		}
		if err != nil {
			t.Errorf("ParseRepoWithProxy(%q): unexpected error: %v", tc.in, err)
			continue
		}
		if repo != tc.wantRepo || proxyBase != tc.wantProxy {
			t.Errorf("ParseRepoWithProxy(%q) = (%q, %q), want (%q, %q)", tc.in, repo, proxyBase, tc.wantRepo, tc.wantProxy)
		}
		if got, err := ParseRepo(tc.in); err != nil || got != tc.wantRepo {
			t.Errorf("ParseRepo(%q) = (%q, %v), want (%q, nil)", tc.in, got, err, tc.wantRepo)
		}
	}

	// Non-GitHub LAN URLs are never rewritten or misclassified as proxies.
	if _, _, ok := SplitProxyURL("http://192.168.1.5:8080/plugin.zip"); ok {
		t.Fatal("LAN URL should not match SplitProxyURL")
	}
	if got := WrapGitHubURL(GitHubProxyCom, "http://192.168.1.5:8080/plugin.zip"); got != "http://192.168.1.5:8080/plugin.zip" {
		t.Fatalf("WrapGitHubURL modified non-GitHub URL: %q", got)
	}
	if got := WrapGitHubURL(GitHubProxyOrg, "https://github.com/a/b/releases/download/v1/p.zip"); got != "https://gh-proxy.org/https://github.com/a/b/releases/download/v1/p.zip" {
		t.Fatalf("WrapGitHubURL produced unexpected URL: %q", got)
	}
}

// Verifies NormalizeGitHubProxy normalizes valid URLs and rejects malformed proxy addresses.
func TestNormalizeGitHubProxy(t *testing.T) {
	if got, err := NormalizeGitHubProxy("  gh-proxy.com/  "); err != nil || got != "https://gh-proxy.com" {
		t.Fatalf("got (%q, %v), want (https://gh-proxy.com, nil)", got, err)
	}
	if got, err := NormalizeGitHubProxy("https://proxy.example.com/gh///"); err != nil || got != "https://proxy.example.com/gh" {
		t.Fatalf("got (%q, %v), want (https://proxy.example.com/gh, nil)", got, err)
	}
	if got, err := NormalizeGitHubProxy(""); err != nil || got != "" {
		t.Fatalf("empty input: got (%q, %v)", got, err)
	}
	for _, bad := range []string{"ftp://gh-proxy.com", "https://gh-proxy.com?a=1", "https://bad host"} {
		if _, err := NormalizeGitHubProxy(bad); err == nil {
			t.Errorf("NormalizeGitHubProxy(%q): expected error", bad)
		}
	}
}

// Verifies FetchWithProxies tries the proxy first without leaking tokens and falls back to direct GitHub on failure.
func TestFetchWithProxiesPriorityAndFallback(t *testing.T) {
	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	writeEntry := func(name, content string) {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(content))
	}
	writeEntry("demo/plugin.json", `{"id":"demo","name":"Demo","version":"1.0.0","entry":"index.js"}`)
	writeEntry("demo/index.js", `export default { info: { id: "demo", name: "Demo" } };`)
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	archiveBytes := zipBuf.Bytes()

	var directHits atomic.Int32
	var proxyHits atomic.Int32
	var proxyFail atomic.Bool
	var leakedAuth atomic.Bool

	directSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		directHits.Add(1)
		switch r.URL.Path {
		case "/repos/acme/demo/releases/latest":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"tag_name":    "v1.0.0",
				"zipball_url": "http://" + r.Host + "/repos/acme/demo/zipball/v1.0.0",
			})
		case "/repos/acme/demo/zipball/v1.0.0":
			w.Header().Set("Content-Type", "application/zip")
			_, _ = w.Write(archiveBytes)
		default:
			http.NotFound(w, r)
		}
	}))
	defer directSrv.Close()

	proxySrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxyHits.Add(1)
		if r.Header.Get("Authorization") != "" {
			leakedAuth.Store(true)
		}
		if proxyFail.Load() {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		// Forward wrapped path like /http://127.0.0.1:xxx/repos/...
		trimmed := strings.TrimPrefix(r.URL.Path, "/")
		if strings.HasSuffix(trimmed, "/repos/acme/demo/releases/latest") {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"tag_name":    "v1.0.0",
				"zipball_url": directSrv.URL + "/repos/acme/demo/zipball/v1.0.0",
			})
			return
		}
		if strings.HasSuffix(trimmed, "/repos/acme/demo/zipball/v1.0.0") {
			w.Header().Set("Content-Type", "application/zip")
			_, _ = w.Write(archiveBytes)
			return
		}
		http.NotFound(w, r)
	}))
	defer proxySrv.Close()

	origAPI := githubAPI
	origToken := githubToken
	origClient := installClient
	githubAPI = directSrv.URL
	githubToken = func() string { return "secret-test-token" }
	installClient = directSrv.Client()
	defer func() {
		githubAPI = origAPI
		githubToken = origToken
		installClient = origClient
	}()

	// 1. Proxy enabled & healthy: uses proxy without touching direct server and never leaks Authorization token.
	p1, err := FetchWithProxies("acme/demo", t.TempDir(), proxySrv.URL)
	if err != nil {
		t.Fatalf("FetchWithProxies via healthy proxy failed: %v", err)
	}
	p1.Discard()
	if proxyHits.Load() < 2 || directHits.Load() != 0 {
		t.Fatalf("expected proxy-only hits, got proxy=%d direct=%d", proxyHits.Load(), directHits.Load())
	}
	if leakedAuth.Load() {
		t.Fatal("GitHub Authorization token must never be sent to a third-party proxy")
	}

	// 2. Proxy failing: falls back seamlessly to direct server.
	proxyHits.Store(0)
	directHits.Store(0)
	proxyFail.Store(true)
	p2, err := FetchWithProxies("acme/demo", t.TempDir(), proxySrv.URL)
	if err != nil {
		t.Fatalf("FetchWithProxies fallback failed: %v", err)
	}
	p2.Discard()
	if proxyHits.Load() < 2 || directHits.Load() < 2 {
		t.Fatalf("expected proxy attempts followed by direct fallback, got proxy=%d direct=%d", proxyHits.Load(), directHits.Load())
	}

	// 3. No proxy configured: never touches proxy.
	proxyHits.Store(0)
	directHits.Store(0)
	p3, err := FetchWithProxies("acme/demo", t.TempDir())
	if err != nil {
		t.Fatalf("FetchWithProxies direct failed: %v", err)
	}
	p3.Discard()
	if proxyHits.Load() != 0 || directHits.Load() < 2 {
		t.Fatalf("expected direct-only hits when proxy disabled, got proxy=%d direct=%d", proxyHits.Load(), directHits.Load())
	}
}
