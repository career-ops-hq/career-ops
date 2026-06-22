//go:build !windows && !darwin && !linux

package main

import (
	"fmt"
	"runtime"
)

func openWithDefaultApp(target string) error {
	return fmt.Errorf("opening URLs is not supported on %s", runtime.GOOS)
}
