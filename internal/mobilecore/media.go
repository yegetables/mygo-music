package mobilecore

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jfreymuth/oggvorbis"

	"mygo-music/internal/music"
)

type cachedStreamMeta struct {
	stream  *music.Stream
	expires time.Time
}

type mediaProxy struct {
	songsDir     string
	coversDir    string
	limitMB      func() int
	sources      *sourceManager
	httpClient   *http.Client
	mu           sync.Mutex
	metaCache    map[string]cachedStreamMeta
	downloading  map[string]bool
	paletteCache map[string]coverPalette
}

func newMediaProxy(cacheDir string, sources *sourceManager, limitMB func() int) *mediaProxy {
	songsDir := filepath.Join(cacheDir, "songs")
	coversDir := filepath.Join(cacheDir, "covers")
	_ = os.MkdirAll(songsDir, 0o755)
	_ = os.MkdirAll(coversDir, 0o755)
	return &mediaProxy{
		songsDir:  songsDir,
		coversDir: coversDir,
		limitMB:   limitMB,
		sources:   sources,
		httpClient: &http.Client{
			Timeout: 0, // streaming downloads may last minutes
		},
		metaCache:    map[string]cachedStreamMeta{},
		downloading:  map[string]bool{},
		paletteCache: map[string]coverPalette{},
	}
}

// normPreamp matches internal/player/player.go (+4 dB ReplayGain preamp).
const normPreamp = 4.0

// normGain returns the linear loudness scale factor for st matching desktop
// MyGo Music: 10^((Gain + 4)/20), capped at 1/Peak to avoid clipping.
func normGain(st *music.Stream) float64 {
	if st == nil || (st.Gain == 0 && st.Peak == 0) {
		return 1.0
	}
	g := math.Pow(10, (st.Gain+normPreamp)/20.0)
	if st.Peak > 0 {
		if ceiling := 1.0 / st.Peak; g > ceiling {
			g = ceiling
		}
	}
	if math.IsNaN(g) || math.IsInf(g, 0) || g <= 0 {
		return 1.0
	}
	return g
}

func (m *mediaProxy) resolveStream(sourceID, trackID, quality string) (*music.Stream, error) {
	key := sourceID + "|" + trackID + "|" + quality
	m.mu.Lock()
	if cached, ok := m.metaCache[key]; ok && time.Now().Before(cached.expires) {
		m.mu.Unlock()
		return cached.stream, nil
	}
	m.mu.Unlock()

	src, ok := m.sources.Get(sourceID)
	if !ok {
		return nil, errors.New("source not found")
	}
	st, err := src.Stream(trackID, quality)
	if err != nil {
		return nil, err
	}
	if st == nil || st.URL == "" {
		return nil, music.ErrUnavailable
	}

	m.mu.Lock()
	m.metaCache[key] = cachedStreamMeta{
		stream:  st,
		expires: time.Now().Add(4 * time.Minute),
	}
	m.mu.Unlock()
	return st, nil
}

func (m *mediaProxy) songCachePath(sourceID, trackID, quality, ext string) string {
	sum := sha256.Sum256([]byte(sourceID + "\x00" + trackID + "\x00" + quality))
	if ext == "" {
		ext = "bin"
	}
	ext = strings.TrimPrefix(strings.ToLower(ext), ".")
	return filepath.Join(m.songsDir, hex.EncodeToString(sum[:16])+"."+ext)
}

func (m *mediaProxy) handleStreamInfo(w http.ResponseWriter, r *http.Request, token string) {
	sourceID := r.URL.Query().Get("source")
	trackID := r.URL.Query().Get("id")
	quality := r.URL.Query().Get("quality")
	transcodeOgg := r.URL.Query().Get("transcodeOgg") == "1"

	st, err := m.resolveStream(sourceID, trackID, quality)
	if err != nil {
		writeError(w, 0, err)
		return
	}

	ext := streamExt(st)
	cached := false
	if _, isFile := music.PathOf(st.URL); isFile {
		cached = true
	} else if _, err := os.Stat(m.songCachePath(sourceID, trackID, quality, ext)); err == nil {
		cached = true
	}

	q := url.Values{}
	q.Set("source", sourceID)
	q.Set("id", trackID)
	q.Set("quality", quality)
	if transcodeOgg {
		q.Set("transcodeOgg", "1")
	}
	q.Set("token", token)

	writeJSON(w, http.StatusOK, map[string]any{
		"streamUrl": "/api/stream/audio?" + q.Encode(),
		"type":      ext,
		"quality":   st.Quality,
		"bitRate":   st.BitRate,
		"size":      st.Size,
		"cached":    cached,
		"gain":      st.Gain,
		"peak":      st.Peak,
		"normGain":  normGain(st),
	})
}

