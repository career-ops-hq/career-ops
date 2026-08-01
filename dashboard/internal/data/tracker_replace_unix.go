//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package data

import "os"

func replaceFileAtomic(oldPath, newPath string) error {
	return os.Rename(oldPath, newPath)
}
