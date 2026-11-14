package data

import (
	"errors"
	"fmt"
	"io/fs"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// PendingRow is one unchecked row of the Pending section of data/pipeline.md,
// as the dashboard's Inbox tab shows it (#5269). Every text field has been
// through SanitizeTerminalText.
type PendingRow struct {
	URL      string // posting URL, or a `local:jds/…` target
	Company  string
	Role     string
	Location string
	Posted   string // YYYY-MM-DD from a `posted:` label, else ""
	// Rank is the first-pass rank rank-pipeline.mjs writes (`rank: 4.2/5 — reason`),
	// never an evaluation score. HasRank is false when the row has no rank
	// label, or one this reader cannot read or that is outside 0-5.
	Rank       float64
	HasRank    bool
	RankReason string
	// Status is one of the PendingStatus values: what batch-input.tsv and
	// batch-state.tsv record for this URL.
	Status string
}

// What the batch files record for a pending row. Read only: the dashboard does
// not work out what the next batch run would do, and never writes a status.
const (
	PendingStatusNone        = ""             // the URL is not in batch-input.tsv
	PendingStatusQueued      = "queued"       // in input with no state row, rate_limited, or a state this version does not know
	PendingStatusRunning     = "running"      // processing
	PendingStatusPaused      = "paused"       // paused_rate_limit
	PendingStatusNeedsAnswer = "needs_answer" // needs_confirmation
	PendingStatusFailed      = "failed"       // failed
	PendingStatusDone        = "done"         // completed or skipped, row still Pending
)

// pendingSectionPairs is a Go copy of SECTION_PAIRS in lib/pipeline-sections.mjs:
// the Pending and Processed headings each modes/<lang>/pipeline.md writes.
// tests/dashboard-pending-parity.test.mjs fails when the two lists differ.
var pendingSectionPairs = [][2]string{
	{"Pending", "Processed"},
	{"Pendientes", "Procesadas"},
	{"Pendentes", "Processadas"},
	{"Offen", "Verarbeitet"},
	{"En attente", "Traitees"},
	{"In attesa", "Elaborati"},
	{"In afwachting", "Verwerkt"},
	{"Afventer", "Behandlede"},
	{"Venter", "Behandlet"},
	{"Oczekujące", "Przetworzone"},
	{"Bekleyenler", "İşlenenler"},
	{"Menunggu", "Diproses"},
	{"Ожидающие", "Обработанные"},
	{"Очікуючі", "Оброблені"},
	{"लंबित", "संसाधित"},
	{"대기", "처리 완료"},
}

// lib/pipeline-sections.mjs folds a heading with NFD, drops U+0300-U+036F and
// lower-cases it, so a hand-typed "Traitées" matches "Traitees". Go's standard
// library has no NFD, so the precomposed Latin letters in U+00C0-U+017F are
// mapped to what that fold leaves of them. Combining marks in already
// decomposed text are dropped as Node drops them. The parity test checks this
// table against Node's own fold for every code point in that range.
const (
	headingFoldFrom = "ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽž"
	headingFoldTo   = "AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyyAaAaAaCcCcCcCcDdEeEeEeEeEeGgGgGgGgHhIiIiIiIiIJjKkLlLlLlNnNnNnOoOoOoRrRrRrSsSsSsSsTtTtUuUuUuUuUuUuWwYyYZzZzZz"
)

var headingFold = func() map[rune]rune {
	from := []rune(headingFoldFrom)
	to := []rune(headingFoldTo)
	if len(from) != len(to) {
		panic("pending.go: headingFoldFrom and headingFoldTo differ in length")
	}
	m := make(map[rune]rune, len(from))
	for i, r := range from {
		m[r] = to[i]
	}
	return m
}()

func foldHeading(text string) string {
	folded := strings.Map(func(r rune) rune {
		if r >= 0x300 && r <= 0x36f {
			return -1
		}
		if base, ok := headingFold[r]; ok {
			return base
		}
		return r
	}, text)
	return trimJS(strings.ToLower(folded))
}

var sectionKinds = func() map[string]string {
	m := make(map[string]string, 2*len(pendingSectionPairs))
	for _, pair := range pendingSectionPairs {
		m[foldHeading(pair[0])] = "pending"
		m[foldHeading(pair[1])] = "processed"
	}
	return m
}()

// jsSpace is what JavaScript's \s and String.prototype.trim treat as white
// space. Go's \s and strings.TrimSpace differ (no NBSP or BOM; U+0085 added),
// so the patterns below, written as they are in the Node readers, are compiled
// with this class, and cells are trimmed with trimJS.
const jsSpace = `\t\n\x{0B}\f\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}`

func isJSSpace(r rune) bool {
	switch {
	case r == '\t', r == '\n', r == 0x0B, r == '\f', r == '\r', r == ' ', r == 0xA0, r == 0x1680,
		r >= 0x2000 && r <= 0x200A, r == 0x2028, r == 0x2029, r == 0x202F, r == 0x205F, r == 0x3000, r == 0xFEFF:
		return true
	}
	return false
}

func trimJS(s string) string { return strings.TrimFunc(s, isJSSpace) }

// jsRegexp compiles a pattern copied from a Node reader, reading \s and \S as
// JavaScript does.
func jsRegexp(pattern string) *regexp.Regexp {
	pattern = strings.ReplaceAll(pattern, `\S`, "[^"+jsSpace+"]")
	pattern = strings.ReplaceAll(pattern, `\s`, "["+jsSpace+"]")
	return regexp.MustCompile(pattern)
}

var (
	// Same patterns as lib/pipeline-sections.mjs sectionKind and the
	// sync-batch-input.mjs section end.
	reSectionHeading = regexp.MustCompile(`^##[ \t]+(.+?)[ \t]*$`)
	reAnyHeading     = jsRegexp(`^##\s`)
	// web/src/lib/pipeline-table.mjs parseInbox, unchecked rows only. A `- [!]`
	// row (a posting set aside for the user) does not match, as it does not there.
	rePendingItem = jsRegexp(`^\s*-\s*\[ \]\s*(.+)$`)
	reRowTarget   = jsRegexp(`(?i)^(?:https?://|local:\S)`)
	reLabeled     = jsRegexp(`(?i)^(posted|trust|yrs|note|rank):\s(.*)$`)
	rePostedDate  = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	// parseRankStamp in web/src/lib/core/inbox-rank.mjs.
	reRankStamp = jsRegexp(`(\d+(?:\.\d+)?)\s*/\s*5\s*[—–-]\s*(.+)`)
)

// sectionKind reports whether a line opens the Pending or Processed section,
// as lib/pipeline-sections.mjs sectionKind does. "" for any other line.
func sectionKind(line string) string {
	m := reSectionHeading.FindStringSubmatch(strings.TrimSuffix(line, "\r"))
	if m == nil {
		return ""
	}
	return sectionKinds[foldHeading(m[1])]
}

// ParsePendingRows returns the unchecked rows of the first Pending section of
// a pipeline.md text, one per URL, the first occurrence winning. The section
// ends at the next `## ` heading, as it does for sync-batch-input.mjs, which
// fills the batch input from the same rows. A text with no Pending heading has
// no pending rows.
//
// Each row is read with the grammar of the web inbox's parseInbox: the first
// cell that is an http(s) URL or a `local:` target is the URL; company and role
// are the next two cells and are never read as labels; from the third cell on,
// `posted:`, `trust:`, `yrs:`, `note:` and `rank:` are labels and the other
// cells are positional, location first. Any other `word:` cell is positional,
// as it is in the web reader, so a row whose fourth cell is such a cell shows
// it as the location.
func ParsePendingRows(text string) []PendingRow {
	var rows []PendingRow
	seen := map[string]bool{}
	inPending := false
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSuffix(line, "\r")
		if inPending && reAnyHeading.MatchString(line) {
			break
		}
		if !inPending {
			inPending = sectionKind(line) == "pending"
			continue
		}
		row, ok := parsePendingLine(line)
		if !ok {
			continue
		}
		key := pendingURLKey(row.URL)
		if seen[key] {
			continue
		}
		seen[key] = true
		rows = append(rows, row)
	}
	return rows
}

