package data

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const trackerLockPrefix = "career-ops-merge-tracker-"

type trackerLockOptions struct {
	timeout time.Duration
	retry   time.Duration
	stale   time.Duration
}

type trackerLockOwner struct {
	PID       int    `json:"pid"`
	Token     string `json:"token"`
	StartedAt string `json:"started_at"`
	Tracker   string `json:"tracker"`
}

type trackerLock struct {
	dir           string
	token         string
	removeAll     func(string) error
	mu            sync.Mutex
	ownerVerified bool
	verifiedDir   fs.FileInfo
	released      bool
}

type processStatus uint8

const (
	processUnknown processStatus = iota
	processDead
	processAlive
)

func envMilliseconds(name string, fallback time.Duration) time.Duration {
	value, err := strconv.Atoi(os.Getenv(name))
	if err != nil || value <= 0 {
		return fallback
	}
	return time.Duration(value) * time.Millisecond
}

func defaultTrackerLockOptions() trackerLockOptions {
	return trackerLockOptions{
		timeout: envMilliseconds("CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS", 60*time.Second),
		retry:   envMilliseconds("CAREER_OPS_TRACKER_LOCK_RETRY_MS", 75*time.Millisecond),
		stale:   envMilliseconds("CAREER_OPS_TRACKER_LOCK_STALE_MS", 10*time.Minute),
	}
}

func canonicalPath(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if canonical, err := filepath.EvalSymlinks(absolute); err == nil {
		return canonical, nil
	}
	return filepath.Clean(absolute), nil
}

func pathWithin(path, parent string) bool {
	relative, err := filepath.Rel(parent, path)
	if err != nil {
		return false
	}
	return relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative))
}

// trackerLockDirFor mirrors tracker-utils.mjs exactly so Go and Node writers
// contend on the same lock directory for the same canonical tracker path.
func trackerLockDirFor(trackerPath string) (string, error) {
	canonicalTracker, err := canonicalPath(trackerPath)
	if err != nil {
		return "", err
	}
	canonicalTemp, err := canonicalPath(os.TempDir())
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(canonicalTracker))
	fallback := filepath.Join(canonicalTemp, fmt.Sprintf("%s%x.lock", trackerLockPrefix, sum[:8]))

	override := os.Getenv("CAREER_OPS_TRACKER_LOCK")
	if override == "" || !filepath.IsAbs(override) {
		return fallback, nil
	}
	candidate := filepath.Clean(override)
	canonicalParent, err := canonicalPath(filepath.Dir(candidate))
	if err != nil || !pathWithin(canonicalParent, canonicalTemp) || !strings.HasPrefix(filepath.Base(candidate), trackerLockPrefix) {
		return fallback, nil
	}
	return candidate, nil
}

func randomLockToken() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func readTrackerLockOwner(lockDir string) (trackerLockOwner, error) {
	content, err := os.ReadFile(filepath.Join(lockDir, "owner.json"))
	if err != nil {
		return trackerLockOwner{}, err
	}
	var owner trackerLockOwner
	if err := json.Unmarshal(content, &owner); err != nil {
		return trackerLockOwner{}, err
	}
	return owner, nil
}

func trackerLockCanRecover(lockDir string, stale time.Duration) bool {
	if owner, err := readTrackerLockOwner(lockDir); err == nil && owner.PID > 0 {
		switch getProcessStatus(owner.PID) {
		case processDead:
			return true
		case processAlive:
			return false
		}
	}
	info, err := os.Stat(lockDir)
	if err != nil {
		return true
	}
	return time.Since(info.ModTime()) > stale
}

