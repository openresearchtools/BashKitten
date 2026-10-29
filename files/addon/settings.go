package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strings"
)

type nativePreset struct {
	Content string `json:"content"`
	Stamp   string `json:"stamp"`
}

func settingsBase() string { return strings.TrimSuffix(config.WopiURL, "/") + "/wopi/settings" }
func settingURI(r *http.Request, req *wopiRequest, name string) string {
	return settingsBase() + "/" + url.PathEscape(req.claims.FileID) + "/" + name + "?access_token=" + url.QueryEscape(r.URL.Query().Get("access_token"))
}
func contentStamp(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}
func preset(r *http.Request, req *wopiRequest, name string, update *string) (nativePreset, error) {
	for attempt := 0; attempt < 4; attempt++ {
		var current nativePreset
		if err := ownerJSON(r.Context(), "settings-preset", req.claims, map[string]any{"name": name}, &current); err != nil {
			return current, err
		}
		next := current.Content
		var err error
		if name == "documentView.xcu" {
			incoming := ""
			if update != nil {
				incoming = *update
			}
			next, err = mergedNativeXcu(current.Content, incoming)
		} else if update != nil {
			next, err = mergedViewSettings(current.Content, *update)
		} else if next == "" {
			next = "{}"
		}
		if err != nil {
			return current, &hostError{http.StatusBadRequest}
		}
		if next == current.Content {
			return current, nil
		}
		var saved nativePreset
		err = ownerJSON(r.Context(), "settings-preset", req.claims, map[string]any{"name": name, "content": next, "expectedStamp": current.Stamp}, &saved)
		if err == nil {
			return saved, nil
		}
		var host *hostError
		if !errors.As(err, &host) || host.status != http.StatusConflict {
			return current, err
		}
	}
	return nativePreset{}, &hostError{http.StatusConflict}
}
func settingsManifestHandler(w http.ResponseWriter, r *http.Request, req *wopiRequest) int {
	var browser any
	if err := ownerJSON(r.Context(), "settings", req.claims, nil, &browser); err != nil {
		return errorStatus(err)
	}
	browserBytes, err := json.Marshal(browser)
	if err != nil {
		return 502
	}
	xcu, err := preset(r, req, "documentView.xcu", nil)
	if err != nil {
		return errorStatus(err)
	}
	view, err := preset(r, req, "viewsetting.json", nil)
	if err != nil {
		return errorStatus(err)
	}
	manifest := map[string]any{
		"browsersetting": []map[string]string{{"uri": settingURI(r, req, "browser"), "stamp": contentStamp(browserBytes)}},
		"xcu":            []map[string]string{{"uri": settingURI(r, req, "documentView.xcu"), "stamp": xcu.Stamp}},
		"viewsetting":    []map[string]string{{"uri": settingURI(r, req, "viewsetting.json"), "stamp": view.Stamp}},
	}
	var extension struct {
		Available bool   `json:"available"`
		Stamp     string `json:"stamp"`
	}
	if err := ownerJSON(r.Context(), "extension-info", req.claims, nil, &extension); err != nil {
		return errorStatus(err)
	}
	if extension.Available {
		manifest["extensions"] = []map[string]string{{"uri": settingURI(r, req, "org.bashkitten.references.zip"), "stamp": extension.Stamp}}
	}
	jsonResponse(w, 200, manifest)
	return 0
}

