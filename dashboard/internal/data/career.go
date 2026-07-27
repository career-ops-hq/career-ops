package data

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

var (
	reReportLink     = regexp.MustCompile(`\[(\d+)\]\(([^)]+)\)`)
	reScoreValue     = regexp.MustCompile(`(\d+\.?\d*)/5`)
	reArchetype      = regexp.MustCompile(`(?i)\*\*(?:Arquetipo|Archetype)(?:\s+(?:detectado|detected))?\*\*\s*\|\s*(.+)`)
	reTlDr           = regexp.MustCompile(`(?i)\*\*TL;DR\*\*\s*\|\s*(.+)`)
	reTlDrColon      = regexp.MustCompile(`(?i)\*\*TL;DR:\*\*\s*(.+)`)
	reRemote         = regexp.MustCompile(`(?i)\*\*Remote\*\*\s*\|\s*(.+)`)
	reComp           = regexp.MustCompile(`(?i)\*\*Comp\*\*\s*\|\s*(.+)`)
	reArchetypeColon = regexp.MustCompile(`(?i)\*\*(?:Arquetipo|Archetype):\*\*\s*(.+)`)
	reArchetypeYAML  = regexp.MustCompile(`(?m)^archetype:\s*"?([^"\n]+)"?\s*$`)
	reReportURL      = regexp.MustCompile(`(?m)^\*\*URL:\*\*\s*(https?://\S+)`)
	reBatchID        = regexp.MustCompile(`(?m)^\*\*Batch ID:\*\*\s*(\d+)`)
	reDiscardReasons = regexp.MustCompile(`(?s)discard_reasons:\s*\n((?:\s*-\s*.+?\n)+)`)
	reDiscardItem    = regexp.MustCompile(`\s*-\s*([^\n]+)`)
)

// resolveReportPath converts a report link from the tracker into a path
// relative to careerOpsPath. Links are normally relative to the tracker
// file's own directory (see merge-tracker.mjs link normalization, #760);
// legacy trackers may still carry root-relative links, so fall back to the
// raw link when the tracker-relative resolution does not exist on disk.
func resolveReportPath(careerOpsPath, trackerPath, link string) string {
	resolved := filepath.Join(filepath.Dir(trackerPath), link)
	if _, err := os.Stat(resolved); err != nil {
		legacy := filepath.Join(careerOpsPath, link)
		if _, err2 := os.Stat(legacy); err2 == nil {
			resolved = legacy
		}
	}
	if rel, err := filepath.Rel(careerOpsPath, resolved); err == nil {
		return rel
	}
	return link
}

