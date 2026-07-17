//go:build js && wasm

package tsshd

import (
	"fmt"
	"io"
	"os/exec"
	"syscall"

	"github.com/google/shlex"
)

type tsshdPty struct {
	stdin  io.WriteCloser
	stdout io.ReadCloser
}

func (p *tsshdPty) Wait() error      { return fmt.Errorf("pty unavailable in browser client") }
func (p *tsshdPty) Close() error     { return nil }
func (p *tsshdPty) GetExitCode() int { return -1 }
func (p *tsshdPty) Resize(cols, rows int) error {
	return fmt.Errorf("pty unavailable in browser client")
}

func newTsshdPty(cmd *exec.Cmd, cols, rows int) (*tsshdPty, error) {
	return nil, fmt.Errorf("pty unavailable in browser client")
}

func getSysProcAttr() *syscall.SysProcAttr { return nil }

func splitCommandLine(command string) ([]string, error) { return shlex.Split(command) }

var _ io.Closer = (*tsshdPty)(nil)
