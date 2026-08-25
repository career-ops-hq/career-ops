//go:build !aix && !darwin && !dragonfly && !freebsd && !linux && !netbsd && !openbsd && !solaris && !windows

package data

// Unknown platforms recover a PID-owned lock only after the age threshold.
func getProcessStatus(pid int) processStatus {
	if pid <= 0 {
		return processDead
	}
	return processUnknown
}
