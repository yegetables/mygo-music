package plugin

import (
	"fmt"
	"net/url"
	"strings"
)

const (
	// Built-in GitHub proxy endpoints.
	GitHubProxyCom = "https://gh-proxy.com"
	GitHubProxyOrg = "https://gh-proxy.org"
)

// NormalizeGitHubProxy validates and normalizes a GitHub proxy base URL.
// An empty input returns ("", nil). Inputs without an explicit scheme default
// to https:// so users can enter either "gh-proxy.com" or "https://gh-proxy.com/".
func NormalizeGitHubProxy(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", nil
	}
	if strings.ContainsAny(s, " \t\r\n") {
		return "", fmt.Errorf("invalid GitHub proxy URL: %s", raw)
	}
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", fmt.Errorf("invalid GitHub proxy URL: %s", raw)
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("GitHub proxy URL must not contain query or fragment: %s", raw)
	}
	u.Path = strings.TrimRight(u.Path, "/")
	return strings.TrimRight(u.String(), "/"), nil
}

// IsGitHubHost reports whether host belongs to GitHub's own web, API, or asset
// download domains.
func IsGitHubHost(host string) bool {
	h := strings.ToLower(strings.TrimSpace(host))
	if i := strings.IndexByte(h, ':'); i >= 0 {
		h = h[:i]
	}
	switch h {
	case "github.com", "www.github.com", "api.github.com", "uploads.github.com", "codeload.github.com":
		return true
	}
	return h == "githubusercontent.com" || strings.HasSuffix(h, ".githubusercontent.com")
}

// IsGitHubURL reports whether rawURL is an http(s) URL pointing to a GitHub host.
func IsGitHubURL(rawURL string) bool {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return false
	}
	return IsGitHubHost(u.Hostname())
}

// WrapGitHubURL prepends proxyBase to targetURL when proxyBase is non-empty and
// targetURL targets a GitHub host. If targetURL is already wrapped by proxyBase,
// it is returned unchanged.
func WrapGitHubURL(proxyBase, targetURL string) string {
	base, err := NormalizeGitHubProxy(proxyBase)
	if err != nil || base == "" {
		return targetURL
	}
	target := strings.TrimSpace(targetURL)
	if target == "" {
		return targetURL
	}
	if strings.HasPrefix(strings.ToLower(target), strings.ToLower(base)+"/") {
		return target
	}
	if !IsGitHubURL(target) {
		return targetURL
	}
	return base + "/" + target
}

// SplitProxyURL detects whether raw is a proxy-wrapped GitHub URL such as:
//   - https://gh-proxy.com/github.com/owner/repo
//   - https://gh-proxy.org/https://github.com/owner/repo
//   - https://my.proxy.example/prefix/https://github.com/owner/repo/releases/download/v1/a.zip
//
// When matched, it returns the normalized proxyBase and the unwrapped GitHub
// targetURL. Direct GitHub URLs and non-GitHub URLs return ok=false.
func SplitProxyURL(raw string) (proxyBase, targetURL string, ok bool) {
	s := strings.TrimSpace(raw)
	if s == "" || strings.HasPrefix(strings.ToLower(s), "git@") {
		return "", "", false
	}
	candidate := s
	if !strings.Contains(candidate, "://") {
		// Support scheme-less inputs like "gh-proxy.com/github.com/owner/repo".
		first, rest, hasSlash := strings.Cut(candidate, "/")
		if !hasSlash || !strings.Contains(first, ".") || IsGitHubHost(first) || rest == "" {
			return "", "", false
		}
		candidate = "https://" + candidate
	}

	schemeEnd := strings.Index(candidate, "://")
	if schemeEnd <= 0 {
		return "", "", false
	}
	scheme := strings.ToLower(candidate[:schemeEnd])
	if scheme != "http" && scheme != "https" {
		return "", "", false
	}
	afterScheme := candidate[schemeEnd+3:]
	slashIdx := strings.IndexByte(afterScheme, '/')
	if slashIdx <= 0 {
		return "", "", false
	}
	host := afterScheme[:slashIdx]
	if host == "" || IsGitHubHost(host) {
		return "", "", false
	}
	rest := afterScheme[slashIdx+1:] // path+query+frag without leading '/'
	if rest == "" {
		return "", "", false
	}

	// Scan each slash boundary in rest for either an embedded http(s)://github...
	// or a scheme-less github.com/... host segment.
	pos := 0
	for {
		sub := rest[pos:]
		if inner, matched := extractEmbeddedGitHubURL(sub); matched {
			prefix := strings.TrimRight(rest[:pos], "/")
			base := scheme + "://" + host
			if prefix != "" {
				base += "/" + prefix
			}
			normBase, err := NormalizeGitHubProxy(base)
			if err != nil || normBase == "" {
				return "", "", false
			}
			return normBase, inner, true
		}
		nextSlash := strings.IndexByte(sub, '/')
		if nextSlash < 0 {
			break
		}
		pos += nextSlash + 1
		if pos >= len(rest) {
			break
		}
	}
	return "", "", false
}

