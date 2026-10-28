// Adapted for BashKitten: see ../UPSTREAM.md and patches/.
package main

import (
	"encoding/xml"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

const (
	wopiProductCollabora  = "collabora"
	wopiProductOnlyOffice = "onlyoffice"
	wopiProductGeneric    = "generic"

	wopiActionView = "view"
	wopiActionEdit = "edit"

	wopiDiscoveryRefresh = 10 * time.Minute
	wopiDiscoveryTimeout = 10 * time.Second
)

// wopiNativeExtensions are formats FileBrowser displays itself. Collabora's
// discovery offers to view images and plain text too; routing those to an
// office suite would replace the native viewers, so they are never taken from
// discovery.
var wopiNativeExtensions = map[string]bool{
	"bmp": true, "gif": true, "jpeg": true, "jpg": true, "png": true,
	"svg": true, "tif": true, "tiff": true, "webp": true,
	"txt": true, "md": true, "pdf": true,
}

// wopiDiscovery is what FileBrowser keeps from an editor's /hosting/discovery
// document: for each file extension, the editor URL of each action it offers.
type wopiDiscovery struct {
	Product string
	// Actions maps a lower-case extension without dot to action name to urlsrc.
	Actions map[string]map[string]string
}

// editorURL returns the urlsrc to open ext with, preferring edit when the
// session may write, view otherwise, and whichever exists as a fallback.
func (d *wopiDiscovery) editorURL(ext string, canWrite bool) (string, bool) {
	actions, ok := d.Actions[strings.ToLower(ext)]
	if !ok {
		return "", false
	}
	order := []string{wopiActionView, wopiActionEdit}
	if canWrite {
		order = []string{wopiActionEdit, wopiActionView}
	}
	for _, name := range order {
		if src, ok := actions[name]; ok {
			return src, true
		}
	}
	return "", false
}

// extensions returns, for every extension the editor handles, whether it can
// edit it ("edit") or only display it ("view"). The SPA uses it to decide
// which files open in the WOPI editor.
func (d *wopiDiscovery) extensions() map[string]string {
	out := make(map[string]string, len(d.Actions))
	for ext, actions := range d.Actions {
		if _, ok := actions[wopiActionEdit]; ok {
			out[ext] = wopiActionEdit
		} else {
			out[ext] = wopiActionView
		}
	}
	return out
}

type discoveryXML struct {
	NetZones []struct {
		Name string `xml:"name,attr"`
		Apps []struct {
			Name    string `xml:"name,attr"`
			Actions []struct {
				Name   string `xml:"name,attr"`
				Ext    string `xml:"ext,attr"`
				Urlsrc string `xml:"urlsrc,attr"`
			} `xml:"action"`
		} `xml:"app"`
	} `xml:"net-zone"`
}

// parseWopiDiscovery reads a discovery document. Only external net zones are
// considered, and when the editor publishes both, the one matching the scheme
// of the configured editor URL wins. Only the view and edit actions are kept:
// FileBrowser does not offer the others (embedview, editnew, convert…).
func parseWopiDiscovery(data []byte, editorURL, product string) (*wopiDiscovery, error) {
	var doc discoveryXML
	if err := xml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("parse wopi discovery: %w", err)
	}
	preferredZone := "external-https"
	if strings.HasPrefix(strings.ToLower(editorURL), "http://") {
		preferredZone = "external-http"
	}
	zone := -1
	for i, z := range doc.NetZones {
		if !strings.Contains(z.Name, "external") {
			continue
		}
		if zone == -1 || z.Name == preferredZone {
			zone = i
		}
	}
	if zone == -1 {
		return nil, errors.New("wopi discovery has no external net-zone")
	}

	detected := wopiProductGeneric
	d := &wopiDiscovery{Actions: map[string]map[string]string{}}
	for _, app := range doc.NetZones[zone].Apps {
		// Collabora advertises its capabilities endpoint as a pseudo-app.
		if app.Name == "Capabilities" {
			detected = wopiProductCollabora
		}
		for _, a := range app.Actions {
			if strings.Contains(a.Urlsrc, "/hosting/wopi/") && detected == wopiProductGeneric {
				detected = wopiProductOnlyOffice
			}
			if a.Ext == "" || a.Urlsrc == "" || (a.Name != wopiActionView && a.Name != wopiActionEdit) {
				continue
			}
			ext := strings.ToLower(strings.TrimPrefix(a.Ext, "."))
			if wopiNativeExtensions[ext] {
				continue
			}
			if d.Actions[ext] == nil {
				d.Actions[ext] = map[string]string{}
			}
			if _, exists := d.Actions[ext][a.Name]; !exists {
				d.Actions[ext][a.Name] = a.Urlsrc
			}
		}
	}
	if len(d.Actions) == 0 {
		return nil, errors.New("wopi discovery declares no view or edit action")
	}
	d.Product = detected
	if product != "" {
		d.Product = product
	}
	return d, nil
}

// buildWopiEditorURL turns a discovery urlsrc into the URL the iframe loads.
// Discovery URLs carry optional placeholders such as <ui=UI_LLCC&>; rather
// than interpret them, every placeholder is dropped and the parameters
// FileBrowser needs are added explicitly.
func buildWopiEditorURL(urlsrc, wopiSrc, product, locale string) (string, error) {
	u, err := url.Parse(urlsrc)
	if err != nil {
		return "", fmt.Errorf("invalid wopi urlsrc: %w", err)
	}
	query := url.Values{}
	for _, pair := range strings.Split(u.RawQuery, "&") {
		if pair == "" || strings.ContainsAny(pair, "<>") {
			continue
		}
		key, value, _ := strings.Cut(pair, "=")
		k, errK := url.QueryUnescape(key)
		v, errV := url.QueryUnescape(value)
		if errK != nil || errV != nil || k == "" {
			continue
		}
		query.Add(k, v)
	}
	query.Set("WOPISrc", wopiSrc)
	locale = wopiLocale(locale)
	if locale != "" {
		switch product {
		case wopiProductCollabora:
			query.Set("lang", locale)
		case wopiProductOnlyOffice:
			query.Set("ui", locale)
		}
	}
	if product == wopiProductCollabora {
		// Collabora then shows its own close button, which posts UI_Close.
		query.Set("closebutton", "1")
	}
	u.RawQuery = query.Encode()
	return u.String(), nil
}

func wopiLocale(locale string) string { return strings.ReplaceAll(locale, "_", "-") }
