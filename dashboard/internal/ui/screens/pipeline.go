package screens

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/i18n"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// PipelineClosedMsg is emitted when the pipeline screen is dismissed.
type PipelineClosedMsg struct{}

// PipelineOpenReportMsg is emitted when a report should be opened in FileViewer.
type PipelineOpenReportMsg struct {
	Path   string
	Title  string
	JobURL string
	App    model.CareerApplication
}

// PipelineOpenURLMsg is emitted when a job URL should be opened in browser.
type PipelineOpenURLMsg struct {
	URL string
}

// PipelineOpenPDFMsg is emitted when a generated CV PDF should be opened
// with the OS default handler. Path is absolute.
type PipelineOpenPDFMsg struct {
	Path string
}

// PipelineGeneratePDFMsg requests a PDF regeneration via generate-pdf.mjs
// from the application's recorded source HTML. Paths are relative to
// CareerOpsPath (as recorded in the manifest).
type PipelineGeneratePDFMsg struct {
	CareerOpsPath string
	ReportNumber  string
	HTMLPath      string
	PDFPath       string
	Format        string
}

// PipelinePDFGeneratedMsg reports the outcome of a regeneration. On success
// Err is empty and Path holds the absolute path of the (already opened) PDF.
type PipelinePDFGeneratedMsg struct {
	Err  string
	Path string
}

// PipelineLoadReportMsg requests lazy loading of a report summary.
type PipelineLoadReportMsg struct {
	CareerOpsPath string
	ReportPath    string
}

// PipelineUpdateStatusMsg requests a status update for an application.
type PipelineUpdateStatusMsg struct {
	CareerOpsPath string
	App           model.CareerApplication
	NewStatus     string
}

// PipelineUpdateStatusAndNotesMsg requests an atomic status + notes update.
// Used by the discard reason picker (Issue 1380) to commit both changes in a
// single tracker write.
type PipelineUpdateStatusAndNotesMsg struct {
	CareerOpsPath string
	App           model.CareerApplication
	NewStatus     string
	NotesAppend   string // text to append to the Notes cell, e.g. "DISCARD: salary_too_low"
}

// PipelineDiscardReasonsLoadedMsg delivers predicted discard reasons from a
// report back to the pipeline model so the picker can show them.
type PipelineDiscardReasonsLoadedMsg struct {
	Reasons []string
}

// PipelineRefreshMsg requests a full tracker reload from disk.
type PipelineRefreshMsg struct{}

// PipelineOpenProgressMsg is emitted when the progress screen should open.
type PipelineOpenProgressMsg struct{}

var canonicalDiscardReasons = []string{
	"salary_too_low",
	"hybrid_required",
	"tech_stack_mismatch",
	"seniority_mismatch",
	"geo_restriction",
	"size_mismatch",
	"company_culture",
}

type reportSummary struct {
	archetype string
	tldr      string
	remote    string
	comp      string
}

const storyTemplateURL = "https://github.com/santifer/career-ops/issues/new?template=i-got-hired.yml"

// Sort modes
const (
	sortScore    = "score"
	sortDate     = "date"
	sortCompany  = "company"
	sortStatus   = "status"
	sortLocation = "location"
	sortPay      = "pay"
	sortLast     = "last"
)

// Filter modes
const (
	filterAll       = "all"
	filterEvaluated = "evaluated"
	filterApplied   = "applied"
	filterInterview = "interview"
	filterSkip      = "skip"
	filterRejected  = "rejected"
	filterDiscarded = "discarded"
	filterTop       = "top"
)

type pipelineTab struct {
	filter string
	label  string
}

func getPipelineTabs() []pipelineTab {
	return []pipelineTab{
		{filterAll, i18n.Current.TabAll},
		{filterEvaluated, i18n.Current.TabEvaluated},
		{filterApplied, i18n.Current.TabApplied},
		{filterInterview, i18n.Current.TabInterview},
		{filterTop, i18n.Current.TabTop},
		{filterSkip, i18n.Current.TabSkip},
		{filterRejected, i18n.Current.TabRejected},
		{filterDiscarded, i18n.Current.TabDiscarded},
	}
}

var sortCycle = []string{sortScore, sortDate, sortCompany, sortStatus, sortLocation, sortPay, sortLast}

// ColumnID identifies an optional table column in the pipeline view.
type ColumnID int

const (
	// Optional columns — user-toggleable via the column picker (C key).
	ColDate        ColumnID = iota // APPLIED date
	ColLocation                    // LOCATION city+state
	ColPay                         // PAY range
	ColHasReport                   // RPT: ✓/—
	ColHasPDF                      // PDF: ✓/—
	ColLastContact                 // LAST contact date
)

// colDef describes one optional column for the picker UI.
type colDef struct {
	id          ColumnID
	header      string
	hint        string
	width       int
	onByDefault bool
}

func getOptionalCols() []colDef {
	return []colDef{
		{ColDate, i18n.Current.ColApplied, "", 10, true},
		{ColLocation, i18n.Current.ColLocation, "", 20, true},
		{ColPay, i18n.Current.ColPay, "", 16, true},
		{ColHasReport, i18n.Current.ColReport, "✓/—", 4, false},
		{ColHasPDF, i18n.Current.ColPDF, "✓/—", 4, false},
		{ColLastContact, i18n.Current.ColLast, "", 10, false},
	}
}

type StatusPair struct {
	Display   string
	Canonical string
}

func getStatusPairs() []StatusPair {
	return []StatusPair{
		{i18n.Current.StatusEvaluated, "Evaluated"},
		{i18n.Current.StatusApplied, "Applied"},
		{i18n.Current.StatusResponded, "Responded"},
		{i18n.Current.StatusInterview, "Interview"},
		{i18n.Current.StatusOffer, "Offer"},
		{i18n.Current.StatusHired, "Hired"},
		{i18n.Current.StatusRejected, "Rejected"},
		{i18n.Current.StatusDiscarded, "Discarded"},
		{i18n.Current.StatusSkip, "Skip"},
	}
}

// statusGroupOrder defines display order for grouped view.
var statusGroupOrder = []string{"hired", "interview", "offer", "responded", "applied", "evaluated", "skip", "rejected", "discarded"}

// PipelineModel implements the career pipeline dashboard screen.
type PipelineModel struct {
	apps          []model.CareerApplication
	filtered      []model.CareerApplication
	metrics       model.PipelineMetrics
	cursor        int
	scrollOffset  int
	sortMode      string
	activeTab     int
	viewMode      string // "grouped" or "flat"
	width, height int
	theme         theme.Theme
	careerOpsPath string
	reportCache   map[string]reportSummary
	// Status picker sub-state
	statusPicker bool
	statusCursor int
	// Discard reason picker sub-state (Issue 1380) — opens when status
	// transitions to Discarded or SKIP, pre-populated from the report's
	// predicted discard_reasons, plus canonical fallback options.
	discardPicker         bool
	discardCursor         int
	discardOptions        []string                // predicted + canonical options shown to user
	discardCustomInput    bool                    // true when "Other…" is selected and user is typing
	discardCustomText     string                  // free-text typed for "Other…" reason
	discardPendingApp     model.CareerApplication // app awaiting the reason pick
	discardPendingStatus  string                  // new status to commit with the reason
	discardPredictedCount int                     // count of predicted reasons (from report)

	// PDF picker sub-state — shown when one application matches several
	// generated CVs (role variants from the same company).
	pdfPicker  bool
	pdfCursor  int
	pdfChoices []string // root-relative paths, newest first
	// flash is a one-shot notice rendered in place of the help bar; any
	// keypress clears it.
	flash string
	// Search sub-state — narrows the active tab by substring on company/role/notes.
	searchInput bool   // true while the user is typing the query
	searchQuery string // committed (or in-progress) lowercased query
	// Column picker sub-state — opened with C, closed with esc.
	colPicker    bool
	colPickerIdx int
	visibleCols  map[ColumnID]bool

	// Hired win flow sub-state (Issue 1447)
	hiredApp  model.CareerApplication
	hiredStep int // 0 = inactive, 1 = celebration, 2 = story invite, 3 = anonymous stat
}

// IsTextInputActive returns true if the search or any other text input is currently focused
func (m PipelineModel) IsTextInputActive() bool {
	return m.searchInput || m.discardCustomInput
}

// NewPipelineModel creates a new pipeline screen.
func NewPipelineModel(t theme.Theme, apps []model.CareerApplication, metrics model.PipelineMetrics, careerOpsPath string, width, height int) PipelineModel {
	visible := make(map[ColumnID]bool)
	for _, col := range getOptionalCols() {
		visible[col.id] = col.onByDefault
	}
	m := PipelineModel{
		apps:          apps,
		metrics:       metrics,
		sortMode:      sortScore,
		activeTab:     0,
		viewMode:      "grouped",
		width:         width,
		height:        height,
		theme:         t,
		careerOpsPath: careerOpsPath,
		reportCache:   make(map[string]reportSummary),
		visibleCols:   visible,
	}
	m.applyFilterAndSort()
	return m
}