func (m *mediaProxy) handleStreamAudio(w http.ResponseWriter, r *http.Request) {
	sourceID := r.URL.Query().Get("source")
	trackID := r.URL.Query().Get("id")
	quality := r.URL.Query().Get("quality")
	transcodeOgg := r.URL.Query().Get("transcodeOgg") == "1"

	st, err := m.resolveStream(sourceID, trackID, quality)
	if err != nil {
		writeError(w, 0, err)
		return
	}

	ext := streamExt(st)

	// Case 1: Local file:// track
	if localPath, ok := music.PathOf(st.URL); ok {
		if transcodeOgg && ext == "ogg" {
			wavPath, err := m.ensureOggWav(sourceID, trackID, quality, localPath)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			m.serveFileWithType(w, r, wavPath, "audio/wav")
			return
		}
		m.serveFileWithType(w, r, localPath, mimeForAudio(ext))
		return
	}

	cachePath := m.songCachePath(sourceID, trackID, quality, ext)

	// Case 2: iOS OGG Vorbis -> download and transcode to WAV so AVPlayer supports full Range seeking.
	if transcodeOgg && ext == "ogg" {
		if _, err := os.Stat(cachePath); err != nil {
			if err := m.downloadToFile(st, cachePath); err != nil {
				writeError(w, http.StatusBadGateway, err)
				return
			}
		}
		wavPath, err := m.ensureOggWav(sourceID, trackID, quality, cachePath)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		m.serveFileWithType(w, r, wavPath, "audio/wav")
		return
	}

	// Case 3: Already cached on disk -> instant 206 Partial Content via ServeContent.
	if _, err := os.Stat(cachePath); err == nil {
		now := time.Now()
		_ = os.Chtimes(cachePath, now, now)
		m.serveFileWithType(w, r, cachePath, mimeForAudio(ext))
		return
	}

	// Case 4: Live stream proxy with Range forwarding + async background cache fill (when enabled).
	if m.limitMB() > 0 {
		m.startBackgroundCache(st, cachePath)
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, st.URL, nil)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	req.Header.Set("User-Agent", music.Agent)
	for k, v := range st.Headers {
		req.Header.Set(k, v)
	}
	if rng := r.Header.Get("Range"); rng != "" {
		req.Header.Set("Range", rng)
	}

	client := music.HeadersStay(m.httpClient, req.URL.Hostname(), st.Headers)
	resp, err := client.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		writeError(w, resp.StatusCode, fmt.Errorf("upstream audio returned %s", resp.Status))
		return
	}

	ct := resp.Header.Get("Content-Type")
	if ct == "" || ct == "application/octet-stream" {
		ct = mimeForAudio(ext)
	}
	w.Header().Set("Content-Type", ct)
	if ar := resp.Header.Get("Accept-Ranges"); ar != "" {
		w.Header().Set("Accept-Ranges", ar)
	} else {
		w.Header().Set("Accept-Ranges", "bytes")
	}
	if cr := resp.Header.Get("Content-Range"); cr != "" {
		w.Header().Set("Content-Range", cr)
	}
	if cl := resp.Header.Get("Content-Length"); cl != "" {
		w.Header().Set("Content-Length", cl)
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func (m *mediaProxy) serveFileWithType(w http.ResponseWriter, r *http.Request, path, contentType string) {
	f, err := os.Open(path)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("Accept-Ranges", "bytes")
	http.ServeContent(w, r, filepath.Base(path), info.ModTime(), f)
}

func (m *mediaProxy) startBackgroundCache(st *music.Stream, cachePath string) {
	m.mu.Lock()
	if m.downloading[cachePath] {
		m.mu.Unlock()
		return
	}
	m.downloading[cachePath] = true
	m.mu.Unlock()

	go func() {
		defer func() {
			m.mu.Lock()
			delete(m.downloading, cachePath)
			m.mu.Unlock()
		}()
		if err := m.downloadToFile(st, cachePath); err == nil {
			m.enforceCacheLimit()
		}
	}()
}

func (m *mediaProxy) downloadToFile(st *music.Stream, dest string) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodGet, st.URL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", music.Agent)
	for k, v := range st.Headers {
		req.Header.Set(k, v)
	}
	client := music.HeadersStay(m.httpClient, req.URL.Hostname(), st.Headers)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download returned %s", resp.Status)
	}
	tmp := dest + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	_, err = io.Copy(f, resp.Body)
	closeErr := f.Close()
	if err != nil {
		os.Remove(tmp)
		return err
	}
	if closeErr != nil {
		os.Remove(tmp)
		return closeErr
	}
	return os.Rename(tmp, dest)
}

