//go:build !bashkitten_client

// SPDX-License-Identifier: AGPL-3.0-only

package tunnel

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/openresearchtools/bashkitten/remote/oauth"
	"golang.org/x/crypto/ssh"
)

type AuthorizeIdentity func(context.Context, string) (string, error)
type RefreshBearer func(context.Context, string) (oauth.TokenResponse, error)

// All live connections admitted with one access token share its replacement.
// The write lock covers only local Authelia checks/exchange, never a Tor reply.
// Revoke/Close still cancel carriers immediately without taking this lock.
type authorization struct {
	mu    sync.RWMutex
	token string
	user  string
	refs  int // Server.mu; token changes also hold Server.mu for map cleanup.
}

func (s *Server) acquireAuthorization(ctx context.Context, token string) (*authorization, error) {
	s.mu.Lock()
	a := s.authorizations[token]
	if a == nil {
		a = &authorization{token: token}
		s.authorizations[token] = a
	}
	a.refs++
	s.mu.Unlock()
	a.mu.Lock()
	user, err := s.authorize(ctx, token)
	if err == nil && (user == "" || a.token != token || (a.user != "" && a.user != user)) {
		err = errors.New("OAuth identity changed")
	}
	if err == nil {
		a.user = user
	}
	a.mu.Unlock()
	if err != nil {
		s.releaseAuthorization(a)
		return nil, err
	}
	return a, nil
}

func (s *Server) releaseAuthorization(a *authorization) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a.refs--
	if a.refs == 0 && s.authorizations[a.token] == a {
		delete(s.authorizations, a.token)
	}
}

func (s *Server) checkAuthorization(ctx context.Context, a *authorization) error {
	a.mu.RLock()
	defer a.mu.RUnlock()
	check, done := context.WithTimeout(ctx, 5*time.Second)
	defer done()
	user, err := s.authorize(check, a.token)
	if err == nil && user != a.user {
		return errors.New("OAuth identity changed")
	}
	return err
}

func (s *Server) renewAuthorization(ctx context.Context, a *authorization, epoch uint64, payload []byte) (oauth.TokenResponse, error) {
	var request renewal
	var response oauth.TokenResponse
	if len(payload) > 20<<10 {
		return response, errors.New("invalid renewal request")
	}
	d := json.NewDecoder(bytes.NewReader(payload))
	d.DisallowUnknownFields()
	if d.Decode(&request) != nil || d.Decode(new(any)) != io.EOF || !validToken(request.AccessToken) ||
		!validToken(request.RefreshToken) || !strings.HasPrefix(request.RefreshToken, "authelia_rt_") {
		return response, errors.New("invalid renewal request")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	// Refresh invalidates its paired access token. Keep every carrier's checks
	// outside that local transaction; no expired-token or network grace period.
	check, done := context.WithTimeout(ctx, 5*time.Second)
	defer done()
	if request.AccessToken != a.token {
		return response, errors.New("stale renewal credential")
	}
	user, err := s.authorize(check, a.token)
	if err != nil || user != a.user {
		return response, errors.New("OAuth authorization denied")
	}
	response, err = s.refresh(check, request.RefreshToken)
	request.RefreshToken = ""
	if err != nil || !validToken(response.AccessToken) {
		return oauth.TokenResponse{}, errors.New("OAuth refresh failed")
	}
	user, err = s.authorize(check, response.AccessToken)
	if err != nil || user != a.user {
		return oauth.TokenResponse{}, errors.New("OAuth replacement identity denied")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.epoch != epoch || check.Err() != nil {
		return oauth.TokenResponse{}, errors.New("remote access ended during renewal")
	}
	delete(s.authorizations, a.token)
	a.token = response.AccessToken
	s.authorizations[a.token] = a
	return response, nil
}

// Only this adapter handles the credential control request. Pristine Chisel
// continues to own its other requests, stream framing and backpressure.
func (s *Server) credentialRequests(ctx context.Context, cancel context.CancelFunc, a *authorization, epoch uint64, requests <-chan *ssh.Request) <-chan *ssh.Request {
	forward := make(chan *ssh.Request)
	go func() {
		defer close(forward)
		for {
			select {
			case <-ctx.Done():
				return
			case request, ok := <-requests:
				if !ok {
					return
				}
				if request.Type != renewalRequest {
					select {
					case forward <- request:
					case <-ctx.Done():
						return
					}
					continue
				}
				if !request.WantReply {
					cancel()
					return
				}
				response, err := s.renewAuthorization(ctx, a, epoch, request.Payload)
				clear(request.Payload)
				if err != nil {
					request.Reply(false, nil)
					cancel()
					return
				}
				payload, _ := json.Marshal(response)
				err = request.Reply(true, payload)
				clear(payload)
				if err != nil {
					cancel()
					return
				}
			}
		}
	}()
	return forward
}
