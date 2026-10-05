//go:build !bashkitten_client

// SPDX-License-Identifier: AGPL-3.0-only

// Desktop adapter for the same client used by Android. The browser owns its
// pipes and encrypted credential store; EOF closes every mapping and socket.
package desktop

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"

	"github.com/openresearchtools/bashkitten/remote/bundle"
	"github.com/openresearchtools/bashkitten/remote/mobile"
)

type request struct {
	ID     uint64          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type pipe struct {
	ctx        context.Context
	out        *json.Encoder
	writeMu    sync.Mutex
	ack        chan bool
	connection atomic.Pointer[mobile.Connection]
	gateway    *gateway
	onion      string
}

func (p *pipe) write(value any) error {
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	return p.out.Encode(value)
}

// Rotation must wait for the browser's durable NSS-encrypted write. An ack
// travels separately from ordinary commands, avoiding request/callback deadlock.
func (p *pipe) SaveToken(data []byte) error {
	if err := p.write(map[string]any{"event": "save-token", "token": json.RawMessage(data)}); err != nil {
		return err
	}
	select {
	case saved := <-p.ack:
		if saved {
			return nil
		}
		return errors.New("encrypted token persistence failed")
	case <-p.ctx.Done():
		return p.ctx.Err()
	}
}

func Run() error {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()
	p := &pipe{ctx: ctx, out: json.NewEncoder(os.Stdout), ack: make(chan bool)}
	requests := make(chan request)
	inputDone := make(chan error, 1)
	go func() {
		decoder := json.NewDecoder(os.Stdin)
		decoder.DisallowUnknownFields()
		for {
			var r request
			if err := decoder.Decode(&r); err != nil {
				inputDone <- err
				cancel()
				return
			}
			if r.Method == "token-saved" {
				var saved bool
				if json.Unmarshal(r.Params, &saved) != nil {
					cancel()
					return
				}
				select {
				case p.ack <- saved:
				case <-ctx.Done():
					return
				}
			} else {
				select {
				case requests <- r:
				case <-ctx.Done():
					return
				}
			}
		}
	}()
	// One outstanding browser command; completion is read before its successor.
	// Token callbacks may arrive from mapped connections between commands.
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer func() {
			if p.gateway != nil {
				p.gateway.Close()
			}
			if c := p.connection.Load(); c != nil {
				c.Close()
			}
		}()
		for {
			select {
			case <-ctx.Done():
				return
			case r := <-requests:
				result, err := p.action(r)
				clear(r.Params)
				response := map[string]any{"id": r.ID}
				if err != nil {
					response["error"] = err.Error()
				} else {
					response["result"] = result
				}
				if p.write(response) != nil {
					cancel()
					return
				}
			}
		}
	}()
	<-ctx.Done()
	// Closing stdin alone is not enough to cancel an active native network call.
	// Client operations are short except for mappings, which Close cancels.
	if c := p.connection.Load(); c != nil {
		c.Close()
	}
	<-done
	select {
	case err := <-inputDone:
		if !errors.Is(err, io.EOF) {
			return errors.New("invalid native client stream")
		}
	default:
	}
	return nil
}

func (p *pipe) action(r request) (any, error) {
	var value struct {
		Text         string          `json:"text"`
		Password     string          `json:"password"`
		Enrollment   json.RawMessage `json:"enrollment"`
		Token        json.RawMessage `json:"token"`
		SOCKSAddress string          `json:"socksAddress"`
		Callback     string          `json:"callback"`
		Form         string          `json:"form"`
		ID           string          `json:"id"`
		Port         int             `json:"port"`
		Action       string          `json:"action"`
	}
	decoder := json.NewDecoder(bytes.NewReader(r.Params))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&value) != nil || decoder.Decode(new(any)) != io.EOF {
		return nil, errors.New("invalid native client request")
	}
	if r.Method == "decrypt" {
		data, err := mobile.Decrypt(value.Text, value.Password)
		return json.RawMessage(data), err
	}
	if r.Method == "identity" {
		data, err := mobile.BrowserIdentity(value.Enrollment)
		return json.RawMessage(data), err
	}
	if r.Method == "open" {
		if p.connection.Load() != nil {
			return nil, errors.New("connection already open")
		}
		var record bundle.Bundle
		if err := json.Unmarshal(value.Enrollment, &record); err != nil {
			return nil, errors.New("invalid enrollment")
		}
		connection, err := mobile.Open(value.Enrollment, "tcp", value.SOCKSAddress, value.Token, p)
		if err != nil {
			return nil, err
		}
		p.connection.Store(connection)
		p.onion = record.Onion
		if p.ctx.Err() != nil {
			connection.Close()
			return nil, p.ctx.Err()
		}
		return true, nil
	}
	c := p.connection.Load()
	if c == nil {
		return nil, errors.New("connection is not open")
	}
	switch r.Method {
	case "authorize":
		return c.Authorize()
	case "begin-login":
		return c.BeginLogin()
	case "complete-login":
		return true, c.CompleteLogin(value.Callback, value.Form)
	case "cancel-login":
		c.CancelLogin()
		return true, nil
	case "map":
		data, err := c.Map(value.ID, value.Port)
		return json.RawMessage(data), err
	case "unmap":
		c.Unmap(value.ID)
		return true, nil
	case "mappings":
		data, err := c.Mappings()
		return json.RawMessage(data), err
	case "services":
		data, err := c.Services()
		return json.RawMessage(data), err
	case "service-action":
		data, err := c.ServiceAction(value.ID, value.Action)
		return json.RawMessage(data), err
	case "agent-route":
		if p.gateway != nil {
			return nil, errors.New("Agent route already open")
		}
		data, err := c.Map("agent", 0)
		if err != nil {
			return nil, err
		}
		var mapped struct {
			Port int `json:"port"`
		}
		if err := json.Unmarshal([]byte(data), &mapped); err != nil {
			return nil, err
		}
		gateway, route, err := startGateway(p.onion, mapped.Port)
		if err != nil {
			c.Unmap("agent")
			return nil, err
		}
		p.gateway = gateway
		return route, nil
	case "logout":
		return true, c.Logout()
	default:
		return nil, errors.New("unknown native client operation")
	}
}