// ParseApplications reads applications.md and returns parsed applications.
// It tries both {path}/applications.md and {path}/data/applications.md for compatibility.
func ParseApplications(careerOpsPath string) []model.CareerApplication {
	filePath := filepath.Join(careerOpsPath, "applications.md")
	content, err := os.ReadFile(filePath)
	if err != nil {
		// Fallback: try data/ subdirectory
		filePath = filepath.Join(careerOpsPath, "data", "applications.md")
		content, err = os.ReadFile(filePath)
		if err != nil {
			return nil
		}
	}

	lines := strings.Split(string(content), "\n")
	apps := make([]model.CareerApplication, 0)
	num := 0

	// Map columns by header name rather than fixed position, so a customized or
	// reordered tracker (e.g. an inserted Location column) does not desync the
	// reader. Falls back to the legacy fixed layout when no header is present.
	// This matches the Node tracker tooling, which became header-aware in #954.
	cols := resolveTrackerColumns(lines)

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "# ") || strings.HasPrefix(line, "|---") || strings.HasPrefix(line, "| #") {
			continue
		}
		if !strings.HasPrefix(line, "|") {
			continue
		}

		fields := splitTrackerRow(line)
		if len(fields) < 8 {
			continue
		}

		at := func(name string) string {
			if idx, ok := cols[name]; ok && idx >= 0 && idx < len(fields) {
				return fields[idx]
			}
			return ""
		}

		num++
		trackerNumber := num
		if parsedNumber, err := strconv.Atoi(at("num")); err == nil {
			trackerNumber = parsedNumber
		}
		app := model.CareerApplication{
			Number:  trackerNumber,
			Date:    at("date"),
			Company: at("company"),
			Role:    at("role"),
			Status:  at("status"),
			HasPDF:  strings.Contains(at("pdf"), "\u2705"),
		}

		// Parse score from the Score column.
		app.ScoreRaw = at("score")
		if sm := reScoreValue.FindStringSubmatch(at("score")); sm != nil {
			app.Score, _ = strconv.ParseFloat(sm[1], 64)
		}

		// Parse report link. Tracker links are written relative to the
		// tracker file itself (e.g. ../reports/... when the tracker lives in
		// data/), so resolve against the tracker's directory and normalize
		// back to a careerOpsPath-relative path, which is what every
		// consumer joins against. Legacy root-relative links are kept as a
		// fallback when the resolved file does not exist.
		if rm := reReportLink.FindStringSubmatch(at("report")); rm != nil {
			app.ReportNumber = rm[1]
			app.ReportPath = resolveReportPath(careerOpsPath, filePath, rm[2])
		}

		// Notes column, when present.
		app.Notes = at("notes")

		// Lift location / work mode / pay / last-contact out of the notes free-text
		deriveNoteFields(&app)

		apps = append(apps, app)
	}

	// Enrich with job URLs using 5-tier strategy:
	// 1. **URL:** field in report header (newest reports)
	// 2. **Batch ID:** in report -> batch-input.tsv URL lookup
	// 3. report_num -> batch-state completed mapping (legacy)
	// 4. scan-history.tsv (pipeline scan entries matched by company+role)
	// 5. company name fallback from batch-input.tsv
	batchURLs := loadBatchInputURLs(careerOpsPath)
	reportNumURLs := loadJobURLs(careerOpsPath)

	for i := range apps {
		if apps[i].ReportPath == "" {
			continue
		}
		fullReport := filepath.Join(careerOpsPath, apps[i].ReportPath)
		reportContent, err := os.ReadFile(fullReport)
		if err != nil {
			continue
		}
		header := string(reportContent)
		// Only scan the header (first 1000 bytes) for speed
		if len(header) > 1000 {
			header = header[:1000]
		}

		// Strategy 1: **URL:** in report
		if m := reReportURL.FindStringSubmatch(header); m != nil {
			apps[i].JobURL = m[1]
			continue
		}

		// Strategy 2: **Batch ID:** -> batch-input.tsv
		if m := reBatchID.FindStringSubmatch(header); m != nil {
			if url, ok := batchURLs[m[1]]; ok {
				apps[i].JobURL = url
				continue
			}
		}

		// Strategy 3: report_num -> batch-state completed mapping
		if reportNumURLs != nil {
			if url, ok := reportNumURLs[apps[i].ReportNumber]; ok {
				apps[i].JobURL = url
				continue
			}
		}
	}

	// Strategy 4: scan-history.tsv (pipeline scan entries matched by company+role)
	enrichFromScanHistory(careerOpsPath, apps)

	// Strategy 5: company name fallback from batch-input.tsv
	enrichAppURLsByCompany(careerOpsPath, apps)

	return apps
}

// loadBatchInputURLs reads batch-input.tsv and returns a map of batch ID -> job URL.
func loadBatchInputURLs(careerOpsPath string) map[string]string {
	inputPath := filepath.Join(careerOpsPath, "batch", "batch-input.tsv")
	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		return nil
	}
	result := make(map[string]string)
	for _, line := range strings.Split(string(inputData), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) < 4 || fields[0] == "id" {
			continue
		}
		id := fields[0]
		notes := fields[3]
		// Extract real job URL from notes: "Title @ Company | Match% | https://actual-url"
		if idx := strings.LastIndex(notes, "| "); idx >= 0 {
			u := strings.TrimSpace(notes[idx+2:])
			if strings.HasPrefix(u, "http") {
				result[id] = u
				continue
			}
		}
		// Fallback: use JackJill URL
		if strings.HasPrefix(fields[1], "http") {
			result[id] = fields[1]
		}
	}
	return result
}

// batchEntry holds parsed data from batch-input.tsv.
type batchEntry struct {
	id      string
	url     string
	company string
	role    string
}

