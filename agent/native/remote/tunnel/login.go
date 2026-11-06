// SPDX-License-Identifier: AGPL-3.0-only
package tunnel

import (
	"context"
	"github.com/jpillora/chisel/share/cio"
	"net"
	"net/url"
)

// LoginRoute exposes only raw bytes to the enrolled Caddy identity. It does
// not terminate TLS or provide an HTTP/authentication bypass.
func (c ClientConfig) LoginRoute(ctx context.Context) (*Mapping, error) {
	dialer, _, err := c.prepare("agent")
	if err != nil {
		return nil, err
	}
	origin, _ := url.Parse(c.OnionURL)
	listener, err := net.ListenTCP("tcp4", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(ctx)
	m := &Mapping{listener: listener, cancel: cancel, active: make(map[net.Conn]struct{})}
	context.AfterFunc(ctx, func() { m.Close() })
	go func() {
		for {
			local, e := listener.AcceptTCP()
			if e != nil {
				return
			}
			m.mu.Lock()
			if m.closed {
				m.mu.Unlock()
				local.Close()
				continue
			}
			m.active[local] = struct{}{}
			m.mu.Unlock()
			go func() {
				defer local.Close()
				defer func() { m.mu.Lock(); delete(m.active, local); m.mu.Unlock() }()
				remote, e := dialer.NetDialContext(ctx, "tcp", net.JoinHostPort(origin.Hostname(), "443"))
				if e != nil {
					if ctx.Err() == nil {
						m.setStatus(e)
					}
					return
				}
				defer remote.Close()
				stop := context.AfterFunc(ctx, func() { remote.Close(); local.Close() })
				defer stop()
				cio.Pipe(local, remote)
			}()
		}
	}()
	return m, nil
}