// Init implements tea.Model.
func (m PipelineModel) Init() tea.Cmd {
	return nil
}

// Resize updates dimensions.
func (m *PipelineModel) Resize(width, height int) {
	m.width = width
	m.height = height
}

// Width returns the current width.
func (m PipelineModel) Width() int { return m.width }

// Height returns the current height.
func (m PipelineModel) Height() int { return m.height }

// CopyReportCache copies the report cache from another pipeline model.
func (m *PipelineModel) CopyReportCache(other *PipelineModel) {
	for k, v := range other.reportCache {
		m.reportCache[k] = v
	}
}

// EnrichReport caches report summary data for preview.
func (m *PipelineModel) EnrichReport(reportPath, archetype, tldr, remote, comp string) {
	m.reportCache[reportPath] = reportSummary{
		archetype: archetype,
		tldr:      tldr,
		remote:    remote,
		comp:      comp,
	}
}

// WithReloadedData rebuilds the pipeline with fresh tracker data while preserving
// the current UI state so manual refresh feels seamless.
func (m PipelineModel) WithReloadedData(apps []model.CareerApplication, metrics model.PipelineMetrics) PipelineModel {
	selectedReportPath := ""
	selectedCompany := ""
	selectedRole := ""
	if app, ok := m.CurrentApp(); ok {
		selectedReportPath = app.ReportPath
		selectedCompany = app.Company
		selectedRole = app.Role
	}

	reloaded := NewPipelineModel(m.theme, apps, metrics, m.careerOpsPath, m.width, m.height)
	reloaded.sortMode = m.sortMode
	reloaded.activeTab = m.activeTab
	reloaded.viewMode = m.viewMode
	// Preserve search state across refresh — otherwise pressing `r` silently drops a
	// committed query and the user loses their place mid-investigation.
	reloaded.searchQuery = m.searchQuery
	reloaded.searchInput = m.searchInput
	// Preserve user's column visibility choices across refresh.
	reloaded.visibleCols = m.visibleCols
	reloaded.applyFilterAndSort()
	reloaded.CopyReportCache(&m)

	for i, app := range reloaded.filtered {
		if selectedReportPath != "" && app.ReportPath == selectedReportPath {
			reloaded.cursor = i
			reloaded.adjustScroll()
			return reloaded
		}
		if selectedReportPath == "" && app.Company == selectedCompany && app.Role == selectedRole {
			reloaded.cursor = i
			reloaded.adjustScroll()
			return reloaded
		}
	}

	if len(reloaded.filtered) == 0 {
		reloaded.cursor = 0
		reloaded.scrollOffset = 0
		return reloaded
	}

	if m.cursor >= len(reloaded.filtered) {
		reloaded.cursor = len(reloaded.filtered) - 1
	} else if m.cursor > 0 {
		reloaded.cursor = m.cursor
	}
	reloaded.adjustScroll()
	return reloaded
}

// CurrentApp returns the currently selected application, if any.
func (m PipelineModel) CurrentApp() (model.CareerApplication, bool) {
	if m.cursor < 0 || m.cursor >= len(m.filtered) {
		return model.CareerApplication{}, false
	}
	return m.filtered[m.cursor], true
}

// Update handles input for the pipeline screen.
func (m PipelineModel) Update(msg tea.Msg) (PipelineModel, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		m.flash = ""
		if m.hiredStep > 0 {
			return m.handleHiredFlow(msg)
		}
		if m.colPicker {
			return m.handleColPicker(msg)
		}
		if m.statusPicker {
			return m.handleStatusPicker(msg)
		}
		if m.discardPicker {
			return m.handleDiscardPicker(msg)
		}
		if m.pdfPicker {
			return m.handlePDFPicker(msg)
		}
		if m.searchInput {
			return m.handleSearchInput(msg)
		}
		return m.handleKey(msg)
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil
	case PipelinePDFGeneratedMsg:
		if msg.Err != "" {
			m.flash = "PDF regeneration failed: " + msg.Err
		} else {
			m.flash = "PDF regenerated and opened: " + filepath.Base(msg.Path)
		}
		return m, nil
	case pipelineStartDiscardPickerMsg:
		// Issue 1380: initialise the discard reason picker state.
		// Merge predicted reasons (from report) with canonical fallback options.
		seen := make(map[string]bool)
		var opts []string
		numPredicted := 0
		for _, r := range msg.predictedReasons {
			if !seen[r] {
				opts = append(opts, r)
				seen[r] = true
				numPredicted++
			}
		}
		for _, c := range canonicalDiscardReasons {
			if !seen[c] {
				opts = append(opts, c)
				seen[c] = true
			}
		}
		opts = append(opts, "Other…")
		m.discardPicker = true
		m.discardCursor = 0
		m.discardOptions = opts
		m.discardPredictedCount = numPredicted
		m.discardCustomInput = false
		m.discardCustomText = ""
		m.discardPendingApp = msg.app
		m.discardPendingStatus = msg.newStatus
		return m, nil
	}
	return m, nil
}

func (m PipelineModel) handleKey(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc":
		// While a search is committed, Esc clears the search (matches vim's `:nohl`
		// ergonomics). With no query, Esc is a no-op — q is the only quit key, which
		// keeps the help bar honest and avoids accidental exits.
		if m.searchQuery != "" {
			m.searchQuery = ""
			m.applyFilterAndSort()
			m.cursor = 0
			m.scrollOffset = 0
			return m, m.loadCurrentReport()
		}
		return m, nil

	case "q":
		return m, func() tea.Msg { return PipelineClosedMsg{} }

	case "/":
		// Open search input. Pre-fill with the current query so refining is one keystroke away.
		m.searchInput = true
		return m, nil

	case "down", "j":
		if len(m.filtered) > 0 {
			m.cursor++
			if m.cursor >= len(m.filtered) {
				m.cursor = len(m.filtered) - 1
			}
			m.adjustScroll()
			return m, m.loadCurrentReport()
		}

	case "up", "k":
		if len(m.filtered) > 0 {
			m.cursor--
			if m.cursor < 0 {
				m.cursor = 0
			}
			m.adjustScroll()
			return m, m.loadCurrentReport()
		}

	case "s":
		// Cycle sort mode
		for i, s := range sortCycle {
			if s == m.sortMode {
				m.sortMode = sortCycle[(i+1)%len(sortCycle)]
				break
			}
		}
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0

	case "f", "right", "l":
		m.activeTab++
		if m.activeTab >= len(getPipelineTabs()) {
			m.activeTab = 0
		}
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0

	case "left", "h":
		m.activeTab--
		if m.activeTab < 0 {
			m.activeTab = len(getPipelineTabs()) - 1
		}
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0

	case "v":
		if m.viewMode == "grouped" {
			m.viewMode = "flat"
		} else {
			m.viewMode = "grouped"
		}

	case "enter":
		if app, ok := m.CurrentApp(); ok && app.ReportPath != "" {
			fullPath := filepath.Join(m.careerOpsPath, app.ReportPath)
			title := fmt.Sprintf("%s — %s", app.Company, app.Role)
			jobURL := app.JobURL
			return m, func() tea.Msg {
				return PipelineOpenReportMsg{Path: fullPath, Title: title, JobURL: jobURL, App: app}
			}
		}

	case "o":
		if app, ok := m.CurrentApp(); ok && app.JobURL != "" {
			return m, func() tea.Msg {
				return PipelineOpenURLMsg{URL: app.JobURL}
			}
		}

	case "m":
		return m, func() tea.Msg {
			return PipelineOpenURLMsg{URL: "https://career-ops.org/manifesto?utm_source=dashboard-shortcut"}
		}

	case "d":
		if app, ok := m.CurrentApp(); ok {
			manifest := data.LoadPDFManifest(m.careerOpsPath)
			candidates := data.ResolvePDFs(m.careerOpsPath, app, manifest)
			if len(candidates) == 0 {
				m.flash = "No CV PDF found for this application — generate one with /career-ops pdf"
			} else {
				return m, m.openPDFCmd(candidates[0]) // newest first
			}
		}

	case "D":
		if app, ok := m.CurrentApp(); ok {
			manifest := data.LoadPDFManifest(m.careerOpsPath)
			entry, found := manifest.Lookup(app)
			// Manifest lookup requires a report number; fall back to PDF-path
			// index when the manifest was written without --report (common case).
			if !found || entry.HTMLPath == "" {
				byPath := data.LoadPDFEntriesByPath(m.careerOpsPath)
				candidates := data.ResolvePDFs(m.careerOpsPath, app, manifest)
				for _, c := range candidates {
					if e, ok := byPath[c]; ok && e.HTMLPath != "" {
						entry = e
						found = true
						break
					}
				}
			}
			if !found || entry.HTMLPath == "" {
				m.flash = "No source HTML found for this application — run /career-ops pdf first"
				return m, nil
			}
			if _, err := os.Stat(filepath.Join(m.careerOpsPath, filepath.FromSlash(entry.HTMLPath))); err != nil {
				m.flash = "Source HTML missing: " + entry.HTMLPath
				return m, nil
			}
			m.flash = "Regenerating PDF via generate-pdf.mjs — this takes a few seconds..."
			path, report := m.careerOpsPath, entry.ReportNumber
			html, pdf, format := entry.HTMLPath, entry.PDFPath, entry.Format
			return m, func() tea.Msg {
				return PipelineGeneratePDFMsg{
					CareerOpsPath: path,
					ReportNumber:  report,
					HTMLPath:      html,
					PDFPath:       pdf,
					Format:        format,
				}
			}
		}

	case "p":
		return m, func() tea.Msg { return PipelineOpenProgressMsg{} }

	case "r":
		return m, func() tea.Msg { return PipelineRefreshMsg{} }

	case "C":
		m.colPicker = true
		m.colPickerIdx = 0
		return m, nil

	case "c":
		if len(m.filtered) > 0 {
			m.statusPicker = true
			m.statusCursor = 0
		}

	case "g":
		if len(m.filtered) > 0 {
			m.cursor = 0
			m.scrollOffset = 0
			return m, m.loadCurrentReport()
		}

	case "G":
		if len(m.filtered) > 0 {
			m.cursor = len(m.filtered) - 1
			m.adjustScroll()
			return m, m.loadCurrentReport()
		}

	case "pgdown", "ctrl+d":
		if len(m.filtered) > 0 {
			halfPage := m.height / 2
			if halfPage < 1 {
				halfPage = 1
			}
			m.cursor += halfPage
			if m.cursor >= len(m.filtered) {
				m.cursor = len(m.filtered) - 1
			}
			m.adjustScroll()
			return m, m.loadCurrentReport()
		}

	case "pgup", "ctrl+u":
		if len(m.filtered) > 0 {
			halfPage := m.height / 2
			if halfPage < 1 {
				halfPage = 1
			}
			m.cursor -= halfPage
			if m.cursor < 0 {
				m.cursor = 0
			}
			m.adjustScroll()
			return m, m.loadCurrentReport()
		}
	}

	return m, nil
}

