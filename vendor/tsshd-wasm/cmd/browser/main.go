//go:build js && wasm

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall/js"
	"time"

	"github.com/trzsz/tsshd/tsshd"
)

type browserServerInfo struct {
	ServerVer  string `json:",omitempty"`
	Port       int    `json:",omitempty"`
	Mode       string `json:",omitempty"`
	Pass       string `json:",omitempty"`
	Salt       string `json:",omitempty"`
	ServerCert string `json:",omitempty"`
	ClientCert string `json:",omitempty"`
	ClientKey  string `json:",omitempty"`
	ProxyKey   string `json:",omitempty"`
	ClientID   string `json:",omitempty"`
	ServerID   string `json:",omitempty"`
	ProxyMode  string `json:",omitempty"`
	MTU        uint16 `json:",omitempty"`
}

type connectConfig struct {
	Host       string            `json:"host"`
	Cols       int               `json:"cols"`
	Rows       int               `json:"rows"`
	ServerInfo browserServerInfo `json:"serverInfo"`
}

type jsPacketConn struct {
	handle    js.Value
	packets   chan []byte
	done      chan struct{}
	closeOnce sync.Once
	errMu     sync.Mutex
	err       error
	callbacks []js.Func
}

func newJSPacketConn(_ string, address string) (tsshd.PacketConn, error) {
	bridge := js.Global().Get("__tsshdUdp")
	if bridge.Type() != js.TypeObject {
		return nil, fmt.Errorf("browser UDP bridge is unavailable")
	}
	host, portText, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("invalid tsshd address: %w", err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		return nil, fmt.Errorf("invalid tsshd port")
	}

	conn := &jsPacketConn{
		packets: make(chan []byte, 1024),
		done:    make(chan struct{}),
	}
	onPacket := js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) == 0 || args[0].Type() != js.TypeObject {
			return nil
		}
		length := args[0].Get("byteLength").Int()
		if length < 1 || length > 0xffff {
			return nil
		}
		data := make([]byte, length)
		js.CopyBytesToGo(data, args[0])
		select {
		case conn.packets <- data:
		case <-conn.done:
		default:
			// UDP is lossy. Drop on pressure and let KCP/QUIC retransmit.
		}
		return nil
	})
	onError := js.FuncOf(func(this js.Value, args []js.Value) any {
		message := "browser UDP socket failed"
		if len(args) > 0 {
			message = args[0].String()
		}
		conn.fail(fmt.Errorf("%s", message))
		return nil
	})
	conn.callbacks = []js.Func{onPacket, onError}
	opened := make(chan error, 1)
	onOpened := js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) > 0 && args[0].Type() == js.TypeString && args[0].String() != "" {
			opened <- fmt.Errorf("%s", args[0].String())
		} else {
			opened <- nil
		}
		return nil
	})
	conn.callbacks = append(conn.callbacks, onOpened)

	var recovered any
	func() {
		defer func() { recovered = recover() }()
		conn.handle = bridge.Call("open", host, port, onPacket, onError, onOpened)
	}()
	if recovered != nil || conn.handle.Type() != js.TypeObject {
		for _, callback := range conn.callbacks {
			callback.Release()
		}
		return nil, fmt.Errorf("open browser UDP socket failed: %v", recovered)
	}
	select {
	case err := <-opened:
		if err != nil {
			_ = conn.Close()
			return nil, fmt.Errorf("open browser UDP socket failed: %w", err)
		}
		return conn, nil
	case <-time.After(15 * time.Second):
		_ = conn.Close()
		return nil, fmt.Errorf("open browser UDP socket timed out")
	}
}

func (c *jsPacketConn) fail(err error) {
	c.errMu.Lock()
	if c.err == nil {
		c.err = err
	}
	c.errMu.Unlock()
	c.closeOnce.Do(func() { close(c.done) })
}

func (c *jsPacketConn) currentError() error {
	c.errMu.Lock()
	defer c.errMu.Unlock()
	if c.err != nil {
		return c.err
	}
	return io.EOF
}

func (c *jsPacketConn) Close() error {
	closed := make(chan struct{}, 1)
	onClosed := js.FuncOf(func(this js.Value, args []js.Value) any {
		closed <- struct{}{}
		return nil
	})
	if c.handle.Type() == js.TypeObject {
		func() {
			defer func() { _ = recover() }()
			c.handle.Call("close", onClosed)
		}()
	}
	c.closeOnce.Do(func() { close(c.done) })
	select {
	case <-closed:
	case <-time.After(2 * time.Second):
	}
	onClosed.Release()
	for _, callback := range c.callbacks {
		callback.Release()
	}
	c.callbacks = nil
	return nil
}

