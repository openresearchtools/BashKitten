// WOPI proof validation fills the documented gap in Quantum's donor connector.
// Format and key rotation follow MS-WOPI and Collabora wsd/ProofKey.cpp.
package main

import (
	"bytes"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/xml"
	"math/big"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type proofKeys struct{ Current, Old *rsa.PublicKey }

func parseProofKeys(data []byte) (proofKeys, error) {
	var d struct {
		Proof struct {
			Modulus     string `xml:"modulus,attr"`
			Exponent    string `xml:"exponent,attr"`
			OldModulus  string `xml:"oldmodulus,attr"`
			OldExponent string `xml:"oldexponent,attr"`
		} `xml:"proof-key"`
	}
	if err := xml.Unmarshal(data, &d); err != nil {
		return proofKeys{}, err
	}
	key := func(m, e string) *rsa.PublicKey {
		mod, err := base64.StdEncoding.DecodeString(m)
		if err != nil || len(mod) < 256 {
			return nil
		}
		exp, err := base64.StdEncoding.DecodeString(e)
		if err != nil || len(exp) > 4 {
			return nil
		}
		n := 0
		for _, b := range exp {
			n = n<<8 + int(b)
		}
		if n < 3 {
			return nil
		}
		return &rsa.PublicKey{N: new(big.Int).SetBytes(mod), E: n}
	}
	return proofKeys{key(d.Proof.Modulus, d.Proof.Exponent), key(d.Proof.OldModulus, d.Proof.OldExponent)}, nil
}
func verifyProof(r *http.Request, base string, keys proofKeys) bool {
	timestamp, err := strconv.ParseInt(r.Header.Get("X-WOPI-TimeStamp"), 10, 64)
	if err != nil {
		return false
	}
	// .NET ticks since 0001-01-01, bounded to WOPI's twenty-minute replay window.
	now := time.Now().Unix()*10000000 + 621355968000000000
	delta := now - timestamp
	if delta < 0 {
		delta = -delta
	}
	if delta > 20*60*10000000 {
		return false
	}
	b, err := url.Parse(base)
	if err != nil {
		return false
	}
	b.Path = strings.TrimSuffix(b.Path, "/") + r.URL.Path
	b.RawPath = ""
	b.RawQuery = r.URL.RawQuery
	token := []byte(r.URL.Query().Get("access_token"))
	uri := []byte(strings.ToUpper(b.String()))
	var data bytes.Buffer
	_ = binary.Write(&data, binary.BigEndian, uint32(len(token)))
	data.Write(token)
	_ = binary.Write(&data, binary.BigEndian, uint32(len(uri)))
	data.Write(uri)
	_ = binary.Write(&data, binary.BigEndian, uint32(8))
	_ = binary.Write(&data, binary.BigEndian, timestamp)
	sum := sha256.Sum256(data.Bytes())
	valid := func(k *rsa.PublicKey, header string) bool {
		if k == nil {
			return false
		}
		sig, e := base64.StdEncoding.DecodeString(header)
		return e == nil && rsa.VerifyPKCS1v15(k, crypto.SHA256, sum[:], sig) == nil
	}
	return valid(keys.Current, r.Header.Get("X-WOPI-Proof")) || valid(keys.Current, r.Header.Get("X-WOPI-ProofOld")) || valid(keys.Old, r.Header.Get("X-WOPI-Proof"))
}