// handleSearchInput consumes keys while the search input bar is open.
// Esc cancels (closes input AND clears query). Enter commits (closes input,
// keeps query, refreshes filtered list). Backspace + printable chars edit
// the query and live-update the filter so the user sees results as they type.
//
// Report previews are NOT lazy-loaded on every keystroke — that would trigger
// a synchronous os.ReadFile per rune/backspace/ctrl+u and stutter live
// typing. Instead the load fires once when the user commits (Enter) or
// cancels (Esc); subsequent cursor movement in handleKey loads as before.
func (m PipelineModel) handleSearchInput(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.searchInput = false
		m.searchQuery = ""
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0
		return m, m.loadCurrentReport()

	case "enter":
		m.searchInput = false
		// Query already applied during typing; load the preview for the
		// committed first match (skipped during typing for perf).
		return m, m.loadCurrentReport()

	case "backspace":
		if len(m.searchQuery) > 0 {
			// Drop the last UTF-8 rune so multi-byte characters delete cleanly.
			runes := []rune(m.searchQuery)
			m.searchQuery = string(runes[:len(runes)-1])
			m.applyFilterAndSort()
			m.cursor = 0
			m.scrollOffset = 0
		}
		return m, nil

	case "ctrl+u":
		// vim-flavored: clear the in-progress query without leaving search mode.
		m.searchQuery = ""
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0
		return m, nil
	}

	// Append printable runes (ignore other special keys like arrows / ctrl-combos).
	if r := msg.Runes; len(r) > 0 {
		m.searchQuery += strings.ToLower(string(r))
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0
		return m, nil
	}
	return m, nil
}

func (m PipelineModel) handleStatusPicker(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc", "q":
		m.statusPicker = false
		return m, nil

	case "down", "j":
		m.statusCursor++
		if m.statusCursor >= len(getStatusPairs()) {
			m.statusCursor = len(getStatusPairs()) - 1
		}

	case "up", "k":
		m.statusCursor--
		if m.statusCursor < 0 {
			m.statusCursor = 0
		}

	case "enter":
		m.statusPicker = false
		if app, ok := m.CurrentApp(); ok {
			newStatus := getStatusPairs()[m.statusCursor].Canonical
			norm := data.NormalizeStatus(newStatus)
			if norm == "hired" {
				m.hiredApp = app
				m.hiredStep = 1
				return m, func() tea.Msg {
					return PipelineUpdateStatusMsg{
						CareerOpsPath: m.careerOpsPath,
						App:           app,
						NewStatus:     newStatus,
					}
				}
			}
			if norm == "discarded" || norm == "skip" {
				return m, func() tea.Msg {
					return m.startDiscardFlow(app, newStatus)
				}
			}
			return m, func() tea.Msg {
				return PipelineUpdateStatusMsg{
					CareerOpsPath: m.careerOpsPath,
					App:           app,
					NewStatus:     newStatus,
				}
			}
		}
	}
	return m, nil
}

// startDiscardFlow loads predicted reasons from the report (if any), merges
// them with the canonical fallback list, and returns a message that triggers
// the discard picker overlay. Called synchronously inside a Cmd so it can do
// file I/O without blocking the Bubble Tea event loop.
func (m PipelineModel) startDiscardFlow(app model.CareerApplication, newStatus string) tea.Msg {
	predicted := data.LoadReportDiscardReasons(m.careerOpsPath, app.ReportPath)
	return pipelineStartDiscardPickerMsg{
		app:              app,
		newStatus:        newStatus,
		predictedReasons: predicted,
	}
}

// pipelineStartDiscardPickerMsg is an internal message that initialises the
// discard reason picker state on the model. It is dispatched from startDiscardFlow.
type pipelineStartDiscardPickerMsg struct {
	app              model.CareerApplication
	newStatus        string
	predictedReasons []string
}

// handlePDFPicker consumes keys while the PDF picker overlay is open.
func (m PipelineModel) handlePDFPicker(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc", "q":
		m.pdfPicker = false
		return m, nil

	case "down", "j":
		m.pdfCursor++
		if m.pdfCursor >= len(m.pdfChoices) {
			m.pdfCursor = len(m.pdfChoices) - 1
		}

	case "up", "k":
		m.pdfCursor--
		if m.pdfCursor < 0 {
			m.pdfCursor = 0
		}

	case "enter", "d":
		m.pdfPicker = false
		if m.pdfCursor >= 0 && m.pdfCursor < len(m.pdfChoices) {
			return m, m.openPDFCmd(m.pdfChoices[m.pdfCursor])
		}
	}
	return m, nil
}

// handleDiscardPicker consumes keys while the discard reason picker is open
// (Issue 1380). When "Other…" is focused and Enter is pressed, it enters a
// free-text sub-mode where the user types a custom reason and confirms with
// Enter again. Esc at any point skips tagging and just commits the status.
func (m PipelineModel) handleDiscardPicker(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	// Free-text sub-mode for "Other…"
	if m.discardCustomInput {
		switch msg.String() {
		case "enter":
			reason := strings.TrimSpace(m.discardCustomText)
			reason = strings.ReplaceAll(reason, ",", " ")
			reason = strings.ReplaceAll(reason, ";", " ")
			reason = strings.ReplaceAll(reason, "\n", " ")
			reason = strings.ReplaceAll(reason, "\r", " ")
			reason = strings.ReplaceAll(reason, "\t", " ")
			reason = strings.Join(strings.Fields(reason), " ")
			reason = strings.TrimSpace(reason)
			if reason == "" {
				reason = "other"
			}
			return m.commitDiscardReason(reason)
		case "esc":
			m.discardCustomInput = false
			m.discardCustomText = ""
		case "backspace", "ctrl+h":
			if len(m.discardCustomText) > 0 {
				m.discardCustomText = m.discardCustomText[:len(m.discardCustomText)-1]
			}
		default:
			if len(msg.Runes) > 0 {
				m.discardCustomText += string(msg.Runes)
			}
		}
		return m, nil
	}

	switch msg.String() {
	case "esc":
		// Skip reason tagging — still commit the status change.
		m.discardPicker = false
		return m, func() tea.Msg {
			return PipelineUpdateStatusMsg{
				CareerOpsPath: m.careerOpsPath,
				App:           m.discardPendingApp,
				NewStatus:     m.discardPendingStatus,
			}
		}

	case "down", "j":
		m.discardCursor++
		if m.discardCursor >= len(m.discardOptions) {
			m.discardCursor = len(m.discardOptions) - 1
		}

	case "up", "k":
		m.discardCursor--
		if m.discardCursor < 0 {
			m.discardCursor = 0
		}

	case "enter":
		if m.discardCursor < 0 || m.discardCursor >= len(m.discardOptions) {
			break
		}
		chosen := m.discardOptions[m.discardCursor]
		if chosen == "Other…" {
			m.discardCustomInput = true
			m.discardCustomText = ""
			return m, nil
		}
		return m.commitDiscardReason(chosen)
	}
	return m, nil
}

