// Command mobile-dev runs mobilecore + embedded Web UI locally on desktop for rapid testing.
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"mygo-music/internal/mobilecore"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:18080", "listen address")
	data := flag.String("data", filepath.Join(os.TempDir(), "mygo-music-mobile-dev"), "data directory")
	dist := flag.String("dist", "mobile/bridge/webdist", "built web dist directory")
	flag.Parse()

	s, err := mobilecore.Start(mobilecore.Options{
		DataDir:     *data,
		CacheDir:    filepath.Join(*data, "cache"),
		SystemLangs: []string{"zh-CN"},
		ListenAddr:  *addr,
		WebFS:       os.DirFS(*dist),
	})
	if err != nil {
		log.Fatal(err)
	}
	defer s.Stop()

	fmt.Printf("MyGo Music Mobile Dev UI: http://%s/?token=%s&platform=web\n", s.Addr, s.Token)
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
}