func acquireTrackerLock(trackerPath string, options trackerLockOptions) (*trackerLock, error) {
	if options.timeout <= 0 || options.retry <= 0 || options.stale <= 0 {
		defaults := defaultTrackerLockOptions()
		if options.timeout <= 0 {
			options.timeout = defaults.timeout
		}
		if options.retry <= 0 {
			options.retry = defaults.retry
		}
		if options.stale <= 0 {
			options.stale = defaults.stale
		}
	}

	canonicalTracker, err := canonicalPath(trackerPath)
	if err != nil {
		return nil, err
	}
	lockDir, err := trackerLockDirFor(canonicalTracker)
	if err != nil {
		return nil, err
	}
	recoverGuard := lockDir + ".recover"
	token, err := randomLockToken()
	if err != nil {
		return nil, err
	}
	deadline := time.Now().Add(options.timeout)

	for time.Now().Before(deadline) {
		err := os.Mkdir(lockDir, 0o755)
		if err == nil {
			owner := trackerLockOwner{
				PID:       os.Getpid(),
				Token:     token,
				StartedAt: time.Now().UTC().Format(time.RFC3339Nano),
				Tracker:   canonicalTracker,
			}
			content, marshalErr := json.MarshalIndent(owner, "", "  ")
			if marshalErr == nil {
				marshalErr = os.WriteFile(filepath.Join(lockDir, "owner.json"), content, 0o644)
			}
			if marshalErr != nil {
				_ = os.RemoveAll(lockDir)
				return nil, marshalErr
			}
			return &trackerLock{dir: lockDir, token: token}, nil
		}
		if !errors.Is(err, fs.ErrExist) {
			return nil, err
		}

		guardAcquired := false
		if err := os.Mkdir(recoverGuard, 0o755); err == nil {
			guardAcquired = true
		} else if errors.Is(err, fs.ErrExist) && trackerLockCanRecover(recoverGuard, options.stale) {
			_ = os.RemoveAll(recoverGuard)
		} else if !errors.Is(err, fs.ErrExist) {
			return nil, err
		}

		if guardAcquired {
			recoverable := trackerLockCanRecover(lockDir, options.stale)
			if recoverable {
				_ = os.RemoveAll(lockDir)
			}
			_ = os.RemoveAll(recoverGuard)
			if recoverable {
				continue
			}
		}
		time.Sleep(options.retry)
	}

	return nil, fmt.Errorf("timed out waiting for tracker lock at %s", lockDir)
}

func (lock *trackerLock) release() error {
	if lock == nil {
		return nil
	}
	lock.mu.Lock()
	defer lock.mu.Unlock()
	if lock.released {
		return nil
	}
	if lock.ownerVerified {
		currentDir, err := os.Stat(lock.dir)
		if errors.Is(err, fs.ErrNotExist) {
			lock.released = true
			return nil
		}
		if err != nil {
			return fmt.Errorf("stat tracker lock: %w", err)
		}
		if lock.verifiedDir == nil || !os.SameFile(lock.verifiedDir, currentDir) {
			lock.released = true
			return nil
		}
		owner, ownerErr := readTrackerLockOwner(lock.dir)
		if ownerErr == nil && owner.Token != lock.token {
			lock.released = true
			return nil
		}
		if ownerErr != nil && !errors.Is(ownerErr, fs.ErrNotExist) {
			return fmt.Errorf("read tracker lock owner: %w", ownerErr)
		}
	} else {
		beforeRead, err := os.Stat(lock.dir)
		if errors.Is(err, fs.ErrNotExist) {
			lock.released = true
			return nil
		}
		if err != nil {
			return fmt.Errorf("stat tracker lock: %w", err)
		}
		owner, err := readTrackerLockOwner(lock.dir)
		if err != nil {
			return fmt.Errorf("read tracker lock owner: %w", err)
		}
		if owner.Token != lock.token {
			lock.released = true
			return nil
		}
		afterRead, err := os.Stat(lock.dir)
		if errors.Is(err, fs.ErrNotExist) {
			lock.released = true
			return nil
		}
		if err != nil {
			return fmt.Errorf("stat tracker lock: %w", err)
		}
		if !os.SameFile(beforeRead, afterRead) {
			lock.released = true
			return nil
		}
		lock.ownerVerified = true
		lock.verifiedDir = afterRead
	}
	removeAll := lock.removeAll
	if removeAll == nil {
		removeAll = os.RemoveAll
	}
	if err := removeAll(lock.dir); err != nil {
		return fmt.Errorf("remove tracker lock: %w", err)
	}
	lock.released = true
	return nil
}

func writeFileAtomic(filePath string, content []byte) error {
	dir := filepath.Dir(filePath)
	temp, err := os.CreateTemp(dir, "."+filepath.Base(filePath)+".*.tmp")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)

	mode := os.FileMode(0o644)
	if info, statErr := os.Stat(filePath); statErr == nil {
		mode = info.Mode().Perm()
	}
	if err := temp.Chmod(mode); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(content); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return replaceFileAtomic(tempPath, filePath)
}