func (m PipelineModel) StartHiredFlow(app model.CareerApplication) (PipelineModel, tea.Cmd) {
	m.hiredApp = app
	m.hiredStep = 1
	return m, nil
}

func (m PipelineModel) StartDiscardReasonFlow(app model.CareerApplication, status string) (PipelineModel, tea.Cmd) {
	predicted := data.LoadReportDiscardReasons(m.careerOpsPath, app.ReportPath)
	seen := make(map[string]bool)
	var opts []string
	numPredicted := 0
	for _, r := range predicted {
		if !seen[r] {
			opts = append(opts, r)
			seen[r] = true
			numPredicted++
		}
	}
	for _, c := range canonicalDiscardReasons {
		if !seen[c] {
			opts = append(opts, c)
			seen[c] = true
		}
	}
	opts = append(opts, "Other…")
	m.discardPicker = true
	m.discardCursor = 0
	m.discardOptions = opts
	m.discardPredictedCount = numPredicted
	m.discardCustomInput = false
	m.discardCustomText = ""
	m.discardPendingApp = app
	m.discardPendingStatus = status
	return m, nil
}

func (m PipelineModel) handleHiredFlow(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch m.hiredStep {
	case 1: // win screen
		if msg.String() == "enter" {
			m.hiredStep = 2
		}
	case 2: // story invite
		switch msg.String() {
		case "y", "Y":
			m.hiredStep = 3
			return m, func() tea.Msg {
				return PipelineOpenURLMsg{URL: storyTemplateURL}
			}
		case "n", "N", "enter", "esc":
			m.hiredStep = 3
		}
	case 3: // anonymous stat
		switch msg.String() {
		case "y", "Y":
			weeks := m.calculateWeeksToHire()
			if err := data.SaveAnonymousStat(m.careerOpsPath, m.hiredApp.Role, weeks); err != nil {
				m.flash = "Could not record anonymous stat: " + err.Error()
			}
			m.hiredStep = 0
		case "n", "N", "enter", "esc":
			m.hiredStep = 0
		}
	}
	return m, nil
}

// commitDiscardReason closes the picker and emits PipelineUpdateStatusAndNotesMsg
// to atomically persist the new status plus a DISCARD/SKIP tag in Notes.
func (m PipelineModel) commitDiscardReason(reason string) (PipelineModel, tea.Cmd) {
	m.discardPicker = false
	m.discardCustomInput = false
	app := m.discardPendingApp
	newStatus := m.discardPendingStatus
	prefix := "DISCARD"
	if strings.ToLower(newStatus) == "skip" {
		prefix = "SKIP"
	}
	notesTag := fmt.Sprintf("%s: %s", prefix, reason)
	return m, func() tea.Msg {
		return PipelineUpdateStatusAndNotesMsg{
			CareerOpsPath: m.careerOpsPath,
			App:           app,
			NewStatus:     newStatus,
			NotesAppend:   notesTag,
		}
	}
}

func (m PipelineModel) calculateWeeksToHire() int {
	if m.hiredApp.Date == "" {
		return 1
	}
	appDate, err := time.Parse("2006-01-02", m.hiredApp.Date)
	if err != nil {
		return 1
	}
	days := int(time.Since(appDate).Hours() / 24)
	weeks := (days + 3) / 7
	if weeks < 1 {
		weeks = 1
	}
	return weeks
}

// handleColPicker consumes keys while the column picker overlay is open.
func (m PipelineModel) handleColPicker(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc", "q", "C":
		m.colPicker = false
		return m, nil

	case "down", "j":
		m.colPickerIdx++
		if m.colPickerIdx >= len(getOptionalCols()) {
			m.colPickerIdx = len(getOptionalCols()) - 1
		}

	case "up", "k":
		m.colPickerIdx--
		if m.colPickerIdx < 0 {
			m.colPickerIdx = 0
		}

	case " ":
		col := getOptionalCols()[m.colPickerIdx]
		m.visibleCols[col.id] = !m.visibleCols[col.id]
	}
	return m, nil
}

// openPDFCmd emits a PipelineOpenPDFMsg for a root-relative PDF path.
func (m PipelineModel) openPDFCmd(relPath string) tea.Cmd {
	fullPath := filepath.Join(m.careerOpsPath, filepath.FromSlash(relPath))
	return func() tea.Msg {
		return PipelineOpenPDFMsg{Path: fullPath}
	}
}

func (m PipelineModel) loadCurrentReport() tea.Cmd {
	app, ok := m.CurrentApp()
	if !ok || app.ReportPath == "" {
		return nil
	}
	if _, cached := m.reportCache[app.ReportPath]; cached {
		return nil
	}
	path := m.careerOpsPath
	report := app.ReportPath
	return func() tea.Msg {
		return PipelineLoadReportMsg{CareerOpsPath: path, ReportPath: report}
	}
}

// matchesSearch reports whether app contains the query as a case-insensitive
// substring of its company, role, or notes. Empty query matches everything.
// Lowercases both sides so callers don't have to remember the contract.
func matchesSearch(app model.CareerApplication, query string) bool {
	if query == "" {
		return true
	}
	q := strings.ToLower(query)
	if strings.Contains(strings.ToLower(app.Company), q) {
		return true
	}
	if strings.Contains(strings.ToLower(app.Role), q) {
		return true
	}
	if strings.Contains(strings.ToLower(app.Notes), q) {
		return true
	}
	return false
}

// applyFilterAndSort rebuilds the filtered list from apps.
func (m *PipelineModel) applyFilterAndSort() {
	var filtered []model.CareerApplication

	currentFilter := getPipelineTabs()[m.activeTab].filter
	for _, app := range m.apps {
		if !matchesSearch(app, m.searchQuery) {
			continue
		}
		norm := data.NormalizeStatus(app.Status)
		switch currentFilter {
		case filterAll:
			filtered = append(filtered, app)
		case filterTop:
			if app.Score >= 4.0 && norm != "skip" {
				filtered = append(filtered, app)
			}
		default:
			if norm == currentFilter {
				filtered = append(filtered, app)
			}
		}
	}

	// Sort
	less := m.sortLess()
	sort.SliceStable(filtered, func(i, j int) bool {
		return less(filtered[i], filtered[j])
	})

	// In grouped mode, always sort by status priority first, then by selected sort within groups
	if m.viewMode == "grouped" {
		sort.SliceStable(filtered, func(i, j int) bool {
			pi := data.StatusPriority(filtered[i].Status)
			pj := data.StatusPriority(filtered[j].Status)
			if pi != pj {
				return pi < pj
			}
			// Within same group, use selected sort
			return less(filtered[i], filtered[j])
		})
	}

	m.filtered = filtered
}

// sortLess returns the comparator for the active sort mode. Shared by the flat
// sort and the within-group tiebreaker in grouped view.
func (m PipelineModel) sortLess() func(a, b model.CareerApplication) bool {
	switch m.sortMode {
	case sortDate:
		return func(a, b model.CareerApplication) bool { return a.Date > b.Date }
	case sortCompany:
		return func(a, b model.CareerApplication) bool {
			return strings.ToLower(a.Company) < strings.ToLower(b.Company)
		}
	case sortStatus:
		return func(a, b model.CareerApplication) bool {
			return data.StatusPriority(a.Status) < data.StatusPriority(b.Status)
		}
	case sortLocation:
		// Remote-first, then hybrid, then onsite; alphabetical city as tiebreaker.
		return func(a, b model.CareerApplication) bool {
			ra, rb := workModeRank(a.WorkMode), workModeRank(b.WorkMode)
			if ra != rb {
				return ra < rb
			}
			return a.Location < b.Location
		}
	case sortPay:
		// Highest band ceiling first; unknown pay (0) sinks to the bottom.
		return func(a, b model.CareerApplication) bool { return a.PayMax > b.PayMax }
	case sortLast:
		// Most recent contact first; empty dates sink to the bottom.
		return func(a, b model.CareerApplication) bool { return a.LastContact > b.LastContact }
	default: // sortScore
		return func(a, b model.CareerApplication) bool { return a.Score > b.Score }
	}
}

// workModeRank orders work modes remote-first for the location sort.
func workModeRank(mode string) int {
	// Internal language-neutral representations.
	switch mode {
	case "Remote":
		return 0
	case "RemoteFlex":
		return 1
	case "Hybrid":
		return 2
	case "Full":
		return 3
	default:
		return 4
	}
}

