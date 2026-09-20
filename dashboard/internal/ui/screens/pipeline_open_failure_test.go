package screens

import (
	"strings"
	"testing"
)

// Issue 3913: a failed open must surface in the pipeline flash line, because
// stderr is invisible under the alt-screen.
func TestPipelineOpenFailedMsgSetsFlash(t *testing.T) {
	pm := newPDFTestModel(t, t.TempDir(), nil)

	failed, _ := pm.Update(PipelineOpenFailedMsg{
		Target: "https://example.com/jobs?id=1",
		Err:    "executable file not found in $PATH",
	})

	if !strings.Contains(failed.flash, "executable file not found in $PATH") {
		t.Fatalf("expected failure flash to carry the error, got %q", failed.flash)
	}
	if !strings.Contains(failed.flash, "https://example.com/jobs?id=1") {
		t.Fatalf("expected failure flash to name the target, got %q", failed.flash)
	}
}
