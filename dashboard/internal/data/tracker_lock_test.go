package data

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAcquireTrackerLockRecoversDeadOwner(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
	_, trackerPath := writeTracker(t, insertedColumnTracker)
	lockDir, err := trackerLockDirFor(trackerPath)
	if err != nil {
		t.Fatalf("trackerLockDirFor: %v", err)
	}
	if err := os.Mkdir(lockDir, 0o755); err != nil {
		t.Fatalf("create stale lock: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(lockDir) })

	staleOwner := trackerLockOwner{
		PID:       999999999,
		Token:     "dead-owner",
		StartedAt: time.Now().Add(-time.Hour).UTC().Format(time.RFC3339Nano),
		Tracker:   trackerPath,
	}
	writeTrackerLockOwnerForTest(t, lockDir, staleOwner)

	lock, err := acquireTrackerLock(trackerPath, trackerLockOptions{
		timeout: time.Second,
		retry:   5 * time.Millisecond,
		stale:   time.Hour,
	})
	if err != nil {
		t.Fatalf("recover stale lock: %v", err)
	}
	if lock.token == staleOwner.Token {
		t.Fatal("recovered lock reused the dead owner's token")
	}
	lock.release()
	if _, err := os.Stat(lockDir); !os.IsNotExist(err) {
		t.Fatalf("released recovered lock still exists: %v", err)
	}
}

func TestTrackerLockReleaseDoesNotRemoveReplacementOwner(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
	_, trackerPath := writeTracker(t, insertedColumnTracker)
	lock, err := acquireTrackerLock(trackerPath, trackerLockOptions{
		timeout: time.Second,
		retry:   5 * time.Millisecond,
		stale:   time.Minute,
	})
	if err != nil {
		t.Fatalf("acquire lock: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(lock.dir) })

	replacement := trackerLockOwner{
		PID:       os.Getpid(),
		Token:     "replacement-owner",
		StartedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Tracker:   trackerPath,
	}
	writeTrackerLockOwnerForTest(t, lock.dir, replacement)
	lock.release()

	owner, err := readTrackerLockOwner(lock.dir)
	if err != nil {
		t.Fatalf("old owner removed replacement lock: %v", err)
	}
	if owner.Token != replacement.Token {
		t.Fatalf("replacement token = %q, want %q", owner.Token, replacement.Token)
	}
}

func TestTrackerLockReleaseRetriesAfterCleanupFailure(t *testing.T) {
	lockDir := filepath.Join(t.TempDir(), "tracker.lock")
	if err := os.Mkdir(lockDir, 0o755); err != nil {
		t.Fatalf("create lock: %v", err)
	}
	owner := trackerLockOwner{PID: os.Getpid(), Token: "retry-owner"}
	writeTrackerLockOwnerForTest(t, lockDir, owner)

	removeAttempts := 0
	lock := &trackerLock{
		dir:   lockDir,
		token: owner.Token,
		removeAll: func(path string) error {
			removeAttempts++
			if removeAttempts == 1 {
				if err := os.Remove(filepath.Join(path, "owner.json")); err != nil {
					return err
				}
				return errors.New("transient cleanup failure")
			}
			return os.RemoveAll(path)
		},
	}
	if err := lock.release(); err == nil {
		t.Fatal("first release unexpectedly hid the cleanup failure")
	}
	if lock.released {
		t.Fatal("failed cleanup permanently marked the lock released")
	}
	if _, err := os.Stat(lockDir); err != nil {
		t.Fatalf("lock disappeared after failed cleanup: %v", err)
	}
	if _, err := os.Stat(filepath.Join(lockDir, "owner.json")); !os.IsNotExist(err) {
		t.Fatalf("first cleanup did not model a removed owner file: %v", err)
	}
	if err := lock.release(); err != nil {
		t.Fatalf("retry release: %v", err)
	}
	if !lock.released || removeAttempts != 2 {
		t.Fatalf("release retry state = released:%v attempts:%d", lock.released, removeAttempts)
	}
	if _, err := os.Stat(lockDir); !os.IsNotExist(err) {
		t.Fatalf("lock remains after successful retry: %v", err)
	}
}

func TestTrackerLockReleaseDoesNotRemoveReplacementAfterCleanupFailure(t *testing.T) {
	lockDir := filepath.Join(t.TempDir(), "tracker.lock")
	if err := os.Mkdir(lockDir, 0o755); err != nil {
		t.Fatalf("create lock: %v", err)
	}
	owner := trackerLockOwner{PID: os.Getpid(), Token: "original-owner"}
	writeTrackerLockOwnerForTest(t, lockDir, owner)

	removeAttempts := 0
	lock := &trackerLock{
		dir:   lockDir,
		token: owner.Token,
		removeAll: func(path string) error {
			removeAttempts++
			if err := os.Remove(filepath.Join(path, "owner.json")); err != nil {
				return err
			}
			return errors.New("transient cleanup failure")
		},
	}
	if err := lock.release(); err == nil {
		t.Fatal("first release unexpectedly hid the cleanup failure")
	}
	if err := os.RemoveAll(lockDir); err != nil {
		t.Fatalf("remove partial original lock: %v", err)
	}
	if err := os.Mkdir(lockDir, 0o755); err != nil {
		t.Fatalf("create replacement lock: %v", err)
	}
	replacement := trackerLockOwner{PID: os.Getpid(), Token: "replacement-owner"}
	writeTrackerLockOwnerForTest(t, lockDir, replacement)

	if err := lock.release(); err != nil {
		t.Fatalf("release stale handle: %v", err)
	}
	current, err := readTrackerLockOwner(lockDir)
	if err != nil {
		t.Fatalf("stale handle removed replacement lock: %v", err)
	}
	if current.Token != replacement.Token || removeAttempts != 1 {
		t.Fatalf("replacement token = %q, attempts = %d", current.Token, removeAttempts)
	}
}

func writeTrackerLockOwnerForTest(t *testing.T, lockDir string, owner trackerLockOwner) {
	t.Helper()
	content, err := json.Marshal(owner)
	if err != nil {
		t.Fatalf("marshal owner: %v", err)
	}
	if err := os.WriteFile(filepath.Join(lockDir, "owner.json"), content, 0o644); err != nil {
		t.Fatalf("write owner: %v", err)
	}
}
