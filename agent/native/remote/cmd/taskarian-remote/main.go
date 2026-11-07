//go:build !taskarian_client

// SPDX-License-Identifier: AGPL-3.0-only

// The existing native controller owns this child and its private stdin/stdout
// pipes. No TCP control API, secret-bearing arguments or daemon supervisor.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/go-crypt/crypt/algorithm/argon2"
	"github.com/openresearchtools/Taskarian/remote/bundle"
	"github.com/openresearchtools/Taskarian/remote/desktop"
	"github.com/openresearchtools/Taskarian/remote/host"
	"github.com/openresearchtools/Taskarian/remote/oauth"
	"github.com/openresearchtools/Taskarian/remote/transport"
	"github.com/openresearchtools/Taskarian/remote/tunnel"
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
	if len(os.Args) == 2 && os.Args[1] == "--client" {
		if err := desktop.Run(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
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
	var publisher *transport.Publisher
	defer func() {
		if publisher != nil {
			publisher.Close()
		}
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
			value, err := action(&running, &publisher, r)
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

func action(running **host.Host, publisher **transport.Publisher, r request) (any, error) {
	switch r.Method {
	case "transport-start":
		if *publisher != nil {
			return nil, errors.New("publishing transport already running")
		}
		var config transport.PublishConfig
		if err := decode(r.Params, &config); err != nil {
			return nil, err
		}
		p, err := transport.StartPublisher(config)
		if err != nil {
			return nil, err
		}
		*publisher = p
		return p.Status()
	case "transport-status":
		if *publisher == nil {
			return transport.Status{State: "stopped"}, nil
		}
		return (*publisher).Status()
	case "transport-stop":
		if *publisher != nil {
			(*publisher).Close()
			*publisher = nil
		}
		return true, nil
	case "decrypt":
		var p struct {
			Text     string `json:"text"`
			Image    []byte `json:"image"`
			Password string `json:"password"`
		}
		if err := decode(r.Params, &p); err != nil {
			return nil, err
		}
		if (p.Text == "") == (len(p.Image) == 0) {
			return nil, errors.New("one encrypted connection text or image is required")
		}
		if len(p.Image) != 0 {
			var err error
			p.Text, err = bundle.ReadImage(p.Image)
			clear(p.Image)
			if err != nil {
				return nil, err
			}
		}
		return bundle.Decrypt(p.Text, p.Password)
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
	case "enrollment-keys":
		var p struct{}
		if err := decode(r.Params, &p); err != nil {
			return nil, err
		}
		keys, err := host.NewEnrollmentKeys()
		if err != nil {
			return nil, errors.New("remote identity generation failed")
		}
		return keys, nil
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
		if *publisher != nil {
			(*publisher).Close()
			*publisher = nil
		}
		if *running != nil {
			(*running).Close()
			*running = nil
		}
		return true, nil
	default:
		return nil, errors.New("unknown native remote operation")
	}
}
