// BashKitten Office host boundary. Quantum protocol logic is adapted in wopi_*.go.
package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

type configuration struct {
	Socket            string `json:"socket"`
	CallbackSocket    string `json:"callbackSocket"`
	CallbackTokenFile string `json:"callbackTokenFile"`
	SigningKeyFile    string `json:"signingKeyFile"`
	CollaboraURL      string `json:"collaboraUrl"`
	WopiURL           string `json:"wopiUrl"`
	EnvironmentID     string `json:"environmentId"`
	TokenHours        int    `json:"tokenHours"`
	// WOPI writes and file requests always require native Collabora RSA proofs.
	RequireProof  bool   `json:"requireProof"`
	SigningKey    []byte `json:"-"`
	CallbackToken string `json:"-"`
}

var config configuration
var ownerClient *http.Client
var docMutexes sync.Map

func documentLock(id string) func() {
	value, _ := docMutexes.LoadOrStore(id, &sync.Mutex{})
	m := value.(*sync.Mutex)
	m.Lock()
	return m.Unlock
}
func jsonResponse(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func privateRequest(r *http.Request) bool {
	a := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	return len(a) == len(config.CallbackToken) && subtle.ConstantTimeCompare([]byte(a), []byte(config.CallbackToken)) == 1
}
func ownerRequest(ctx context.Context, op string, claims *wopiClaims, body io.Reader, headers http.Header) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://owner/v1/owner/"+op, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+config.CallbackToken)
	if claims != nil {
		raw, _ := json.Marshal(claims)
		req.Header.Set("X-BashKitten-Grant", string(raw))
	}
	for key, values := range headers {
		req.Header[key] = values
	}
	return ownerClient.Do(req)
}
func ownerJSON(ctx context.Context, op string, claims *wopiClaims, body any, result any) error {
	var reader io.Reader
	if body != nil {
		b, e := json.Marshal(body)
		if e != nil {
			return e
		}
		reader = strings.NewReader(string(b))
	}
	res, err := ownerRequest(ctx, op, claims, reader, http.Header{"Content-Type": []string{"application/json"}})
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return &hostError{res.StatusCode}
	}
	if result == nil {
		_, err = io.Copy(io.Discard, res.Body)
		return err
	}
	return json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(result)
}

type hostError struct{ status int }

func (e *hostError) Error() string { return fmt.Sprintf("file owner refused operation (%d)", e.status) }
func errorStatus(err error) int {
	var h *hostError
	if errors.As(err, &h) {
		return h.status
	}
	return http.StatusBadGateway
}

type fileMetadata struct {
	DocumentID      string `json:"documentId"`
	Name            string `json:"name"`
	Size            int64  `json:"size"`
	Version         string `json:"version"`
	LastModified    string `json:"lastModified"`
	LastWrite       string `json:"lastWrite"`
	Generation      uint64 `json:"generation"`
	ParticipantID   string `json:"participantId"`
	ParticipantName string `json:"participantName"`
	Permissions     struct {
		Write      bool `json:"write"`
		Copy       bool `json:"copy"`
		Print      bool `json:"print"`
		Export     bool `json:"export"`
		Create     bool `json:"create"`
		Rename     bool `json:"rename"`
		Extensions bool `json:"extensions"`
	} `json:"permissions"`
	SettingsURL string `json:"settingsUrl"`
}

type discoveryState struct {
	mu    sync.Mutex
	value *wopiDiscovery
	at    time.Time
	proof proofKeys
}

var discovery discoveryState