func (c *jsPacketConn) Write(data []byte) error {
	select {
	case <-c.done:
		return c.currentError()
	default:
	}
	array := js.Global().Get("Uint8Array").New(len(data))
	js.CopyBytesToJS(array, data)
	done := make(chan error, 1)
	onDone := js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) > 0 && args[0].Type() == js.TypeString && args[0].String() != "" {
			done <- fmt.Errorf("%s", args[0].String())
		} else {
			done <- nil
		}
		return nil
	})
	var recovered any
	func() {
		defer func() { recovered = recover() }()
		c.handle.Call("send", array, onDone)
	}()
	if recovered != nil {
		onDone.Release()
		return fmt.Errorf("browser UDP send failed: %v", recovered)
	}
	select {
	case err := <-done:
		onDone.Release()
		return err
	}
}

func (c *jsPacketConn) Read(buf []byte) (int, error) {
	select {
	case packet := <-c.packets:
		if len(packet) > len(buf) {
			return copy(buf, packet[:len(buf)]), nil
		}
		return copy(buf, packet), nil
	case <-c.done:
		return 0, c.currentError()
	}
}

func (c *jsPacketConn) Consume(consumeFn func([]byte) error) error {
	buf := make([]byte, 0xffff)
	for {
		n, err := c.Read(buf)
		if err != nil {
			return err
		}
		packet := append([]byte(nil), buf[:n]...)
		if err := consumeFn(packet); err != nil {
			return err
		}
	}
}

var state struct {
	sync.Mutex
	generation uint64
	client     *tsshd.SshUdpClient
	session    *tsshd.SshUdpSession
	stdin      io.WriteCloser
}

// inputPump serializes keystrokes onto stdin. Spawning a goroutine per
// tsshdSendInput call races under backpressure and reorders/drops keys on
// slow links; enqueue here is non-blocking and preserves order.
type inputPump struct {
	mu     sync.Mutex
	chunks []string
	stdin  io.WriteCloser
	wake   chan struct{}
}

func (p *inputPump) signal() {
	select {
	case p.wake <- struct{}{}:
	default:
	}
}

func (p *inputPump) enqueue(data string) {
	if data == "" {
		return
	}
	p.mu.Lock()
	p.chunks = append(p.chunks, data)
	p.mu.Unlock()
	p.signal()
}

func (p *inputPump) setStdin(stdin io.WriteCloser) {
	p.mu.Lock()
	p.stdin = stdin
	p.mu.Unlock()
	p.signal()
}

func (p *inputPump) reset(discardPending bool) {
	p.mu.Lock()
	p.stdin = nil
	if discardPending {
		p.chunks = nil
	}
	p.mu.Unlock()
}

func (p *inputPump) loop() {
	for range p.wake {
		for {
			p.mu.Lock()
			if p.stdin == nil || len(p.chunks) == 0 {
				p.mu.Unlock()
				break
			}
			data := strings.Join(p.chunks, "")
			p.chunks = p.chunks[:0]
			stdin := p.stdin
			p.mu.Unlock()
			if _, err := io.WriteString(stdin, data); err != nil {
				postError(fmt.Errorf("send tsshd input: %w", err))
				p.reset(true)
				break
			}
		}
	}
}

var inputs = &inputPump{wake: make(chan struct{}, 1)}

var callbacks []js.Func
var generationCounter atomic.Uint64

var sensitiveHex = regexp.MustCompile(`(?i)[0-9a-f]{32,}`)

func post(kind string, values ...any) {
	message := js.Global().Get("Object").New()
	message.Set("type", kind)
	for i := 0; i+1 < len(values); i += 2 {
		message.Set(values[i].(string), values[i+1])
	}
	js.Global().Call("postMessage", message)
}

func postError(err error) {
	post("error", "message", sensitiveHex.ReplaceAllString(err.Error(), "[redacted]"))
}

type outputWriter struct{ generation uint64 }

func (w outputWriter) Write(data []byte) (int, error) {
	if w.generation != generationCounter.Load() {
		return 0, io.EOF
	}
	array := js.Global().Get("Uint8Array").New(len(data))
	js.CopyBytesToJS(array, data)
	post("output", "data", array)
	return len(data), nil
}

func closeCurrent() {
	inputs.reset(true)
	state.Lock()
	stdin, session, client := state.stdin, state.session, state.client
	state.stdin, state.session, state.client = nil, nil, nil
	state.Unlock()
	if stdin != nil {
		_ = stdin.Close()
	}
	if session != nil {
		_ = session.Close()
	}
	if client != nil {
		_ = client.Close()
	}
}

func parseServerInfo(info browserServerInfo) (*tsshd.ServerInfo, error) {
	clientID, err := strconv.ParseUint(info.ClientID, 10, 64)
	if err != nil || clientID == 0 {
		return nil, fmt.Errorf("invalid client ID")
	}
	serverID, err := strconv.ParseUint(info.ServerID, 10, 64)
	if err != nil || serverID == 0 {
		return nil, fmt.Errorf("invalid server ID")
	}
	return &tsshd.ServerInfo{
		ServerVer: info.ServerVer, Port: info.Port, Mode: info.Mode,
		Pass: info.Pass, Salt: info.Salt, ServerCert: info.ServerCert,
		ClientCert: info.ClientCert, ClientKey: info.ClientKey,
		ProxyKey: info.ProxyKey, ClientID: clientID, ServerID: serverID,
		ProxyMode: info.ProxyMode, MTU: info.MTU,
	}, nil
}

