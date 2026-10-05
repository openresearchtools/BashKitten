//go:build !bashkitten_client

// Copyright 2026 The Torkitten Authors (Apache-2.0).
// BashKitten adaptations: SPDX-License-Identifier: AGPL-3.0-only

// Package host exposes only the service-ID carrier on a private Unix socket.
// The existing controller owns Tor, Caddy, Authelia, enrollment and service jobs.
package host

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"

	"github.com/openresearchtools/bashkitten/remote/tunnel"
	"golang.org/x/crypto/ssh"
)

type Config struct {
	Socket        string `json:"socket"`
	AuthSocket    string `json:"auth_socket"`
	ControlSocket string `json:"control_socket"`
	Generation    string `json:"generation"`
	Onion         string `json:"onion"`
	Key           string `json:"key"`
}

type Host struct {
	Tunnel  *tunnel.Server
	server  *http.Server
	auth    *http.Transport
	control *http.Transport
	done    chan error
}

// Start never deletes an existing listener or chooses another socket. The
// controller must reconcile its previously owned process before starting us.
func Start(c Config) (*Host, error) {
	if !regexp.MustCompile(`^[a-z2-7]{56}\.onion$`).MatchString(c.Onion) || !regexp.MustCompile(`^[a-f0-9]{48}$`).MatchString(c.Generation) {
		return nil, errors.New("an exact v3 onion is required")
	}
	for _, socket := range []string{c.Socket, c.AuthSocket, c.ControlSocket} {
		if !filepath.IsAbs(socket) || filepath.Clean(socket) != socket || strings.ContainsRune(socket, 0) {
			return nil, errors.New("an absolute private socket path is required")
		}
		parent, err := os.Stat(filepath.Dir(socket))
		if err != nil || !parent.IsDir() || parent.Mode().Perm()&0077 != 0 {
			return nil, errors.New("socket directory must be private")
		}
		owner, ok := parent.Sys().(*syscall.Stat_t)
		if !ok || owner.Uid != uint32(os.Geteuid()) {
			return nil, errors.New("socket directory must belong to the controller user")
		}
	}
	key := []byte(c.Key)
	signer, err := ssh.ParsePrivateKey(key)
	clear(key)
	c.Key = ""
	if err != nil {
		return nil, errors.New("invalid Chisel host key")
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", c.AuthSocket)
	}}
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	authorize := func(ctx context.Context, token string) error {
		if !strings.HasPrefix(token, "authelia_at_") || strings.ContainsAny(token, "\r\n") {
			return errors.New("OAuth authorization required")
		}
		// This separately configured Authelia endpoint accepts Bearer only. A
		// CookieSession or forged Caddy identity header cannot authorize a carrier.
		r, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+c.Onion+"/login/api/authz/tunnel", nil)
		if err != nil {
			return errors.New("invalid authorization request")
		}
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("X-Forwarded-Proto", "https")
		r.Header.Set("X-Forwarded-Host", c.Onion)
		r.Header.Set("X-Forwarded-For", "127.0.0.1")
		r.Header.Set("X-Forwarded-Method", "GET")
		r.Header.Set("X-Forwarded-Uri", "/tunnel")
		response, err := client.Do(r)
		if err != nil {
			return errors.New("Authelia authorization unavailable")
		}
		defer response.Body.Close()
		io.Copy(io.Discard, response.Body)
		if response.StatusCode != http.StatusOK || response.Header.Get("Remote-User") == "" {
			return errors.New("OAuth authorization denied")
		}
		return nil
	}
	relay, err := tunnel.NewServer(signer, authorize)
	if err != nil {
		return nil, err
	}
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: c.Socket, Net: "unix"})
	if err != nil {
		return nil, errors.New("cannot bind the private tunnel socket")
	}
	if err := os.Chmod(c.Socket, 0600); err != nil {
		listener.Close()
		return nil, errors.New("cannot protect the private tunnel socket")
	}
	control := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", c.ControlSocket)
	}}
	mux := http.NewServeMux()
	mux.Handle("/tunnel/", relay)
	mux.Handle("/services", serviceControl(authorize, control, c.Generation))
	mux.Handle("/services/", serviceControl(authorize, control, c.Generation))
	h := &Host{Tunnel: relay, auth: transport, control: control, done: make(chan error, 1), server: &http.Server{
		Handler: mux, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second,
	}}
	go func() { h.done <- h.server.Serve(listener) }()
	return h, nil
}

func (h *Host) Done() <-chan error { return h.done }

// Close also ends hijacked WebSockets: net/http shutdown alone does not own them.
func (h *Host) Close() {
	h.Tunnel.Close()
	h.server.Close()
	h.auth.CloseIdleConnections()
	h.control.CloseIdleConnections()
}
