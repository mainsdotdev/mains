package relay

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
)

const Protocol = "mains-relay.v1"
const ticketDomain = "mains.relay.ticket.v1."

// Tickets authorize routing only. The backend separately verifies a paired
// device's credential inside the end-to-end encrypted connection.
type Claims struct {
	Version   int    `json:"v"`
	Role      string `json:"role"`
	BackendID string `json:"backendId"`
	DeviceID  string `json:"deviceId,omitempty"`
	Expires   int64  `json:"exp"`
}

var identity = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)

func verifyTicket(secret []byte, token string, now time.Time) (Claims, error) {
	var claims Claims
	if len(token) > 2048 {
		return claims, errors.New("invalid ticket")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return claims, errors.New("invalid ticket")
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return claims, errors.New("invalid ticket")
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(ticketDomain + parts[0]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return claims, errors.New("invalid ticket")
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || json.Unmarshal(body, &claims) != nil {
		return claims, errors.New("invalid ticket")
	}
	if claims.Version != 1 || !identity.MatchString(claims.BackendID) || claims.Expires <= now.Unix() || claims.Expires > now.Add(366*24*time.Hour).Unix() {
		return claims, errors.New("invalid ticket")
	}
	if claims.Role == "device" && identity.MatchString(claims.DeviceID) {
		return claims, nil
	}
	if claims.Role == "backend" && claims.DeviceID == "" {
		return claims, nil
	}
	return claims, errors.New("invalid ticket")
}