func (m *mediaProxy) ensureOggWav(sourceID, trackID, quality, oggPath string) (string, error) {
	wavPath := m.songCachePath(sourceID, trackID, quality+"|wav", "wav")
	if _, err := os.Stat(wavPath); err == nil {
		now := time.Now()
		_ = os.Chtimes(wavPath, now, now)
		return wavPath, nil
	}
	in, err := os.Open(oggPath)
	if err != nil {
		return "", err
	}
	defer in.Close()
	samples, format, err := oggvorbis.ReadAll(in)
	if err != nil {
		return "", err
	}
	tmp := wavPath + ".part"
	out, err := os.Create(tmp)
	if err != nil {
		return "", err
	}
	if err := writePCM16WAV(out, samples, format.SampleRate, format.Channels); err != nil {
		out.Close()
		os.Remove(tmp)
		return "", err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return "", err
	}
	if err := os.Rename(tmp, wavPath); err != nil {
		return "", err
	}
	go m.enforceCacheLimit()
	return wavPath, nil
}

func writePCM16WAV(w io.Writer, samples []float32, sampleRate, channels int) error {
	if channels <= 0 {
		channels = 2
	}
	if sampleRate <= 0 {
		sampleRate = 44100
	}
	dataSize := uint32(len(samples) * 2)
	var hdr [44]byte
	copy(hdr[0:4], "RIFF")
	binary.LittleEndian.PutUint32(hdr[4:8], 36+dataSize)
	copy(hdr[8:12], "WAVE")
	copy(hdr[12:16], "fmt ")
	binary.LittleEndian.PutUint32(hdr[16:20], 16)
	binary.LittleEndian.PutUint16(hdr[20:22], 1) // PCM
	binary.LittleEndian.PutUint16(hdr[22:24], uint16(channels))
	binary.LittleEndian.PutUint32(hdr[24:28], uint32(sampleRate))
	binary.LittleEndian.PutUint32(hdr[28:32], uint32(sampleRate*channels*2))
	binary.LittleEndian.PutUint16(hdr[32:34], uint16(channels*2))
	binary.LittleEndian.PutUint16(hdr[34:36], 16)
	copy(hdr[36:40], "data")
	binary.LittleEndian.PutUint32(hdr[40:44], dataSize)
	if _, err := w.Write(hdr[:]); err != nil {
		return err
	}
	buf := make([]byte, 8192)
	pos := 0
	for _, s := range samples {
		clamped := math.Max(-1.0, math.Min(1.0, float64(s)))
		v := int16(clamped * 32767)
		binary.LittleEndian.PutUint16(buf[pos:pos+2], uint16(v))
		pos += 2
		if pos == len(buf) {
			if _, err := w.Write(buf); err != nil {
				return err
			}
			pos = 0
		}
	}
	if pos > 0 {
		_, err := w.Write(buf[:pos])
		return err
	}
	return nil
}

func (m *mediaProxy) handleImage(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		writeError(w, http.StatusBadRequest, errors.New("missing url"))
		return
	}
	size := queryInt(r, "size", 300)
	sized := music.SizedImage(rawURL, size)

	// Local file covers are already on disk; serve directly without duplicating into cover cache.
	if localPath, ok := music.PathOf(sized); ok {
		b, err := os.ReadFile(localPath)
		if err != nil {
			writeError(w, http.StatusNotFound, err)
			return
		}
		w.Header().Set("Content-Type", http.DetectContentType(b))
		w.Header().Set("Cache-Control", "public, max-age=86400")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(b)
		return
	}

	sum := sha256.Sum256([]byte(sized))
	cachePath := filepath.Join(m.coversDir, hex.EncodeToString(sum[:16]))
	if b, err := os.ReadFile(cachePath); err == nil {
		w.Header().Set("Content-Type", http.DetectContentType(b))
		w.Header().Set("Cache-Control", "public, max-age=86400")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(b)
		return
	}

	b, err := music.Fetch(sized)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	go func() {
		tmp := cachePath + ".part"
		if os.WriteFile(tmp, b, 0o644) == nil {
			_ = os.Rename(tmp, cachePath)
		}
		m.enforceCoversLimit(100 << 20)
	}()

	w.Header().Set("Content-Type", http.DetectContentType(b))
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(b)
}

