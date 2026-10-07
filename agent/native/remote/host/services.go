//go:build !bashkitten_client

// SPDX-License-Identifier: AGPL-3.0-only
package host

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strings"

	"github.com/openresearchtools/bashkitten/remote/tunnel"
)

// Only catalogue reads and fixed actions cross into the existing private
// controller. No client-supplied path, target, command, headers or body is forwarded.
func serviceControl(authorize tunnel.AuthorizeBearer, transport *http.Transport, generation string) http.Handler {
	client := &http.Client{Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	pattern := regexp.MustCompile(`^/services/([a-z0-9][a-z0-9_-]{0,63})/(start|stop|reload)$`)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.URL.RawPath != "" || r.URL.RawQuery != "" {
			http.NotFound(w, r)
			return
		}
		path, params := "/remote-services", map[string]string{}
		if r.URL.Path != "/services" || r.Method != http.MethodGet {
			match := pattern.FindStringSubmatch(r.URL.Path)
			if r.Method != http.MethodPost || match == nil {
				http.NotFound(w, r)
				return
			}
			path, params = "/remote-service-action", map[string]string{"id": match[1], "action": match[2]}
		}
		params["generation"] = generation
		headers := r.Header.Values("Authorization")
		if len(headers) != 1 || !strings.HasPrefix(headers[0], "Bearer ") {
			http.Error(w, "unauthorized", 401)
			return
		}
		err := authorize(r.Context(), strings.TrimPrefix(headers[0], "Bearer "))
		if err != nil {
			http.Error(w, "unauthorized", 401)
			return
		}
		body, _ := json.Marshal(params)
		request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, "http://controller"+path, bytes.NewReader(body))
		if err != nil {
			http.Error(w, "invalid service action", 400)
			return
		}
		request.Header.Set("Content-Type", "application/json")
		response, err := client.Do(request)
		if err != nil {
			http.Error(w, "host service controller unavailable", 503)
			return
		}
		defer response.Body.Close()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(response.StatusCode)
		io.Copy(w, response.Body)
	})
}