// chromeRowsFixed returns the number of fixed chrome rows above/below the body
// (header + tabs(2) + metrics + sortbar + column header + help + 1 search bar
// when active). Shared by View() and adjustScroll() so additions stay in sync.
func (m PipelineModel) chromeRowsFixed() int {
	rows := 8 // header + tabs(2) + metrics + sortbar + column header + help + preview baseline
	if m.searchInput || m.searchQuery != "" {
		rows++
	}
	return rows
}

// previewBudgetApprox is the approximate row count reserved for the preview block
// when computing scroll positioning. View() measures the actual rendered preview
// height; adjustScroll uses this constant to avoid re-rendering on every keystroke.
const previewBudgetApprox = 6

// adjustScroll updates scrollOffset so the cursor stays visible.
func (m *PipelineModel) adjustScroll() {
	availHeight := m.height - m.chromeRowsFixed() - previewBudgetApprox
	if availHeight < 5 {
		availHeight = 5
	}
	line := m.cursorLineEstimate()
	margin := 3

	if line >= m.scrollOffset+availHeight-margin {
		m.scrollOffset = line - availHeight + margin + 1
	}
	if line < m.scrollOffset+margin {
		m.scrollOffset = line - margin
	}
	if m.scrollOffset < 0 {
		m.scrollOffset = 0
	}
}

func (m PipelineModel) cursorLineEstimate() int {
	if m.viewMode != "grouped" {
		return m.cursor
	}
	// Account for group headers
	line := 0
	prevStatus := ""
	for i, app := range m.filtered {
		norm := data.NormalizeStatus(app.Status)
		if norm != prevStatus {
			line++ // group header
			prevStatus = norm
		}
		if i == m.cursor {
			return line
		}
		line++
	}
	return line
}

// -- View --

// View renders the pipeline screen.
func (m PipelineModel) View() string {
	if m.hiredStep > 0 {
		return m.overlayHiredFlow()
	}

	header := m.renderHeader()
	tabs := m.renderTabs()
	metricsBar := m.renderMetrics()
	sortBar := m.renderSortBar()
	searchBar := m.renderSearchBar()
	body := m.renderBody()
	preview := m.renderPreview()
	help := m.renderHelp()

	// Apply scroll to body
	bodyLines := strings.Split(body, "\n")
	if m.scrollOffset > 0 && m.scrollOffset < len(bodyLines) {
		bodyLines = bodyLines[m.scrollOffset:]
	}

	// Calculate available height for body
	previewLines := strings.Count(preview, "\n") + 1
	availHeight := m.height - m.chromeRowsFixed() - previewLines
	if availHeight < 3 {
		availHeight = 3
	}
	if len(bodyLines) > availHeight {
		bodyLines = bodyLines[:availHeight]
	}
	body = strings.Join(bodyLines, "\n")

	// Column picker overlay
	if m.colPicker {
		body = m.overlayColPicker(body)
	}

	// Status picker overlay
	if m.statusPicker {
		body = m.overlayStatusPicker(body)
	}

	// PDF picker overlay
	if m.pdfPicker {
		body = m.overlayPDFPicker(body)
	}

	// Discard reason picker overlay
	if m.discardPicker {
		body = m.overlayDiscardPicker(body)
	}

	sections := []string{header, tabs, metricsBar, sortBar}
	if searchBar != "" {
		sections = append(sections, searchBar)
	}
	sections = append(sections, m.renderColumnHeader(), body, preview, help)
	return lipgloss.JoinVertical(lipgloss.Left, sections...)
}

// renderSearchBar returns an empty string when there is no active or in-progress
// search; otherwise it renders a vim-style status line showing the query and the
// match count. While in input mode, a trailing cursor is appended.
func (m PipelineModel) renderSearchBar() string {
	if !m.searchInput && m.searchQuery == "" {
		return ""
	}

	style := lipgloss.NewStyle().
		Foreground(m.theme.Text).
		Width(m.width).
		Padding(0, 2)

	prompt := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Blue).Render("/")
	queryStyle := lipgloss.NewStyle().Foreground(m.theme.Text)
	hintStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	display := queryStyle.Render(m.searchQuery)
	if m.searchInput {
		display += lipgloss.NewStyle().Foreground(m.theme.Blue).Render("█")
	}

	tabFiltered := m.countForFilter(getPipelineTabs()[m.activeTab].filter)
	matchInfo := hintStyle.Render(fmt.Sprintf(i18n.Current.SearchMatching, len(m.filtered), tabFiltered))

	hint := ""
	if m.searchInput {
		hint = hintStyle.Render(i18n.Current.SearchHintInput)
	} else {
		hint = hintStyle.Render(i18n.Current.SearchHintNormal)
	}

	return style.Render(prompt + " " + display + matchInfo + hint)
}

func (m PipelineModel) renderHeader() string {
	style := lipgloss.NewStyle().
		Bold(true).
		Foreground(m.theme.Text).
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 2)

	right := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	avg := fmt.Sprintf("%.1f", m.metrics.AvgScore)
	info := right.Render(fmt.Sprintf(i18n.Current.OffersSummary, m.metrics.Total, avg))

	title := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Blue).Render(i18n.Current.AppTitle)
	gap := m.width - lipgloss.Width(title) - lipgloss.Width(info) - 4
	if gap < 1 {
		gap = 1
	}

	return style.Render(title + strings.Repeat(" ", gap) + info)
}

func (m PipelineModel) renderTabs() string {
	var tabs []string
	var underParts []string

	for i, tab := range getPipelineTabs() {
		// Count items for this tab
		count := m.countForFilter(tab.filter)
		label := fmt.Sprintf(" %s (%d) ", tab.label, count)

		if i == m.activeTab {
			style := lipgloss.NewStyle().
				Bold(true).
				Foreground(m.theme.Blue).
				Padding(0, 0)
			tabs = append(tabs, style.Render(label))
			underParts = append(underParts, strings.Repeat("━", lipgloss.Width(label)))
		} else {
			style := lipgloss.NewStyle().
				Foreground(m.theme.Subtext).
				Padding(0, 0)
			tabs = append(tabs, style.Render(label))
			underParts = append(underParts, strings.Repeat("─", lipgloss.Width(label)))
		}
	}

	row := lipgloss.JoinHorizontal(lipgloss.Top, tabs...)
	underline := lipgloss.NewStyle().Foreground(m.theme.Overlay).Render(strings.Join(underParts, ""))

	padStyle := lipgloss.NewStyle().Padding(0, 1)
	return padStyle.Render(row) + "\n" + padStyle.Render(underline)
}

func (m PipelineModel) countForFilter(filter string) int {
	count := 0
	for _, app := range m.apps {
		norm := data.NormalizeStatus(app.Status)
		switch filter {
		case filterAll:
			count++
		case filterTop:
			if app.Score >= 4.0 && norm != "skip" {
				count++
			}
		default:
			if norm == filter {
				count++
			}
		}
	}
	return count
}

func (m PipelineModel) renderMetrics() string {
	style := lipgloss.NewStyle().
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 2)

	var parts []string
	statusColors := m.statusColorMap()

	for _, status := range statusGroupOrder {
		count, ok := m.metrics.ByStatus[status]
		if !ok || count == 0 {
			continue
		}
		color := statusColors[status]
		s := lipgloss.NewStyle().Foreground(color)
		parts = append(parts, s.Render(fmt.Sprintf("%s:%d", statusLabel(status), count)))
	}

	return style.Render(strings.Join(parts, "  "))
}

func (m PipelineModel) renderSortBar() string {
	style := lipgloss.NewStyle().
		Foreground(m.theme.Subtext).
		Width(m.width).
		Padding(0, 2)

	sortLabel := fmt.Sprintf(i18n.Current.SortLabel, i18n.Current.SortModeLabel(m.sortMode))
	viewLabel := fmt.Sprintf(i18n.Current.ViewLabel, i18n.Current.ViewModeLabel(m.viewMode))
	count := fmt.Sprintf(i18n.Current.ShownCount, len(m.filtered))

	return style.Render(fmt.Sprintf("%s  %s  %s", sortLabel, viewLabel, count))
}

func (m PipelineModel) renderBody() string {
	if len(m.filtered) == 0 {
		emptyStyle := lipgloss.NewStyle().
			Foreground(m.theme.Subtext).
			Padding(1, 2)
		return emptyStyle.Render(i18n.Current.NoOffersMatch)
	}

	var lines []string
	prevStatus := ""
	padStyle := lipgloss.NewStyle().Padding(0, 2)

	for i, app := range m.filtered {
		norm := data.NormalizeStatus(app.Status)

		// Group header in grouped mode
		if m.viewMode == "grouped" && norm != prevStatus {
			count := m.countByNormStatus(norm)
			headerStyle := lipgloss.NewStyle().
				Bold(true).
				Foreground(m.theme.Subtext)
			lines = append(lines, padStyle.Render(
				headerStyle.Render(fmt.Sprintf("── %s (%d) %s",
					strings.ToUpper(statusLabel(norm)), count,
					strings.Repeat("─", max(0, m.width-30-len(statusLabel(norm)))))),
			))
			prevStatus = norm
		}

		selected := i == m.cursor
		line := m.renderAppLine(app, selected)
		lines = append(lines, line)
	}

	return strings.Join(lines, "\n")
}

