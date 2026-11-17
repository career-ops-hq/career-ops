package screens

// `e` on the Inbox tab queues the selected row for evaluation (#5269). The
// screen only asks: main.go runs `sync-batch-input.mjs --url <url>`, which
// appends that one Pending row to batch/batch-input.tsv under the same lock,
// dedupe and id allocation as a full sync. Nothing here starts an evaluation.
// The flash names batch/batch-runner.sh as the command to run, and the
// dashboard never runs it.
//
// `e` does nothing on the tracker tabs: handlePendingKey sees it only while
// the Inbox is active, and handleKey has no `e` binding.

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/i18n"
)

// PipelineQueueEvalMsg asks main.go to queue one Inbox row through
// sync-batch-input.mjs --url.
type PipelineQueueEvalMsg struct {
	CareerOpsPath string
	URL           string
}

// PipelineQueueEvalDoneMsg reports how the queue request ended, from the
// script's exit status. main.go reloads the Inbox before passing it on, so the
// row's status cell shows what batch-input.tsv now records.
type PipelineQueueEvalDoneMsg struct {
	URL string
	// Already: exit 3, the URL was in batch-input.tsv or batch-state.tsv and
	// nothing was queued. The Inbox shows no status for a URL that is only in
	// batch-state.tsv, so this is the only sign of it.
	Already bool
	// Unreadable: exit 4, the script could not read the row as an unchecked
	// Pending row. The Inbox's reader accepts some rows the script does not,
	// such as an indented row or one whose URL is not the first cell.
	Unreadable bool
	// Err is any other failure; empty on success.
	Err string
}

// queuePendingRow handles `e` on the Inbox. A row that is not an http(s) URL,
// or that the batch files already record, is not sent to the script: the
// script would refuse the first and do nothing for the second.
func (m PipelineModel) queuePendingRow() (PipelineModel, tea.Cmd) {
	row, ok := m.currentPendingRow()
	if !ok {
		return m, nil
	}
	if !isWebURL(row.URL) {
		m.flash = fmt.Sprintf(i18n.Current.InboxQueueNoWebURL, row.URL)
		return m, nil
	}
	if row.Status == data.PendingStatusFailed {
		// batch-runner.sh --retry-failed retries it; queueing again would not.
		m.flash = fmt.Sprintf(i18n.Current.InboxQueueRetryFailed, row.URL)
		return m, nil
	}
	if row.Status != data.PendingStatusNone {
		m.flash = fmt.Sprintf(i18n.Current.InboxQueueAlready, row.URL)
		return m, nil
	}
	m.flash = fmt.Sprintf(i18n.Current.InboxQueueing, row.URL)
	msg := PipelineQueueEvalMsg{CareerOpsPath: m.careerOpsPath, URL: row.URL}
	return m, func() tea.Msg { return msg }
}

func (m PipelineModel) onQueueEvalDone(msg PipelineQueueEvalDoneMsg) PipelineModel {
	switch {
	case msg.Already:
		m.flash = fmt.Sprintf(i18n.Current.InboxQueueAlready, msg.URL)
	case msg.Unreadable:
		m.flash = fmt.Sprintf(i18n.Current.InboxQueueUnreadable, msg.URL)
	case msg.Err != "":
		m.flash = fmt.Sprintf(i18n.Current.InboxQueueFailed, msg.Err)
	default:
		m.flash = fmt.Sprintf(i18n.Current.InboxQueued, msg.URL)
	}
	return m
}