// Native Options asks for this fixed user-config manifest using its existing
// Collabora proxy. The scoped token still binds the live document and principal.
func settingsBaseHandler(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("fileId") != "-1" || r.URL.Query().Get("type") != "userconfig" {
		w.WriteHeader(400)
		return
	}
	c, err := parseWopiToken(r.URL.Query().Get("access_token"), "")
	if err != nil {
		w.WriteHeader(401)
		return
	}
	r.SetPathValue("id", c.FileID)
	withSettingsToken(settingsManifestHandler)(w, r)
}
func settingsBrowserHandler(w http.ResponseWriter, r *http.Request, req *wopiRequest) int {
	var result any
	if err := ownerJSON(r.Context(), "settings", req.claims, nil, &result); err != nil {
		return errorStatus(err)
	}
	jsonResponse(w, 200, result)
	return 0
}
func settingsPresetHandler(w http.ResponseWriter, r *http.Request, req *wopiRequest) int {
	name := r.PathValue("name")
	if name != "documentView.xcu" && name != "viewsetting.json" {
		return 404
	}
	value, err := preset(r, req, name, nil)
	if err != nil {
		return errorStatus(err)
	}
	w.Header().Set("Content-Type", "application/json")
	if name == "documentView.xcu" {
		w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, err = io.WriteString(w, value.Content)
	if err != nil {
		return 502
	}
	return 0
}
func nativeViewSettings(data []byte) (string, error) {
	var values map[string]any
	if err := json.Unmarshal(data, &values); err != nil || values == nil {
		return "", errors.New("invalid native view settings")
	}
	allowed := map[string]bool{"zoteroAPIKey": true, "signatureCert": true, "signatureKey": true, "signatureCa": true, "zoteroAPIKeyStored": true, "signatureKeyStored": true, "presentationViewModes": true,
		"aiProviderURL": true, "aiProviderAPIKey": true, "aiProviderModel": true, "aiImageProviderAPIKey": true, "aiImageProviderURL": true, "aiImageModel": true, "aiImageSize": true, "aiRequestTimeout": true, "aiProviderAPIKeyStored": true, "aiImageProviderAPIKeyStored": true}
	for key, value := range values {
		if !allowed[key] {
			return "", errors.New("unsupported native view setting")
		}
		if key == "presentationViewModes" {
			modes, ok := value.(map[string]any)
			if !ok || len(modes) > 100 {
				return "", errors.New("invalid native presentation view modes")
			}
			for document, stored := range modes {
				entry, ok := stored.(map[string]any)
				if !ok || len(document) > 4096 || len(entry) != 2 {
					return "", errors.New("invalid native presentation view mode")
				}
				mode, ok := entry["mode"].(string)
				if !ok || (mode != "normal" && mode != "notes" && mode != "master" && mode != "multipage") {
					return "", errors.New("invalid native presentation view mode")
				}
				timestamp, ok := entry["updatedAt"].(float64)
				if !ok || timestamp < 0 || timestamp > 9007199254740991 || math.Trunc(timestamp) != timestamp {
					return "", errors.New("invalid native presentation timestamp")
				}
			}
			continue
		}
		if strings.HasSuffix(key, "Stored") {
			if _, ok := value.(bool); !ok {
				return "", errors.New("invalid native stored-secret flag")
			}
		} else if _, ok := value.(string); !ok {
			return "", errors.New("invalid native view setting value")
		}
		// Native Options always saves this companion file. Office AI remains off;
		// provider/account setup still belongs to Pi, not this editor's preferences.
		if strings.HasPrefix(key, "ai") {
			if strings.HasSuffix(key, "Stored") {
				values[key] = false
			} else {
				values[key] = ""
			}
		}
	}
	encoded, err := json.Marshal(values)
	return string(encoded), err
}
func mergedViewSettings(current, incoming string) (string, error) {
	normalized, err := nativeViewSettings([]byte(incoming))
	if err != nil {
		return "", err
	}
	stored := map[string]any{}
	if current != "" {
		current, err = nativeViewSettings([]byte(current))
		if err != nil {
			return "", err
		}
		if err = json.Unmarshal([]byte(current), &stored); err != nil {
			return "", err
		}
	}
	next := map[string]any{}
	_ = json.Unmarshal([]byte(normalized), &next)
	for key, value := range next {
		if key != "presentationViewModes" {
			stored[key] = value
			continue
		}
		modes, _ := stored[key].(map[string]any)
		if modes == nil {
			modes = map[string]any{}
		}
		for document, entry := range value.(map[string]any) {
			previous, _ := modes[document].(map[string]any)
			timestamp, _ := previous["updatedAt"].(float64)
			if entry.(map[string]any)["updatedAt"].(float64) >= timestamp {
				modes[document] = entry
			}
		}
		keys := make([]string, 0, len(modes))
		for document := range modes {
			keys = append(keys, document)
		}
		sort.Slice(keys, func(i, j int) bool {
			first, second := modes[keys[i]].(map[string]any)["updatedAt"].(float64), modes[keys[j]].(map[string]any)["updatedAt"].(float64)
			if first == second {
				return keys[i] < keys[j]
			}
			return first > second
		})
		for _, document := range keys[min(100, len(keys)):] {
			delete(modes, document)
		}
		stored[key] = modes
	}
	encoded, err := json.Marshal(stored)
	if err != nil {
		return "", err
	}
	return nativeViewSettings(encoded)
}
func settingsUploadHandler(w http.ResponseWriter, r *http.Request) {
	c, err := parseWopiToken(r.URL.Query().Get("access_token"), "")
	if err != nil {
		w.WriteHeader(401)
		return
	}
	r.SetPathValue("id", c.FileID)
	fileID := r.URL.Query().Get("fileId")
	switch fileID {
	case "/settings/userconfig/browsersetting/browsersetting.json", "/settings/userconfig/xcu/documentView.xcu", "/settings/userconfig/xcu/registrymodifications.xcu", "/settings/userconfig/viewsetting/viewsetting.json":
	default:
		w.WriteHeader(400)
		return
	}
	withWopiToken(func(w http.ResponseWriter, r *http.Request, req *wopiRequest) int {
		raw, err := io.ReadAll(io.LimitReader(r.Body, (1<<20)+1))
		if err != nil {
			return 400
		}
		if len(raw) > 1<<20 {
			return 413
		}
		if fileID == "/settings/userconfig/browsersetting/browsersetting.json" {
			var value map[string]any
			if json.Unmarshal(raw, &value) != nil || value == nil {
				return 400
			}
			var result any
			if err := ownerJSON(r.Context(), "settings", req.claims, value, &result); err != nil {
				return errorStatus(err)
			}
			jsonResponse(w, 200, result)
			return 0
		}
		name := "documentView.xcu"
		content := string(raw)
		if fileID == "/settings/userconfig/viewsetting/viewsetting.json" {
			name = "viewsetting.json"
			content, err = nativeViewSettings(raw)
			if err != nil {
				return 400
			}
		}
		value, err := preset(r, req, name, &content)
		if err != nil {
			return errorStatus(err)
		}
		jsonResponse(w, 200, map[string]string{"stamp": value.Stamp})
		return 0
	})(w, r)
}
func settingsExtensionHandler(w http.ResponseWriter, r *http.Request, req *wopiRequest) int {
	res, err := ownerRequest(r.Context(), "extension", req.claims, nil, nil)
	if err != nil {
		return errorStatus(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return res.StatusCode
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Length", res.Header.Get("Content-Length"))
	_, err = io.Copy(w, res.Body)
	if err != nil {
		return http.StatusBadGateway
	}
	return 0
}