// loadJobURLs reads batch TSV files and returns a map of report_num -> job URL.
// Uses two strategies: (1) report_num mapping for completed jobs, (2) company name
// matching as fallback for failed/missing jobs.
func loadJobURLs(careerOpsPath string) map[string]string {
	// Read batch-input.tsv: id \t url \t source \t notes
	inputPath := filepath.Join(careerOpsPath, "batch", "batch-input.tsv")
	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		return nil
	}

	// Parse batch-input: extract job URL, company, and role from notes
	entries := make(map[string]batchEntry) // keyed by id
	for _, line := range strings.Split(string(inputData), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) < 4 || fields[0] == "id" {
			continue
		}
		e := batchEntry{id: fields[0]}
		notes := fields[3]

		// Extract URL from notes: "Title @ Company | Match% | https://actual-url"
		if idx := strings.LastIndex(notes, "| "); idx >= 0 {
			u := strings.TrimSpace(notes[idx+2:])
			if strings.HasPrefix(u, "http") {
				e.url = u
			}
		}
		// Fallback: use JackJill URL from field 1
		if e.url == "" && strings.HasPrefix(fields[1], "http") {
			e.url = fields[1]
		}

		// Extract company and role: "Role @ Company | Match% | URL"
		notesPart := notes
		if pipeIdx := strings.Index(notesPart, " | "); pipeIdx >= 0 {
			notesPart = notesPart[:pipeIdx]
		}
		if atIdx := strings.LastIndex(notesPart, " @ "); atIdx >= 0 {
			e.role = strings.TrimSpace(notesPart[:atIdx])
			e.company = strings.TrimSpace(notesPart[atIdx+3:])
		}

		if e.url != "" {
			entries[fields[0]] = e
		}
	}

	// Read batch-state.tsv: id \t url \t status \t ... \t report_num \t ...
	statePath := filepath.Join(careerOpsPath, "batch", "batch-state.tsv")
	stateData, err := os.ReadFile(statePath)
	if err != nil {
		return nil
	}

	// Strategy 1: map report_num -> URL only for COMPLETED jobs
	reportToURL := make(map[string]string)
	for _, line := range strings.Split(string(stateData), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) < 6 || fields[0] == "id" {
			continue
		}
		id := fields[0]
		status := fields[2]
		reportNum := fields[5]
		if status != "completed" || reportNum == "" || reportNum == "-" {
			continue
		}
		if e, ok := entries[id]; ok {
			reportToURL[reportNum] = e.url
			if len(reportNum) < 3 {
				reportToURL[fmt.Sprintf("%03s", reportNum)] = e.url
			}
		}
	}

	return reportToURL
}

// enrichFromScanHistory fills JobURL from scan-history.tsv by matching company name.
func enrichFromScanHistory(careerOpsPath string, apps []model.CareerApplication) {
	scanPath := filepath.Join(careerOpsPath, "scan-history.tsv")
	scanData, err := os.ReadFile(scanPath)
	if err != nil {
		return
	}

	// Build company -> URL index from scan-history
	type scanEntry struct {
		url     string
		company string
		title   string
	}
	byCompany := make(map[string][]scanEntry)
	for _, line := range strings.Split(string(scanData), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) < 5 || fields[0] == "url" {
			continue
		}
		url := fields[0]
		company := fields[4]
		title := fields[3]
		if url == "" || !strings.HasPrefix(url, "http") {
			continue
		}
		key := normalizeCompany(company)
		byCompany[key] = append(byCompany[key], scanEntry{url: url, company: company, title: title})
	}

	for i := range apps {
		if apps[i].JobURL != "" {
			continue
		}
		key := normalizeCompany(apps[i].Company)
		matches := byCompany[key]
		if len(matches) == 1 {
			apps[i].JobURL = matches[0].url
		} else if len(matches) > 1 {
			// Multiple entries: pick best role match
			appRole := strings.ToLower(apps[i].Role)
			best := matches[0].url
			bestScore := 0
			for _, m := range matches {
				score := 0
				mTitle := strings.ToLower(m.title)
				for _, word := range strings.Fields(appRole) {
					if len(word) > 2 && strings.Contains(mTitle, word) {
						score++
					}
				}
				if score > bestScore {
					bestScore = score
					best = m.url
				}
			}
			apps[i].JobURL = best
		}
	}
}

// normalizeCompany strips common suffixes and lowercases a company name.
func normalizeCompany(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	for _, suffix := range []string{" inc.", " inc", " llc", " ltd", " corp", " corporation", " technologies", " technology", " group", " co."} {
		s = strings.TrimSuffix(s, suffix)
	}
	return strings.TrimSpace(s)
}

// enrichAppURLsByCompany fills in JobURL for apps that didn't get one via report_num mapping.
// It matches by company name from batch-input.tsv notes.
func enrichAppURLsByCompany(careerOpsPath string, apps []model.CareerApplication) {
	inputPath := filepath.Join(careerOpsPath, "batch", "batch-input.tsv")
	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		return
	}

	// Build company -> []entry index
	type entry struct {
		role string
		url  string
	}
	byCompany := make(map[string][]entry)
	for _, line := range strings.Split(string(inputData), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) < 4 || fields[0] == "id" {
			continue
		}
		notes := fields[3]
		var url string
		if idx := strings.LastIndex(notes, "| "); idx >= 0 {
			u := strings.TrimSpace(notes[idx+2:])
			if strings.HasPrefix(u, "http") {
				url = u
			}
		}
		if url == "" && strings.HasPrefix(fields[1], "http") {
			url = fields[1]
		}
		if url == "" {
			continue
		}
		notesPart := notes
		if pipeIdx := strings.Index(notesPart, " | "); pipeIdx >= 0 {
			notesPart = notesPart[:pipeIdx]
		}
		if atIdx := strings.LastIndex(notesPart, " @ "); atIdx >= 0 {
			role := strings.TrimSpace(notesPart[:atIdx])
			company := strings.TrimSpace(notesPart[atIdx+3:])
			key := normalizeCompany(company)
			byCompany[key] = append(byCompany[key], entry{role: role, url: url})
		}
	}

	for i := range apps {
		if apps[i].JobURL != "" {
			continue
		}
		key := normalizeCompany(apps[i].Company)
		matches := byCompany[key]
		if len(matches) == 1 {
			apps[i].JobURL = matches[0].url
		} else if len(matches) > 1 {
			// Multiple entries for same company: pick best role match
			appRole := strings.ToLower(apps[i].Role)
			best := matches[0].url
			bestScore := 0
			for _, m := range matches {
				score := 0
				mRole := strings.ToLower(m.role)
				// Count matching words
				for _, word := range strings.Fields(appRole) {
					if len(word) > 2 && strings.Contains(mRole, word) {
						score++
					}
				}
				if score > bestScore {
					bestScore = score
					best = m.url
				}
			}
			apps[i].JobURL = best
		}
	}
}

