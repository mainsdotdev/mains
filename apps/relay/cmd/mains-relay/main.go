package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/mainsdotdev/mains/apps/relay/internal/relay"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:8791", "HTTP listen address; use a TLS reverse proxy for public access")
	secretFile := flag.String("secret-file", os.Getenv("MAINS_RELAY_SECRET_FILE"), "operator routing secret file (at least 32 bytes)")
	flag.Parse()
	if *secretFile == "" {
		log.Fatal("-secret-file or MAINS_RELAY_SECRET_FILE is required")
	}
	secret, err := os.ReadFile(*secretFile)
	if err != nil {
		log.Fatal("could not read relay secret file")
	}
	handler, err := relay.New(relay.Config{Secret: []byte(strings.TrimSpace(string(secret)))})
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: *listen, Handler: handler, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 8192}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	result := make(chan error, 1)
	go func() { result <- server.ListenAndServe() }()
	log.Printf("mains relay listening on %s", *listen)
	select {
	case err := <-result:
		handler.Close()
		if err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	case <-ctx.Done():
		handler.Close()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			server.Close()
		}
	}
}
