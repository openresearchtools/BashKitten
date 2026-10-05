//go:build !bashkitten_client

// SPDX-License-Identifier: AGPL-3.0-only

// The upstream SOCKS server bridges only the enrolled Agent's TLS socket. It
// neither terminates TLS nor interprets application requests/stream contents.
package desktop

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"log"
	"net"
	"strconv"
	"sync"

	socks "github.com/armon/go-socks5"
)

type gateway struct {
	onion       string
	listener    net.Listener
	mu          sync.Mutex
	connections map[net.Conn]bool
	closed      bool
}

func (g *gateway) Resolve(ctx context.Context, name string) (context.Context, net.IP, error) {
	if name != g.onion {
		return ctx, nil, errors.New("Agent origin required")
	}
	// This is an enrolled name, not a DNS lookup. Dial below uses only the
	// already bound authenticated mapping owned by the native client.
	return ctx, net.IPv4(127, 0, 0, 1), nil
}

func (g *gateway) Allow(ctx context.Context, req *socks.Request) (context.Context, bool) {
	return ctx, req.Command == socks.ConnectCommand && req.DestAddr.FQDN == g.onion && req.DestAddr.Port == 443
}

func startGateway(onion string, mappedPort int) (*gateway, map[string]any, error) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, nil, err
	}
	credential := hex.EncodeToString(key)
	clear(key)
	g := &gateway{onion: onion, connections: make(map[net.Conn]bool)}
	server, err := socks.New(&socks.Config{
		Credentials: socks.StaticCredentials{"agent": credential}, Resolver: g, Rules: g,
		Logger: log.New(io.Discard, "", 0),
		Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(mappedPort)))
		},
	})
	if err != nil {
		return nil, nil, err
	}
	g.listener, err = net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, nil, err
	}
	go func() {
		for {
			conn, err := g.listener.Accept()
			if err != nil {
				return
			}
			g.mu.Lock()
			if g.closed {
				g.mu.Unlock()
				conn.Close()
				return
			}
			g.connections[conn] = true
			g.mu.Unlock()
			go func() {
				server.ServeConn(conn)
				g.mu.Lock()
				delete(g.connections, conn)
				g.mu.Unlock()
			}()
		}
	}()
	return g, map[string]any{"port": g.listener.Addr().(*net.TCPAddr).Port, "username": "agent", "password": credential}, nil
}

func (g *gateway) Close() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.closed = true
	g.listener.Close()
	for conn := range g.connections {
		conn.Close()
	}
}