func currentDiscovery(ctx context.Context) (*wopiDiscovery, error) {
	discovery.mu.Lock()
	defer discovery.mu.Unlock()
	if discovery.value != nil && time.Since(discovery.at) < 10*time.Minute {
		return discovery.value, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", strings.TrimSuffix(config.CollaboraURL, "/")+"/hosting/discovery", nil)
	if err != nil {
		return nil, err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("discovery status %d", res.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	d, err := parseWopiDiscovery(data, config.CollaboraURL, "collabora")
	if err != nil {
		return nil, err
	}
	keys, err := parseProofKeys(data)
	if err != nil {
		return nil, err
	}
	if config.RequireProof && keys.Current == nil {
		return nil, errors.New("Collabora does not publish WOPI proof keys")
	}
	discovery.value = d
	discovery.at = time.Now()
	discovery.proof = keys
	return d, nil
}

func sessionHandler(w http.ResponseWriter, r *http.Request) {
	if !privateRequest(r) {
		w.WriteHeader(401)
		return
	}
	var input struct {
		GrantID       string `json:"grantId"`
		DocumentID    string `json:"documentId"`
		Participant   string `json:"participantId"`
		Origin        string `json:"origin"`
		EditorBaseURL string `json:"editorBaseUrl"`
		Locale        string `json:"locale"`
		Snapshot      string `json:"snapshot"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 16<<10)).Decode(&input) != nil {
		w.WriteHeader(400)
		return
	}
	origin, err := url.Parse(input.Origin)
	if err != nil || origin.Host == "" || origin.Scheme != "https" || origin.Path != "" {
		w.WriteHeader(400)
		return
	}
	c := wopiClaims{FileID: input.DocumentID, GrantID: input.GrantID, EnvironmentID: config.EnvironmentID, Participant: input.Participant, Origin: input.Origin, Snapshot: input.Snapshot}
	var metadata fileMetadata
	if err = ownerJSON(r.Context(), "metadata", &c, nil, &metadata); err != nil {
		w.WriteHeader(errorStatus(err))
		return
	}
	c.Generation = metadata.Generation
	c.Write = metadata.Permissions.Write && input.Snapshot == ""
	d, err := currentDiscovery(r.Context())
	if err != nil {
		jsonResponse(w, 503, map[string]string{"error": err.Error()})
		return
	}
	ext := strings.TrimPrefix(filepath.Ext(metadata.Name), ".")
	action, ok := d.editorURL(ext, c.Write)
	if !ok {
		w.WriteHeader(415)
		return
	}
	if _, ok = d.Actions[strings.ToLower(ext)][wopiActionEdit]; !ok {
		c.Write = false
	}
	id := c.FileID
	if c.Snapshot != "" {
		id += "~" + c.Snapshot
		c.FileID = id
	}
	src := strings.TrimSuffix(config.WopiURL, "/") + "/wopi/files/" + url.PathEscape(id)
	action, err = buildWopiEditorURL(action, src, "collabora", input.Locale)
	if err != nil {
		w.WriteHeader(502)
		return
	}
	base, err := url.Parse(input.EditorBaseURL)
	if err != nil || base.Host == "" || base.Scheme != "https" {
		w.WriteHeader(400)
		return
	}
	// Browser origin is supplied by the authenticated host route, never discovery's
	// shared server URL or a value copied from a different client's tunnel mapping.
	actionURL, _ := url.Parse(action)
	q := actionURL.Query()
	q.Set("revisionhistory", "true")
	actionURL.RawQuery = q.Encode()
	actionURL.Scheme = base.Scheme
	actionURL.Host = base.Host
	internalBase, _ := url.Parse(config.CollaboraURL)
	internalPrefix := strings.TrimSuffix(internalBase.Path, "/")
	if internalPrefix != "" {
		if !strings.HasPrefix(actionURL.Path, internalPrefix+"/") {
			jsonResponse(w, 502, map[string]string{"error": "Discovery does not match the configured native service root"})
			return
		}
		actionURL.Path = strings.TrimPrefix(actionURL.Path, internalPrefix)
	}
	actionURL.Path = strings.TrimSuffix(base.Path, "/") + actionURL.Path
	token, expires, err := mintWopiToken(c, time.Now())
	if err != nil {
		w.WriteHeader(500)
		return
	}
	ws := *base
	if ws.Scheme == "https" {
		ws.Scheme = "wss"
	} else {
		ws.Scheme = "ws"
	}
	ws.Path = strings.TrimSuffix(base.Path, "/") + "/cool/" + src + "/ws"
	ws.RawPath = strings.TrimSuffix(base.EscapedPath(), "/") + "/cool/" + url.PathEscape(src) + "/ws"
	ws.RawQuery = url.Values{"WOPISrc": []string{src}, "access_token": []string{token}}.Encode()
	mode := "view"
	if c.Write {
		mode = "edit"
	}
	jsonResponse(w, 200, map[string]any{"apiVersion": 1, "documentId": input.DocumentID, "wopiSrc": src, "accessToken": token, "accessTokenTtl": expires.UnixMilli(), "actionUrl": actionURL.String(), "editorUrl": actionURL.String(), "editorBaseUrl": base.String(), "websocketUrl": ws.String(), "mode": mode, "participantId": metadata.ParticipantID, "permissions": metadata.Permissions, "version": metadata.Version, "generation": metadata.Generation, "lastWrite": metadata.LastWrite, "launchParameters": map[string]string{"ui_defaults": "UITheme=light;SavedUIState=false;LockedUITheme=light", "wopi_setting_base_url": settingsBase()}})
}
func main() {
	filename := flag.String("config", "", "private addon config")
	flag.Parse()
	if *filename == "" {
		log.Fatal("--config is required")
	}
	data, err := os.ReadFile(*filename)
	if err != nil {
		log.Fatal(err)
	}
	config.RequireProof = true
	if err = json.Unmarshal(data, &config); err != nil {
		log.Fatal(err)
	}
	if !config.RequireProof {
		log.Fatal("Native Collabora WOPI proof verification is required")
	}
	if config.Socket == "" || config.CallbackSocket == "" || config.EnvironmentID == "" {
		log.Fatal("missing private owner configuration")
	}
	config.SigningKey, err = os.ReadFile(config.SigningKeyFile)
	if os.IsNotExist(err) {
		config.SigningKey = make([]byte, 64)
		_, err = rand.Read(config.SigningKey)
		if err == nil {
			err = os.WriteFile(config.SigningKeyFile, config.SigningKey, 0600)
		}
	}
	if err != nil || len(config.SigningKey) < 32 {
		log.Fatal("cannot load private signing key")
	}
	key, err := os.ReadFile(config.CallbackTokenFile)
	if err != nil || len(key) < 32 {
		log.Fatal("cannot load private callback credential")
	}
	config.CallbackToken = strings.TrimSpace(string(key))
	ownerClient = &http.Client{Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", config.CallbackSocket)
	}, ResponseHeaderTimeout: 120 * time.Second}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, 200, map[string]any{"apiVersion": 1, "service": "files-office"})
	})
	mux.HandleFunc("POST /v1/session", sessionHandler)
	mux.HandleFunc("GET /wopi/settings", settingsBaseHandler)
	mux.HandleFunc("GET /wopi/settings/{id}/{name}", withSettingsToken(settingsPresetHandler))
	mux.HandleFunc("GET /wopi/settings/{id}/manifest", withSettingsToken(settingsManifestHandler))
	mux.HandleFunc("GET /wopi/settings/{id}/browser", withSettingsToken(settingsBrowserHandler))
	mux.HandleFunc("GET /wopi/settings/{id}/org.bashkitten.references.zip", withSettingsToken(settingsExtensionHandler))
	mux.HandleFunc("POST /wopi/settings/upload", settingsUploadHandler)
	mux.HandleFunc("GET /wopi/files/{id}", withWopiToken(wopiCheckFileInfoHandler))
	mux.HandleFunc("POST /wopi/files/{id}", withWopiToken(wopiFilesPostHandler))
	mux.HandleFunc("GET /wopi/files/{id}/contents", withWopiToken(wopiGetFileHandler))
	mux.HandleFunc("POST /wopi/files/{id}/contents", withWopiToken(wopiPutFileHandler))
	if err = os.MkdirAll(filepath.Dir(config.Socket), 0700); err != nil {
		log.Fatal(err)
	}
	// Kernel/runtime ownership prevents a second backend; still refuse to
	// unlink a live listener or a non-socket after a child crash.
	if entry, statErr := os.Lstat(config.Socket); statErr == nil {
		if entry.Mode()&os.ModeSocket == 0 {
			log.Fatal("private Office endpoint is not a socket")
		}
		probe, dialErr := net.DialTimeout("unix", config.Socket, time.Second)
		if dialErr == nil {
			probe.Close()
			log.Fatal("private Office endpoint already has a live owner")
		}
		if !errors.Is(dialErr, syscall.ECONNREFUSED) {
			log.Fatal("cannot verify stale private Office endpoint")
		}
		if err = os.Remove(config.Socket); err != nil {
			log.Fatal(err)
		}
	} else if !os.IsNotExist(statErr) {
		log.Fatal(statErr)
	}
	listener, err := net.Listen("unix", config.Socket)
	if err != nil {
		log.Fatal(err)
	}
	defer os.Remove(config.Socket)
	if err = os.Chmod(config.Socket, 0600); err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 120 * time.Second, IdleTimeout: 180 * time.Second, MaxHeaderBytes: 64 << 10}
	log.Fatal(server.Serve(listener))
}
