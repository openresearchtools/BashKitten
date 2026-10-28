package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
)

func settingsManifestHandler(w http.ResponseWriter, r *http.Request, req *wopiRequest) int {
	uri := strings.TrimSuffix(config.WopiURL, "/") + "/wopi/settings/" + url.PathEscape(req.claims.FileID) + "/browser?access_token=" + url.QueryEscape(r.URL.Query().Get("access_token"))
	manifest := map[string]any{"browsersetting": []map[string]string{{"uri": uri, "stamp": "bashkitten-light-v1"}}}
	var extension struct {
		Available bool   `json:"available"`
		Stamp     string `json:"stamp"`
	}
	if err := ownerJSON(r.Context(), "extension-info", req.claims, nil, &extension); err != nil {
		return errorStatus(err)
	}
	if extension.Available {
		manifest["extensions"] = []map[string]string{{"uri": strings.TrimSuffix(config.WopiURL, "/") + "/wopi/settings/" + url.PathEscape(req.claims.FileID) + "/org.bashkitten.references.zip?access_token=" + url.QueryEscape(r.URL.Query().Get("access_token")), "stamp": extension.Stamp}}
	}
	jsonResponse(w, 200, manifest)
	return 0
}
func settingsBrowserHandler(w http.ResponseWriter, r *http.Request, req *wopiRequest) int {
	var result any
	if err := ownerJSON(r.Context(), "settings", req.claims, nil, &result); err != nil {
		return errorStatus(err)
	}
	jsonResponse(w, 200, result)
	return 0
}
func settingsUploadHandler(w http.ResponseWriter, r *http.Request) {
	c, err := parseWopiToken(r.URL.Query().Get("access_token"), "")
	if err != nil {
		w.WriteHeader(401)
		return
	}
	r.SetPathValue("id", c.FileID)
	if r.URL.Query().Get("fileId") != "/settings/userconfig/browsersetting/browsersetting.json" {
		w.WriteHeader(501)
		return
	}
	withWopiToken(func(w http.ResponseWriter, r *http.Request, req *wopiRequest) int {
		var value map[string]any
		if json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&value) != nil {
			return 400
		}
		var result any
		if err := ownerJSON(r.Context(), "settings", req.claims, value, &result); err != nil {
			return errorStatus(err)
		}
		jsonResponse(w, 200, result)
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
