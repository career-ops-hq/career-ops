//go:build linux

package main

func openWithDefaultApp(target string) error {
	return runOpenCommand("xdg-open", target)
}
