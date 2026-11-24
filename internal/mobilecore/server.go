// Package mobilecore runs the shared pure-Go music core (plugin runtime, local
// library, lyrics parser, audio stream cache/proxy, and REST/SSE API) inside
// Android and iPadOS native shells.
package mobilecore

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"

	"mygo-music/internal/plugin"
)

// Options configures a mobilecore Server instance.
type Options struct {
	DataDir     string
	CacheDir    string
	SystemLangs []string
	// ListenAddr defaults to "127.0.0.1:0" (ephemeral loopback port).
	ListenAddr string
	// WebFS serves the bundled responsive Web UI at "/". Optional for headless tests.
	WebFS fs.FS
}

type sseEvent struct {
	Name string
	Data []byte
}

// Server exposes the in-process loopback HTTP/SSE API and embedded Web UI.
type Server struct {
	Token   string
	Port    int
	Addr    string
	state   *stateStore
	sources *sourceManager
	auth    *authManager
	media   *mediaProxy
	updater *appUpdater
	webFS   fs.FS

	httpSrv  *http.Server
	listener net.Listener

	sseMu   sync.Mutex
	clients map[chan sseEvent]struct{}
}

// Start initializes state, plugins, local library, media cache, and starts the loopback HTTP server.
func Start(opts Options) (*Server, error) {
	if opts.DataDir == "" {
		return nil, errors.New("mobilecore: DataDir is required")
	}
	if opts.CacheDir == "" {
		opts.CacheDir = opts.DataDir
	}
	if opts.ListenAddr == "" {
		opts.ListenAddr = "127.0.0.1:0"
	}

	plugin.SetAppVersion(AppVersion)

	s := &Server{
		Token:   randomHex(32),
		webFS:   opts.WebFS,
		clients: map[chan sseEvent]struct{}{},
	}

	s.state = newStateStore(opts.DataDir, opts.SystemLangs)
	s.auth = newAuthManager(s.emit)
	s.sources = newSourceManager(opts.DataDir, s.emit)
	s.media = newMediaProxy(opts.CacheDir, s.sources, func() int {
		return s.state.Settings().CacheLimitMB
	})
	s.updater = newAppUpdater(s.state)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/", s.withAuth(s.handleAPI))
	mux.HandleFunc("/", s.handleStatic)

	ln, err := net.Listen("tcp", opts.ListenAddr)
	if err != nil {
		s.sources.Close()
		s.auth.Close()
		return nil, err
	}
	s.listener = ln
	s.Addr = ln.Addr().String()
	if tcp, ok := ln.Addr().(*net.TCPAddr); ok {
		s.Port = tcp.Port
	}

	s.httpSrv = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 15 * time.Second,
	}

	go func() {
		_ = s.httpSrv.Serve(ln)
	}()

	return s, nil
}

// Stop shuts down the HTTP server, plugin runtimes, and pending auth requests.
func (s *Server) Stop() {
	if s == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if s.httpSrv != nil {
		_ = s.httpSrv.Shutdown(ctx)
	}
	s.auth.Close()
	s.sources.Close()
}

// CompleteWebSignIn bridges native WebView sign-in completion back into the plugin runtime.
func (s *Server) CompleteWebSignIn(id, cookie, errMsg string) {
	if s == nil || s.auth == nil {
		return
	}
	s.auth.CompleteWebSignIn(id, cookie, errMsg)
}

func (s *Server) emit(name string, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	ev := sseEvent{Name: name, Data: data}
	s.sseMu.Lock()
	for ch := range s.clients {
		select {
		case ch <- ev:
		default:
		}
	}
	s.sseMu.Unlock()
}

func (s *Server) withAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-MyGo-Token")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		tok := r.Header.Get("X-MyGo-Token")
		if tok == "" {
			tok = r.URL.Query().Get("token")
		}
		if subtle.ConstantTimeCompare([]byte(tok), []byte(s.Token)) != 1 {
			writeError(w, http.StatusUnauthorized, errors.New("unauthorized"))
			return
		}
		next(w, r)
	}
}

