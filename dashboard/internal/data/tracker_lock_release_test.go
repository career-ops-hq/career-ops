package data

import (
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

// A release that fails must not look like a release that worked.
//
// release() can return an error without removing the lock directory and without
// marking itself released — the last of those paths being:
//
//	if err := removeAll(lock.dir); err != nil {
//		return fmt.Errorf("remove tracker lock: %w", err)
//	}
//	lock.released = true
//
// os.RemoveAll on a directory whose owner.json still has an open handle fails
// on Windows where it succeeds on POSIX. Callers that discard the error then
// leave the lock in place, and the next waiter blocks for its entire timeout.
//
// That is how TestUpdateApplicationStatusWaitsForSharedLock fails on
// windows-latest: 10s budget, 75ms production retry — a 133x margin — so
// exhausting it means the waiter never re-acquired, not that it was slow.
//
// trackerLock.removeAll is injectable, so the one OS-specific failure can be
// simulated and the consequence pinned without a Windows machine.

func lockForTest(t *testing.T) *trackerLock {
	t.Helper()
	t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
	_, trackerPath := writeTracker(t, insertedColumnTracker)
	lock, err := acquireTrackerLock(trackerPath, trackerLockOptions{
		timeout: 2 * time.Second,
		retry:   10 * time.Millisecond,
		stale:   time.Minute,
	})
	if err != nil {
		t.Fatalf("acquire lock: %v", err)
	}
	t.Cleanup(func() {
		lock.removeAll = nil
		lock.released = false
		_ = lock.release()
	})
	return lock
}

func TestReleaseReportsAFailedRemovalAndKeepsTheLock(t *testing.T) {
	lock := lockForTest(t)
	lock.removeAll = func(string) error {
		return errors.New("ERROR_SHARING_VIOLATION (simulated)")
	}

	err := lock.release()
	if err == nil {
		t.Fatal("a failed removal must be reported, not swallowed — a caller that cannot see it leaves the lock held")
	}
	if !strings.Contains(err.Error(), "remove tracker lock") {
		t.Errorf("the error should say what step failed, got %q", err)
	}

	// The half that matters to the next waiter.
	if _, statErr := os.Stat(lock.dir); statErr != nil {
		t.Fatalf("the lock directory should still exist after a failed removal: %v", statErr)
	}
	if lock.released {
		t.Error("a lock whose removal failed must not be marked released")
	}
}

func TestAWaiterBlocksAfterAFailedRelease(t *testing.T) {
	// The consequence, end to end: this is the shape of the windows-latest
	// failure, with the budget scaled down so the test is fast.
	lock := lockForTest(t)
	lock.removeAll = func(string) error { return errors.New("simulated removal failure") }
	if err := lock.release(); err == nil {
		t.Fatal("expected the release to fail")
	}

	start := time.Now()
	_, err := acquireTrackerLock(canonicalTrackerForLockDir(t, lock), trackerLockOptions{
		timeout: 400 * time.Millisecond,
		retry:   50 * time.Millisecond,
		stale:   time.Minute,
	})
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("a waiter must not acquire a lock whose directory was never removed")
	}
	// It blocks for the WHOLE budget rather than failing fast, which is why the
	// real test reports 10.16s: the waiter is not erroring, it is waiting.
	if elapsed < 300*time.Millisecond {
		t.Errorf("expected the waiter to exhaust its budget, gave up after %v", elapsed)
	}
	t.Logf("waiter exhausted a %v budget in %v after a failed release — the 10s CI timeout, scaled",
		400*time.Millisecond, elapsed.Round(time.Millisecond))
}

func TestReleaseIsIdempotentOnceItSucceeds(t *testing.T) {
	// Guards the fix rather than the bug: now that callers check the error, a
	// second release must not invent one.
	lock := lockForTest(t)
	if err := lock.release(); err != nil {
		t.Fatalf("first release: %v", err)
	}
	if err := lock.release(); err != nil {
		t.Errorf("a second release must be a no-op, got %v", err)
	}
}

// canonicalTrackerForLockDir recovers a tracker path that hashes to the same
// lock directory as `lock`, so the waiter contends for exactly that lock.
func canonicalTrackerForLockDir(t *testing.T, lock *trackerLock) string {
	t.Helper()
	owner, err := readTrackerLockOwner(lock.dir)
	if err != nil {
		t.Fatalf("read lock owner to recover the tracker path: %v", err)
	}
	if owner.Tracker == "" {
		t.Fatal("lock owner carries no tracker path, so the waiter cannot target the same lock")
	}
	return owner.Tracker
}