// ComputeMetrics calculates aggregate metrics from applications.
func ComputeMetrics(apps []model.CareerApplication) model.PipelineMetrics {
	m := model.PipelineMetrics{
		Total:    len(apps),
		ByStatus: make(map[string]int),
	}

	var totalScore float64
	var scored int

	for _, app := range apps {
		status := NormalizeStatus(app.Status)
		m.ByStatus[status]++

		if app.Score > 0 {
			totalScore += app.Score
			scored++
			if app.Score > m.TopScore {
				m.TopScore = app.Score
			}
		}
		if app.HasPDF {
			m.WithPDF++
		}
		if status != "skip" && status != "rejected" && status != "discarded" {
			m.Actionable++
		}
	}

	if scored > 0 {
		m.AvgScore = totalScore / float64(scored)
	}

	return m
}

// NormalizeStatus normalizes raw status text to a canonical form.
// Aliases match states.yml -- keep in sync with career-ops/states.yml
func NormalizeStatus(raw string) string {
	// Strip markdown bold and trailing dates
	s := strings.ReplaceAll(raw, "**", "")
	s = strings.TrimSpace(strings.ToLower(s))
	// Strip trailing date (e.g., "aplicado 2026-03-12")
	if idx := strings.Index(s, " 202"); idx > 0 {
		s = strings.TrimSpace(s[:idx])
	}

	switch {
	// Most restrictive first — accepts English, Spanish, and Turkish
	case s == "hired" || s == "contratado" || s == "contratada" || s == "accepted" || s == "accept" || s == "kabul edildi" || s == "kabul_edildi" || s == "işe alındı" || s == "ise alindi":
		return "hired"
	case strings.Contains(s, "no aplicar") || strings.Contains(s, "no_aplicar") || s == "skip" || strings.Contains(s, "geo blocker") || strings.Contains(s, "uygun değil") || strings.Contains(s, "uygun_değil") || strings.Contains(s, "uygun degil") || strings.Contains(s, "uygun_degil"):
		return "skip"
	case strings.Contains(s, "interview") || strings.Contains(s, "entrevista") || strings.Contains(s, "mülakat") || strings.Contains(s, "mulakat"):
		return "interview"
	case s == "offer" || strings.Contains(s, "oferta") || strings.Contains(s, "teklif"):
		return "offer"
	case strings.Contains(s, "responded") || strings.Contains(s, "respondido") || strings.Contains(s, "yanıt verildi") || strings.Contains(s, "yanıt_verildi") || strings.Contains(s, "yanit verildi") || strings.Contains(s, "yanit_verildi"):
		return "responded"
	case strings.Contains(s, "applied") || strings.Contains(s, "aplicado") || s == "enviada" || s == "aplicada" || s == "sent" || strings.Contains(s, "başvuruldu") || strings.Contains(s, "basvuruldu"):
		return "applied"
	case strings.Contains(s, "rejected") || strings.Contains(s, "rechazado") || s == "rechazada" || strings.Contains(s, "reddedildi"):
		return "rejected"
	case strings.Contains(s, "discarded") || strings.Contains(s, "descartado") || s == "descartada" || s == "cerrada" || s == "cancelada" ||
		strings.HasPrefix(s, "duplicado") || strings.HasPrefix(s, "dup") || strings.Contains(s, "iptal edildi") || strings.Contains(s, "iptal_edildi") || strings.Contains(s, "ıptal edildi") || strings.Contains(s, "ıptal_edildi"):
		return "discarded"
	case strings.Contains(s, "evaluated") || strings.Contains(s, "evaluada") || s == "condicional" || s == "hold" || s == "monitor" || s == "evaluar" || s == "verificar" || strings.Contains(s, "değerlendirildi") || strings.Contains(s, "degerlendirildi"):
		return "evaluated"
	default:
		return s
	}
}