func (s *Server) handleAPI(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	switch {
	case p == "/api/health":
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"version": AppVersion,
		})

	case p == "/api/events":
		s.handleSSE(w, r)

	case p == "/api/qr":
		handleQRCode(w, r)

	case p == "/api/settings":
		if r.Method == http.MethodGet {
			writeJSON(w, http.StatusOK, s.state.Settings())
			return
		}
		if r.Method == http.MethodPost {
			var patch struct {
				ActiveSource     *string  `json:"activeSource"`
				Quality          *string  `json:"quality"`
				Language         *string  `json:"language"`
				Theme            *string  `json:"theme"`
				CacheLimitMB     *int     `json:"cacheLimitMB"`
				PlayerStyle      *string  `json:"playerStyle"`
				HotComments      *bool    `json:"hotComments"`
				Normalize        *bool    `json:"normalize"`
				Smoke            *bool    `json:"smoke"`
				Fog              *bool    `json:"fog"`
				GrowFromCover    *bool    `json:"growFromCover"`
				LyricsStage      *bool    `json:"lyricsStage"`
				StageStyle       *string  `json:"stageStyle"`
				StageSparks      *bool    `json:"stageSparks"`
				DisabledPlugins  []string `json:"disabledPlugins"`
				HasDisabled      bool     `json:"-"`
				UpdateChannel    *string  `json:"updateChannel"`
				AutoCheckUpdates *bool    `json:"autoCheckUpdates"`
				Platform         *string  `json:"platform"`
			}
			var rawMap map[string]json.RawMessage
			if err := decodeBody(r, &rawMap); err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}
			rawBytes, _ := json.Marshal(rawMap)
			if err := json.Unmarshal(rawBytes, &patch); err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}
			_, patch.HasDisabled = rawMap["disabledPlugins"]

			// Reject selecting an unsupported update channel on mobile platforms.
			if patch.UpdateChannel != nil {
				plat := r.URL.Query().Get("platform")
				if patch.Platform != nil && *patch.Platform != "" {
					plat = *patch.Platform
				}
				if plat != "" {
					wanted := sanitizeUpdateChannel(*patch.UpdateChannel)
					supported := false
					for _, ch := range ChannelsForPlatform(plat) {
						if ch.ID == wanted {
							supported = ch.Supported
							break
						}
					}
					if !supported {
						writeError(w, http.StatusBadRequest, errors.New("selected update channel is not supported on this platform"))
						return
					}
				}
			}

			cacheChanged := false
			updated, err := s.state.UpdateSettings(func(st *Settings) {
				if patch.ActiveSource != nil {
					st.ActiveSource = *patch.ActiveSource
				}
				if patch.Quality != nil {
					st.Quality = *patch.Quality
				}
				if patch.Language != nil {
					st.Language = *patch.Language
				}
				if patch.Theme != nil {
					st.Theme = *patch.Theme
				}
				if patch.CacheLimitMB != nil {
					if *patch.CacheLimitMB != st.CacheLimitMB {
						cacheChanged = true
					}
					st.CacheLimitMB = *patch.CacheLimitMB
				}
				if patch.PlayerStyle != nil {
					st.PlayerStyle = *patch.PlayerStyle
				}
				if patch.HotComments != nil {
					st.HotComments = *patch.HotComments
				}
				if patch.Normalize != nil {
					st.Normalize = *patch.Normalize
				}
				if patch.Smoke != nil {
					st.Smoke = *patch.Smoke
				}
				if patch.Fog != nil {
					st.Fog = *patch.Fog
				}
				if patch.GrowFromCover != nil {
					st.GrowFromCover = *patch.GrowFromCover
				}
				if patch.LyricsStage != nil {
					st.LyricsStage = *patch.LyricsStage
				}
				if patch.StageStyle != nil {
					st.StageStyle = *patch.StageStyle
				}
				if patch.StageSparks != nil {
					st.StageSparks = *patch.StageSparks
				}
				if patch.HasDisabled {
					st.DisabledPlugins = patch.DisabledPlugins
				}
				if patch.UpdateChannel != nil {
					st.UpdateChannel = *patch.UpdateChannel
				}
				if patch.AutoCheckUpdates != nil {
					st.AutoCheckUpdates = *patch.AutoCheckUpdates
				}
			})
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			if cacheChanged {
				go s.media.enforceCacheLimit()
			}
			writeJSON(w, http.StatusOK, updated)
			return
		}
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET or POST required"))

	case p == "/api/session":
		if r.Method == http.MethodGet {
			writeJSON(w, http.StatusOK, s.state.Session())
			return
		}
		if r.Method == http.MethodPost {
			var sess Session
			if err := decodeBody(r, &sess); err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}
			if err := s.state.SaveSession(sess); err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"ok": true})
			return
		}
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET or POST required"))

	case p == "/api/sources":
		st := s.state.Settings()
		writeJSON(w, http.StatusOK, map[string]any{
			"activeSource": st.ActiveSource,
			"sources":      s.sources.List(st.ActiveSource, st.DisabledPlugins),
		})

	case strings.HasPrefix(p, "/api/sources/"):
		s.handleSourceRoute(w, r)

	case p == "/api/plugins/prepare/github":
		var body struct {
			Repo string `json:"repo"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		summary, err := s.sources.PrepareGitHub(body.Repo)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, summary)

	case p == "/api/plugins/prepare/url":
		var body struct {
			URL string `json:"url"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		summary, err := s.sources.PrepareURL(body.URL)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, summary)

	case p == "/api/plugins/prepare/local":
		var body struct {
			Path string `json:"path"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		summary, err := s.sources.PrepareLocalPath(body.Path)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, summary)

	case p == "/api/plugins/prepare/upload":
		var reader = r.Body
		if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
			if err := r.ParseMultipartForm(64 << 20); err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}
			f, _, err := r.FormFile("file")
			if err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}
			defer f.Close()
			reader = f
		}
		summary, err := s.sources.PrepareZipReader(reader)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, summary)

	case p == "/api/plugins/confirm":
		var body struct {
			PendingID string `json:"pendingId"`
			Activate  bool   `json:"activate"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		summary, err := s.sources.ConfirmInstall(body.PendingID)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if body.Activate || s.state.Settings().ActiveSource == "local" {
			_, _ = s.state.UpdateSettings(func(st *Settings) {
				st.ActiveSource = summary.Info.ID
			})
			summary.Active = true
		}
		writeJSON(w, http.StatusOK, summary)

	case p == "/api/plugins/discard":
		var body struct {
			PendingID string `json:"pendingId"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		s.sources.DiscardPending(body.PendingID)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})

	case p == "/api/plugins/remove":
		var body struct {
			ID string `json:"id"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := s.sources.RemovePlugin(body.ID); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if s.state.Settings().ActiveSource == body.ID {
			_, _ = s.state.UpdateSettings(func(st *Settings) {
				st.ActiveSource = "local"
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})

	case p == "/api/plugins/reload":
		var body struct {
			ID string `json:"id"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		summary, err := s.sources.ReloadPlugin(body.ID)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, summary)

	case p == "/api/plugins/check-update":
		var body struct {
			ID string `json:"id"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		info, err := s.sources.CheckUpdate(body.ID)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, info)

	case p == "/api/auth/web-signin/complete":
		var body struct {
			ID     string `json:"id"`
			Cookie string `json:"cookie"`
			Error  string `json:"error"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		s.CompleteWebSignIn(body.ID, body.Cookie, body.Error)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})

	case p == "/api/local/folders":
		writeJSON(w, http.StatusOK, map[string]any{
			"folders": s.sources.localSrc.Folders(),
		})

	case p == "/api/local/folders/add":
		var body struct {
			Paths []string `json:"paths"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		s.sources.localSrc.AddFolders(body.Paths...)
		writeJSON(w, http.StatusOK, map[string]any{"folders": s.sources.localSrc.Folders()})

	case p == "/api/local/folders/remove":
		var body struct {
			Path string `json:"path"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		s.sources.localSrc.RemoveFolder(body.Path)
		writeJSON(w, http.StatusOK, map[string]any{"folders": s.sources.localSrc.Folders()})

	case p == "/api/local/rescan":
		go s.sources.localSrc.Rescan()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})

	case p == "/api/local/import":
		if err := r.ParseMultipartForm(64 << 20); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		files := r.MultipartForm.File["file"]
		if len(files) == 0 {
			writeError(w, http.StatusBadRequest, errors.New("no audio files uploaded"))
			return
		}
		var imported []string
		for _, fh := range files {
			f, err := fh.Open()
			if err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}
			dest, err := s.sources.ImportAudioFile(fh.Filename, f)
			f.Close()
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			imported = append(imported, dest)
		}
		writeJSON(w, http.StatusOK, map[string]any{"imported": imported})

	case p == "/api/stream/info":
		s.media.handleStreamInfo(w, r, s.Token)

	case p == "/api/stream/audio":
		s.media.handleStreamAudio(w, r)

	case p == "/api/image":
		s.media.handleImage(w, r)

	case p == "/api/image/palette":
		s.media.handleImagePalette(w, r)

	case p == "/api/update/status":
		writeJSON(w, http.StatusOK, s.updater.Status(r.URL.Query().Get("platform")))

	case p == "/api/update/check":
		plat := r.URL.Query().Get("platform")
		if r.Method == http.MethodPost {
			var body struct {
				Platform string `json:"platform"`
			}
			_ = decodeBody(r, &body)
			if body.Platform != "" {
				plat = body.Platform
			}
		}
		res, err := s.updater.Check(plat)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, res)

	case p == "/api/update/skip":
		var body struct {
			Version string `json:"version"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		updated, err := s.state.UpdateSettings(func(st *Settings) {
			st.SkippedVersion = strings.TrimPrefix(strings.TrimSpace(body.Version), "v")
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, updated)

	case p == "/api/cache/stats":
		writeJSON(w, http.StatusOK, s.media.Stats())

	case p == "/api/cache/clear":
		s.media.Clear()
		writeJSON(w, http.StatusOK, s.media.Stats())

	default:
		writeError(w, http.StatusNotFound, errors.New("not found"))
	}
}

func (s *Server) handleSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, errors.New("streaming unsupported"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	ch := make(chan sseEvent, 32)
	s.sseMu.Lock()
	s.clients[ch] = struct{}{}
	s.sseMu.Unlock()
	defer func() {
		s.sseMu.Lock()
		delete(s.clients, ch)
		s.sseMu.Unlock()
	}()

	_, _ = fmt.Fprintf(w, "event: ready\ndata: {\"version\":%q}\n\n", AppVersion)
	flusher.Flush()

	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			_, _ = fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		case ev := <-ch:
			_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Name, ev.Data)
			flusher.Flush()
		}
	}
}

func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	if s.webFS == nil {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = fmt.Fprint(w, "<!doctype html><title>MyGo Music Core</title><p>MyGo Music Mobile Core is running.</p>")
		return
	}
	clean := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if clean == "" {
		clean = "index.html"
	}
	if _, err := fs.Stat(s.webFS, clean); err != nil {
		// SPA fallback to index.html
		clean = "index.html"
	}
	if clean == "index.html" {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeFileFS(w, r, s.webFS, clean)
}
