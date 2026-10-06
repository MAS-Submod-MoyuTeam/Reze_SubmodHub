package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type FlarumGroup struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type FlarumProfile struct {
	ID          string        `json:"flarum_user_id"`
	Username    string        `json:"username"`
	DisplayName string        `json:"display_name"`
	AvatarURL   string        `json:"avatar_url"`
	Groups      []FlarumGroup `json:"groups"`
}

type FlarumClient struct {
	base *url.URL
	http *http.Client
}

func NewFlarumClient(rawURL string, client *http.Client) (*FlarumClient, error) {
	base, err := url.Parse(strings.TrimRight(rawURL, "/"))
	if err != nil || base == nil || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return nil, errors.New("invalid Flarum URL")
	}
	host := base.Hostname()
	if base.Scheme != "https" && !(base.Scheme == "http" && (host == "localhost" || net.ParseIP(host) != nil && net.ParseIP(host).IsLoopback())) {
		return nil, errors.New("Flarum URL must use HTTPS")
	}
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	configured := *client
	configured.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	if configured.Timeout == 0 {
		configured.Timeout = 10 * time.Second
	}
	return &FlarumClient{base: base, http: &configured}, nil
}

func (c *FlarumClient) request(ctx context.Context, method, endpoint string, body []byte, token string, target any) error {
	uri := *c.base
	uri.Path = strings.TrimRight(c.base.Path, "/") + endpoint
	request, err := http.NewRequestWithContext(ctx, method, uri.String(), bytes.NewReader(body))
	if err != nil {
		return errors.New("Flarum request failed")
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		request.Header.Set("Authorization", "Token "+token)
	}
	response, err := c.http.Do(request)
	if err != nil {
		return errors.New("Flarum request failed")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("Flarum returned HTTP %d", response.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(target); err != nil {
		return errors.New("invalid Flarum response")
	}
	return nil
}

func (c *FlarumClient) Login(ctx context.Context, identification, password string) (FlarumProfile, error) {
	var tokenResponse struct {
		Token  string      `json:"token"`
		UserID json.Number `json:"userId"`
	}
	body, err := json.Marshal(map[string]string{"identification": identification, "password": password})
	if err != nil {
		return FlarumProfile{}, errors.New("invalid credentials")
	}
	if err := c.request(ctx, http.MethodPost, "/api/token", body, "", &tokenResponse); err != nil {
		return FlarumProfile{}, err
	}
	if tokenResponse.Token == "" || tokenResponse.UserID == "" {
		return FlarumProfile{}, errors.New("invalid Flarum token response")
	}
	var response struct {
		Data struct {
			ID         string `json:"id"`
			Attributes struct {
				Username    string `json:"username"`
				DisplayName string `json:"displayName"`
				AvatarURL   string `json:"avatarUrl"`
			} `json:"attributes"`
			Relationships struct {
				Groups struct {
					Data []struct {
						ID         string `json:"id"`
						Attributes struct {
							NameSingular string `json:"nameSingular"`
							Name         string `json:"name"`
						} `json:"attributes"`
					} `json:"data"`
				} `json:"groups"`
			} `json:"relationships"`
		} `json:"data"`
		Included []struct {
			Type       string `json:"type"`
			ID         string `json:"id"`
			Attributes struct {
				NameSingular string `json:"nameSingular"`
				Name         string `json:"name"`
			} `json:"attributes"`
		} `json:"included"`
	}
	userID := tokenResponse.UserID.String()
	if strings.ContainsAny(userID, "/\\?&#") {
		return FlarumProfile{}, errors.New("invalid Flarum user ID")
	}
	if err := c.request(ctx, http.MethodGet, "/api/users/"+url.PathEscape(userID), nil, tokenResponse.Token, &response); err != nil {
		return FlarumProfile{}, err
	}
	if response.Data.ID != userID || response.Data.Attributes.Username == "" {
		return FlarumProfile{}, errors.New("invalid Flarum profile")
	}
	profile := FlarumProfile{ID: userID, Username: response.Data.Attributes.Username, DisplayName: response.Data.Attributes.DisplayName, AvatarURL: response.Data.Attributes.AvatarURL, Groups: []FlarumGroup{}}
	for _, group := range response.Data.Relationships.Groups.Data {
		name := group.Attributes.NameSingular
		if name == "" {
			name = group.Attributes.Name
		}
		if name == "" {
			for _, included := range response.Included {
				if included.Type == "groups" && included.ID == group.ID {
					name = included.Attributes.NameSingular
					if name == "" {
						name = included.Attributes.Name
					}
					break
				}
			}
		}
		profile.Groups = append(profile.Groups, FlarumGroup{ID: group.ID, Name: name})
	}
	return profile, nil
}