func (m *mediaProxy) loadImageBytes(rawURL string, size int) ([]byte, error) {
	sized := music.SizedImage(rawURL, size)
	if localPath, ok := music.PathOf(sized); ok {
		return os.ReadFile(localPath)
	}
	sum := sha256.Sum256([]byte(sized))
	cachePath := filepath.Join(m.coversDir, hex.EncodeToString(sum[:16]))
	if b, err := os.ReadFile(cachePath); err == nil {
		return b, nil
	}
	b, err := music.Fetch(sized)
	if err != nil {
		return nil, err
	}
	go func() {
		tmp := cachePath + ".part"
		if os.WriteFile(tmp, b, 0o644) == nil {
			_ = os.Rename(tmp, cachePath)
		}
		m.enforceCoversLimit(100 << 20)
	}()
	return b, nil
}

func (m *mediaProxy) handleImagePalette(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		writeJSON(w, http.StatusOK, defaultCoverPalette())
		return
	}
	m.mu.Lock()
	if cached, ok := m.paletteCache[rawURL]; ok {
		m.mu.Unlock()
		writeJSON(w, http.StatusOK, cached)
		return
	}
	m.mu.Unlock()

	b, err := m.loadImageBytes(rawURL, 128)
	pal := defaultCoverPalette()
	if err == nil && len(b) > 0 {
		pal = extractPalette(b)
		m.mu.Lock()
		if len(m.paletteCache) > 256 {
			clear(m.paletteCache)
		}
		m.paletteCache[rawURL] = pal
		m.mu.Unlock()
	}
	writeJSON(w, http.StatusOK, pal)
}

func (m *mediaProxy) enforceCacheLimit() {
	mb := m.limitMB()
	if mb <= 0 {
		evictDirToLimit(m.songsDir, 0)
		return
	}
	limitBytes := int64(mb) << 20
	evictDirToLimit(m.songsDir, limitBytes)
}

func (m *mediaProxy) enforceCoversLimit(limitBytes int64) {
	evictDirToLimit(m.coversDir, limitBytes)
}

func evictDirToLimit(dir string, limitBytes int64) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	type item struct {
		path    string
		size    int64
		modTime time.Time
	}
	var items []item
	var total int64
	for _, e := range entries {
		if e.IsDir() || strings.HasSuffix(e.Name(), ".part") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		items = append(items, item{
			path:    filepath.Join(dir, e.Name()),
			size:    info.Size(),
			modTime: info.ModTime(),
		})
		total += info.Size()
	}
	if total <= limitBytes {
		return
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].modTime.Before(items[j].modTime)
	})
	for _, it := range items {
		if total <= limitBytes {
			break
		}
		if os.Remove(it.path) == nil {
			total -= it.size
		}
	}
}

func (m *mediaProxy) Stats() map[string]any {
	songs := dirSize(m.songsDir)
	covers := dirSize(m.coversDir)
	return map[string]any{
		"songsBytes":  songs,
		"coversBytes": covers,
		"totalBytes":  songs + covers,
		"limitMB":     m.limitMB(),
	}
}

func (m *mediaProxy) Clear() {
	clearDir(m.songsDir)
	clearDir(m.coversDir)
}

func dirSize(dir string) int64 {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	var total int64
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if info, err := e.Info(); err == nil {
			total += info.Size()
		}
	}
	return total
}

func clearDir(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		_ = os.RemoveAll(filepath.Join(dir, e.Name()))
	}
}

func streamExt(st *music.Stream) string {
	t := strings.ToLower(strings.TrimSpace(st.Type))
	if t != "" {
		return t
	}
	if u, err := url.Parse(st.URL); err == nil {
		ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(u.Path)), ".")
		if ext != "" {
			return ext
		}
	}
	return "mp3"
}

func mimeForAudio(ext string) string {
	switch strings.ToLower(ext) {
	case "mp3":
		return "audio/mpeg"
	case "flac":
		return "audio/flac"
	case "ogg":
		return "audio/ogg"
	case "wav":
		return "audio/wav"
	case "m4a", "mp4":
		return "audio/mp4"
	case "aac":
		return "audio/aac"
	default:
		return "application/octet-stream"
	}
}

func formatBytes(n int64) string {
	return strconv.FormatInt(n, 10)
}
