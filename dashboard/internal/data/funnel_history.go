package data

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

func funnelRank(status string) int {
	switch NormalizeStatus(status) {
	case "applied":
		return 1
	case "responded", "rejected":
		return 2
	case "assessment":
		return 3
	case "interview":
		return 4
	case "offer", "hired":
		return 5
	}
	return 0
}

// StatusLedger is what the dashboard needs from status-log.tsv, the
// append-only transition ledger beside the tracker
// ({tracker#}\t{date}\t{from}\t{to}\t{source}\t{note}, see DATA_CONTRACT.md).
type StatusLedger struct {
	// Reached is the highest funnel stage each tracker # ever reached, so a
	// row that moved on to Rejected still counts the Interview it had.
	Reached map[int]int
	// LatestDate is the date of each tracker #'s most recent surviving
	// transition — what the DATE column shows. Absent when the row has none.
	LatestDate map[int]string
}

var reLedgerDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// ReadStatusLedger reads only the ledger beside the active tracker, including
// tracker overrides and the legacy root layout. Missing history is harmless;
// other read failures must not silently erase previously reached stages.
func ReadStatusLedger(root string) (StatusLedger, error) {
	content, err := os.ReadFile(filepath.Join(filepath.Dir(resolveTrackerPath(root)), "status-log.tsv"))
	if errors.Is(err, os.ErrNotExist) {
		return StatusLedger{}, nil
	}
	if err != nil {
		return StatusLedger{}, fmt.Errorf("read funnel history: %w", err)
	}
	return parseStatusLedger(string(content)), nil
}

// ReadFunnelHistory is the funnel-only view of ReadStatusLedger, kept for
// callers that need nothing but the reached stages.
func ReadFunnelHistory(root string) (map[int]int, error) {
	ledger, err := ReadStatusLedger(root)
	if err != nil {
		return nil, err
	}
	return ledger.Reached, nil
}

func parseFunnelHistory(content string) map[int]int {
	return parseStatusLedger(content).Reached
}

type ledgerObservation struct {
	to   string
	date string
}

// parseStatusLedger folds the ledger once for both views.
//
// Reached keeps its long-standing, lenient rule: any line with a numeric
// tracker # and non-empty date/from/to contributes both states' ranks.
//
// LatestDate mirrors foldObservations in funnel-velocity.mjs rather than
// taking a plain maximum, because the ledger is append-only and corrects
// itself by appending: a `to` of "-" retracts the row's latest surviving
// observation (so a mis-click's later date does not linger), and a
// `correction` line re-dates the latest observation with the same target
// (so a transition moved to an earlier day actually moves). Source validity
// is deliberately not a gate here — for a display date a `backfill` line is
// still the best information there is.
func parseStatusLedger(content string) StatusLedger {
	reached := make(map[int]int)
	timelines := make(map[int][]ledgerObservation)
	for _, line := range strings.Split(content, "\n") {
		c := strings.Split(strings.TrimSuffix(line, "\r"), "\t")
		if len(c) < 4 {
			continue
		}
		for i := range c {
			c[i] = strings.TrimSpace(c[i])
		}
		if c[0] == "" || strings.IndexFunc(c[0], func(r rune) bool { return r < '0' || r > '9' }) >= 0 || c[1] == "" || c[2] == "" || c[3] == "" {
			continue
		}
		num, err := strconv.Atoi(c[0])
		if err != nil {
			continue
		}
		for _, status := range c[2:4] {
			if rank := funnelRank(status); rank > reached[num] {
				reached[num] = rank
			}
		}

		if !reLedgerDate.MatchString(c[1]) {
			continue
		}
		date, to := c[1], c[3]
		source := ""
		if len(c) > 4 {
			source = c[4]
		}
		tl := timelines[num]
		switch {
		case to == "-":
			if len(tl) > 0 {
				tl = tl[:len(tl)-1]
			}
		case source == "correction":
			corrected := false
			for i := len(tl) - 1; i >= 0; i-- {
				if NormalizeStatus(tl[i].to) == NormalizeStatus(to) {
					tl[i].date = date
					corrected = true
					break
				}
			}
			if !corrected {
				tl = append(tl, ledgerObservation{to: to, date: date})
			}
		default:
			tl = append(tl, ledgerObservation{to: to, date: date})
		}
		timelines[num] = tl
	}

	latest := make(map[int]string, len(timelines))
	for num, tl := range timelines {
		for _, o := range tl {
			if o.date > latest[num] {
				latest[num] = o.date
			}
		}
		if latest[num] == "" {
			delete(latest, num)
		}
	}
	return StatusLedger{Reached: reached, LatestDate: latest}
}

// ApplyStatusDates stamps each row's latest ledger transition date onto
// StatusDate. Rows whose tracker # was synthesized (TrackerNumberMissing) are
// skipped: a display number must never join another row's ledger history.
func ApplyStatusDates(apps []model.CareerApplication, dates map[int]string) {
	if len(dates) == 0 {
		return
	}
	for i := range apps {
		if apps[i].TrackerNumberMissing {
			continue
		}
		if d, ok := dates[apps[i].Number]; ok {
			apps[i].StatusDate = d
		}
	}
}
