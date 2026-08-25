//go:build windows

package data

import (
	"errors"

	"golang.org/x/sys/windows"
)

func getProcessStatus(pid int) processStatus {
	if pid <= 0 || uint64(pid) > uint64(^uint32(0)) {
		return processDead
	}
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		if errors.Is(err, windows.ERROR_ACCESS_DENIED) {
			return processAlive
		}
		if errors.Is(err, windows.ERROR_INVALID_PARAMETER) {
			return processDead
		}
		return processUnknown
	}
	_ = windows.CloseHandle(handle)
	return processAlive
}
