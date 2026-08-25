//go:build darwin || linux

package main

import "os/exec"

var runOpenCommand = func(name string, args ...string) error {
	return exec.Command(name, args...).Run()
}
