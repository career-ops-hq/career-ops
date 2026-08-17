//go:build linux

package main

import (
	"os"
	"os/exec"
	"strings"
)

func openWithDefaultApp(target string) error {
	// Check if running in Termux (Android)
	if isTermux() {
		return runOpenCommand("termux-open", target)
	}
	return runOpenCommand("xdg-open", target)
}

// isTermux detects if we're running in a Termux environment
func isTermux() bool {
	// Primary check: if termux-open command exists, we're likely in Termux
	if _, err := exec.LookPath("termux-open"); err == nil {
		return true
	}

	// Secondary checks for Termux environment
	// Check for Termux-specific environment variables
	if os.Getenv("TERM") != "" && strings.Contains(os.Getenv("TERM"), "xterm-termux") {
		return true
	}

	// Check for PREFIX environment variable (Termux-specific)
	if os.Getenv("PREFIX") != "" && strings.Contains(os.Getenv("PREFIX"), "/com.termux") {
		return true
	}

	return false
}
