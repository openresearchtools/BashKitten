// SPDX-License-Identifier: AGPL-3.0-only
package client

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
)

func (c *Client) Services(parent context.Context) ([]byte, error) {
	return c.serviceRequest(parent, http.MethodGet, "/services")
}

func (c *Client) ServiceAction(parent context.Context, id, action string) ([]byte, error) {
	if !regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`).MatchString(id) ||
		(action != "start" && action != "stop" && action != "reload") {
		return nil, errors.New("invalid service action")
	}
	return c.serviceRequest(parent, http.MethodPost, "/services/"+id+"/"+action)
}

func (c *Client) serviceRequest(parent context.Context, method, path string) ([]byte, error) {
	ctx, cancel := c.operation(parent)
	defer cancel()
	token, err := c.accessToken(ctx)
	if err != nil {
		return nil, err
	}
	r, err := http.NewRequestWithContext(ctx, method, c.config.OnionURL+path, nil)
	if err != nil {
		return nil, err
	}
	r.Header.Set("Authorization", "Bearer "+token)
	response, err := c.http.Do(r)
	if err != nil {
		return nil, errors.New("remote service request failed")
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, errors.New("remote service response interrupted")
	}
	if response.StatusCode != http.StatusOK {
		var failure struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(data, &failure) == nil && failure.Error != "" {
			return nil, errors.New(failure.Error)
		}
		return nil, fmt.Errorf("remote service request returned HTTP %d", response.StatusCode)
	}
	if !json.Valid(data) {
		return nil, errors.New("invalid remote service response")
	}
	return data, nil
}
