package mobilecore

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"mygo-music/internal/lyrics"
	"mygo-music/internal/music"
)

func classifyError(err error) (code, reason string) {
	reason = music.Reason(err)
	switch {
	case errors.Is(err, music.ErrSignIn):
		return "signIn", reason
	case errors.Is(err, music.ErrSetup):
		return "setup", reason
	case errors.Is(err, music.ErrUnavailable):
		return "unavailable", reason
	case errors.Is(err, music.ErrUnsupported):
		return "unsupported", reason
	default:
		return "error", reason
	}
}

func writeError(w http.ResponseWriter, status int, err error) {
	code, reason := classifyError(err)
	if status == 0 {
		switch code {
		case "signIn":
			status = http.StatusUnauthorized
		case "setup":
			status = http.StatusPreconditionRequired
		case "unavailable":
			status = http.StatusNotFound
		case "unsupported":
			status = http.StatusNotImplemented
		default:
			status = http.StatusBadGateway
		}
	}
	writeJSON(w, status, map[string]any{
		"error":  err.Error(),
		"code":   code,
		"reason": reason,
	})
}

func decodeBody(r *http.Request, dst any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(dst)
}

func queryInt(r *http.Request, key string, fallback int) int {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return n
}

type parsedLyricWord struct {
	Text    string `json:"text"`
	StartMs int64  `json:"startMs"`
	EndMs   int64  `json:"endMs"`
}

type parsedLyricLine struct {
	AtMs        int64             `json:"atMs"`
	EndMs       int64             `json:"endMs"`
	Text        string            `json:"text"`
	Translation string            `json:"translation,omitempty"`
	IsCredit    bool              `json:"isCredit,omitempty"`
	Words       []parsedLyricWord `json:"words,omitempty"`
}

type parsedQuietSpan struct {
	FromMs int64 `json:"fromMs"`
	ToMs   int64 `json:"toMs"`
}

type parsedLyricsResponse struct {
	Lang   string            `json:"lang,omitempty"`
	Lines  []parsedLyricLine `json:"lines"`
	Quiets []parsedQuietSpan `json:"quiets,omitempty"`
}

