// SPDX-License-Identifier: AGPL-3.0-only

// Package mobile is the native Java binding, never a web or browser-tool API.
// It deliberately imports only the client, encrypted bundle and OAuth types.
package mobile

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"

	"github.com/openresearchtools/bashkitten/remote/bundle"
	"github.com/openresearchtools/bashkitten/remote/client"
	"github.com/openresearchtools/bashkitten/remote/oauth"
)

// TokenStore is implemented by the browser's native encrypted store. SaveToken
// must finish atomically before returning, must not log its input or call back
// into Connection, and must delete the saved token when the input is JSON null.
type TokenStore interface{ SaveToken(data []byte) error }

type Connection struct{ client *client.Client }

func decode(data []byte, value any) error {
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(value) != nil || d.Decode(new(any)) != io.EOF {
		return errors.New("invalid native connection record")
	}
	return nil
}

// Decrypt returns private enrollment bytes to the native importer only. The
// caller encrypts them in its platform store, then clears transient byte arrays.
func Decrypt(text, password string) ([]byte, error) {
	value, err := bundle.Decrypt(text, password)
	if err != nil {
		return nil, err
	}
	return json.Marshal(value)
}

// ReadImage decodes an uploaded PNG/JPEG locally. Native camera ZXing callers
// already have the TK2 text and can call Decrypt directly.
func ReadImage(data []byte) (string, error) { return bundle.ReadImage(data) }

// Open takes the actual owned Tor SOCKS endpoint, never a system/direct proxy.
// A missing saved token is nil/empty; it requires native browser authorization.
func Open(enrollment []byte, socksNetwork, socksAddress string, savedToken []byte, store TokenStore) (*Connection, error) {
	if store == nil {
		return nil, errors.New("native encrypted token store required")
	}
	var config client.Config
	if err := decode(enrollment, &config.Enrollment); err != nil {
		return nil, err
	}
	if len(savedToken) != 0 {
		if err := decode(savedToken, &config.Token); err != nil {
			return nil, err
		}
	}
	config.SOCKSNetwork, config.SOCKSAddress = socksNetwork, socksAddress
	config.Save = func(token oauth.Token) error {
		var value any
		if token != (oauth.Token{}) {
			value = token
		}
		data, err := json.Marshal(value)
		if err != nil {
			return err
		}
		defer clear(data)
		return store.SaveToken(data)
	}
	c, err := client.New(config)
	if err != nil {
		return nil, err
	}
	return &Connection{client: c}, nil
}

// BrowserIdentity supplies only the privileged Gecko enrollment call. The
// PKCS#8 bytes must never enter page script, status, logs or Android KeyChain.
func BrowserIdentity(enrollment []byte) ([]byte, error) {
	var record bundle.Bundle
	if err := decode(enrollment, &record); err != nil {
		return nil, err
	}
	tlsConfig, err := record.TLS()
	if err != nil {
		return nil, err
	}
	key, err := x509.MarshalPKCS8PrivateKey(tlsConfig.Certificates[0].PrivateKey)
	if err != nil {
		return nil, errors.New("unsupported native client key")
	}
	defer clear(key)
	root, _ := pem.Decode([]byte(record.RootCA)) // TLS validated the single root.
	fingerprint := sha256.Sum256(root.Bytes)
	return json.Marshal(struct {
		URL               string            `json:"url"`
		Identity          map[string]string `json:"identity"`
		ClientCertificate map[string][]byte `json:"clientCertificate"`
	}{"https://" + record.Onion,
		map[string]string{"caPem": record.RootCA, "caSha256": hex.EncodeToString(fingerprint[:]), "instanceId": record.ID},
		map[string][]byte{"certificate": tlsConfig.Certificates[0].Certificate[0], "pkcs8": key}})
}

func (c *Connection) BeginLogin() (string, error) { return c.client.BeginLogin(context.Background()) }
func (c *Connection) CompleteLogin(callback string) error {
	return c.client.CompleteLogin(context.Background(), callback)
}
func (c *Connection) CancelLogin() { c.client.CancelLogin() }
func (c *Connection) Authorize() (bool, error) {
	return c.client.Authorize(context.Background())
}
func (c *Connection) Map(id string, port int) (string, error) {
	value, err := c.client.Map(context.Background(), id, port)
	if err != nil {
		return "", err
	}
	data, err := json.Marshal(value)
	return string(data), err
}
func (c *Connection) Unmap(id string) { c.client.Unmap(id) }
func (c *Connection) Mappings() (string, error) {
	data, err := json.Marshal(c.client.Mappings())
	return string(data), err
}
func (c *Connection) Close()        { c.client.Close() }
func (c *Connection) Logout() error { return c.client.Logout(context.Background()) }
