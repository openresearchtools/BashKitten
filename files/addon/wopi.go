// Adapted from Quantum fd64a47 backend/internal/web/wopi.go (Apache-2.0).
// Native protocol dispatch is retained; file/user globals become the private
// BashKitten owner callback. See UPSTREAM.md for the exact extraction boundary.
package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type wopiRequest struct {
	claims   *wopiClaims
	metadata fileMetadata
	canWrite bool
}
type wopiHandlerFunc func(http.ResponseWriter, *http.Request, *wopiRequest) int

func withWopiToken(fn wopiHandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if status := serveWopi(w, r, fn); status != 0 {
			w.WriteHeader(status)
		}
	}
}
func serveWopi(w http.ResponseWriter, r *http.Request, fn wopiHandlerFunc) int {
	return serveAuthorized(w, r, fn, true)
}

// Native preset downloads use DocumentBroker::sendHttpSyncRequest, which does
// not sign WOPI proofs. These read-only settings/extension endpoints still require the scoped,
// expiring participant token and live backend grant, and expose fixed settings/plugin artifacts only.
func withSettingsToken(fn wopiHandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if status := serveAuthorized(w, r, fn, false); status != 0 {
			w.WriteHeader(status)
		}
	}
}
func serveAuthorized(w http.ResponseWriter, r *http.Request, fn wopiHandlerFunc, requireProof bool) int {
	c, err := parseWopiToken(r.URL.Query().Get("access_token"), r.PathValue("id"))
	if err != nil {
		return 401
	}
	if c.EnvironmentID != config.EnvironmentID {
		return 401
	}
	if config.RequireProof && requireProof {
		discovery.mu.Lock()
		keys := discovery.proof
		discovery.mu.Unlock()
		if !verifyProof(r, config.WopiURL, keys) {
			return 401
		}
	}
	var metadata fileMetadata
	if err = ownerJSON(r.Context(), "metadata", c, nil, &metadata); err != nil {
		if r.Pattern == "POST /wopi/files/{id}" && r.Header.Get("X-WOPI-Override") == "UNLOCK" {
			return releaseNativeLock(w, r, c)
		}
		return errorStatus(err)
	}
	if c.Generation != metadata.Generation {
		if r.Pattern == "POST /wopi/files/{id}" && r.Header.Get("X-WOPI-Override") == "UNLOCK" {
			return releaseNativeLock(w, r, c)
		}
		return 409
	}
	return fn(w, r, &wopiRequest{c, metadata, c.Write && metadata.Permissions.Write && c.Snapshot == ""})
}