// LoadReportSummary extracts key fields from a report file.
func LoadReportSummary(careerOpsPath, reportPath string) (archetype, tldr, remote, comp string) {
	fullPath := filepath.Join(careerOpsPath, reportPath)
	content, err := os.ReadFile(fullPath)
	if err != nil {
		return
	}
	text := string(content)

	if m := reArchetype.FindStringSubmatch(text); m != nil {
		archetype = cleanTableCell(m[1])
	} else if m := reArchetypeColon.FindStringSubmatch(text); m != nil {
		archetype = cleanTableCell(m[1])
	} else if m := reArchetypeYAML.FindStringSubmatch(text); m != nil {
		archetype = strings.TrimSpace(m[1])
	}

	// Try table-format TL;DR first (most reports), then colon format
	if m := reTlDr.FindStringSubmatch(text); m != nil {
		tldr = cleanTableCell(m[1])
	} else if m := reTlDrColon.FindStringSubmatch(text); m != nil {
		tldr = cleanTableCell(m[1])
	}

	if m := reRemote.FindStringSubmatch(text); m != nil {
		remote = cleanTableCell(m[1])
	}

	if m := reComp.FindStringSubmatch(text); m != nil {
		comp = cleanTableCell(m[1])
	}

	// Truncate long fields
	if len(tldr) > 120 {
		tldr = tldr[:117] + "..."
	}

	return
}

// splitTrackerRow splits a tracker table line into trimmed cell values, using
// the same delimiter logic as ParseApplications: a mixed "| " + tab-separated
// body, or a pure pipe-delimited row. Field 0 is the first real column (num), so
// the returned indices match the legacy layout (Status is field 5).
func splitTrackerRow(line string) []string {
	line = strings.TrimSpace(line)
	var fields []string
	if strings.Contains(line, "\t") {
		// Mixed format: starts with "| " then tab-separated.
		line = strings.TrimPrefix(line, "|")
		line = strings.TrimSpace(line)
		for _, p := range strings.Split(line, "\t") {
			fields = append(fields, strings.TrimSpace(strings.Trim(p, "|")))
		}
	} else {
		// Pure pipe format.
		line = strings.Trim(line, "|")
		for _, p := range strings.Split(line, "|") {
			fields = append(fields, strings.TrimSpace(p))
		}
	}
	return fields
}

// trackerHeaderAliases maps a lowercased header cell to a canonical field name.
// Mirrors HEADER_ALIASES in tracker-parse.mjs (including the Spanish aliases) so
// the Go data layer tolerates the same customized layouts as the Node tracker
// tooling after #954.
var trackerHeaderAliases = map[string]string{
	"#": "num", "num": "num", "date": "date",
	"company": "company", "empresa": "company",
	"via": "via", "role": "role", "puesto": "role",
	"location": "location", "score": "score", "status": "status",
	"pdf": "pdf", "report": "report", "notes": "notes",
}

// legacyTrackerColumns is the original fixed layout in splitTrackerRow field
// space (num=0 … notes=8), used when no recognizable header row is present.
var legacyTrackerColumns = map[string]int{
	"num": 0, "date": 1, "company": 2, "role": 3, "score": 4,
	"status": 5, "pdf": 6, "report": 7, "notes": 8,
}

// detectTrackerColumns scans for the table header row and maps canonical field
// names to column indices in splitTrackerRow field space. It returns nil unless
// the essential columns are all present, so a stray pipe line cannot yield a
// bogus mapping and the caller falls back to legacyTrackerColumns. Mirrors
// detectColumns in tracker-parse.mjs (#954).
func detectTrackerColumns(lines []string) map[string]int {
	for _, line := range lines {
		if !strings.HasPrefix(strings.TrimSpace(line), "|") {
			continue
		}
		cells := splitTrackerRow(line)
		m := make(map[string]int)
		for i, c := range cells {
			if name, ok := trackerHeaderAliases[strings.ToLower(c)]; ok {
				// Unconditional assign: with a duplicated header name the LAST
				// occurrence wins, matching detectColumns in tracker-parse.mjs
				// (which this function mirrors) — first-wins here made the two
				// runtimes map the same header row differently.
				m[name] = i
			}
		}
		complete := true
		for _, k := range []string{"num", "company", "role", "score", "status"} {
			if _, ok := m[k]; !ok {
				complete = false
				break
			}
		}
		if complete {
			return m
		}
	}
	return nil
}

// resolveTrackerColumns returns the header-detected column map, falling back to
// the legacy fixed layout when no header row is found.
func resolveTrackerColumns(lines []string) map[string]int {
	if m := detectTrackerColumns(lines); m != nil {
		return m
	}
	return legacyTrackerColumns
}

