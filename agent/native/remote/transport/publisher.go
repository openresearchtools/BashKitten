//go:build !taskarian_client

// SPDX-License-Identifier: AGPL-3.0-only
package transport

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/jpillora/chisel/share/cio"
	"github.com/tailscale/tailcat"
	"tailscale.com/tsnet"
)

type PublishConfig struct {
	Kind       string `json:"kind"`
	Dir        string `json:"dir"`
	Host       string `json:"host"`
	Target     string `json:"target"`
	Initialize bool   `json:"initialize"`
}

// Publisher owns only a provider's TCP listener and its exact configured Caddy
// target. The caller retains the independent account/TLS/service stack owner.
type Publisher struct {
	ctx      context.Context
	cancel   context.CancelFunc
	config   PublishConfig
	mu       sync.Mutex
	status   Status
	ts       *tsnet.Server
	tc       *tailcat.Server
	listener net.Listener
	active   map[net.Conn]struct{}
	closed   bool
	done     chan struct{}
}

func StartPublisher(c PublishConfig) (*Publisher, error) {
	host, port, err := net.SplitHostPort(c.Target)
	ip := net.ParseIP(host)
	n, pe := strconv.Atoi(port)
	if (c.Kind != "tailcat" && c.Kind != "tailscale") || !privateHost.MatchString(c.Host) || err != nil || ip == nil || !ip.IsLoopback() || pe != nil || n < 1 || n > 65535 || strconv.Itoa(n) != port {
		return nil, errors.New("an owned transport and numeric loopback Caddy target are required")
	}
	if _, err := net.ResolveTCPAddr("tcp", c.Target); err != nil {
		return nil, errors.New("invalid Caddy target")
	}
	if err := privateDir(c.Dir); err != nil {
		return nil, err
	}
	if c.Kind == "tailscale" && !c.Initialize {
		if _, err := os.Stat(filepath.Join(c.Dir, "tailscaled.state")); err != nil {
			return nil, errors.New("saved Tailscale node state is missing or unreadable; reissue this sharing identity")
		}
	}
	configure()
	ctx, cancel := context.WithCancel(context.Background())
	p := &Publisher{ctx: ctx, cancel: cancel, config: c, status: Status{Kind: c.Kind, State: "starting"}, active: make(map[net.Conn]struct{}), done: make(chan struct{})}
	go p.run()
	return p, nil
}

func (p *Publisher) run() {
	defer close(p.done)
	var ln net.Listener
	var err error
	if p.config.Kind == "tailcat" {
		var identity *tailcat.PrivateKey
		identity, err = tailcatIdentity(p.config.Dir, p.config.Initialize)
		if err == nil {
			s := &tailcat.Server{Key: identity.Private, PresharedKey: identity.Public.PresharedKey, Logf: func(string, ...any) {}}
			if len(identity.Public.Region) > 0 {
				s.Region = identity.Public.Region[0]
			} else {
				s.RegionID = identity.Public.RegionID
			}
			ln, err = s.Listen(p.ctx, "tcp", ":443")
			if err == nil {
				ci, e := tailcat.ParseAddr(s.TailcatAddr())
				err = e
				if err == nil {
					identity.Public = ci
					err = saveIdentity(p.config.Dir, identity)
				}
				if err == nil {
					p.mu.Lock()
					p.tc = s
					p.status.Address = string(s.TailcatAddr())
					p.mu.Unlock()
				}
			}
			if err != nil {
				s.Close()
			}
		}
	} else {
		s := newTailscale(p.config.Dir, "taskarian-"+strings.Split(p.config.Host, ".")[0][:12])
		err = s.Start()
		if err == nil {
			p.mu.Lock()
			p.ts = s
			p.mu.Unlock()
			_, err = s.Up(p.ctx)
			if err == nil {
				ln, err = s.Listen("tcp", ":443")
			}
		}
		if err != nil {
			s.Close()
		}
	}
	p.mu.Lock()
	if err != nil || p.closed || p.ctx.Err() != nil {
		if err != nil && p.ctx.Err() == nil {
			p.status.State = "error"
			p.status.Error = "transport listener failed: " + err.Error()
		}
		p.mu.Unlock()
		if ln != nil {
			ln.Close()
		}
		return
	}
	p.listener = ln
	p.status.State = "ready"
	p.mu.Unlock()
	stop := context.AfterFunc(p.ctx, func() { ln.Close() })
	defer stop()
	for {
		remote, e := ln.Accept()
		if e != nil {
			if p.ctx.Err() == nil {
				p.mu.Lock()
				p.status.State = "error"
				p.status.Error = "transport listener stopped"
				p.mu.Unlock()
			}
			return
		}
		p.mu.Lock()
		if p.closed {
			p.mu.Unlock()
			remote.Close()
			continue
		}
		p.active[remote] = struct{}{}
		p.mu.Unlock()
		go p.forward(remote)
	}
}

