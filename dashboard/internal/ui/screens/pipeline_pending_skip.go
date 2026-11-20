package screens

// `x` on the Inbox tab skips the selected row, and `u` undoes the last skip
// made in this session (#5269). The screen only asks: main.go runs the
// checkout's inbox-skip.mjs, which flips the row's checkbox in
// data/pipeline.md under the pipeline lock (`- [ ]` to `- [x]`, and back with
// --undo). Its write is lib/inbox-skip.mjs, the code the web inbox's Skip runs.
//
// A skipped row leaves the Inbox, so `u` does not act on the selected row. It
// puts back the row the last successful `x` skipped, once, and the footer
// names it. There is no longer undo history than that one row.
//
// Both keys do nothing on the tracker tabs: handlePendingKey sees them only
// while the Inbox is active, and handleKey has no `x` or `u` binding.

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/santifer/career-ops/dashboard/internal/i18n"
)

// PipelineSkipMsg asks main.go to skip one Inbox row through inbox-skip.mjs,
// or with Undo to put it back.
type PipelineSkipMsg struct {
	CareerOpsPath string
	URL           string
	Undo          bool
}

// PipelineSkipDoneMsg reports how a skip or undo ended, from the script's exit
// status. main.go reloads the Inbox before passing it on.
type PipelineSkipDoneMsg struct {
	URL  string
	Undo bool
	// Unchanged: exit 3, the row's checkbox already had that state, because
	// pipeline.md changed after the Inbox read it.
	Unchanged bool
	// Unreadable: exit 4, no Pending row has this URL as its first cell. The
	// Inbox's reader accepts some rows the script does not, such as one whose
	// URL is not the first cell; for an undo, the row has left Pending.
	Unreadable bool
	// Err is any other failure; empty on success.
	Err string
}

// skipPendingRow handles `x` on the Inbox. A row that is not an http(s) URL
// is not sent: the script would refuse it.
func (m PipelineModel) skipPendingRow() (PipelineModel, tea.Cmd) {
	row, ok := m.currentPendingRow()
	if !ok {
		return m, nil
	}
	if !isWebURL(row.URL) {
		m.flash = fmt.Sprintf(i18n.Current.InboxSkipNoWebURL, row.URL)
		return m, nil
	}
	m.flash = fmt.Sprintf(i18n.Current.InboxSkipping, row.URL)
	msg := PipelineSkipMsg{CareerOpsPath: m.careerOpsPath, URL: row.URL}
	return m, func() tea.Msg { return msg }
}

// undoPendingSkip handles `u` on the Inbox: it puts back the row the last
// successful `x` of this session skipped, whichever row is selected.
func (m PipelineModel) undoPendingSkip() (PipelineModel, tea.Cmd) {
	if m.pendingLastSkip == "" {
		m.flash = i18n.Current.InboxUndoNothing
		return m, nil
	}
	m.flash = fmt.Sprintf(i18n.Current.InboxUndoing, m.pendingLastSkip)
	msg := PipelineSkipMsg{CareerOpsPath: m.careerOpsPath, URL: m.pendingLastSkip, Undo: true}
	return m, func() tea.Msg { return msg }
}

func (m PipelineModel) onSkipDone(msg PipelineSkipDoneMsg) PipelineModel {
	if !msg.Undo {
		switch {
		case msg.Err != "":
			m.flash = fmt.Sprintf(i18n.Current.InboxSkipFailed, msg.Err)
		case msg.Unchanged:
			m.flash = fmt.Sprintf(i18n.Current.InboxSkipUnchanged, msg.URL)
		case msg.Unreadable:
			m.flash = fmt.Sprintf(i18n.Current.InboxSkipUnreadable, msg.URL)
		default:
			// Only a skip this session made can be undone: a row that was
			// already checked was skipped by someone else.
			m.pendingLastSkip = msg.URL
			m.flash = fmt.Sprintf(i18n.Current.InboxSkipped, msg.URL)
		}
		return m
	}
	if msg.Err != "" {
		// The skip stays recorded, so `u` can try again.
		m.flash = fmt.Sprintf(i18n.Current.InboxUndoFailed, msg.Err)
		return m
	}
	switch {
	case msg.Unchanged:
		m.flash = fmt.Sprintf(i18n.Current.InboxUndoUnchanged, msg.URL)
	case msg.Unreadable:
		m.flash = fmt.Sprintf(i18n.Current.InboxUndoGone, msg.URL)
	default:
		m.flash = fmt.Sprintf(i18n.Current.InboxUndone, msg.URL)
		m.restorePendingCursor(msg.URL)
	}
	if m.pendingLastSkip == msg.URL {
		m.pendingLastSkip = ""
	}
	return m
}