// UpdateApplicationStatus updates the status of an application in applications.md.
func UpdateApplicationStatus(careerOpsPath string, app model.CareerApplication, newStatus string) error {
	return UpdateApplicationStatusAndNotes(careerOpsPath, app, newStatus, "")
}

// UpdateApplicationStatusAndNotes atomically updates both the Status cell and
// the Notes cell for an application row. It is used by the discard reason
// picker (Issue 1380) to commit `DISCARD: <reason>` alongside the new status
// in a single file write, preventing a second partial update from leaving the
// tracker in a half-written state.
//
// notesAppend is appended (with a space separator if notes are non-empty) to
// whatever the Notes cell already contains. Pass an empty string to leave
// notes unchanged.
func UpdateApplicationStatusAndNotes(careerOpsPath string, app model.CareerApplication, newStatus, notesAppend string) (returnErr error) {
	filePath := filepath.Join(careerOpsPath, "applications.md")
	if _, err := os.Stat(filePath); err != nil {
		filePath = filepath.Join(careerOpsPath, "data", "applications.md")
		if _, err := os.Stat(filePath); err != nil {
			return err
		}
	}
	filePath, err := canonicalPath(filePath)
	if err != nil {
		return fmt.Errorf("resolve tracker path: %w", err)
	}

	lock, err := acquireTrackerLock(filePath, defaultTrackerLockOptions())
	if err != nil {
		return fmt.Errorf("acquire tracker lock: %w", err)
	}
	defer func() {
		if err := lock.release(); err != nil {
			releaseErr := fmt.Errorf("release tracker lock: %w", err)
			if returnErr == nil {
				returnErr = releaseErr
			} else {
				returnErr = errors.Join(returnErr, releaseErr)
			}
		}
	}()

	content, err := os.ReadFile(filePath)
	if err != nil {
		return err
	}

	lines := strings.Split(string(content), "\n")
	cols := resolveTrackerColumns(lines)
	statusIdx, statusOk := cols["status"]
	if !statusOk {
		return fmt.Errorf("status column not found in tracker")
	}
	notesIdx, notesOk := cols["notes"]
	if notesAppend != "" && !notesOk {
		return fmt.Errorf("notes column not found in tracker, cannot append notes")
	}

	found := false
	for i, line := range lines {
		if !strings.HasPrefix(strings.TrimSpace(line), "|") {
			continue
		}
		if app.ReportNumber == "" || !strings.Contains(line, fmt.Sprintf("[%s]", app.ReportNumber)) {
			continue
		}
		// Update status
		updated, ok := replaceStatusInLine(line, app.Status, newStatus, statusIdx)
		if !ok {
			return fmt.Errorf("failed to replace status: status cell '%s' not matched in row", app.Status)
		}
		// Optionally append to notes
		if notesAppend != "" {
			var ok bool
			updated, ok = appendNotesInLine(updated, notesAppend, notesIdx)
			if !ok {
				return fmt.Errorf("failed to append notes: notes column index %d out of bounds", notesIdx)
			}
		}
		lines[i] = updated
		found = true
		break
	}

	if !found {
		return fmt.Errorf("application not found: report %s", app.ReportNumber)
	}

	return writeFileAtomic(filePath, []byte(strings.Join(lines, "\n")))
}

// appendNotesInLine appends text to the Notes cell of a tracker row without
// disturbing any other cell. notesField is the 0-based column index returned
// by resolveTrackerColumns.
func appendNotesInLine(line, text string, notesField int) (string, bool) {
	if notesField < 0 {
		return line, false
	}
	if strings.Contains(line, "\t") {
		prefix, body, found := strings.Cut(line, "|")
		if !found {
			return line, false
		}
		cells := strings.Split(body, "\t")
		if notesField < len(cells) {
			old := strings.TrimSpace(cells[notesField])
			if old == "" {
				cells[notesField] = " " + text + " "
			} else {
				cells[notesField] = " " + old + " " + text + " "
			}
			return prefix + "|" + strings.Join(cells, "\t"), true
		}
		return line, false
	}

	segments := strings.Split(line, "|")
	if notesField+1 < len(segments) {
		old := strings.TrimSpace(segments[notesField+1])
		if old == "" {
			segments[notesField+1] = " " + text + " "
		} else {
			segments[notesField+1] = " " + old + " " + text + " "
		}
		return strings.Join(segments, "|"), true
	}
	return line, false
}

