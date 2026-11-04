package relay

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

var testSecret = []byte("private-relay-routing-secret-for-tests-only")

func ticket(role, backend, device string, expires time.Time) string {
	body, _ := json.Marshal(Claims{Version: 1, Role: role, BackendID: backend, DeviceID: device, Expires: expires.Unix()})
	encoded := base64.RawURLEncoding.EncodeToString(body)
	mac := hmac.New(sha256.New, testSecret)
	mac.Write([]byte(ticketDomain + encoded))
	return encoded + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func start(t *testing.T, config Config) (*Server, string) {
	t.Helper()
	config.Secret = testSecret
	s, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(s)
	t.Cleanup(func() { s.Close(); httpServer.Close() })
	return s, "ws" + strings.TrimPrefix(httpServer.URL, "http")
}
func dial(t *testing.T, url, role, backend, device string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, url+"/v1/"+role, &websocket.DialOptions{Subprotocols: []string{Protocol, "ticket." + ticket(role, backend, device, time.Now().Add(time.Hour))}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.CloseNow() })
	return c
}
func read(t *testing.T, c *websocket.Conn) []byte {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, data, err := c.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
func write(t *testing.T, c *websocket.Conn, data []byte) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := c.Write(ctx, websocket.MessageText, data); err != nil {
		t.Fatal(err)
	}
}
func opening(t *testing.T, backend *websocket.Conn) frame {
	t.Helper()
	var message frame
	if err := json.Unmarshal(read(t, backend), &message); err != nil {
		t.Fatal(err)
	}
	if message.Type != "open" || message.ID == "" {
		t.Fatalf("unexpected open: %+v", message)
	}
	return message
}

func TestForwardsOpaqueFramesAndIsolatesBackends(t *testing.T) {
	_, url := start(t, Config{})
	a := dial(t, url, "backend", "a", "")
	b := dial(t, url, "backend", "b", "")
	phoneA := dial(t, url, "device", "a", "phone-a")
	openA := opening(t, a)
	phoneB := dial(t, url, "device", "b", "phone-b")
	openB := opening(t, b)
	write(t, phoneA, []byte(`{"ciphertext":"opaque"}`))
	var delivered frame
	json.Unmarshal(read(t, a), &delivered)
	if delivered.ID != openA.ID || delivered.Payload != `{"ciphertext":"opaque"}` {
		t.Fatalf("wrong routing: %+v", delivered)
	}
	// A guessed connection id cannot cross the authenticated backend boundary.
	attack, _ := json.Marshal(frame{Type: "data", ID: openB.ID, Payload: "wrong backend"})
	write(t, a, attack)
	reply, _ := json.Marshal(frame{Type: "data", ID: openB.ID, Payload: "correct backend"})
	write(t, b, reply)
	if string(read(t, phoneB)) != "correct backend" {
		t.Fatal("cross-backend delivery")
	}
}

func TestRejectsMissingExpiredWrongRoleAndCrossOriginTickets(t *testing.T) {
	_, url := start(t, Config{})
	for _, test := range []struct {
		name, path, token, origin string
		status                    int
	}{
		{"missing", "backend", "", "", 401},
		{"expired", "backend", ticket("backend", "a", "", time.Now().Add(-time.Minute)), "", 401},
		{"wrong-role", "backend", ticket("device", "a", "phone", time.Now().Add(time.Hour)), "", 401},
		{"tampered", "backend", ticket("backend", "a", "", time.Now().Add(time.Hour)) + "x", "", 401},
		{"origin", "backend", ticket("backend", "a", "", time.Now().Add(time.Hour)), "https://untrusted.example", 403},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			headers := http.Header{}
			if test.origin != "" {
				headers.Set("Origin", test.origin)
			}
			c, response, err := websocket.Dial(ctx, url+"/v1/"+test.path, &websocket.DialOptions{HTTPHeader: headers, Subprotocols: []string{Protocol, "ticket." + test.token}})
			if c != nil {
				c.CloseNow()
			}
			if err == nil || response == nil || response.StatusCode != test.status {
				t.Fatalf("expected %d, got %v %v", test.status, response, err)
			}
		})
	}
}

func TestLimitsConnectionsAndPreservesExistingBackend(t *testing.T) {
	_, url := start(t, Config{MaxConnections: 2, MaxDevicesPerBackend: 1})
	backend := dial(t, url, "backend", "a", "")
	phone := dial(t, url, "device", "a", "phone")
	opening(t, backend)
	for _, role := range []string{"backend", "device"} {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		c, response, err := websocket.Dial(ctx, url+"/v1/"+role, &websocket.DialOptions{Subprotocols: []string{Protocol, "ticket." + ticket(role, "a", map[string]string{"device": "another"}[role], time.Now().Add(time.Hour))}})
		cancel()
		if c != nil {
			c.CloseNow()
		}
		if err == nil || response == nil || response.StatusCode != 503 {
			t.Fatalf("expected capacity refusal: %v", err)
		}
	}
	write(t, phone, []byte("still connected"))
	read(t, backend)
}

func TestBackendDisconnectAndShutdownCloseDevices(t *testing.T) {
	s, url := start(t, Config{})
	backend := dial(t, url, "backend", "a", "")
	phone := dial(t, url, "device", "a", "phone")
	opening(t, backend)
	backend.CloseNow()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if _, _, err := phone.Read(ctx); err == nil {
		t.Fatal("device survived backend disconnect")
	}
	s.Close()
	if _, _, err := backend.Read(ctx); err == nil {
		t.Fatal("backend survived shutdown")
	}
}

func TestOversizedDeviceFrameIsClosed(t *testing.T) {
	_, url := start(t, Config{MaxMessageBytes: 1024})
	backend := dial(t, url, "backend", "a", "")
	phone := dial(t, url, "device", "a", "phone")
	opening(t, backend)
	write(t, phone, []byte(strings.Repeat("x", 2048)))
	var closed frame
	json.Unmarshal(read(t, backend), &closed)
	if closed.Type != "close" {
		t.Fatalf("oversized content forwarded: %+v", closed)
	}
}

func TestQueuedReplyArrivesBeforeBackendClosesDevice(t *testing.T) {
	_, url := start(t, Config{})
	backend := dial(t, url, "backend", "a", "")
	phone := dial(t, url, "device", "a", "phone")
	opened := opening(t, backend)
	for _, message := range []frame{{Type: "data", ID: opened.ID, Payload: "encrypted auth refusal"}, {Type: "close", ID: opened.ID}} {
		encoded, _ := json.Marshal(message)
		write(t, backend, encoded)
	}
	if string(read(t, phone)) != "encrypted auth refusal" {
		t.Fatal("last reply was lost")
	}
}
