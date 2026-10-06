// Copyright 2026 The Torkitten Authors (Apache-2.0).
// BashKitten adaptations: SPDX-License-Identifier: AGPL-3.0-only
package oauth

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Authorization is private native state. Only URL goes to the protected Agent
// context; it retains the real Authelia login/Remember me cookie for Agent.
// The native request handler intercepts CallbackURI before any network load
// and passes the form POST here. No localhost listener, code in history/logs, cookie
// fabrication or second password/TOTP flow is required.
type Authorization struct {
	URL      string
	client   *Client
	state    string
	verifier string
	until    time.Time
	ctx      context.Context
	cancel   context.CancelFunc
	mu       sync.Mutex
	used     bool
}

func (c *Client) Begin(ctx context.Context) (*Authorization, error) {
	state, err := randomValue()
	if err != nil {
		return nil, err
	}
	verifier, err := randomValue()
	if err != nil {
		return nil, err
	}
	var par struct {
		RequestURI string `json:"request_uri"`
		ExpiresIn  int64  `json:"expires_in"`
	}
	if err := c.post(ctx, "pushed-authorization-request", url.Values{
		"response_type": {"code"}, "response_mode": {"form_post"}, "redirect_uri": {CallbackURI},
		"scope": {scope}, "audience": {c.config.Audience}, "resource": {c.config.Audience}, "state": {state},
		"code_challenge": {challenge(verifier)}, "code_challenge_method": {"S256"}, "prompt": {"consent"},
	}, &par); err != nil {
		return nil, err
	}
	if !strings.HasPrefix(par.RequestURI, "urn:ietf:params:oauth:request_uri:") || !safeValue(par.RequestURI) || par.ExpiresIn <= 0 {
		return nil, errors.New("invalid pushed authorization response")
	}
	query := url.Values{"client_id": {c.config.ClientID}, "request_uri": {par.RequestURI}}
	until := time.Now().Add(time.Duration(min(par.ExpiresIn, 300)) * time.Second)
	flowCtx, cancel := context.WithDeadline(context.Background(), until)
	return &Authorization{URL: c.config.Issuer + "/api/oidc/authorization?" + query.Encode(), client: c,
		state: state, verifier: verifier, until: until, ctx: flowCtx, cancel: cancel}, nil
}

// Complete consumes this PKCE exchange exactly once, including on a failed
// exchange. A cancelled/expired attempt requires explicit new authorization.
func (a *Authorization) Complete(ctx context.Context, callback, form string) (Token, error) {
	a.mu.Lock()
	if a.used || time.Now().After(a.until) {
		a.mu.Unlock()
		return Token{}, ErrLoginRequired
	}
	a.used = true
	state, verifier := a.state, a.verifier
	a.state, a.verifier = "", ""
	a.mu.Unlock()
	defer a.Cancel()
	requestCtx, cancel := context.WithDeadline(ctx, a.until)
	stop := context.AfterFunc(a.ctx, cancel)
	defer func() { stop(); cancel() }()
	if callback != CallbackURI {
		return Token{}, errors.New("unexpected OAuth callback")
	}
	q, err := url.ParseQuery(form)
	if err != nil {
		return Token{}, errors.New("invalid OAuth callback")
	}
	for key, values := range q {
		if len(values) != 1 || (key != "code" && key != "state" && key != "iss" && key != "scope" && key != "error" && key != "error_description" && key != "error_uri") {
			return Token{}, errors.New("invalid OAuth callback fields")
		}
	}
	if q.Get("state") != state || q.Get("iss") != a.client.config.Issuer {
		return Token{}, errors.New("OAuth issuer or state mismatch")
	}
	if q.Get("error") != "" {
		return Token{}, ErrLoginRequired
	}
	// Authelia includes granted scopes in its authorization-code form response.
	if scopes, present := q["scope"]; present && !exactScopes(strings.Fields(scopes[0])) {
		return Token{}, errors.New("required OAuth scopes were not granted")
	}
	if !safeValue(q.Get("code")) {
		return Token{}, errors.New("missing OAuth authorization code")
	}
	return a.client.exchange(requestCtx, url.Values{"grant_type": {"authorization_code"}, "code": {q.Get("code")},
		"redirect_uri": {CallbackURI}, "code_verifier": {verifier}})
}

func (a *Authorization) Cancel() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.used, a.state, a.verifier = true, "", ""
	a.cancel()
}

func exactScopes(values []string) bool {
	return len(values) == 2 && ((values[0] == "authelia.bearer.authz" && values[1] == "offline_access") ||
		(values[1] == "authelia.bearer.authz" && values[0] == "offline_access"))
}

// Registration is the matching native public-client registration for Authelia.
// Remote reset removes it with the entire remote generation's token storage.
func Registration(clientID, onion string) (map[string]any, error) {
	if !safeValue(clientID) || !onionHost.MatchString(onion) {
		return nil, errors.New("invalid native OAuth registration")
	}
	return map[string]any{
		"client_id": clientID, "client_name": "BashKitten", "public": true,
		"authorization_policy": "two_factor", "consent_mode": "explicit",
		"redirect_uris": []string{CallbackURI}, "scopes": strings.Fields(scope),
		"audience": []string{"https://" + onion}, "grant_types": []string{"authorization_code", "refresh_token"},
		"response_types": []string{"code"}, "response_modes": []string{"form_post"},
		"token_endpoint_auth_method": "none", "require_pushed_authorization_requests": true,
		"require_pkce": true, "pkce_challenge_method": "S256",
	}, nil
}
