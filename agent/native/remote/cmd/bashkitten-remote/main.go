//go:build !bashkitten_client

// SPDX-License-Identifier: AGPL-3.0-only

// The existing native controller owns this child and its private stdin/stdout
// pipes. No TCP control API, secret-bearing arguments or daemon supervisor.
package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/go-crypt/crypt/algorithm/argon2"
	"github.com/openresearchtools/bashkitten/remote/bundle"
	"github.com/openresearchtools/bashkitten/remote/host"
	"github.com/openresearchtools/bashkitten/remote/oauth"
	"github.com/openresearchtools/bashkitten/remote/tunnel"
	"golang.org/x/crypto/ssh"
)

type request struct {
	ID     uint64          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type reply struct {
	ID     uint64 `json:"id"`
	Result any    `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
}

func decode(data []byte, out any) error {
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(out) != nil || d.Decode(new(any)) != io.EOF {
		return errors.New("invalid native request parameters")
	}
	return nil
}

func main() {
	if len(os.Args) != 1 {
		fmt.Fprintln(os.Stderr, "Use the private controller pipe; command arguments are not accepted.")
		os.Exit(2)
	}
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	input := make(chan request)
	inputDone := make(chan error, 1)
	go func() {
		d := json.NewDecoder(os.Stdin)
		d.DisallowUnknownFields()
		for {
			var r request
			if err := d.Decode(&r); err != nil {
				inputDone <- err
				return
			}
			input <- r
		}
	}()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGTERM, syscall.SIGINT)
	defer signal.Stop(signals)
	var running *host.Host
	defer func() {
		if running != nil {
			running.Close()
		}
	}()
	out := json.NewEncoder(os.Stdout)
	for {
		var stopped <-chan error
		if running != nil {
			stopped = running.Done()
		}
		select {
		case <-signals:
			return nil
		case err := <-inputDone:
			if errors.Is(err, io.EOF) {
				return nil
			}
			return errors.New("invalid native controller stream")
		case <-stopped:
			return errors.New("private tunnel listener stopped")
		case r := <-input:
			value, err := action(&running, r)
			clear(r.Params)
			response := reply{ID: r.ID, Result: value}
			if err != nil {
				response.Error = err.Error()
			}
			if out.Encode(response) != nil {
				return errors.New("native controller pipe closed")
			}
			if r.Method == "shutdown" && err == nil {
				return nil
			}
		}
	}
}

func action(running **host.Host, r request) (any, error) {
	switch r.Method {
	case "hash-password":
		var p struct {
			Password string `json:"password"`
		}
		if err := decode(r.Params, &p); err != nil {
			return nil, err
		}
		if err := bundle.ValidatePassword(p.Password); err != nil {
			return nil, err
		}
		// Use the exact library and Argon2id defaults from the pinned Authelia
		// file provider/crypto CLI. The password stays on the private pipe;
		// Authelia's CLI otherwise requires a TTY or a secret-bearing flag.
		hash, err := argon2.New(argon2.WithVariantID(), argon2.WithT(3),
			argon2.WithM(64*1024), argon2.WithP(4), argon2.WithK(32), argon2.WithS(16))
		if err != nil {
			return nil, errors.New("password hasher configuration failed")
		}
		digest, err := hash.Hash(p.Password)
		p.Password = ""
		if err != nil {
			return nil, errors.New("password hashing failed")
		}
		return digest.String(), nil
	case "oauth-registration":
		var p struct {
			ClientID string `json:"client_id"`
			Onion    string `json:"onion"`
		}
		if err := decode(r.Params, &p); err != nil {
			return nil, err
		}
		return oauth.Registration(p.ClientID, p.Onion)
	case "keygen":
		_, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return nil, errors.New("host key generation failed")
		}
		defer clear(key)
		block, err := ssh.MarshalPrivateKey(key, "BashKitten Chisel")
		if err != nil {
			return nil, errors.New("host key encoding failed")
		}
		defer clear(block.Bytes)
		return string(pem.EncodeToMemory(block)), nil
	case "encrypt":
		var p struct {
			Bundle   bundle.Bundle `json:"bundle"`
			Password string        `json:"password"`
		}
		if err := decode(r.Params, &p); err != nil {
			return nil, err
		}
		text, err := bundle.Encrypt(p.Bundle, p.Password)
		if err != nil {
			return nil, err
		}
		return bundle.PNG(text) // JSON encodes the encrypted PNG as base64.
	case "start":
		if *running != nil {
			return nil, errors.New("tunnel host is already running")
		}
		var config host.Config
		if err := decode(r.Params, &config); err != nil {
			return nil, err
		}
		h, err := host.Start(config)
		if err != nil {
			return nil, err
		}
		*running = h
		return map[string]string{"fingerprint": h.Tunnel.Fingerprint()}, nil
	case "service-set":
		if *running == nil {
			return nil, errors.New("tunnel host is stopped")
		}
		var p struct {
			ID      string `json:"id"`
			Network string `json:"network"`
			Address string `json:"address"`
		}
		if err := decode(r.Params, &p); err != nil {
			return nil, err
		}
		if err := (*running).Tunnel.SetService(p.ID, tunnel.Endpoint{Network: p.Network, Address: p.Address}); err != nil {
			return nil, err
		}
		return true, nil
	case "service-remove":
		if *running == nil {
			return nil, errors.New("tunnel host is stopped")
		}
		var p struct {
			ID string `json:"id"`
		}
		if err := decode(r.Params, &p); err != nil {
			return nil, err
		}
		(*running).Tunnel.RemoveService(p.ID)
		return true, nil
	case "revoke":
		if *running != nil {
			(*running).Tunnel.Revoke()
		}
		return true, nil
	case "shutdown":
		if *running != nil {
			(*running).Close()
			*running = nil
		}
		return true, nil
	default:
		return nil, errors.New("unknown native remote operation")
	}
}
