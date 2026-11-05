package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/santifer/career-ops/dashboard/internal/ui/screens"
)

// clipboardCommand is one candidate clipboard utility. The text to copy is
// always written to its stdin, never interpolated into arguments or a shell.
type clipboardCommand struct {
	name string
	args []string
}

// Seams for tests: the host OS, PATH lookup and process execution.
var (
	clipboardGOOS     = runtime.GOOS
	clipboardLookPath = exec.LookPath
	runClipboardCmd   = runClipboardProcess
)

// runClipboardProcess runs one clipboard utility with stdin as its input.
//
// wl-copy and xclip fork a child that keeps serving the clipboard after the
// command itself exits, and that child inherits stderr. With a pipe on stderr
// (CombinedOutput, or any non-*os.File writer) Wait blocks until another app
// takes the clipboard, so the result never reaches the screen. Stderr goes to
// a temporary file instead, which Wait does not drain, and stdout is
// discarded; the file is only read to explain a failure.
func runClipboardProcess(name string, args []string, stdin string) error {
	errFile, err := os.CreateTemp("", "career-ops-clipboard-*")
	if err != nil {
		return err
	}
	defer func() {
		_ = errFile.Close()
		_ = os.Remove(errFile.Name())
	}()

	cmd := exec.Command(name, args...)
	cmd.Stdin = strings.NewReader(stdin)
	cmd.Stderr = errFile
	if err := cmd.Run(); err != nil {
		if _, seekErr := errFile.Seek(0, io.SeekStart); seekErr == nil {
			if out, readErr := io.ReadAll(io.LimitReader(errFile, 4096)); readErr == nil {
				if msg := strings.TrimSpace(string(out)); msg != "" {
					return fmt.Errorf("%w: %s", err, msg)
				}
			}
		}
		return err
	}
	return nil
}

// clipboardCandidates lists the utilities to try, in order, for goos.
func clipboardCandidates(goos string) []clipboardCommand {
	switch goos {
	case "darwin":
		return []clipboardCommand{{name: "pbcopy"}}
	case "windows":
		return []clipboardCommand{{name: "clip"}}
	case "linux":
		return []clipboardCommand{
			{name: "wl-copy"},
			{name: "xclip", args: []string{"-selection", "clipboard"}},
		}
	}
	return nil
}

// copyToClipboard copies text with the first available utility for the host.
// On Linux, wl-copy is tried first and xclip is the fallback, including when
// wl-copy is installed but fails (e.g. no Wayland session).
func copyToClipboard(text string) error {
	candidates := clipboardCandidates(clipboardGOOS)
	if len(candidates) == 0 {
		return fmt.Errorf("clipboard is not supported on %s", clipboardGOOS)
	}
	var tried []string
	var lastErr error
	for _, c := range candidates {
		tried = append(tried, c.name)
		if _, err := clipboardLookPath(c.name); err != nil {
			continue
		}
		if err := runClipboardCmd(c.name, c.args, text); err != nil {
			lastErr = fmt.Errorf("%s failed: %w", c.name, err)
			continue
		}
		return nil
	}
	if lastErr != nil {
		return lastErr
	}
	return errors.New("no clipboard utility found (tried " + strings.Join(tried, ", ") + ")")
}

// copyPathCmd wraps copyToClipboard as a tea.Cmd and always reports the
// outcome back to the pipeline screen, which flashes it.
func copyPathCmd(path string) tea.Cmd {
	return func() tea.Msg {
		if err := copyToClipboard(path); err != nil {
			return screens.PipelineClipboardResultMsg{Path: path, Err: err.Error()}
		}
		return screens.PipelineClipboardResultMsg{Path: path}
	}
}