func parsePendingLine(line string) (PendingRow, bool) {
	m := rePendingItem.FindStringSubmatch(line)
	if m == nil {
		return PendingRow{}, false
	}
	cells := strings.Split(m[1], "|")
	for i := range cells {
		cells[i] = trimJS(cells[i])
	}
	urlIndex := -1
	for i, cell := range cells {
		if reRowTarget.MatchString(cell) {
			urlIndex = i
			break
		}
	}
	if urlIndex < 0 {
		return PendingRow{}, false
	}
	labels := map[string]string{}
	var positional []string
	for i := urlIndex + 1; i < len(cells); i++ {
		if i >= urlIndex+3 {
			if lm := reLabeled.FindStringSubmatch(cells[i]); lm != nil {
				labels[strings.ToLower(lm[1])] = trimJS(lm[2])
				continue
			}
		}
		positional = append(positional, cells[i])
	}
	at := func(i int) string {
		if i < len(positional) {
			return positional[i]
		}
		return ""
	}
	row := PendingRow{
		URL:      cells[urlIndex],
		Company:  at(0),
		Role:     at(1),
		Location: at(2),
	}
	if posted := labels["posted"]; rePostedDate.MatchString(posted) {
		row.Posted = posted
	}
	if stamp, ok := labels["rank"]; ok {
		row.Rank, row.RankReason, row.HasRank = parseRankStamp(stamp)
	}
	row.URL = SanitizeTerminalText(row.URL)
	row.Company = SanitizeTerminalText(row.Company)
	row.Role = SanitizeTerminalText(row.Role)
	row.Location = SanitizeTerminalText(row.Location)
	row.RankReason = SanitizeTerminalText(row.RankReason)
	return row, true
}