// colWidths holds per-column rune budgets for the table.
type colWidths struct {
	num, score, company, status, role int
	// optional columns — 0 means the column is hidden
	date, loc, pay, rpt, pdf, last int
}

func (m PipelineModel) colVisible(id ColumnID) bool {
	if m.visibleCols == nil {
		// Fall back to default for callers before init (tests, etc.)
		for _, col := range getOptionalCols() {
			if col.id == id {
				return col.onByDefault
			}
		}
		return false
	}
	return m.visibleCols[id]
}

func (m PipelineModel) columnWidths() colWidths {
	c := colWidths{num: 5, score: 5, company: 16, status: 16}
	if m.colVisible(ColDate) {
		c.date = 10
	}
	if m.colVisible(ColLocation) {
		c.loc = 20
	}
	if m.colVisible(ColPay) {
		c.pay = 16
	}
	if m.colVisible(ColHasReport) {
		c.rpt = 4
	}
	if m.colVisible(ColHasPDF) {
		c.pdf = 4
	}
	if m.colVisible(ColLastContact) {
		c.last = 10
	}
	fixed := c.num + c.score + c.date + c.company + c.status + c.loc + c.pay + c.rpt + c.pdf + c.last
	c.role = m.width - fixed - 14 // separators + outer padding
	if c.role < 15 {
		c.role = 15
	}
	return c
}

func (m PipelineModel) workModeColor(mode string) lipgloss.Color {
	switch mode {
	case "Remote":
		return m.theme.Green
	case "RemoteFlex":
		return m.theme.Sky
	case "Hybrid":
		return m.theme.Yellow
	case "Full":
		return m.theme.Red
	default:
		return m.theme.Subtext
	}
}

func (m PipelineModel) renderLocCell(app model.CareerApplication, width int) string {
	text := app.WorkMode
	if app.Location != "" {
		if text != "" {
			text += " · " + app.Location
		} else {
			text = app.Location
		}
	}
	if text == "" {
		text = "—"
	}
	return lipgloss.NewStyle().Foreground(m.workModeColor(app.WorkMode)).Width(width).Render(truncateRunes(text, width))
}

func (m PipelineModel) renderCheckCell(yes bool, width int) string {
	text := "—"
	color := m.theme.Subtext
	if yes {
		text = "✓"
		color = m.theme.Green
	}
	return lipgloss.NewStyle().Foreground(color).Width(width).Render(text)
}

// renderPayCell prefers the pay range parsed from notes and falls back to the
// report-cache comp estimate (the pre-column behavior). POSTED bands render
// green; estimates stay yellow.
func (m PipelineModel) renderPayCell(app model.CareerApplication, width int) string {
	text := app.PayRange
	color := m.theme.Yellow
	if app.PaySource == "POSTED" {
		color = m.theme.Green
	}
	if text == "" {
		if summary, ok := m.reportCache[app.ReportPath]; ok && summary.comp != "" {
			text = summary.comp
		}
	}
	if text == "" {
		return lipgloss.NewStyle().Width(width).Render("")
	}
	return lipgloss.NewStyle().Foreground(color).Width(width).Render(truncateRunes(text, width-1))
}

// renderColumnHeader labels the table columns; widths mirror renderAppLine.
func (m PipelineModel) renderColumnHeader() string {
	cw := m.columnWidths()
	h := lipgloss.NewStyle().Foreground(m.theme.Subtext).Bold(true)
	cell := func(label string, width int) string {
		return h.Width(width).Render(truncateRunes(label, width))
	}

	segments := []string{
		cell("#", cw.num),
		h.Render(i18n.Current.ColFit), // score cell is unpadded, always 3 runes wide
	}
	if cw.date != 0 {
		segments = append(segments, cell(i18n.Current.ColApplied, cw.date))
	}
	segments = append(segments, cell(i18n.Current.ColCompany, cw.company))
	segments = append(segments, cell(i18n.Current.ColRole, cw.role))
	segments = append(segments, cell(i18n.Current.ColStatus, cw.status))
	if cw.loc > 0 {
		segments = append(segments, cell(i18n.Current.ColLocation, cw.loc))
	}
	if cw.pay > 0 {
		segments = append(segments, cell(i18n.Current.ColPay, cw.pay))
	}
	if cw.rpt > 0 {
		segments = append(segments, cell(i18n.Current.ColReport, cw.rpt))
	}
	if cw.pdf > 0 {
		segments = append(segments, cell(i18n.Current.ColPDF, cw.pdf))
	}
	if cw.last > 0 {
		segments = append(segments, cell(i18n.Current.ColLast, cw.last))
	}

	padStyle := lipgloss.NewStyle().Padding(0, 2)
	return padStyle.Render(" " + strings.Join(segments, " "))
}

func (m PipelineModel) renderAppLine(app model.CareerApplication, selected bool) string {
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	cw := m.columnWidths()

	// Tracker number (fixed width)
	numText := "#—"
	if app.Number > 0 {
		numText = fmt.Sprintf("#%d", app.Number)
	}
	numStyle := lipgloss.NewStyle().Foreground(m.theme.Blue).Bold(true).Width(cw.num)

	// Score with color
	scoreStyle := m.scoreStyle(app.Score)
	score := scoreStyle.Render(fmt.Sprintf("%.1f", app.Score))

	// Company (truncate)
	company := truncateRunes(app.Company, cw.company)
	companyStyle := lipgloss.NewStyle().Foreground(m.theme.Text).Width(cw.company)

	// Date (fixed width)
	dateText := app.Date
	if dateText == "" {
		dateText = "—"
	}
	dateStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(cw.date)

	// Role (truncate)
	role := truncateRunes(app.Role, cw.role)
	roleStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(cw.role)

	// Status with color -- fixed column
	norm := data.NormalizeStatus(app.Status)
	statusColor := m.statusColorMap()[norm]
	statusStyle := lipgloss.NewStyle().Foreground(statusColor).Width(cw.status)
	statusText := statusStyle.Render(truncateRunes(statusLabel(norm), cw.status))

	segments := []string{
		numStyle.Render(truncateRunes(numText, cw.num)),
		score,
	}
	if cw.date > 0 {
		segments = append(segments, dateStyle.Render(truncateRunes(dateText, cw.date)))
	}
	segments = append(segments, companyStyle.Render(company))
	segments = append(segments, roleStyle.Render(role))
	segments = append(segments, statusText)

	if cw.loc > 0 {
		segments = append(segments, m.renderLocCell(app, cw.loc))
	}
	if cw.pay > 0 {
		segments = append(segments, m.renderPayCell(app, cw.pay))
	}
	if cw.rpt > 0 {
		segments = append(segments, m.renderCheckCell(app.ReportPath != "", cw.rpt))
	}
	if cw.pdf > 0 {
		segments = append(segments, m.renderCheckCell(app.HasPDF, cw.pdf))
	}
	if cw.last > 0 {
		lastText := "—"
		if app.LastContact != "" {
			lastText = formatTimeAgo(app.LastContact)
		}
		lastStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(cw.last)
		if app.LastContact != "" && app.LastContact != app.Date {
			lastStyle = lastStyle.Foreground(m.theme.Text)
		}
		segments = append(segments, lastStyle.Render(truncateRunes(lastText, cw.last)))
	}

	line := " " + strings.Join(segments, " ")

	if selected {
		selStyle := lipgloss.NewStyle().
			Background(m.theme.Overlay).
			Width(m.width - 4)
		return padStyle.Render(selStyle.Render(line))
	}
	return padStyle.Render(line)
}

