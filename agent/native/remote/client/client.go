// SPDX-License-Identifier: AGPL-3.0-only

// Package client owns one native enrollment's OAuth flow and service mappings.
// Platform callers own Tor, protected browser UI and encrypted persistence.
// Nothing here exposes a management listener or gives credentials to web content.
package client

import (
	"context"
	"errors"
	"net"
	"net/http"
	"sync"

	"github.com/openresearchtools/bashkitten/remote/bundle"
	"github.com/openresearchtools/bashkitten/remote/oauth"
	"github.com/openresearchtools/bashkitten/remote/tunnel"
)

type Config struct {
	Enrollment                 bundle.Bundle
	SOCKSNetwork, SOCKSAddress string
	Token                      oauth.Token
	Save                       func(oauth.Token) error
}

type mapping struct {
	requested int
	tunnel    *tunnel.Mapping
}

// MappingState reports the bound socket and last carrier error, not readiness
// of the remote application. The platform obtains host state from its catalogue.
type MappingState struct {
	ID    string `json:"id"`
	Port  int    `json:"port"`
	Error string `json:"error,omitempty"`
}

type Client struct {
	ctx    context.Context
	cancel context.CancelFunc
	config tunnel.ClientConfig
	http   *http.Client
	oauth  *oauth.Client
	save   func(oauth.Token) error

	authMu      sync.Mutex // A refresh token is consumed at most once, including failure.
	token       oauth.Token
	mu          sync.Mutex
	closed      bool
	login       *oauth.Authorization
	loginCancel context.CancelFunc
	mappings    map[string]mapping
}

// OAuthClientID is derived from the bundle ID so no additional shared secret or
// registration field is needed in TK2. Host registration uses this same value.
func OAuthClientID(enrollment bundle.Bundle) string { return "bashkitten-" + enrollment.ID }

func New(config Config) (*Client, error) {
	if config.Save == nil {
		return nil, errors.New("native encrypted token persistence is required")
	}
	tlsConfig, err := config.Enrollment.TLS()
	if err != nil {
		return nil, err
	}
	origin := "https://" + config.Enrollment.Onion
	c := &Client{save: config.Save, token: config.Token, mappings: make(map[string]mapping)}
	c.config = tunnel.ClientConfig{OnionURL: origin, SOCKSNetwork: config.SOCKSNetwork,
		SOCKSAddress: config.SOCKSAddress, TLS: tlsConfig, Fingerprint: config.Enrollment.Fingerprint,
		AccessToken: c.accessToken}
	c.http, err = c.config.HTTPClient()
	if err != nil {
		return nil, err
	}
	c.oauth, err = oauth.New(oauth.Config{Issuer: origin + "/login", ClientID: OAuthClientID(config.Enrollment),
		Audience: origin, HTTP: c.http, Save: config.Save})
	if err != nil {
		c.http.CloseIdleConnections()
		return nil, err
	}
	if config.Token != (oauth.Token{}) && !c.oauth.Owns(config.Token) {
		c.http.CloseIdleConnections()
		return nil, errors.New("saved OAuth credentials belong to another enrollment")
	}
	c.ctx, c.cancel = context.WithCancel(context.Background())
	return c, nil
}

func (c *Client) operation(parent context.Context) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(parent)
	stop := context.AfterFunc(c.ctx, cancel)
	if c.ctx.Err() != nil {
		cancel()
	}
	return ctx, func() { stop(); cancel() }
}

// BeginLogin returns only the authorization URL for the protected Agent view.
// CancelLogin can interrupt both the PAR request and an already displayed flow.
func (c *Client) BeginLogin(parent context.Context) (string, error) {
	c.authMu.Lock()
	defer c.authMu.Unlock()
	c.CancelLogin()
	ctx, cancel := c.operation(parent)
	defer cancel()
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return "", errors.New("remote connection is closed")
	}
	c.loginCancel = cancel
	c.mu.Unlock()
	flow, err := c.oauth.Begin(ctx)
	c.mu.Lock()
	defer c.mu.Unlock()
	c.loginCancel = nil
	if err == nil && (c.closed || ctx.Err() != nil) {
		flow.Cancel()
		err = context.Canceled
	}
	if err != nil {
		return "", err
	}
	c.login = flow
	return flow.URL, nil
}