func connect(configJSON string) {
	var config connectConfig
	if err := json.Unmarshal([]byte(configJSON), &config); err != nil {
		postError(fmt.Errorf("invalid connect configuration: %w", err))
		return
	}
	serverInfo, err := parseServerInfo(config.ServerInfo)
	if err != nil {
		postError(err)
		return
	}
	if config.Cols < 1 {
		config.Cols = 80
	}
	if config.Rows < 1 {
		config.Rows = 24
	}
	generation := generationCounter.Add(1)
	closeCurrent()
	post("status", "status", "connecting")

	client, err := tsshd.NewSshUdpClient(&tsshd.UdpClientOptions{
		TsshdAddr:         net.JoinHostPort(config.Host, strconv.Itoa(serverInfo.Port)),
		ServerInfo:        serverInfo,
		ConnectTimeout:    15 * time.Second,
		AliveTimeout:      10 * 24 * time.Hour,
		IntervalTime:      3 * time.Second,
		HeartbeatTimeout:  3 * time.Second,
		PacketConnFactory: newJSPacketConn,
	})
	if err != nil {
		if generation == generationCounter.Load() {
			postError(fmt.Errorf("connect to tsshd failed"))
		}
		return
	}
	// Default tsshd discards stdin while the server heartbeat is timed out.
	// On slow/lossy links that silently drops keypresses; keep them instead.
	_ = client.SetKeepPendingInput(true)
	if generation != generationCounter.Load() {
		_ = client.Close()
		return
	}
	session, err := client.NewSession()
	if err != nil {
		_ = client.Close()
		if generation == generationCounter.Load() {
			postError(fmt.Errorf("create tsshd session: %w", err))
		}
		return
	}
	if err := session.RequestPty("xterm-256color", config.Rows, config.Cols, nil); err != nil {
		_ = session.Close()
		_ = client.Close()
		if generation == generationCounter.Load() {
			postError(fmt.Errorf("request tsshd pty: %w", err))
		}
		return
	}
	stdin, err := session.StdinPipe()
	if err != nil {
		_ = session.Close()
		_ = client.Close()
		if generation == generationCounter.Load() {
			postError(fmt.Errorf("open tsshd stdin: %w", err))
		}
		return
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		_ = session.Close()
		_ = client.Close()
		if generation == generationCounter.Load() {
			postError(fmt.Errorf("open tsshd stdout: %w", err))
		}
		return
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		_ = stdin.Close()
		_ = session.Close()
		_ = client.Close()
		if generation == generationCounter.Load() {
			postError(fmt.Errorf("open tsshd stderr: %w", err))
		}
		return
	}
	_ = session.Setenv("TERM", "xterm-256color")
	if err := session.Shell(); err != nil {
		_ = stdin.Close()
		_ = session.Close()
		_ = client.Close()
		if generation == generationCounter.Load() {
			postError(fmt.Errorf("start tsshd shell: %w", err))
		}
		return
	}

	state.Lock()
	if generation != generationCounter.Load() {
		state.Unlock()
		_ = stdin.Close()
		_ = session.Close()
		_ = client.Close()
		return
	}
	state.generation, state.client, state.session, state.stdin = generation, client, session, stdin
	state.Unlock()
	inputs.setStdin(stdin)
	post("status", "status", "connected")
	go func() { _, _ = io.Copy(outputWriter{generation}, stdout) }()
	go func() { _, _ = io.Copy(outputWriter{generation}, stderr) }()
	if err := session.Wait(); err != nil && generation == generationCounter.Load() {
		postError(fmt.Errorf("tsshd session ended: %w", err))
	}
	if generation == generationCounter.Load() {
		closeCurrent()
		post("status", "status", "disconnected")
	}
}

func register(name string, fn func(this js.Value, args []js.Value) any) {
	callback := js.FuncOf(fn)
	callbacks = append(callbacks, callback)
	js.Global().Set(name, callback)
}

func main() {
	go inputs.loop()
	register("tsshdConnect", func(this js.Value, args []js.Value) any {
		if len(args) != 1 {
			postError(fmt.Errorf("missing connect configuration"))
			return nil
		}
		go connect(args[0].String())
		return nil
	})
	register("tsshdSendInput", func(this js.Value, args []js.Value) any {
		if len(args) == 0 {
			return nil
		}
		inputs.enqueue(args[0].String())
		return nil
	})
	register("tsshdResize", func(this js.Value, args []js.Value) any {
		if len(args) < 2 {
			return nil
		}
		cols, rows := args[0].Int(), args[1].Int()
		state.Lock()
		session := state.session
		state.Unlock()
		if session != nil && cols > 0 && rows > 0 {
			go func() { _ = session.WindowChange(rows, cols) }()
		}
		return nil
	})
	register("tsshdDisconnect", func(this js.Value, args []js.Value) any {
		generationCounter.Add(1)
		go func() {
			closeCurrent()
			post("status", "status", "disconnected")
		}()
		return nil
	})
	select {}
}
