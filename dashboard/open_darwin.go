//go:build darwin

package main

func openWithDefaultApp(target string) error {
	return runOpenCommand("open", target)
}
