package relay

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

// Config belongs to the operator of a private relay. Secret is never a device
// credential, encryption key, or a secret shipped inside a public client.
type Config struct {
	Secret               []byte
	MaxConnections       int
	MaxDevicesPerBackend int
	MaxMessageBytes      int64
	MaxQueuedBytes       int64
	PingInterval         time.Duration
	WriteTimeout         time.Duration
}

type frame struct {
	Type     string `json:"type"`
	ID       string `json:"id"`
	DeviceID string `json:"deviceId,omitempty"`
	Payload  string `json:"payload,omitempty"`
}

type room struct {
	backend *peer
	devices map[string]*peer
}
type Server struct {
	config  Config
	mu      sync.Mutex
	rooms   map[string]*room
	peers   map[*peer]struct{}
	closing bool
}

func New(config Config) (*Server, error) {
	if len(config.Secret) < 32 {
		return nil, errors.New("relay secret must contain at least 32 bytes")
	}
	config.Secret = append([]byte(nil), config.Secret...)
	if config.MaxConnections <= 0 {
		config.MaxConnections = 128
	}
	if config.MaxDevicesPerBackend <= 0 {
		config.MaxDevicesPerBackend = 16
	}
	if config.MaxMessageBytes <= 0 {
		config.MaxMessageBytes = 6 * 1024 * 1024
	}
	if config.MaxQueuedBytes <= 0 {
		config.MaxQueuedBytes = 8 * 1024 * 1024
	}
	if config.PingInterval <= 0 {
		config.PingInterval = 25 * time.Second
	}
	if config.WriteTimeout <= 0 {
		config.WriteTimeout = 10 * time.Second
	}
	return &Server{config: config, rooms: make(map[string]*room), peers: make(map[*peer]struct{})}, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodGet && r.URL.Path == "/health" {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true,"protocol":1}`))
		return
	}
	role := ""
	if r.URL.Path == "/v1/backend" {
		role = "backend"
	}
	if r.URL.Path == "/v1/device" {
		role = "device"
	}
	if r.Method != http.MethodGet || role == "" {
		http.NotFound(w, r)
		return
	}
	// Reject URL credentials; tickets travel in a header and are never echoed.
	if r.URL.RawQuery != "" {
		http.Error(w, "Query parameters are not supported", http.StatusBadRequest)
		return
	}
	protocols := strings.Split(r.Header.Get("Sec-WebSocket-Protocol"), ",")
	token, offered := "", false
	for _, protocol := range protocols {
		protocol = strings.TrimSpace(protocol)
		if protocol == Protocol {
			offered = true
		}
		if strings.HasPrefix(protocol, "ticket.") {
			token = strings.TrimPrefix(protocol, "ticket.")
		}
	}
	claims, err := verifyTicket(s.config.Secret, token, time.Now())
	if err != nil || !offered || claims.Role != role {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	s.mu.Lock()
	available := !s.closing && len(s.peers) < s.config.MaxConnections
	current := s.rooms[claims.BackendID]
	if role == "device" {
		available = available && current != nil && len(current.devices) < s.config.MaxDevicesPerBackend
	}
	if role == "backend" {
		available = available && current == nil
	}
	s.mu.Unlock()
	if !available {
		http.Error(w, "Relay unavailable", http.StatusServiceUnavailable)
		return
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{Protocol}})
	if err != nil {
		return
	}
	conn.SetReadLimit(s.config.MaxMessageBytes)
	ctx, cancel := context.WithDeadline(r.Context(), time.Unix(claims.Expires, 0))
	p := &peer{conn: conn, ctx: ctx, cancel: cancel, queue: make(chan []byte, 16), config: s.config}
	defer p.stop()
	s.mu.Lock()
	current = s.rooms[claims.BackendID]
	if s.closing || len(s.peers) >= s.config.MaxConnections || (role == "backend" && current != nil) || (role == "device" && (current == nil || len(current.devices) >= s.config.MaxDevicesPerBackend)) {
		s.mu.Unlock()
		return
	}
	s.peers[p] = struct{}{}
	connectionID := ""
	if role == "backend" {
		current = &room{backend: p, devices: make(map[string]*peer)}
		s.rooms[claims.BackendID] = current
	} else {
		var id [16]byte
		if _, err := rand.Read(id[:]); err != nil {
			delete(s.peers, p)
			s.mu.Unlock()
			return
		}
		connectionID = hex.EncodeToString(id[:])
		current.devices[connectionID] = p
		current.backend.enqueueFrame(frame{Type: "open", ID: connectionID, DeviceID: claims.DeviceID})
	}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		delete(s.peers, p)
		if role == "backend" {
			if s.rooms[claims.BackendID] == current {
				delete(s.rooms, claims.BackendID)
			}
			for _, device := range current.devices {
				device.stop()
			}
		} else {
			delete(current.devices, connectionID)
			current.backend.enqueueFrame(frame{Type: "close", ID: connectionID})
		}
	}()
	go p.writeLoop()
	go p.pingLoop()
	for {
		kind, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		if kind != websocket.MessageText {
			return
		}
		if role == "device" {
			if !current.backend.enqueueFrame(frame{Type: "data", ID: connectionID, Payload: string(data)}) {
				return
			}
			continue
		}
		var message frame
		if json.Unmarshal(data, &message) != nil || (message.Type != "data" && message.Type != "close") || len(message.ID) > 128 {
			return
		}
		s.mu.Lock()
		device := current.devices[message.ID]
		s.mu.Unlock()
		if device == nil {
			continue
		}
		if message.Type == "close" {
			device.enqueue(nil)
		} else if !device.enqueue([]byte(message.Payload)) {
			device.stop()
		}
	}
}

// HTTP Shutdown does not close upgraded WebSockets. Close explicitly cancels
// every reader/writer/heartbeat, including clients waiting on an offline peer.
func (s *Server) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closing = true
	for p := range s.peers {
		p.stop()
	}
}

type peer struct {
	conn   *websocket.Conn
	ctx    context.Context
	cancel context.CancelFunc
	queue  chan []byte
	queued atomic.Int64
	once   sync.Once
	config Config
}

func (p *peer) stop() { p.once.Do(func() { p.cancel(); p.conn.CloseNow() }) }
func (p *peer) enqueueFrame(message frame) bool {
	data, err := json.Marshal(message)
	return err == nil && p.enqueue(data)
}
func (p *peer) enqueue(data []byte) bool {
	if int64(len(data)) > p.config.MaxMessageBytes || p.queued.Add(int64(len(data))) > p.config.MaxQueuedBytes {
		// Only Add on a size-eligible frame; the peer is discarded on overflow.
		p.stop()
		return false
	}
	select {
	case <-p.ctx.Done():
		p.queued.Add(-int64(len(data)))
		return false
	case p.queue <- data:
		return true
	default:
		p.queued.Add(-int64(len(data)))
		p.stop()
		return false
	}
}
func (p *peer) writeLoop() {
	defer p.stop()
	for {
		select {
		case <-p.ctx.Done():
			return
		case data := <-p.queue:
			if data == nil {
				return
			}
			ctx, cancel := context.WithTimeout(p.ctx, p.config.WriteTimeout)
			err := p.conn.Write(ctx, websocket.MessageText, data)
			cancel()
			p.queued.Add(-int64(len(data)))
			if err != nil {
				return
			}
		}
	}
}
func (p *peer) pingLoop() {
	ticker := time.NewTicker(p.config.PingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-p.ctx.Done():
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(p.ctx, p.config.WriteTimeout)
			err := p.conn.Ping(ctx)
			cancel()
			if err != nil {
				p.stop()
				return
			}
		}
	}
}
