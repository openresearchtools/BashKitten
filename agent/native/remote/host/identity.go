//go:build !bashkitten_client

// Copyright 2026 The Torkitten Authors (Apache-2.0).
// BashKitten adaptations: SPDX-License-Identifier: AGPL-3.0-only

package host

import (
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base32"
	"encoding/hex"
	"encoding/pem"
	"math/big"
	"time"

	"github.com/jpillora/chisel/share/ccrypto"
	"golang.org/x/crypto/ssh"
)

// EnrollmentKeys is private host setup material, never a status response or
// plaintext export. Caddy generates the separate server CA in its native store.
// This follows v2's key types without its Linux openssl/ssh-keygen assumptions.
type EnrollmentKeys struct {
	ID          string `json:"id"`
	TorPublic   string `json:"tor_public"`
	TorPrivate  string `json:"tor_private,omitempty"`
	Certificate string `json:"certificate"`
	PrivateKey  string `json:"private_key,omitempty"`
	HostKey     string `json:"host_key"`
	OIDCKey     string `json:"oidc_key"`
	Fingerprint string `json:"fingerprint"`
}

func NewEnrollmentKeys() (*EnrollmentKeys, error) {
	id := make([]byte, 24)
	if _, err := rand.Read(id); err != nil {
		return nil, err
	}
	keys := &EnrollmentKeys{ID: hex.EncodeToString(id)}
	tor, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	enc := base32.StdEncoding.WithPadding(base32.NoPadding)
	rawTor := tor.Bytes()
	keys.TorPrivate, keys.TorPublic = enc.EncodeToString(rawTor), enc.EncodeToString(tor.PublicKey().Bytes())
	clear(rawTor)
	client, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	leaf := &x509.Certificate{SerialNumber: new(big.Int).SetBytes(id),
		Subject: pkix.Name{CommonName: keys.ID}, NotBefore: now.Add(-time.Minute), NotAfter: now.AddDate(1, 0, 0),
		BasicConstraintsValid: true, KeyUsage: x509.KeyUsageDigitalSignature,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}
	cert, err := x509.CreateCertificate(rand.Reader, leaf, leaf, &client.PublicKey, client)
	if err != nil {
		return nil, err
	}
	keys.Certificate = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert}))
	private, err := x509.MarshalPKCS8PrivateKey(client)
	if err != nil {
		return nil, err
	}
	keys.PrivateKey = string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: private}))
	clear(private)
	_, host, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	defer clear(host)
	signer, err := ssh.NewSignerFromKey(host)
	if err != nil {
		return nil, err
	}
	block, err := ssh.MarshalPrivateKey(host, "BashKitten Chisel")
	if err != nil {
		return nil, err
	}
	keys.HostKey = string(pem.EncodeToMemory(block))
	clear(block.Bytes)
	keys.Fingerprint = ccrypto.FingerprintKey(signer.PublicKey())
	oidc, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		return nil, err
	}
	private, err = x509.MarshalPKCS8PrivateKey(oidc)
	if err != nil {
		return nil, err
	}
	keys.OIDCKey = string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: private}))
	clear(private)
	return keys, nil
}