// replaceStatusInLine rewrites only the Status cell of a tracker row, leaving
// every other cell untouched. The previous implementation used
// strings.Replace(line, oldStatus, …, 1), which replaces the first occurrence of
// the status text anywhere in the row — so a status word appearing as a
// substring of an earlier cell (e.g. Company "Applied Materials") was rewritten
// instead of the Status cell, corrupting that cell while the status appeared to
// stay unchanged (#1180). Matching is whole-cell (never a substring) and, as the
// old comment claimed but the code did not, case-insensitive.
//
// statusField is the Status column index in splitTrackerRow field space (5 in
// the legacy layout), resolved from the table header so a customized layout
// (e.g. an inserted Location column) targets the right cell.
func replaceStatusInLine(line, oldStatus, newStatus string, statusField int) (string, bool) {
	want := strings.TrimSpace(oldStatus)

	// Mixed "| " + tab-separated format (mirrors ParseApplications). The body is
	// tab-split, so cell index equals the field index.
	if strings.Contains(line, "\t") {
		prefix, body, found := strings.Cut(line, "|")
		if !found {
			return line, false
		}
		cells := strings.Split(body, "\t")
		if idx := statusCellIndex(cells, statusField, want); idx >= 0 {
			cells[idx] = spliceCellValue(cells[idx], newStatus)
			return prefix + "|" + strings.Join(cells, "\t"), true
		}
		return line, false
	}

	// Pure pipe format. strings.Split keeps the segments between pipes; content
	// cell N is segment N+1 (segment 0 is the empty text before the leading
	// pipe), so the Status field maps to segment statusField+1.
	segments := strings.Split(line, "|")
	if idx := statusCellIndex(segments, statusField+1, want); idx >= 0 {
		segments[idx] = spliceCellValue(segments[idx], newStatus)
		return strings.Join(segments, "|"), true
	}
	return line, false
}

// statusCellIndex returns the index of the Status cell. It prefers the canonical
// column (canonicalIdx, matching ParseApplications) and verifies it by value; if
// that doesn't match — e.g. a custom tracker layout — it falls back to the first
// cell that equals want exactly. Matching is whole-cell and case-insensitive,
// never a substring, so a status word inside an earlier cell is never hit.
// Returns -1 when nothing matches, so the caller leaves the row untouched rather
// than corrupt a guess.
func statusCellIndex(cells []string, canonicalIdx int, want string) int {
	if canonicalIdx < len(cells) && strings.EqualFold(strings.TrimSpace(cells[canonicalIdx]), want) {
		return canonicalIdx
	}
	for i, c := range cells {
		if strings.EqualFold(strings.TrimSpace(c), want) {
			return i
		}
	}
	return -1
}

// spliceCellValue swaps a cell's inner value while preserving its surrounding
// whitespace, so "| Applied |" becomes "| Interview |" rather than "|Interview|".
func spliceCellValue(cell, newVal string) string {
	trimmed := strings.TrimSpace(cell)
	if trimmed == "" {
		if len(cell) >= 2 {
			half := len(cell) / 2
			return cell[:half] + newVal + cell[half:]
		}
		return " " + newVal + " "
	}
	start := strings.Index(cell, trimmed)
	return cell[:start] + newVal + cell[start+len(trimmed):]
}

// cleanTableCell removes trailing pipes and whitespace from a table cell value.
func cleanTableCell(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimRight(s, "|")
	return strings.TrimSpace(s)
}

// StatusPriority returns the sort priority for a status (lower = higher priority).
func StatusPriority(status string) int {
	switch NormalizeStatus(status) {
	case "interview":
		return 0
	case "offer":
		return 1
	case "responded":
		return 2
	case "applied":
		return 3
	case "evaluated":
		return 4
	case "skip":
		return 5
	case "rejected":
		return 6
	case "discarded":
		return 7
	default:
		return 8
	}
}

