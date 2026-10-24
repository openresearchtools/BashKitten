// SPDX-License-Identifier: AGPL-3.0-only

package tunnel

import (
	"context"
	"encoding/json"
	"errors"
	"sync"

	"github.com/openresearchtools/bashkitten/remote/oauth"
	"golang.org/x/crypto/ssh"
)

const renewalRequest = "credentials@bashkitten-v1"

// ErrCarrierClosed means no renewal was sent, so another still-live carrier may
// be selected. Errors after SendRequest must never cause a refresh-token retry.
var ErrCarrierClosed = errors.New("carrier already closed")

type renewal struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

// Carrier is one already authenticated connection to the pinned host. Its
// credential control request does not reopen or replay its application stream.
type Carrier struct {
	conn    ssh.Conn
	renewal bool
	mapping context.Context
	mu      sync.Mutex
	closed  bool
}

func (c *Carrier) finish() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = true
}

// Renew is attempted exactly once. A lost reply is ambiguous because Authelia
// rotates refresh tokens; the owner must close access and require login, never
// retry the refresh token or fall back to another route.
func (c *Carrier) Renew(ctx context.Context, access, refresh string) (oauth.TokenResponse, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	var response oauth.TokenResponse
	if c.closed || c.mapping.Err() != nil {
		return response, ErrCarrierClosed
	}
	if !c.renewal {
		return response, errors.New("remote host must be updated to renew active connections")
	}
	if err := ctx.Err(); err != nil {
		return response, err
	}
	if !validToken(access) || !validToken(refresh) {
		return response, errors.New("invalid renewal credentials")
	}
	payload, _ := json.Marshal(renewal{AccessToken: access, RefreshToken: refresh})
	defer clear(payload)
	stop := context.AfterFunc(ctx, func() { c.conn.Close() })
	defer stop()
	ok, reply, err := c.conn.SendRequest(renewalRequest, true, payload)
	defer clear(reply)
	if err != nil || !ok || len(reply) > 64<<10 || json.Unmarshal(reply, &response) != nil {
		return oauth.TokenResponse{}, errors.New("remote credential renewal failed; sign in again")
	}
	return response, nil
}