func (p *Publisher) forward(remote net.Conn) {
	defer func() { remote.Close(); p.mu.Lock(); delete(p.active, remote); p.mu.Unlock() }()
	local, err := (&net.Dialer{}).DialContext(p.ctx, "tcp", p.config.Target)
	if err != nil {
		return
	}
	defer local.Close()
	stop := context.AfterFunc(p.ctx, func() { local.Close(); remote.Close() })
	defer stop()
	cio.Pipe(local, remote)
}

func (p *Publisher) Status() (Status, error) {
	p.mu.Lock()
	result := p.status
	s := p.ts
	closed := p.closed
	p.mu.Unlock()
	if closed {
		return Status{Kind: p.config.Kind, State: "stopped"}, nil
	}
	if s != nil && result.State != "error" {
		state, err := tailscaleStatus(p.ctx, s)
		if err != nil {
			return result, err
		}
		if state.State == "ready" && result.State != "ready" {
			state.State = "starting"
		}
		return state, nil
	}
	return result, nil
}

func (p *Publisher) Close() {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return
	}
	p.closed = true
	p.cancel()
	if p.listener != nil {
		p.listener.Close()
	}
	for conn := range p.active {
		conn.Close()
	}
	p.mu.Unlock()
	// Startup belongs to the cancellation context. Do not call upstream Close
	// concurrently with its Start/Listen initialization.
	<-p.done
	p.mu.Lock()
	tc, ts := p.tc, p.ts
	p.tc = nil
	p.ts = nil
	p.mu.Unlock()
	if tc != nil {
		tc.Close()
	}
	if ts != nil {
		ts.Close()
	}
}

func tailcatIdentity(dir string, initialize bool) (*tailcat.PrivateKey, error) {
	path := filepath.Join(dir, "tailcat-identity.json")
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		if !initialize {
			return nil, errors.New("saved Tailcat node identity is missing; reissue this sharing identity")
		}
		identity := tailcat.NewPrivateKey()
		identity.Public.RegionID = -1
		return identity, saveIdentity(dir, identity)
	}
	if err != nil {
		return nil, errors.New("cannot read Tailcat identity")
	}
	defer clear(data)
	var identity tailcat.PrivateKey
	if json.Unmarshal(data, &identity) != nil || identity.Private.IsZero() || identity.Private.Public() != identity.Public.ServerPublic.NodePublic || !identity.Public.ServerDiscoPublic.Equal(tailcat.DiscoPublicForNode(identity.Private)) || identity.Public.PresharedKey.IsZero() {
		return nil, errors.New("invalid saved Tailcat identity")
	}
	if len(identity.Public.Region) == 0 {
		if identity.Public.RegionID != -1 {
			return nil, errors.New("invalid saved Tailcat relay")
		}
	} else {
		if len(identity.Public.Region) != 1 || identity.Public.Region[0] == nil || len(identity.Public.Region[0].Nodes) == 0 {
			return nil, errors.New("invalid saved Tailcat relay")
		}
		for _, node := range identity.Public.Region[0].Nodes {
			if node == nil || node.InsecureForTests || node.HostName == "" {
				return nil, errors.New("invalid saved Tailcat relay")
			}
		}
	}
	return &identity, nil
}

func saveIdentity(dir string, identity *tailcat.PrivateKey) error {
	data, err := json.Marshal(identity)
	if err != nil {
		return err
	}
	defer clear(data)
	f, err := os.CreateTemp(dir, ".identity-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err = os.Rename(f.Name(), filepath.Join(dir, "tailcat-identity.json")); err != nil {
		return err
	}
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}