// ComputeProgressMetrics computes progress-oriented analytics from applications.
func ComputeProgressMetrics(apps []model.CareerApplication) model.ProgressMetrics {
	pm := model.ProgressMetrics{}

	// Count by normalized status
	statusCounts := make(map[string]int)
	var totalScore float64
	var scored int

	for _, app := range apps {
		norm := NormalizeStatus(app.Status)
		statusCounts[norm]++

		if app.Score > 0 {
			totalScore += app.Score
			scored++
			if app.Score > pm.TopScore {
				pm.TopScore = app.Score
			}
		}

		if norm == "offer" {
			pm.TotalOffers++
		}
		if norm != "skip" && norm != "rejected" && norm != "discarded" {
			pm.ActiveApps++
		}
	}

	if scored > 0 {
		pm.AvgScore = totalScore / float64(scored)
	}

	// Funnel: each stage counts all apps that reached at least that stage.
	// An app in "interview" has passed through evaluated -> applied -> responded -> interview.
	total := len(apps)
	applied := statusCounts["applied"] + statusCounts["responded"] + statusCounts["interview"] + statusCounts["offer"] + statusCounts["rejected"]
	responded := statusCounts["responded"] + statusCounts["interview"] + statusCounts["offer"]
	interview := statusCounts["interview"] + statusCounts["offer"]
	offer := statusCounts["offer"]

	pm.FunnelStages = []model.FunnelStage{
		{Label: "Evaluated", Count: total, Pct: 100.0},
		{Label: "Applied", Count: applied, Pct: safePct(applied, total)},
		{Label: "Responded", Count: responded, Pct: safePct(responded, applied)},
		{Label: "Interview", Count: interview, Pct: safePct(interview, applied)},
		{Label: "Offer", Count: offer, Pct: safePct(offer, applied)},
	}

	// Rates (relative to applied)
	if applied > 0 {
		pm.ResponseRate = float64(responded) / float64(applied) * 100
		pm.InterviewRate = float64(interview) / float64(applied) * 100
		pm.OfferRate = float64(offer) / float64(applied) * 100
	}

	// Score distribution
	buckets := [5]int{} // 0: 4.5-5.0, 1: 4.0-4.4, 2: 3.5-3.9, 3: 3.0-3.4, 4: <3.0
	for _, app := range apps {
		if app.Score <= 0 {
			continue
		}
		switch {
		case app.Score >= 4.5:
			buckets[0]++
		case app.Score >= 4.0:
			buckets[1]++
		case app.Score >= 3.5:
			buckets[2]++
		case app.Score >= 3.0:
			buckets[3]++
		default:
			buckets[4]++
		}
	}
	pm.ScoreBuckets = []model.ScoreBucket{
		{Label: "4.5-5.0", Count: buckets[0]},
		{Label: "4.0-4.4", Count: buckets[1]},
		{Label: "3.5-3.9", Count: buckets[2]},
		{Label: "3.0-3.4", Count: buckets[3]},
		{Label: "  <3.0", Count: buckets[4]},
	}

	// Weekly activity: group by ISO week from Date field, show last 8 weeks.
	weekCounts := make(map[string]int)
	for _, app := range apps {
		if app.Date == "" {
			continue
		}
		t, err := time.Parse("2006-01-02", app.Date)
		if err != nil {
			continue
		}
		year, week := t.ISOWeek()
		key := fmt.Sprintf("%d-W%02d", year, week)
		weekCounts[key]++
	}

	// Sort weeks and take last 8
	var weeks []string
	for w := range weekCounts {
		weeks = append(weeks, w)
	}
	sort.Strings(weeks)
	if len(weeks) > 8 {
		weeks = weeks[len(weeks)-8:]
	}

	for _, w := range weeks {
		pm.WeeklyActivity = append(pm.WeeklyActivity, model.WeekActivity{
			Week:  w,
			Count: weekCounts[w],
		})
	}

	return pm
}

// safePct returns the percentage of part/whole, or 0 if whole is 0.
func safePct(part, whole int) float64 {
	if whole == 0 {
		return 0
	}
	return float64(part) / float64(whole) * 100
}

// LoadReportDiscardReasons parses predicted discard reasons from a report file.
func LoadReportDiscardReasons(careerOpsPath, reportPath string) []string {
	if reportPath == "" {
		return nil
	}
	p := reportPath
	if strings.Contains(p, "](") {
		idx := strings.Index(p, "](")
		p = p[idx+2:]
		p = strings.TrimSuffix(p, ")")
	}
	fullPath := filepath.Join(careerOpsPath, p)
	content, err := os.ReadFile(fullPath)
	if err != nil {
		return nil
	}
	text := string(content)

	match := reDiscardReasons.FindStringSubmatch(text)
	if len(match) < 2 {
		return nil
	}

	itemsMatch := reDiscardItem.FindAllStringSubmatch(match[1], -1)
	var reasons []string
	for _, item := range itemsMatch {
		reasons = append(reasons, strings.TrimSpace(item[1]))
	}
	return reasons
}

// SaveAnonymousStat records an anonymized win stat to data/reported-hires.tsv.
func SaveAnonymousStat(careerOpsPath string, role string, weeks int) error {
	dirPath := filepath.Join(careerOpsPath, "data")
	if err := os.MkdirAll(dirPath, 0755); err != nil {
		return err
	}
	filePath := filepath.Join(dirPath, "reported-hires.tsv")
	f, err := os.OpenFile(filePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()

	fi, err := f.Stat()
	if err == nil && fi.Size() == 0 {
		_, _ = f.WriteString("Date\tRoleType\tWeeksToHire\n")
	}

	dateStr := time.Now().Format("2006-01-02")
	_, err = f.WriteString(fmt.Sprintf("%s\t%s\t%d\n", dateStr, role, weeks))
	return err
}