func extractEmbeddedGitHubURL(sub string) (string, bool) {
	if sub == "" {
		return "", false
	}
	lower := strings.ToLower(sub)
	var candidate string
	switch {
	case strings.HasPrefix(lower, "https://"):
		candidate = "https://" + sub[len("https://"):]
	case strings.HasPrefix(lower, "http://"):
		candidate = "http://" + sub[len("http://"):]
	case strings.HasPrefix(lower, "https:/"):
		candidate = "https://" + strings.TrimLeft(sub[len("https:/"):], "/")
	case strings.HasPrefix(lower, "http:/"):
		candidate = "http://" + strings.TrimLeft(sub[len("http:/"):], "/")
	default:
		first, _, hasSlash := strings.Cut(sub, "/")
		if !hasSlash || !IsGitHubHost(first) {
			return "", false
		}
		candidate = "https://" + sub
	}

	u, err := url.Parse(candidate)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || !IsGitHubHost(u.Hostname()) {
		return "", false
	}
	return candidate, true
}

// ProxyCandidates returns the ordered list of URLs to attempt for targetURL.
// Each valid non-empty proxy is tried first (wrapping targetURL when it targets
// a GitHub host), followed by targetURL itself as the final direct fallback.
// When no proxies are supplied, only [targetURL] is returned.
func ProxyCandidates(targetURL string, proxies ...string) []string {
	target := strings.TrimSpace(targetURL)
	if target == "" {
		return nil
	}
	seen := make(map[string]struct{}, len(proxies)+1)
	out := make([]string, 0, len(proxies)+1)
	add := func(u string) {
		if u == "" {
			return
		}
		if _, ok := seen[u]; ok {
			return
		}
		seen[u] = struct{}{}
		out = append(out, u)
	}
	for _, p := range proxies {
		if wrapped := WrapGitHubURL(p, target); wrapped != target {
			add(wrapped)
		}
	}
	add(target)
	return out
}

// ParseRepoWithProxy parses a GitHub repository reference, including proxy-wrapped
// URLs such as "https://gh-proxy.com/github.com/owner/repo" or
// "https://gh-proxy.org/https://github.com/owner/repo".
// It returns the canonical "owner/repo" and, if the input carried a proxy prefix,
// the normalized proxy base URL.
func ParseRepoWithProxy(in string) (repo string, proxyBase string, err error) {
	if pBase, target, ok := SplitProxyURL(in); ok {
		r, err := parseDirectRepo(target)
		if err != nil {
			return "", "", fmt.Errorf("not a GitHub repository: %s", strings.TrimSpace(in))
		}
		return r, pBase, nil
	}
	r, err := parseDirectRepo(in)
	if err != nil {
		return "", "", err
	}
	return r, "", nil
}
