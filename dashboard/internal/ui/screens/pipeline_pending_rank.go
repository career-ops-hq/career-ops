package screens

// `a` on the Inbox tab ranks the selected row, and `A` ranks every unranked
// row up to the ranker's usual limit (#5269). Ranking calls the agent CLI and
// spends tokens, so neither key starts anything on its own: the footer says
// how many rows it will rank and that it uses the CLI and tokens, and only a
// lowercase `y` starts it. Any other key, `Y` included, cancels. The question
// fits an 80-column footer in every language, so its controls are never cut.
//
// The screen only asks: main.go runs the checkout's rank-pipeline.mjs, with
// --url for one row or --limit for the count it named, and the script writes
// the `rank:` cell into data/pipeline.md under the pipeline lock. The model is
// asked for one answer, with tools off where the CLI allows. When the run ends, main.go reloads the
// Inbox, so the new scores show, and the footer says what changed.
//
// Both keys do nothing on the tracker tabs: handlePendingKey sees them only
// while the Inbox is active.

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/i18n"
)

// pendingRankLimit is the most rows `A` ranks in one run: rank-pipeline.mjs's
// default --limit. The dashboard passes it as --limit, so the run never ranks
// more rows than the prompt named.
const pendingRankLimit = 20

// pendingRankRequest is a rank the footer is asking about, or one that runs.
type pendingRankRequest struct {
	// URL is the row `a` asked about; empty for `A`.
	URL string
	// Count is the number of rows the prompt names.
	Count int
	// Unranked is how many Inbox rows had no rank when `A` was pressed; more
	// than Count means the question offers the next Count of them.
	Unranked int
}

// PipelineRankMsg asks main.go to rank Inbox rows through rank-pipeline.mjs:
// the row with URL, or with URL empty, up to Limit unranked rows.
type PipelineRankMsg struct {
	CareerOpsPath string
	URL           string
	Limit         int
}

// PipelineRankDoneMsg reports how a rank run ended, from the script's exit
// status. main.go reloads the Inbox before passing it on.
type PipelineRankDoneMsg struct {
	URL string
	// NotPending: exit 4, no unranked Pending row has URL as its first cell,
	// because it was ranked or skipped meanwhile, or its URL is not the first
	// cell.
	NotPending bool
	// Err is any other failure; empty on success.
	Err string
}

// askRankRow handles `a`: it asks before ranking the selected row.
func (m PipelineModel) askRankRow() (PipelineModel, tea.Cmd) {
	row, ok := m.currentPendingRow()
	if !ok {
		return m, nil
	}
	if m.pendingRanking != nil {
		m.flash = i18n.Current.InboxRankBusy
		return m, nil
	}
	if row.HasRank {
		m.flash = fmt.Sprintf(i18n.Current.InboxRankAlready, row.URL)
		return m, nil
	}
	m.pendingRankAsk = &pendingRankRequest{URL: row.URL, Count: 1}
	return m, nil
}

// askRankAll handles `A`: it asks before ranking the unranked rows, up to
// pendingRankLimit of them.
func (m PipelineModel) askRankAll() (PipelineModel, tea.Cmd) {
	if m.pendingRanking != nil {
		m.flash = i18n.Current.InboxRankBusy
		return m, nil
	}
	unranked := countUnranked(m.pending)
	if unranked == 0 {
		m.flash = i18n.Current.InboxRankNone
		return m, nil
	}
	m.pendingRankAsk = &pendingRankRequest{Count: min(unranked, pendingRankLimit), Unranked: unranked}
	return m, nil
}

// handleRankConfirm answers the footer's question: `y` starts the rank, and
// any other key cancels it.
func (m PipelineModel) handleRankConfirm(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	req := m.pendingRankAsk
	m.pendingRankAsk = nil
	if msg.String() != "y" {
		m.flash = i18n.Current.InboxRankCancelled
		return m, nil
	}
	m.pendingRanking = req
	m.flash = fmt.Sprintf(i18n.Current.InboxRanking, req.Count)
	run := PipelineRankMsg{CareerOpsPath: m.careerOpsPath, URL: req.URL}
	if req.URL == "" {
		run.Limit = req.Count
	}
	return m, func() tea.Msg { return run }
}

// rankPrompt is the footer's question while a rank waits for an answer.
func (m PipelineModel) rankPrompt() string {
	if m.pendingRankAsk == nil {
		return ""
	}
	// The selected row stays highlighted and its preview shows the URL, so
	// the question leaves the URL out and keeps its controls in view.
	if m.pendingRankAsk.URL != "" {
		return i18n.Current.InboxRankAskRow
	}
	if m.pendingRankAsk.Unranked > m.pendingRankAsk.Count {
		return fmt.Sprintf(i18n.Current.InboxRankAskSome, m.pendingRankAsk.Count)
	}
	return fmt.Sprintf(i18n.Current.InboxRankAskAll, m.pendingRankAsk.Count)
}

// onRankDone runs after main.go has reloaded the Inbox, so the rows it reads
// are the ones the run left. When that read failed, the rows are the ones
// shown before the run, so nothing is inferred from them. The bulk outcome
// names only the rows still unranked: rows skipped or scanned in while the
// run took its minutes would make a before-and-after count wrong.
func (m PipelineModel) onRankDone(msg PipelineRankDoneMsg) PipelineModel {
	m.pendingRanking = nil
	switch {
	case msg.Err != "":
		m.flash = fmt.Sprintf(i18n.Current.InboxRankFailed, msg.Err)
	case m.pendingErr != "":
		m.flash = fmt.Sprintf(i18n.Current.InboxRankReadFailed, m.pendingErr)
	case msg.NotPending:
		m.flash = fmt.Sprintf(i18n.Current.InboxRankNotPending, msg.URL)
	case msg.URL != "":
		if row, ok := findPendingRow(m.pending, msg.URL); ok && row.HasRank {
			m.flash = fmt.Sprintf(i18n.Current.InboxRankedRow, row.Rank, msg.URL)
		} else {
			m.flash = fmt.Sprintf(i18n.Current.InboxRankNoScore, msg.URL)
		}
	default:
		m.flash = fmt.Sprintf(i18n.Current.InboxRankedAll, countUnranked(m.pending))
	}
	return m
}

func countUnranked(rows []data.PendingRow) int {
	n := 0
	for _, row := range rows {
		if !row.HasRank {
			n++
		}
	}
	return n
}

func findPendingRow(rows []data.PendingRow, url string) (data.PendingRow, bool) {
	for _, row := range rows {
		if row.URL == url {
			return row, true
		}
	}
	return data.PendingRow{}, false
}