func (m PipelineModel) renderPreview() string {
	app, ok := m.CurrentApp()
	if !ok {
		return ""
	}

	padStyle := lipgloss.NewStyle().Padding(0, 2)
	divider := lipgloss.NewStyle().Foreground(m.theme.Overlay)

	var lines []string
	lines = append(lines, padStyle.Render(divider.Render(strings.Repeat("─", m.width-4))))

	labelStyle := lipgloss.NewStyle().Foreground(m.theme.Sky).Bold(true)
	valueStyle := lipgloss.NewStyle().Foreground(m.theme.Text)
	dimStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	// Quick facts derived from notes — available even when there is no report,
	// and the only place narrow terminals see location/pay/last-contact.
	var facts []string
	if app.WorkMode != "" || app.Location != "" {
		loc := app.WorkMode
		if app.Location != "" {
			if loc != "" {
				loc += " · " + app.Location
			} else {
				loc = app.Location
			}
		}
		facts = append(facts, labelStyle.Render(i18n.Current.LabelLoc)+valueStyle.Render(loc))
	}
	if app.PayRange != "" {
		pay := app.PayRange
		if app.PaySource != "" {
			pay += " (" + app.PaySource + ")"
		}
		facts = append(facts, labelStyle.Render(i18n.Current.LabelPay)+valueStyle.Render(pay))
	}
	if app.LastContact != "" {
		facts = append(facts, labelStyle.Render(i18n.Current.LabelLast)+
			valueStyle.Render(fmt.Sprintf("%s (%s)", app.LastContact, formatTimeAgo(app.LastContact))))
	}
	if len(facts) > 0 {
		lines = append(lines, padStyle.Render(strings.Join(facts, "   ")))
	}

	outcome := previewOutcome(app)

	// Check report cache
	if summary, ok := m.reportCache[app.ReportPath]; ok {
		if summary.archetype != "" {
			lines = append(lines, padStyle.Render(
				labelStyle.Render("Archetype: ")+valueStyle.Render(summary.archetype)))
		}
		if summary.tldr != "" {
			lines = append(lines, padStyle.Render(
				labelStyle.Render("TL;DR: ")+valueStyle.Render(summary.tldr)))
		}
		if summary.comp != "" {
			lines = append(lines, padStyle.Render(
				labelStyle.Render("Comp: ")+valueStyle.Render(summary.comp)))
		}
		if summary.remote != "" {
			lines = append(lines, padStyle.Render(
				labelStyle.Render(i18n.Current.LabelRemote)+valueStyle.Render(summary.remote)))
		}
	} else if app.Notes != "" && outcome == "" {
		// Fallback: show notes (the outcome line below already carries them)
		notes := truncateRunes(app.Notes, m.width-10)
		lines = append(lines, padStyle.Render(dimStyle.Render(notes)))
	} else if outcome == "" {
		lines = append(lines, padStyle.Render(dimStyle.Render(i18n.Current.LoadingPreview)))
	}

	// Closed-out postings: surface what happened as the last preview line.
	// The notes-only fallback above disappears once a report summary is
	// cached, which is exactly when the discard reason got lost (#787).
	if outcome != "" {
		// Width budget: 4 cols padding + 9 for the i18n.Current.LabelOutcome label + slack,
		// mirroring the m.width-10 budget of the notes fallback above.
		lines = append(lines, padStyle.Render(
			labelStyle.Render(i18n.Current.LabelOutcome)+valueStyle.Render(truncateRunes(outcome, m.width-14))))
	}

	return strings.Join(lines, "\n")
}

// previewOutcome returns "what happened" to a closed-out application — the raw
// status (which often carries the decision date, e.g. "descartado 2026-03-12")
// plus the tracker notes holding the reason. Returns "" for apps still in play.
func previewOutcome(app model.CareerApplication) string {
	switch data.NormalizeStatus(app.Status) {
	case "discarded", "skip", "rejected":
	default:
		return ""
	}
	outcome := strings.TrimSpace(strings.ReplaceAll(app.Status, "**", ""))
	if app.Notes != "" {
		outcome += " — " + app.Notes
	}
	return outcome
}

func (m PipelineModel) renderHelp() string {
	style := lipgloss.NewStyle().
		Foreground(m.theme.Subtext).
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 1)

	keyStyle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Text)
	descStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	if m.flash != "" {
		flashStyle := lipgloss.NewStyle().
			Foreground(m.theme.Yellow).
			Background(m.theme.Surface).
			Width(m.width).
			Padding(0, 1)
		return flashStyle.Render(m.flash)
	}

	if m.colPicker {
		return style.Render(
			keyStyle.Render("↑↓/jk") + descStyle.Render(i18n.Current.HelpNavigate) +
				keyStyle.Render("SPACE") + descStyle.Render(i18n.Current.HelpToggle) +
				keyStyle.Render("Esc/C") + descStyle.Render(i18n.Current.HelpClose))
	}

	if m.statusPicker || m.pdfPicker {
		return style.Render(
			keyStyle.Render("↑↓/jk") + descStyle.Render(i18n.Current.HelpNavigate) +
				keyStyle.Render("Enter") + descStyle.Render(i18n.Current.HelpConfirm) +
				keyStyle.Render("Esc") + descStyle.Render(i18n.Current.HelpCancel))
	}

	if m.searchInput {
		return style.Render(
			keyStyle.Render("type") + descStyle.Render(i18n.Current.HelpFilterLive) +
				keyStyle.Render("Enter") + descStyle.Render(i18n.Current.HelpKeep) +
				keyStyle.Render("Ctrl+U") + descStyle.Render(i18n.Current.HelpClear) +
				keyStyle.Render("Esc") + descStyle.Render(i18n.Current.HelpCancel))
	}

	// The manifesto segment is an OSC 8 hyperlink (utm_source=dashboard);
	// terminals without support show the same text, just not clickable. The
	// gap math uses the plain text so the escapes never skew the layout.
	const brandPlain = "built on the CareerOps Manifesto · career-ops by santifer.io"
	manifestoLink := "\x1b]8;;https://career-ops.org/manifesto?utm_source=dashboard\x1b\\built on the CareerOps Manifesto\x1b]8;;\x1b\\"
	brand := lipgloss.NewStyle().Foreground(m.theme.Overlay).Render(manifestoLink + " · career-ops by santifer.io")

	keys := keyStyle.Render("↑↓/jk") + descStyle.Render(i18n.Current.HelpNav) +
		keyStyle.Render("←→/hl") + descStyle.Render(i18n.Current.HelpTabs) +
		keyStyle.Render("/") + descStyle.Render(i18n.Current.HelpSearch) +
		keyStyle.Render("s") + descStyle.Render(i18n.Current.HelpSort) +
		keyStyle.Render("r") + descStyle.Render(i18n.Current.HelpRefresh) +
		keyStyle.Render("Enter") + descStyle.Render(i18n.Current.HelpReport) +
		keyStyle.Render("o") + descStyle.Render(i18n.Current.HelpOpenURL) +
		keyStyle.Render("d") + descStyle.Render(i18n.Current.HelpOpenPDF) +
		keyStyle.Render("D") + descStyle.Render(i18n.Current.HelpRegenPDF) +
		keyStyle.Render("c") + descStyle.Render(i18n.Current.HelpChange) +
		keyStyle.Render("C") + descStyle.Render(i18n.Current.HelpColumns) +
		keyStyle.Render("v") + descStyle.Render(i18n.Current.HelpView) +
		keyStyle.Render("p") + descStyle.Render(i18n.Current.HelpProgress) +
		keyStyle.Render("t") + descStyle.Render(i18n.Current.HelpLanguage) +
		keyStyle.Render("m") + descStyle.Render(i18n.Current.HelpManifesto) +
		keyStyle.Render("q") + descStyle.Render(i18n.Current.HelpQuit)

	gap := m.width - lipgloss.Width(keys) - lipgloss.Width(brandPlain) - 2
	if gap < 1 {
		gap = 1
	}

	return style.Render(keys + strings.Repeat(" ", gap) + brand)
}

func (m PipelineModel) overlayStatusPicker(body string) string {
	// Render status picker inline at bottom of body
	bodyLines := strings.Split(body, "\n")

	pickerWidth := 30
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	borderStyle := lipgloss.NewStyle().
		Foreground(m.theme.Blue).
		Bold(true)

	var picker []string
	picker = append(picker, padStyle.Render(borderStyle.Render(i18n.Current.PickerChangeStatus)))

	for i, pair := range getStatusPairs() {
		style := lipgloss.NewStyle().Foreground(m.theme.Text).Width(pickerWidth)
		if i == m.statusCursor {
			style = style.Background(m.theme.Overlay).Bold(true)
		}
		prefix := "  "
		if i == m.statusCursor {
			prefix = " >"
		}
		picker = append(picker, padStyle.Render(prefix+style.Render(pair.Display)))
	}

	// Append picker to body
	bodyLines = append(bodyLines, picker...)
	return strings.Join(bodyLines, "\n")
}