func (s *Server) handleSourceRoute(w http.ResponseWriter, r *http.Request) {
	// Path format: /api/sources/{sourceId}/{action...}
	trimmed := strings.TrimPrefix(r.URL.Path, "/api/sources/")
	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) < 2 || parts[0] == "" {
		writeError(w, http.StatusNotFound, errors.New("missing source action"))
		return
	}
	sourceID := parts[0]
	action := parts[1]

	src, ok := s.sources.Get(sourceID)
	if !ok {
		writeError(w, http.StatusNotFound, errors.New("source not found: "+sourceID))
		return
	}

	switch action {
	case "account":
		acc, err := src.Account()
		if err != nil {
			if errors.Is(err, music.ErrSignIn) || errors.Is(err, music.ErrUnsupported) {
				writeJSON(w, http.StatusOK, map[string]any{"account": nil})
				return
			}
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"account": acc})

	case "signin":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, errors.New("POST required"))
			return
		}
		if err := s.auth.StartSignIn(sourceID, src); err != nil {
			writeError(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]any{"started": true})

	case "signout":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, errors.New("POST required"))
			return
		}
		if err := src.SignOut(); err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})

	case "setting":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, errors.New("POST required"))
			return
		}
		var body struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := src.SetSetting(body.Key, body.Value); err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})

	case "home":
		b, err := src.Home()
		if err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, b)

	case "browse":
		b, err := src.Browse(r.URL.Query().Get("page"))
		if err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, b)

	case "search":
		q := r.URL.Query().Get("q")
		kind := music.SearchKind(r.URL.Query().Get("kind"))
		if kind == "" {
			kind = music.SearchTracks
		}
		offset := queryInt(r, "offset", 0)
		res, err := src.Search(q, kind, offset)
		if err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, res)

	case "suggest":
		q := r.URL.Query().Get("q")
		out, err := src.Suggest(q)
		if err != nil {
			if errors.Is(err, music.ErrUnsupported) {
				writeJSON(w, http.StatusOK, map[string]any{"suggestions": []string{}})
				return
			}
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"suggestions": out})

	case "playlists":
		ps, err := src.Playlists()
		if err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"playlists": ps})

	case "playlist":
		pl, err := src.Playlist(r.URL.Query().Get("id"))
		if err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, pl)

	case "album":
		al, err := src.Album(r.URL.Query().Get("id"))
		if err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, al)

	case "artist":
		ar, err := src.Artist(r.URL.Query().Get("id"))
		if err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, ar)

	case "liked":
		page, err := src.Liked(queryInt(r, "offset", 0))
		if err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, page)

	case "recent":
		tracks, err := src.Recent()
		if err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"tracks": tracks})

	case "saved-albums":
		list, err := src.SavedAlbums(queryInt(r, "offset", 0))
		if err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, list)

	case "shows":
		shows, err := src.Shows()
		if err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"shows": shows})

	case "show":
		sp, err := src.Show(r.URL.Query().Get("id"), queryInt(r, "offset", 0))
		if err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, sp)

	case "stations":
		stations, err := src.Stations()
		if err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"stations": stations})

	case "station-next":
		var body struct {
			ID string `json:"id"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		tracks, err := src.StationNext(body.ID)
		if err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"tracks": tracks})

	case "comments":
		cp, err := src.Comments(r.URL.Query().Get("trackId"), queryInt(r, "offset", 0))
		if err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, cp)

	case "comments/post":
		var body struct {
			TrackID string `json:"trackId"`
			Text    string `json:"text"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		cm, err := src.PostComment(body.TrackID, body.Text)
		if err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, cm)

	case "comments/like":
		var body struct {
			TrackID   string `json:"trackId"`
			CommentID string `json:"commentId"`
			On        bool   `json:"on"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := src.LikeComment(body.TrackID, body.CommentID, body.On); err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})

	case "lyrics":
		raw, err := src.Lyrics(r.URL.Query().Get("id"))
		if err != nil {
			if errors.Is(err, music.ErrUnsupported) || errors.Is(err, music.ErrUnavailable) {
				writeJSON(w, http.StatusOK, parsedLyricsResponse{Lines: []parsedLyricLine{}})
				return
			}
			writeError(w, 0, err)
			return
		}
		lines := lyrics.FromSource(raw)
		durMs := int64(queryInt(r, "durationMs", 0))
		if durMs <= 0 && len(lines) > 0 {
			for _, l := range lines {
				if e := l.End.Milliseconds(); e > durMs {
					durMs = e
				}
				if a := l.At.Milliseconds(); a > durMs {
					durMs = a
				}
			}
		}
		resp := parsedLyricsResponse{
			Lang:  lyrics.Lang(lines),
			Lines: make([]parsedLyricLine, 0, len(lines)),
		}
		for _, l := range lines {
			pl := parsedLyricLine{
				AtMs:        l.At.Milliseconds(),
				EndMs:       l.End.Milliseconds(),
				Text:        l.Text,
				Translation: l.Translation,
				IsCredit:    lyrics.IsCredit(l.Text),
			}
			for _, wd := range l.Words {
				pl.Words = append(pl.Words, parsedLyricWord{
					Text:    wd.Text,
					StartMs: wd.Start.Milliseconds(),
					EndMs:   wd.End.Milliseconds(),
				})
			}
			resp.Lines = append(resp.Lines, pl)
		}
		if durMs > 0 {
			for _, q := range lyrics.Quiets(lines, time.Duration(durMs)*time.Millisecond, 8*time.Second) {
				resp.Quiets = append(resp.Quiets, parsedQuietSpan{
					FromMs: q.From.Milliseconds(),
					ToMs:   q.To.Milliseconds(),
				})
			}
		}
		writeJSON(w, http.StatusOK, resp)

	case "is-liked":
		var body struct {
			IDs []string `json:"ids"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		res, err := src.IsLiked(body.IDs)
		if err != nil {
			if errors.Is(err, music.ErrUnsupported) {
				writeJSON(w, http.StatusOK, map[string]any{"liked": map[string]bool{}})
				return
			}
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"liked": res})

	case "like":
		var body struct {
			ID        string `json:"id"`
			On        bool   `json:"on"`
			IsEpisode bool   `json:"isEpisode"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		var err error
		if body.IsEpisode {
			err = src.LikeEpisode(body.ID, body.On)
		} else {
			err = src.Like(body.ID, body.On)
		}
		if err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})

	case "played":
		var body struct {
			Track music.Track `json:"track"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if rec, ok := src.(music.Recorder); ok {
			go rec.Played(body.Track)
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})

	case "playlist/create":
		var body struct {
			Name string `json:"name"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		pl, err := src.CreatePlaylist(body.Name)
		if err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, pl)

	case "playlist/rename":
		var body struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := src.RenamePlaylist(body.ID, body.Name); err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})

	case "playlist/delete":
		var body struct {
			ID string `json:"id"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := src.DeletePlaylist(body.ID); err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})

	case "playlist/add":
		var body struct {
			ID       string   `json:"id"`
			TrackIDs []string `json:"trackIds"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := src.AddToPlaylist(body.ID, body.TrackIDs); err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})

	case "playlist/remove":
		var body struct {
			ID       string   `json:"id"`
			TrackIDs []string `json:"trackIds"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := src.RemoveFromPlaylist(body.ID, body.TrackIDs); err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})

	case "playlist/save":
		var body struct {
			ID string `json:"id"`
			On bool   `json:"on"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := src.SavePlaylist(body.ID, body.On); err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})

	case "artist/follow":
		var body struct {
			ID string `json:"id"`
			On bool   `json:"on"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := src.FollowArtist(body.ID, body.On); err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})

	case "album/save":
		var body struct {
			ID string `json:"id"`
			On bool   `json:"on"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := src.SaveAlbum(body.ID, body.On); err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})

	case "show/subscribe":
		var body struct {
			ID string `json:"id"`
			On bool   `json:"on"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := src.SubscribeShow(body.ID, body.On); err != nil {
			writeError(w, 0, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})

	default:
		writeError(w, http.StatusNotFound, errors.New("unknown source action: "+action))
	}
}