// parseRankStamp reads the text after `rank:` as web parseRankStamp does
// (score rounded to one decimal, a reason required). It differs on purpose in
// one respect: a score outside 0-5 is not clamped onto the scale but read as
// no rank, because rank-pipeline.mjs never writes one and a hand-edited 9/5
// shown as 5.0 would read as the best row in the list.
func parseRankStamp(stamp string) (float64, string, bool) {
	m := reRankStamp.FindStringSubmatch(trimJS(stamp))
	if m == nil {
		return 0, "", false
	}
	reason := trimJS(m[2])
	score, err := strconv.ParseFloat(m[1], 64)
	if reason == "" || err != nil || math.IsNaN(score) || score < 0 || score > 5 {
		return 0, "", false
	}
	return math.Round(score*10) / 10, reason, true
}

// pendingURLKey is a light normalization of an http(s) URL, used to dedupe
// rows and to join a row to batch-input.tsv: scheme and host lower-cased, a
// default port dropped, and an empty path written as "/". Those are the
// differences sync-batch-input.mjs's `new URL(raw).href` most often makes to
// a URL copied from pipeline.md. It is not a full WHATWG serializer: an
// internationalized host, dot segments or an unencoded space are compared as
// written. Anything that is not an http(s) URL with a host, including a
// `local:` target, is its own key.
func pendingURLKey(raw string) string {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return raw
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return raw
	}
	u.Scheme = scheme
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if (scheme == "http" && port == "80") || (scheme == "https" && port == "443") {
		port = ""
	}
	if port != "" {
		host += ":" + port
	}
	u.Host = host
	if u.Path == "" && u.RawPath == "" && u.Opaque == "" {
		u.Path = "/"
	}
	return u.String()
}

// LoadPendingRows reads the Pending rows of {careerOpsPath}/data/pipeline.md
// and the batch status of each. It reads three files and writes none.
//
// A missing pipeline.md or batch file means no rows or no status. Any other
// read error is returned: an unreadable inbox must not show up as an empty
// one, and an unreadable batch file must not show every row as not queued.
//
// The batch files are found through batchFilePath, so they are the ones the
// tracker's URL lookup reads: beside batch/batch-runner.sh in the checkout
// when it has them, else in the data root.
func LoadPendingRows(careerOpsPath string) ([]PendingRow, error) {
	text, err := os.ReadFile(PendingPipelinePath(careerOpsPath))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows := ParsePendingRows(string(text))
	if len(rows) == 0 {
		return rows, nil
	}
	statuses, err := loadBatchStatuses(
		batchFilePath(careerOpsPath, "batch-input.tsv"),
		batchFilePath(careerOpsPath, "batch-state.tsv"),
	)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		rows[i].Status = statuses[pendingURLKey(rows[i].URL)]
	}
	return rows, nil
}

// PendingPipelinePath is the file the Inbox tab reads.
func PendingPipelinePath(careerOpsPath string) string {
	return filepath.Join(careerOpsPath, "data", "pipeline.md")
}

// readOptional returns a file's text, or "" when it does not exist.
func readOptional(path string) (string, error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// loadBatchStatuses maps each URL key in batch-input.tsv to a PendingStatus.
// When a URL sits under several input ids, the highest id decides: that is
// the newest attempt.
func loadBatchStatuses(inputPath, statePath string) (map[string]string, error) {
	input, err := readOptional(inputPath)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", inputPath, err)
	}
	if input == "" {
		return map[string]string{}, nil
	}
	state, err := readOptional(statePath)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", statePath, err)
	}

	stateByID := map[int]string{}
	for _, fields := range tsvRows(state) {
		if len(fields) < 3 {
			continue
		}
		if id, err := strconv.Atoi(fields[0]); err == nil {
			stateByID[id] = strings.TrimSpace(fields[2])
		}
	}

	newest := map[string]int{}
	for _, fields := range tsvRows(input) {
		if len(fields) < 2 {
			continue
		}
		id, err := strconv.Atoi(fields[0])
		if err != nil {
			continue
		}
		key := pendingURLKey(fields[1])
		if prev, ok := newest[key]; !ok || id > prev {
			newest[key] = id
		}
	}

	out := make(map[string]string, len(newest))
	for key, id := range newest {
		state, ok := stateByID[id]
		if !ok {
			out[key] = PendingStatusQueued
			continue
		}
		out[key] = pendingStatusFor(state)
	}
	return out, nil
}

func pendingStatusFor(state string) string {
	switch state {
	case "processing":
		return PendingStatusRunning
	case "paused_rate_limit":
		return PendingStatusPaused
	case "needs_confirmation":
		return PendingStatusNeedsAnswer
	case "failed":
		return PendingStatusFailed
	case "completed", "skipped":
		return PendingStatusDone
	default:
		// rate_limited is retried by the same run, and a state this version
		// does not know is shown as waiting rather than guessed at.
		return PendingStatusQueued
	}
}

// tsvRows splits a batch TSV into fields, skipping blank lines, `#` comments
// and the `id` header, as sync-batch-input.mjs does.
func tsvRows(text string) [][]string {
	var rows [][]string
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSuffix(line, "\r")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "id\t") {
			continue
		}
		rows = append(rows, strings.Split(line, "\t"))
	}
	return rows
}