func (m PipelineModel) overlayHiredFlow() string {
	borderStyle := lipgloss.NewStyle().
		Border(lipgloss.DoubleBorder()).
		BorderForeground(m.theme.Blue).
		Padding(1, 2)

	var winContent string
	switch m.hiredStep {
	case 1:
		winContent = lipgloss.JoinVertical(lipgloss.Center,
			lipgloss.NewStyle().Foreground(m.theme.Green).Bold(true).Render("🎉 CONGRATULATIONS! 🎉"),
			"",
			lipgloss.NewStyle().Foreground(m.theme.Text).Render("You landed the job!"),
			lipgloss.NewStyle().Foreground(m.theme.Text).Render(fmt.Sprintf("%s @ %s", m.hiredApp.Role, m.hiredApp.Company)),
			"",
			lipgloss.NewStyle().Foreground(m.theme.Subtext).Render("This moment belongs entirely to you. Celebrate the win!"),
			"",
			lipgloss.NewStyle().Foreground(m.theme.Blue).Render("Press [ Enter ] to continue..."),
		)
	case 2:
		winContent = lipgloss.JoinVertical(lipgloss.Center,
			lipgloss.NewStyle().Foreground(m.theme.Green).Bold(true).Render("Share your story? 🚀"),
			"",
			lipgloss.NewStyle().Foreground(m.theme.Text).Render("We'd love to hear your story on GitHub!"),
			lipgloss.NewStyle().Foreground(m.theme.Text).Render("Your story helps others in the community see what's possible."),
			"",
			lipgloss.NewStyle().Foreground(m.theme.Blue).Render("Press [ Y ] to open template in browser / [ N ] to skip"),
		)
	case 3:
		weeks := m.calculateWeeksToHire()
		winContent = lipgloss.JoinVertical(lipgloss.Center,
			lipgloss.NewStyle().Foreground(m.theme.Green).Bold(true).Render("Opt-in Anonymous Stat? 📊"),
			"",
			lipgloss.NewStyle().Foreground(m.theme.Text).Render("Help us count community hires in the public README:"),
			lipgloss.NewStyle().Foreground(m.theme.Subtext).Render(fmt.Sprintf("- Role: %s", m.hiredApp.Role)),
			lipgloss.NewStyle().Foreground(m.theme.Subtext).Render(fmt.Sprintf("- Weeks to hire: %d", weeks)),
			"",
			lipgloss.NewStyle().Foreground(m.theme.Text).Render("No names, no companies, and no salaries are shared."),
			"",
			lipgloss.NewStyle().Foreground(m.theme.Blue).Render("Press [ Y ] to opt-in / [ N ] to keep completely local"),
		)
	}

	box := borderStyle.Render(winContent)
	return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, box)
}

// overlayPDFPicker renders the PDF chooser inline at the bottom of the body,
// mirroring overlayStatusPicker. Choices show the PDF filename only — the
// directory is always output/ and the role variant lives in the name.
func (m PipelineModel) overlayPDFPicker(body string) string {
	bodyLines := strings.Split(body, "\n")

	pickerWidth := m.width - 8
	if pickerWidth < 30 {
		pickerWidth = 30
	}
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	borderStyle := lipgloss.NewStyle().
		Foreground(m.theme.Blue).
		Bold(true)

	var picker []string
	picker = append(picker, padStyle.Render(borderStyle.Render("Open CV PDF:")))

	for i, choice := range m.pdfChoices {
		style := lipgloss.NewStyle().Foreground(m.theme.Text).Width(pickerWidth)
		if i == m.pdfCursor {
			style = style.Background(m.theme.Overlay).Bold(true)
		}
		prefix := "  "
		if i == m.pdfCursor {
			prefix = "> "
		}
		name := truncateRunes(filepath.Base(filepath.FromSlash(choice)), pickerWidth-2)
		picker = append(picker, padStyle.Render(style.Render(prefix+name)))
	}

	bodyLines = append(bodyLines, picker...)
	return strings.Join(bodyLines, "\n")
}

// overlayColPicker renders the column visibility picker inline at the bottom
// of the body. SPACE toggles the focused column; ESC or C closes.
func (m PipelineModel) overlayColPicker(body string) string {
	bodyLines := strings.Split(body, "\n")
	pickerWidth := 36
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	borderStyle := lipgloss.NewStyle().Foreground(m.theme.Blue).Bold(true)
	dimStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	var picker []string
	picker = append(picker, padStyle.Render(borderStyle.Render(i18n.Current.PickerColumnsTitle)))

	for i, col := range getOptionalCols() {
		on := m.visibleCols[col.id]
		check := "[ ]"
		checkColor := m.theme.Subtext
		if on {
			check = "[✓]"
			checkColor = m.theme.Green
		}
		style := lipgloss.NewStyle().Foreground(m.theme.Text).Width(pickerWidth)
		if i == m.colPickerIdx {
			style = style.Background(m.theme.Overlay).Bold(true)
		}
		checkStr := lipgloss.NewStyle().Foreground(checkColor).Render(check)
		label := col.header
		if col.hint != "" {
			label += "  " + dimStyle.Render(col.hint)
		}
		row := checkStr + " " + label
		picker = append(picker, padStyle.Render(style.Render(row)))
	}

	bodyLines = append(bodyLines, picker...)
	return strings.Join(bodyLines, "\n")
}

// -- Helpers --

func (m PipelineModel) scoreStyle(score float64) lipgloss.Style {
	switch {
	case score >= 4.2:
		return lipgloss.NewStyle().Foreground(m.theme.Green).Bold(true)
	case score >= 3.8:
		return lipgloss.NewStyle().Foreground(m.theme.Yellow)
	case score >= 3.0:
		return lipgloss.NewStyle().Foreground(m.theme.Text)
	default:
		return lipgloss.NewStyle().Foreground(m.theme.Red)
	}
}

func (m PipelineModel) statusColorMap() map[string]lipgloss.Color {
	return map[string]lipgloss.Color{
		"interview": m.theme.Green,
		"offer":     m.theme.Green,
		"applied":   m.theme.Sky,
		"responded": m.theme.Blue,
		"evaluated": m.theme.Text,
		"skip":      m.theme.Red,
		"rejected":  m.theme.Subtext,
		"discarded": m.theme.Subtext,
	}
}

func (m PipelineModel) countByNormStatus(status string) int {
	count := 0
	for _, app := range m.filtered {
		if data.NormalizeStatus(app.Status) == status {
			count++
		}
	}
	return count
}

// formatTimeAgo renders an ISO date as a relative duration in calendar days:
// i18n.Current.TimeToday, i18n.Current.TimeYesterday, or "Nd ago". Tracker dates are day-granular (no
// time-of-day), so we never report sub-day hours — doing so would fabricate
// precision the data doesn't have (e.g. an entry dated today would otherwise
// read "13h ago" simply because it's 1pm, not because contact was 13h back).
func formatTimeAgo(dateStr string) string {
	return i18n.Current.FormatTimeAgo(dateStr)
}

// truncateRunes truncates a string to at most maxRunes runes, appending "..." if truncated.
func truncateRunes(s string, maxRunes int) string {
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	if maxRunes <= 3 {
		return string(runes[:maxRunes])
	}
	return string(runes[:maxRunes-3]) + "..."
}

func statusLabel(norm string) string {
	return i18n.Current.StatusLabel(norm)
}

// overlayDiscardPicker renders the discard reason picker inline at the bottom
// of the body (Issue 1380). Predicted reasons (from the report) are listed
// first, followed by the canonical fallback options, with an "Other…" entry
// that switches to free-text input when selected.
func (m PipelineModel) overlayDiscardPicker(body string) string {
	bodyLines := strings.Split(body, "\n")

	pickerWidth := m.width - 8
	if pickerWidth < 36 {
		pickerWidth = 36
	}
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	titleStyle := lipgloss.NewStyle().Foreground(m.theme.Blue).Bold(true)
	hintStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	inputStyle := lipgloss.NewStyle().Foreground(m.theme.Yellow).Bold(true)

	var picker []string

	if m.discardCustomInput {
		// Free-text sub-mode
		picker = append(picker, padStyle.Render(titleStyle.Render("─── Reason (type + Enter) ───────────────")))
		cursor := lipgloss.NewStyle().Foreground(m.theme.Blue).Render("█")
		picker = append(picker, padStyle.Render(inputStyle.Render("> "+m.discardCustomText+cursor)))
		picker = append(picker, padStyle.Render(hintStyle.Render("Enter: confirm   Esc: back")))
	} else {
		numPredicted := m.discardPredictedCount

		heading := "─── Discard reason (↑↓ navigate · Enter confirm · Esc skip) ─"
		picker = append(picker, padStyle.Render(titleStyle.Render(heading)))
		if numPredicted > 0 {
			picker = append(picker, padStyle.Render(hintStyle.Render("  ★ Predicted by agent:")))
		}
		for i, opt := range m.discardOptions {
			if i == numPredicted && numPredicted > 0 {
				picker = append(picker, padStyle.Render(hintStyle.Render("  ── Other options:")))
			}
			style := lipgloss.NewStyle().Foreground(m.theme.Text).Width(pickerWidth)
			if i == m.discardCursor {
				style = style.Background(m.theme.Overlay).Bold(true)
			}
			prefix := "  "
			if i == m.discardCursor {
				prefix = "> "
			}
			label := opt
			if i < numPredicted {
				label = "★ " + opt
			}
			picker = append(picker, padStyle.Render(style.Render(prefix+label)))
		}
	}

	bodyLines = append(bodyLines, picker...)
	return strings.Join(bodyLines, "\n")
}
