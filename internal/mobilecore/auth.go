package mobilecore

import (
	"errors"
	"net/http"
	"sync"
	"time"

	"rsc.io/qr"

	"mygo-music/internal/music"
	"mygo-music/internal/plugin"
)

type webSignInResult struct {
	cookie string
	err    error
}

type authManager struct {
	mu      sync.Mutex
	pending map[string]chan webSignInResult
	signing map[string]bool
	emit    func(event string, payload any)
}

func newAuthManager(emit func(string, any)) *authManager {
	am := &authManager{
		pending: map[string]chan webSignInResult{},
		signing: map[string]bool{},
		emit:    emit,
	}
	plugin.SetWebSignIn(am.handleWebSignIn)
	plugin.SetOpenURL(func(rawURL string) error {
		if emit != nil {
			emit("openURL", map[string]any{"url": rawURL})
		}
		return nil
	})
	return am
}

func (am *authManager) handleWebSignIn(req plugin.WebSignIn) (string, error) {
	id := randomHex(12)
	ch := make(chan webSignInResult, 1)

	am.mu.Lock()
	am.pending[id] = ch
	am.mu.Unlock()

	defer func() {
		am.mu.Lock()
		delete(am.pending, id)
		am.mu.Unlock()
	}()

	if am.emit != nil {
		am.emit("webSignIn", map[string]any{
			"id":        id,
			"plugin":    req.Plugin,
			"name":      req.Name,
			"url":       req.URL,
			"cookiesOf": req.CookiesOf,
			"until":     req.Until,
			"userAgent": req.UserAgent,
		})
	}

	timer := time.NewTimer(5 * time.Minute)
	defer timer.Stop()

	select {
	case res := <-ch:
		return res.cookie, res.err
	case <-timer.C:
		return "", errors.New("web sign-in timed out")
	}
}

// CompleteWebSignIn delivers the captured cookie (or error) from the native WebView back to the plugin.
func (am *authManager) CompleteWebSignIn(id, cookie, errMsg string) {
	am.mu.Lock()
	ch, ok := am.pending[id]
	am.mu.Unlock()
	if !ok {
		return
	}
	var res webSignInResult
	if errMsg != "" {
		res.err = errors.New(errMsg)
	} else {
		res.cookie = cookie
	}
	select {
	case ch <- res:
	default:
	}
}

func (am *authManager) StartSignIn(sourceID string, src music.Source) error {
	am.mu.Lock()
	if am.signing[sourceID] {
		am.mu.Unlock()
		return errors.New("sign-in is already in progress")
	}
	am.signing[sourceID] = true
	am.mu.Unlock()

	go func() {
		defer func() {
			am.mu.Lock()
			delete(am.signing, sourceID)
			am.mu.Unlock()
		}()
		acc, err := src.SignIn()
		if err != nil {
			code, reason := classifyError(err)
			if am.emit != nil {
				am.emit("signInResult", map[string]any{
					"source": sourceID,
					"error":  err.Error(),
					"code":   code,
					"reason": reason,
				})
			}
			return
		}
		if am.emit != nil {
			am.emit("signInResult", map[string]any{
				"source":  sourceID,
				"account": acc,
			})
		}
	}()
	return nil
}

func (am *authManager) Close() {
	am.mu.Lock()
	defer am.mu.Unlock()
	for id, ch := range am.pending {
		select {
		case ch <- webSignInResult{err: errors.New("app closed")}:
		default:
		}
		delete(am.pending, id)
	}
}

func handleQRCode(w http.ResponseWriter, r *http.Request) {
	text := r.URL.Query().Get("text")
	if text == "" {
		writeError(w, http.StatusBadRequest, errors.New("missing text"))
		return
	}
	code, err := qr.Encode(text, qr.M)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	pngBytes := code.PNG()
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(pngBytes)
}
