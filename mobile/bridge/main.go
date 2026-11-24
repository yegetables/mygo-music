// Package main exports the C ABI bridge for Android (c-shared) and iOS/iPadOS (c-archive).
// It embeds the compiled responsive Web UI from ./webdist.
package main

/*
#include <stdlib.h>
*/
import "C"

import (
	"embed"
	"encoding/json"
	"io/fs"
	"strings"
	"sync"
	"unsafe"

	"mygo-music/internal/mobilecore"
)

//go:embed all:webdist
var embeddedWeb embed.FS

var (
	srvMu sync.Mutex
	srv   *mobilecore.Server
)

//export MyGoStart
func MyGoStart(dataDirC, cacheDirC, langC *C.char) *C.char {
	dataDir := C.GoString(dataDirC)
	cacheDir := C.GoString(cacheDirC)
	lang := C.GoString(langC)

	srvMu.Lock()
	defer srvMu.Unlock()

	if srv != nil {
		b, _ := json.Marshal(map[string]any{
			"port":  srv.Port,
			"token": srv.Token,
		})
		return C.CString(string(b))
	}

	var langs []string
	if strings.TrimSpace(lang) != "" {
		langs = strings.Split(lang, ",")
	}
	sub, _ := fs.Sub(embeddedWeb, "webdist")
	s, err := mobilecore.Start(mobilecore.Options{
		DataDir:     dataDir,
		CacheDir:    cacheDir,
		SystemLangs: langs,
		WebFS:       sub,
	})
	if err != nil {
		b, _ := json.Marshal(map[string]any{"error": err.Error()})
		return C.CString(string(b))
	}
	srv = s
	b, _ := json.Marshal(map[string]any{
		"port":  s.Port,
		"token": s.Token,
	})
	return C.CString(string(b))
}

//export MyGoStop
func MyGoStop() {
	srvMu.Lock()
	s := srv
	srv = nil
	srvMu.Unlock()
	if s != nil {
		s.Stop()
	}
}

//export MyGoCompleteWebSignIn
func MyGoCompleteWebSignIn(idC, cookieC, errC *C.char) {
	srvMu.Lock()
	s := srv
	srvMu.Unlock()
	if s != nil {
		s.CompleteWebSignIn(C.GoString(idC), C.GoString(cookieC), C.GoString(errC))
	}
}

//export MyGoFree
func MyGoFree(ptr *C.char) {
	if ptr != nil {
		C.free(unsafe.Pointer(ptr))
	}
}

func main() {}
