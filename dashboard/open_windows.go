//go:build windows

package main

import "golang.org/x/sys/windows"

type shellExecuteFunc func(windows.Handle, *uint16, *uint16, *uint16, *uint16, int32) error

var shellExecute = shellExecuteFunc(windows.ShellExecute)

func openWithDefaultApp(target string) error {
	verb, err := windows.UTF16PtrFromString("open")
	if err != nil {
		return err
	}
	file, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	return shellExecute(0, verb, file, nil, nil, windows.SW_SHOWNORMAL)
}
