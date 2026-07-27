//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package data

import "syscall"

func getProcessStatus(pid int) processStatus {
	if pid <= 0 {
		return processDead
	}
	err := syscall.Kill(pid, 0)
	if err == nil || err == syscall.EPERM {
		return processAlive
	}
	if err == syscall.ESRCH {
		return processDead
	}
	return processUnknown
}