// CompleteLogin is called only by native navigation interception. The callback
// must never load as a page, enter history, or go through an ordinary-tab tool.
func (c *Client) CompleteLogin(parent context.Context, callback string) error {
	c.authMu.Lock()
	defer c.authMu.Unlock()
	ctx, cancel := c.operation(parent)
	defer cancel()
	c.mu.Lock()
	flow := c.login
	if c.closed || flow == nil {
		c.mu.Unlock()
		return oauth.ErrLoginRequired
	}
	c.mu.Unlock()
	token, err := flow.Complete(ctx, callback)
	c.mu.Lock()
	if c.login == flow {
		c.login = nil
	}
	c.mu.Unlock()
	if err != nil {
		return err
	}
	c.token = token
	return nil
}

func (c *Client) CancelLogin() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.loginCancel != nil {
		c.loginCancel()
		c.loginCancel = nil
	}
	if c.login != nil {
		c.login.Cancel()
		c.login = nil
	}
}

func (c *Client) accessToken(parent context.Context) (string, error) {
	c.authMu.Lock()
	defer c.authMu.Unlock()
	return c.accessTokenLocked(parent)
}

func (c *Client) accessTokenLocked(parent context.Context) (string, error) {
	ctx, cancel := c.operation(parent)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return "", err
	}
	previous := c.token
	// A failed refresh may have reached Authelia and consumed its old token.
	// Never keep retrying that credential after an uncertain network result.
	c.token = oauth.Token{}
	token, err := c.oauth.Access(ctx, previous)
	if err != nil {
		c.mu.Lock()
		c.closeMappings()
		c.mu.Unlock()
		if previous != (oauth.Token{}) && c.save(oauth.Token{}) != nil {
			return "", errors.New("could not clear unavailable OAuth credentials")
		}
		return "", err
	}
	c.token = token
	return token.AccessToken, nil
}

func state(id string, m mapping) MappingState {
	s := MappingState{ID: id, Port: m.tunnel.Addr().(*net.TCPAddr).Port}
	if err := m.tunnel.Status(); err != nil {
		s.Error = err.Error()
	}
	return s
}

// Map retains an existing working listener if the new requested port cannot be
// bound. Automatic mode keeps the socket acquired by ListenTCP(127.0.0.1:0).
func (c *Client) Map(ctx context.Context, id string, port int) (MappingState, error) {
	c.authMu.Lock()
	defer c.authMu.Unlock()
	if _, err := c.accessTokenLocked(ctx); err != nil {
		return MappingState{}, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return MappingState{}, errors.New("remote connection is closed")
	}
	previous, exists := c.mappings[id]
	if exists && (previous.requested == port || previous.tunnel.Addr().(*net.TCPAddr).Port == port) {
		previous.requested = port
		c.mappings[id] = previous
		return state(id, previous), nil
	}
	mapped, err := tunnel.Map(c.ctx, c.config, id, port)
	if err != nil {
		return MappingState{}, err
	}
	next := mapping{requested: port, tunnel: mapped}
	c.mappings[id] = next
	if exists {
		previous.tunnel.Close()
	}
	return state(id, next), nil
}

func (c *Client) Unmap(id string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if m, ok := c.mappings[id]; ok {
		m.tunnel.Close()
		delete(c.mappings, id)
	}
}

func (c *Client) Mappings() []MappingState {
	c.mu.Lock()
	defer c.mu.Unlock()
	states := make([]MappingState, 0, len(c.mappings))
	for id, m := range c.mappings {
		states = append(states, state(id, m))
	}
	return states
}

// Caller holds mu. Closing a mapping cancels its active carriers immediately.
func (c *Client) closeMappings() {
	for id, m := range c.mappings {
		m.tunnel.Close()
		delete(c.mappings, id)
	}
}

// Close is normal disconnection/shutdown: it preserves remembered credentials.
// The native owner also removes this enrollment's scoped Gecko credential.
func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	c.closed = true
	c.cancel()
	if c.loginCancel != nil {
		c.loginCancel()
		c.loginCancel = nil
	}
	if c.login != nil {
		c.login.Cancel()
		c.login = nil
	}
	c.closeMappings()
	c.http.CloseIdleConnections()
}

// Logout first closes local access, then revokes with Authelia and erases the
// saved token. Failed remote revocation remains an error, never a claimed logout
// of other devices. A caller creates a new Client for a subsequent explicit login.
func (c *Client) Logout(ctx context.Context) error {
	c.Close()
	c.authMu.Lock()
	defer c.authMu.Unlock()
	token := c.token
	c.token = oauth.Token{}
	var revokeErr error
	if token != (oauth.Token{}) {
		revokeErr = c.oauth.Revoke(ctx, token)
	}
	defer c.http.CloseIdleConnections()
	return errors.Join(revokeErr, c.save(oauth.Token{}))
}
