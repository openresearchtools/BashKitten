// Copyright 2026 The Torkitten Authors (Apache-2.0).
// BashKitten adaptations: SPDX-License-Identifier: AGPL-3.0-only

// Package bundle handles the TorKitten v2 encrypted connection format. It has
// no filesystem, account, network or credential-persistence authority.
package bundle

import (
	"bytes"
	"compress/gzip"
	"crypto/tls"
	"crypto/x509"
	"encoding/base32"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"filippo.io/age"
)

// Credential documents are bounded independently of application file transfers.
const maxDocument = 2 << 20

var identifier = regexp.MustCompile(`^[a-f0-9]{48}$`)
var onion = regexp.MustCompile(`^[a-z2-7]{56}\.onion$`)
var owner = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`)

type Bundle struct {
	Owner       string `json:"owner"`
	Version     int    `json:"version"`
	ID          string `json:"id"`
	Name        string `json:"name"`
	Onion       string `json:"onion"`
	TorPrivate  string `json:"tor_private"`
	RootCA      string `json:"root_ca"`
	Certificate string `json:"certificate"`
	PrivateKey  string `json:"private_key"`
	Fingerprint string `json:"fingerprint"`
}

// TLS validates the full enrollment and trusts only its supplied CA and client
// certificate. It never installs a system root or disables peer verification.
func (b Bundle) TLS() (*tls.Config, error) {
	if b.Version != 2 || !identifier.MatchString(b.ID) || !owner.MatchString(b.Owner) || !onion.MatchString(b.Onion) ||
		strings.TrimSpace(b.Name) == "" || !utf8.ValidString(b.Name) || strings.ContainsAny(b.Name, "\x00\r\n") {
		return nil, errors.New("invalid connection bundle")
	}
	enc := base32.StdEncoding.WithPadding(base32.NoPadding)
	key, err := enc.DecodeString(b.TorPrivate)
	defer clear(key)
	pin, pinErr := base64.StdEncoding.DecodeString(b.Fingerprint)
	if err != nil || len(key) != 32 || enc.EncodeToString(key) != b.TorPrivate || pinErr != nil || len(pin) != 32 {
		return nil, errors.New("invalid Tor credential or Chisel fingerprint")
	}
	block, rest := pem.Decode([]byte(b.RootCA))
	if block == nil || block.Type != "CERTIFICATE" || len(bytes.TrimSpace(rest)) != 0 {
		return nil, errors.New("invalid server CA")
	}
	root, err := x509.ParseCertificate(block.Bytes)
	now := time.Now()
	if err != nil || !root.IsCA || !root.BasicConstraintsValid || root.CheckSignatureFrom(root) != nil || now.Before(root.NotBefore) || now.After(root.NotAfter) {
		return nil, errors.New("invalid or expired server CA")
	}
	cert, err := tls.X509KeyPair([]byte(b.Certificate), []byte(b.PrivateKey))
	if err != nil || len(cert.Certificate) != 1 {
		return nil, errors.New("invalid client certificate and key")
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		return nil, errors.New("invalid client certificate")
	}
	clientAuth := false
	for _, usage := range leaf.ExtKeyUsage {
		clientAuth = clientAuth || usage == x509.ExtKeyUsageClientAuth
	}
	if leaf.IsCA || !clientAuth || now.Before(leaf.NotBefore) || now.After(leaf.NotAfter) {
		return nil, errors.New("expired or unsuitable client certificate")
	}
	roots := x509.NewCertPool()
	roots.AddCert(root)
	return &tls.Config{RootCAs: roots, Certificates: []tls.Certificate{cert}, ServerName: b.Onion, MinVersion: tls.VersionTLS13}, nil
}

func passwordValid(password string) bool {
	n := utf8.RuneCountInString(password)
	return utf8.ValidString(password) && n >= 12 && n <= 256
}

// Encrypt uses the same chosen password as host Authelia enrollment. The caller
// retains only the encrypted result; this package has no password store.
func Encrypt(b Bundle, password string) (string, error) {
	if !passwordValid(password) {
		return "", errors.New("use a password of 12–256 characters")
	}
	if _, err := b.TLS(); err != nil {
		return "", err
	}
	plain, err := json.Marshal(b)
	if err != nil {
		return "", err
	}
	defer clear(plain)
	if len(plain) > maxDocument {
		return "", errors.New("connection document is too large")
	}
	recipient, err := age.NewScryptRecipient(password)
	if err != nil {
		return "", err
	}
	var out bytes.Buffer
	w, err := age.Encrypt(&out, recipient)
	if err != nil {
		return "", err
	}
	z := gzip.NewWriter(w)
	if _, err = z.Write(plain); err != nil {
		return "", err
	}
	if err = z.Close(); err != nil {
		return "", err
	}
	if err = w.Close(); err != nil {
		return "", err
	}
	return "TK2:" + base64.StdEncoding.EncodeToString(out.Bytes()), nil
}

// Decrypt fully authenticates age's encrypted stream before accepting a bundle.
func Decrypt(text, password string) (Bundle, error) {
	var b Bundle
	if !passwordValid(password) || !strings.HasPrefix(text, "TK2:") || len(text) > maxDocument {
		return b, errors.New("invalid connection image or password")
	}
	data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(text, "TK2:"))
	if err != nil {
		return b, errors.New("invalid encrypted connection")
	}
	id, err := age.NewScryptIdentity(password)
	if err != nil {
		return b, err
	}
	id.SetMaxWorkFactor(18)
	r, err := age.Decrypt(bytes.NewReader(data), id)
	if err != nil {
		return b, errors.New("incorrect password or damaged connection")
	}
	compressed, err := io.ReadAll(io.LimitReader(r, maxDocument+1))
	defer clear(compressed)
	if err != nil || len(compressed) > maxDocument {
		return b, errors.New("invalid encrypted connection data")
	}
	z, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return b, errors.New("invalid connection document")
	}
	defer z.Close()
	plain, err := io.ReadAll(io.LimitReader(z, maxDocument+1))
	defer clear(plain)
	if err != nil || len(plain) > maxDocument {
		return b, errors.New("invalid connection document")
	}
	d := json.NewDecoder(bytes.NewReader(plain))
	d.DisallowUnknownFields()
	if d.Decode(&b) != nil || d.Decode(new(any)) != io.EOF {
		return Bundle{}, errors.New("invalid connection fields")
	}
	if _, err = b.TLS(); err != nil {
		return Bundle{}, err
	}
	return b, nil
}