// A revoked participant cannot read, save, refresh a lock or finalize snapshots.
// The native broker may still release its exact lock when its last view closes.
// JWT scope/expiry and native RSA proof were already checked above; matching the
// current opaque lock prevents this cleanup from clearing another broker's lock.
func releaseNativeLock(w http.ResponseWriter, r *http.Request, c *wopiClaims) int {
	if !c.Write || c.Snapshot != "" {
		return 401
	}
	lockID := r.Header.Get("X-WOPI-Lock")
	if lockID == "" || len(lockID) > 1024 {
		return 400
	}
	unlock := documentLock(c.FileID)
	defer unlock()
	if ok, current := wopiLocks.unlock(c.FileID, lockID); !ok {
		w.Header().Set("X-WOPI-Lock", current)
		return 409
	}
	return 200
}
func wopiCheckFileInfoHandler(w http.ResponseWriter, r *http.Request, req *wopiRequest) int {
	m := req.metadata
	properties := map[string]any{"BaseFileName": m.Name, "BreadcrumbDocName": m.Name, "Size": m.Size, "Version": m.Version, "LastModifiedTime": m.LastModified, "OwnerId": config.EnvironmentID, "UserId": m.ParticipantID, "UserFriendlyName": m.ParticipantName, "UserCanWrite": req.canWrite, "ReadOnly": !req.canWrite, "UserCanNotWriteRelative": !m.Permissions.Create || !req.canWrite, "UserCanRename": m.Permissions.Rename && req.canWrite, "SupportsLocks": true, "SupportsGetLock": true, "SupportsUpdate": true, "SupportsRename": m.Permissions.Rename && req.canWrite, "SupportsDeleteFile": false, "PostMessageOrigin": req.claims.Origin, "DisableExport": !m.Permissions.Export, "DisableCopy": !m.Permissions.Copy, "DisablePrint": !m.Permissions.Print, "HideExportOption": !m.Permissions.Export, "EnableOwnerTermination": false, "EnableInsertRemoteImage": false, "EnableInsertRemoteFile": false, "EnableShare": false, "EnableRemoteLinkPicker": false, "EnableRemoteAIContent": false, "DisableAISettings": true, "EnableRemoteImageInsertion": false, "EnableRemoteFileInsertion": false, "EnableRemoteFontInsertion": false, "EnableFileVersions": true}
	// Native browser settings URI/stamp is supplied by the authenticated owner.
	properties["UserSettings"] = map[string]string{"uri": strings.TrimSuffix(config.WopiURL, "/") + "/wopi/settings/" + url.PathEscape(req.claims.FileID) + "/manifest?access_token=" + url.QueryEscape(r.URL.Query().Get("access_token"))}
	jsonResponse(w, 200, properties)
	return 0
}
func wopiGetFileHandler(w http.ResponseWriter, r *http.Request, req *wopiRequest) int {
	response, err := ownerRequest(r.Context(), "read", req.claims, nil, nil)
	if err != nil {
		return 502
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return response.StatusCode
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("X-WOPI-ItemVersion", req.metadata.Version)
	if response.ContentLength >= 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(response.ContentLength, 10))
	}
	w.WriteHeader(200)
	_, _ = io.Copy(w, response.Body)
	return 0
}
func wopiFilesPostHandler(w http.ResponseWriter, r *http.Request, req *wopiRequest) int {
	fileID := req.claims.FileID
	lockID := r.Header.Get("X-WOPI-Lock")
	override := r.Header.Get("X-WOPI-Override")
	unlock := documentLock(fileID)
	defer unlock()
	conflict := func(current string) int {
		w.Header().Set("X-WOPI-Lock", current)
		w.Header().Set("X-WOPI-LockFailureReason", "a current native lock is required")
		return 409
	}
	switch override {
	case "GET_LOCK":
		w.Header().Set("X-WOPI-Lock", wopiLocks.get(fileID))
		return 200
	case "LOCK", "REFRESH_LOCK", "UNLOCK":
		if !req.canWrite && !(override == "UNLOCK" && req.claims.Write && req.claims.Snapshot == "") {
			return 401
		}
		if lockID == "" || len(lockID) > 1024 {
			return 400
		}
		var ok bool
		var current string
		switch {
		case override == "LOCK" && r.Header.Get("X-WOPI-OldLock") != "":
			ok, current = wopiLocks.unlockAndRelock(fileID, r.Header.Get("X-WOPI-OldLock"), lockID)
		case override == "LOCK":
			ok, current = wopiLocks.lock(fileID, lockID)
		case override == "REFRESH_LOCK":
			ok, current = wopiLocks.refresh(fileID, lockID)
		default:
			ok, current = wopiLocks.unlock(fileID, lockID)
		}
		if !ok {
			return conflict(current)
		}
		if override == "UNLOCK" {
			if err := ownerJSON(r.Context(), "finalize", req.claims, nil, nil); err != nil {
				return errorStatus(err)
			}
		}
		w.Header().Set("X-WOPI-ItemVersion", req.metadata.Version)
		return 200
	case "PUT_RELATIVE", "RENAME_FILE":
		if !req.canWrite {
			return 401
		}
		if override == "PUT_RELATIVE" && !req.metadata.Permissions.Create {
			return 401
		}
		if override == "RENAME_FILE" && !req.metadata.Permissions.Rename {
			return 401
		}
		if ok, current := wopiLocks.checkPut(fileID, lockID); !ok && override == "RENAME_FILE" {
			return conflict(current)
		}
		headers := http.Header{}
		for _, key := range []string{"X-WOPI-SuggestedTarget", "X-WOPI-RelativeTarget", "X-WOPI-OverwriteRelativeTarget", "X-WOPI-RequestedName", "Content-Length"} {
			if value := r.Header.Get(key); value != "" {
				headers.Set(key, value)
			}
		}
		op := "relative"
		if override == "RENAME_FILE" {
			op = "rename"
		}
		response, err := ownerRequest(r.Context(), op, req.claims, r.Body, headers)
		if err != nil {
			return 502
		}
		defer response.Body.Close()
		if response.StatusCode != 200 {
			return response.StatusCode
		}
		var result struct {
			Name       string `json:"Name"`
			DocumentID string `json:"documentId"`
			Generation uint64 `json:"generation"`
		}
		if json.NewDecoder(io.LimitReader(response.Body, 65536)).Decode(&result) != nil {
			return 502
		}
		if override == "RENAME_FILE" {
			jsonResponse(w, 200, map[string]string{"Name": result.Name})
			return 0
		}
		c := *req.claims
		c.FileID = result.DocumentID
		c.Generation = result.Generation
		c.Snapshot = ""
		token, expires, err := mintWopiToken(c, time.Now())
		if err != nil {
			return 500
		}
		src := strings.TrimSuffix(config.WopiURL, "/") + "/wopi/files/" + url.PathEscape(c.FileID)
		if err = ownerJSON(r.Context(), "issued", req.claims, map[string]any{"parentToken": r.URL.Query().Get("access_token"), "accessToken": token, "accessTokenTtl": expires.UnixMilli(), "documentId": c.FileID, "generation": c.Generation, "wopiSrc": src}, nil); err != nil {
			return errorStatus(err)
		}
		uri := src + "?access_token=" + url.QueryEscape(token) + "&access_token_ttl=" + strconv.FormatInt(expires.UnixMilli(), 10)
		jsonResponse(w, 200, map[string]string{"Name": result.Name, "Url": uri})
		return 0
	default:
		return 501
	}
}
func wopiPutFileHandler(w http.ResponseWriter, r *http.Request, req *wopiRequest) int {
	if r.Header.Get("X-WOPI-Override") != "PUT" {
		return 400
	}
	if !req.canWrite {
		return 401
	}
	unlock := documentLock(req.claims.FileID)
	defer unlock()
	if ok, current := wopiLocks.checkPut(req.claims.FileID, r.Header.Get("X-WOPI-Lock")); !ok {
		w.Header().Set("X-WOPI-Lock", current)
		w.Header().Set("X-WOPI-LockFailureReason", "native lock expired or belongs to another session")
		return 409
	}
	headers := http.Header{}
	for _, key := range []string{"X-COOL-WOPI-Timestamp", "X-COOL-WOPI-IsAutosave", "X-COOL-WOPI-IsExitSave", "X-COOL-WOPI-IsModifiedByUser", "Content-Length"} {
		if value := r.Header.Get(key); value != "" {
			headers.Set(key, value)
		}
	}
	response, err := ownerRequest(r.Context(), "write", req.claims, r.Body, headers)
	if err != nil {
		return 502
	}
	defer response.Body.Close()
	for _, key := range []string{"Content-Type", "X-WOPI-ItemVersion", "X-WOPI-Lock"} {
		if value := response.Header.Get(key); value != "" {
			w.Header().Set(key, value)
		}
	}
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, response.Body)
	return 0
}

// redactAccessToken is retained for callers that explicitly need sanitized URLs;
// the host itself never logs request URLs or headers.
func redactAccessToken(rawQuery string) string {
	parts := strings.Split(rawQuery, "&")
	for i, p := range parts {
		if strings.HasPrefix(p, "access_token=") {
			parts[i] = "access_token=REDACTED"
		}
	}
	return strings.Join(parts, "&")
}
