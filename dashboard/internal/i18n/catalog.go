package i18n

import (
	"fmt"
	"math"
	"strings"
	"time"
)

// Catalog holds all localized UI strings, labels, table headers, and formats
// for the Go TUI Dashboard. It provides a static, zero-dependency translation architecture.
type Catalog struct {
	// Screen banners & general
	AppTitle       string
	OffersSummary  string
	NoOffersMatch  string
	LoadingPreview string

	// Tabs & filters
	TabAll         string
	TabEvaluated   string
	TabSpeculative string
	TabApplied     string
	TabInterview   string
	TabResponded   string
	TabAssessment  string
	TabTop         string
	TabSkip        string
	TabRejected    string
	TabDiscarded   string
	TabOther       string

	// Table column headers
	ColFit      string
	ColDate     string
	ColCompany  string
	ColRole     string
	ColStatus   string
	ColLocation string
	ColPay      string
	ColPosted   string
	ColLast     string

	// Preview labels
	LabelLoc     string
	LabelPay     string
	LabelLast    string
	LabelRemote  string
	LabelOutcome string

	// Work modes
	ModeRemote     string
	ModeRemoteFlex string
	ModeHybrid     string
	ModeFull       string

	// Progress screen
	ProgressTitle   string
	ProgressSummary string
	FunnelTitle     string
	ScoresTitle     string
	RatesTitle      string
	WeeklyTitle     string
	ActiveInfo      string

	// Stats screen
	StatsTitle             string
	StatsSummary           string
	StatsStrategicInsights string
	FitQualityDistribution string
	SeniorityMix           string
	QualityBreakdown       string
	MeetQualityBar         string
	SalaryBandDist         string
	ArchetypeTitle         string
	WorkModeTitle          string
	LocationTitle          string
	PayTitle               string
	ColArchetype           string
	ColCount               string
	ColAvgScore            string
	PayCount               string
	PayAvg                 string
	PayMedian              string
	PayMax                 string
	PaySourceSplit         string
	InsightVolumeFit       string
	InsightVolumePrimary   string
	InsightWorkMode        string
	InsightPayBenchmark    string

	// Seniority levels
	SeniorityExecutive      string
	SeniorityStaffPrincipal string
	SeniorityLeadManager    string
	SenioritySenior         string
	SeniorityMidLevel       string
	SeniorityJuniorEntry    string

	// Relative dates
	TimeToday     string
	TimeYesterday string
	TimeDaysAgo   string

	// Status display names
	StatusEvaluated   string
	StatusSpeculative string
	StatusApplied     string
	StatusResponded   string
	StatusAssessment  string
	StatusInterview   string
	StatusOffer       string
	StatusRejected    string
	StatusDiscarded   string
	StatusSkip        string
	StatusHired       string
	StatusOther       string

	// Additional UI strings
	NoData        string
	EmptyFile     string
	RateResponse  string
	RateInterview string
	RateOffer     string

	// Footer descriptions & hints
	HelpNav        string
	HelpTabs       string
	HelpSearch     string
	HelpSort       string
	HelpRefresh    string
	HelpReport     string
	HelpOpenURL    string
	HelpQueue      string
	HelpSkip       string
	HelpUndoSkip   string
	HelpRankRow    string
	HelpRankAll    string
	HelpOpenPDF    string
	HelpCopyPDF    string
	HelpRegenPDF   string
	HelpChange     string
	HelpColumns    string
	HelpView       string
	HelpProgress   string
	HelpStats      string
	HelpQuit       string
	HelpKeys       string
	HelpScroll     string
	HelpPage       string
	HelpTopEnd     string
	HelpLanguage   string
	HelpManifesto  string
	HelpBack       string
	HelpNavigate   string
	HelpToggle     string
	HelpClose      string
	HelpConfirm    string
	HelpCancel     string
	HelpFilterLive string
	HelpKeep       string
	HelpClear      string

	// Picker overlay titles & bar hints
	PickerChangeStatus string
	PickerColumnsTitle string
	SearchHintInput    string
	SearchHintNormal   string
	SearchMatching     string
	SortLabel          string
	ViewLabel          string
	ShownCount         string
	ColReport          string
	ColPDF             string

	// Sort & view modes
	SortScore    string
	SortDate     string
	SortCompany  string
	SortStatus   string
	SortLocation string
	SortPay      string
	SortLast     string
	SortPosted   string
	ViewGrouped  string
	ViewFlat     string

	// Inbox tab (#5269): the Pending rows of data/pipeline.md
	TabInbox               string
	ColRank                string
	SortRank               string
	LabelRank              string
	LabelURL               string
	InboxEmpty             string
	InboxNotRanked         string
	InboxSummary           string
	InboxNoWebURL          string
	InboxUnavailable       string
	InboxStatusQueued      string
	InboxStatusRunning     string
	InboxStatusPaused      string
	InboxStatusNeedsAnswer string
	InboxStatusFailed      string
	InboxStatusDone        string

	// Inbox `e`: queue the selected row in batch/batch-input.tsv (#5269)
	InboxQueueing         string
	InboxQueued           string
	InboxQueueFailed      string
	InboxQueueAlready     string
	InboxQueueRetryFailed string
	InboxQueueUnreadable  string
	InboxQueueNoWebURL    string

	// Inbox `x` and `u`: skip the selected row in data/pipeline.md, and undo
	// the last skip of the session (#5269)
	InboxSkipping       string
	InboxSkipped        string
	InboxSkipUnchanged  string
	InboxSkipUnreadable string
	InboxSkipFailed     string
	InboxSkipNoWebURL   string
	InboxUndoNothing    string
	InboxUndoing        string
	InboxUndone         string
	InboxUndoUnchanged  string
	InboxUndoGone       string
	InboxUndoFailed     string

	// Inbox `a` and `A`: rank the selected row, or the unranked rows, through
	// rank-pipeline.mjs after a `y` (#5269)
	InboxRankAskRow     string
	InboxRankAskAll     string
	InboxRankAskSome    string
	InboxRankCancelled  string
	InboxRanking        string
	InboxRankRunning    string
	InboxRankBusy       string
	InboxRankAlready    string
	InboxRankNone       string
	InboxRankFailed     string
	InboxRankNotPending string
	InboxRankedRow      string
	InboxRankNoScore    string
	InboxRankedAll      string
	InboxRankReadFailed string
}

// SortModeLabel returns the localized display label for a sort mode ("score", "date", etc.).
func (c *Catalog) SortModeLabel(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "score":
		return c.SortScore
	case "date":
		return c.SortDate
	case "company":
		return c.SortCompany
	case "status":
		return c.SortStatus
	case "location":
		return c.SortLocation
	case "pay":
		return c.SortPay
	case "last":
		return c.SortLast
	case "posted":
		return c.SortPosted
	default:
		return mode
	}
}

// ViewModeLabel returns the localized display label for a view mode ("grouped" or "flat").
func (c *Catalog) ViewModeLabel(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "grouped":
		return c.ViewGrouped
	case "flat":
		return c.ViewFlat
	default:
		return mode
	}
}

// StatusLabel returns the localized display label for a canonical status ID
// (interview, offer, hired, responded, assessment, applied, evaluated, skip,
// rejected, discarded).
func (c *Catalog) StatusLabel(norm string) string {
	switch strings.ToLower(strings.TrimSpace(norm)) {
	case "interview":
		return c.StatusInterview
	case "offer":
		return c.StatusOffer
	case "hired":
		return c.StatusHired
	case "responded":
		return c.StatusResponded
	case "assessment":
		return c.StatusAssessment
	case "applied":
		return c.StatusApplied
	case "evaluated":
		return c.StatusEvaluated
	case "speculative":
		return c.StatusSpeculative
	case "skip":
		return c.StatusSkip
	case "rejected":
		return c.StatusRejected
	case "discarded":
		return c.StatusDiscarded
	case "other":
		return c.StatusOther
	default:
		return norm
	}
}

// WorkModeLabel returns the localized display label for a derived work mode
// ("Remote", "RemoteFlex", "Hybrid", "Full").
func (c *Catalog) WorkModeLabel(mode string) string {
	switch mode {
	case "Remote":
		return c.ModeRemote
	case "RemoteFlex":
		return c.ModeRemoteFlex
	case "Hybrid":
		return c.ModeHybrid
	case "Full":
		return c.ModeFull
	default:
		return mode
	}
}

// NowFunc allows injecting a mock clock for testing.
var NowFunc = time.Now

// FormatTimeAgo renders an ISO date as a relative duration in calendar days using localized strings:
// "today", "yesterday", or "Nd ago" (or Turkish equivalents).
func (c *Catalog) FormatTimeAgo(dateStr string) string {
	t, err := time.ParseInLocation("2006-01-02", dateStr, time.Local)
	if err != nil {
		return dateStr
	}
	now := NowFunc()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	contactDay := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.Local)
	days := int(math.Round(today.Sub(contactDay).Hours() / 24))
	switch {
	case days <= 0:
		return c.TimeToday
	case days == 1:
		return c.TimeYesterday
	default:
		return fmt.Sprintf(c.TimeDaysAgo, days)
	}
}

// PieChartSectionTitle formats a section title with the standard pie chart icon.
func PieChartSectionTitle(title string) string {
	return "🎯 " + title
}

// SeniorityLabel returns the localized display label for a seniority category.
func (c *Catalog) SeniorityLabel(s string) string {
	switch s {
	case "Executive":
		return c.SeniorityExecutive
	case "Staff / Principal":
		return c.SeniorityStaffPrincipal
	case "Lead / Manager":
		return c.SeniorityLeadManager
	case "Senior":
		return c.SenioritySenior
	case "Mid-Level":
		return c.SeniorityMidLevel
	case "Junior / Entry":
		return c.SeniorityJuniorEntry
	default:
		return s
	}
}

// En is the static English translation catalog.
var En = Catalog{
	// Screen banners & general
	AppTitle:       "CAREER PIPELINE",
	OffersSummary:  "%d offers | Avg %s/5",
	NoOffersMatch:  "No offers match this filter",
	LoadingPreview: "Loading preview...",

	// Tabs & filters
	TabAll:         "ALL",
	TabEvaluated:   "EVALUATED",
	TabSpeculative: "SPEC",
	TabApplied:     "APPLIED",
	TabInterview:   "INTERVIEW",
	TabResponded:   "RESPONDED",
	TabAssessment:  "ASSESSMENT",
	TabTop:         "TOP ≥4",
	TabSkip:        "SKIP",
	TabRejected:    "REJECTED",
	TabDiscarded:   "DISCARDED",
	TabOther:       "OTHER",

	// Table column headers
	ColFit:      "FIT",
	ColDate:     "DATE",
	ColCompany:  "COMPANY",
	ColRole:     "ROLE",
	ColStatus:   "STATUS",
	ColLocation: "LOCATION",
	ColPay:      "PAY",
	ColPosted:   "POSTED",
	ColLast:     "LAST",

	// Preview labels
	LabelLoc:     "Loc: ",
	LabelPay:     "Pay: ",
	LabelLast:    "Last contact: ",
	LabelRemote:  "Remote: ",
	LabelOutcome: "Outcome: ",

	// Work modes
	ModeRemote:     "Remote",
	ModeRemoteFlex: "Remote (flex)",
	ModeHybrid:     "Hybrid",
	ModeFull:       "On-site",

	// Progress screen
	ProgressTitle:   "SEARCH PROGRESS",
	ProgressSummary: "%d tracked | %s avg score",
	FunnelTitle:     "Pipeline Funnel",
	ScoresTitle:     "Score Distribution",
	RatesTitle:      "Conversion Rates",
	WeeklyTitle:     "Weekly Activity",
	ActiveInfo:      "%d active applications | %d total offers",

	// Stats screen
	StatsTitle:             "SEARCH STATS",
	StatsSummary:           "%d evaluated | %d archetypes",
	StatsStrategicInsights: "STRATEGIC INSIGHTS",
	FitQualityDistribution: "Fit Quality Distribution",
	SeniorityMix:           "Seniority Mix",
	QualityBreakdown:       "Quality Breakdown:",
	MeetQualityBar:         "✓ %.0f%% meet ≥4.0 bar",
	SalaryBandDist:         "Salary Band Distribution:",
	ArchetypeTitle:         "By Archetype",
	WorkModeTitle:          "By Work Mode",
	LocationTitle:          "By Location",
	PayTitle:               "Pay Range (posted top, $)",
	ColArchetype:           "ARCHETYPE",
	ColCount:               "COUNT",
	ColAvgScore:            "AVG FIT",
	PayCount:               "Data points: ",
	PayAvg:                 "Avg: ",
	PayMedian:              "Median: ",
	PayMax:                 "Max: ",
	PaySourceSplit:         "%d posted, %d estimated",
	InsightVolumeFit:       "Primary volume in %s (%d roles, %.0f%%) · Highest fit in %s (%.1f/5 avg fit)",
	InsightVolumePrimary:   "Primary archetype is %s (%d roles, %.0f%% of evaluated pipeline)",
	InsightWorkMode:        "Workplace distribution: %.0f%% of roles operate as %s",
	InsightPayBenchmark:    "Compensation benchmark: Median top pay is $%.0fK (peak $%.0fK) across %d data points",

	// Seniority levels
	SeniorityExecutive:      "Executive",
	SeniorityStaffPrincipal: "Staff / Principal",
	SeniorityLeadManager:    "Lead / Manager",
	SenioritySenior:         "Senior",
	SeniorityMidLevel:       "Mid-Level",
	SeniorityJuniorEntry:    "Junior / Entry",

	// Relative dates
	TimeToday:     "today",
	TimeYesterday: "yesterday",
	TimeDaysAgo:   "%dd ago",

	// Status display names
	StatusEvaluated:   "Evaluated",
	StatusSpeculative: "Speculative",
	StatusApplied:     "Applied",
	StatusResponded:   "Responded",
	StatusAssessment:  "Assessment",
	StatusInterview:   "Interview",
	StatusOffer:       "Offer",
	StatusRejected:    "Rejected",
	StatusDiscarded:   "Discarded",
	StatusSkip:        "SKIP",
	StatusHired:       "Hired",
	StatusOther:       "Other",

	// Additional UI strings
	NoData:        "No data",
	EmptyFile:     "(empty file)",
	RateResponse:  "Response Rate: ",
	RateInterview: "Interview Rate: ",
	RateOffer:     "Offer Rate: ",

	// Footer descriptions & hints
	HelpNav:        " nav  ",
	HelpTabs:       " tabs  ",
	HelpSearch:     " search  ",
	HelpSort:       " sort  ",
	HelpRefresh:    " refresh  ",
	HelpReport:     " report  ",
	HelpOpenURL:    " open URL  ",
	HelpQueue:      " queue  ",
	HelpSkip:       " skip  ",
	HelpUndoSkip:   " undo skip  ",
	HelpRankRow:    " rank  ",
	HelpRankAll:    " rank all  ",
	HelpOpenPDF:    " open PDF  ",
	HelpCopyPDF:    " copy PDF path  ",
	HelpRegenPDF:   " regen PDF  ",
	HelpChange:     " change  ",
	HelpColumns:    " columns  ",
	HelpView:       " view  ",
	HelpProgress:   " progress  ",
	HelpStats:      " stats  ",
	HelpQuit:       " quit",
	HelpKeys:       " keys  ",
	HelpScroll:     " scroll  ",
	HelpPage:       " page  ",
	HelpTopEnd:     " top/end  ",
	HelpLanguage:   " lang  ",
	HelpManifesto:  " manifesto  ",
	HelpBack:       " back",
	HelpNavigate:   " navigate  ",
	HelpToggle:     " toggle  ",
	HelpClose:      " close",
	HelpConfirm:    " confirm  ",
	HelpCancel:     " cancel",
	HelpFilterLive: " filter live  ",
	HelpKeep:       " keep  ",
	HelpClear:      " clear  ",

	// Picker overlay titles & bar hints
	PickerChangeStatus: "Change status:",
	PickerColumnsTitle: "─── Columns (SPACE toggle · ESC close) ───",
	SearchHintInput:    "   Enter: keep   Esc: cancel   Ctrl+U: clear",
	SearchHintNormal:   "   Esc: clear   /: edit",
	SearchMatching:     "  %d/%d matching",
	SortLabel:          "[Sort: %s]",
	ViewLabel:          "[View: %s]",
	ShownCount:         "%d shown",
	ColReport:          "RPT",
	ColPDF:             "PDF",

	// Sort & view modes
	SortScore:    "score",
	SortDate:     "date",
	SortCompany:  "company",
	SortStatus:   "status",
	SortLocation: "location",
	SortPay:      "pay",
	SortLast:     "last",
	SortPosted:   "posted",
	ViewGrouped:  "grouped",
	ViewFlat:     "flat",

	// Inbox tab
	TabInbox:               "INBOX",
	ColRank:                "RANK",
	SortRank:               "rank",
	LabelRank:              "Rank: ",
	LabelURL:               "URL: ",
	InboxEmpty:             "No pending rows in data/pipeline.md",
	InboxNotRanked:         "not ranked",
	InboxSummary:           "%d pending · %d not ranked",
	InboxNoWebURL:          "Not a web address, nothing opened: %s",
	InboxUnavailable:       "Inbox unavailable; showing previous rows: %s",
	InboxStatusQueued:      "Queued",
	InboxStatusRunning:     "Running",
	InboxStatusPaused:      "Paused",
	InboxStatusNeedsAnswer: "Needs answer",
	InboxStatusFailed:      "Failed",
	InboxStatusDone:        "Done",

	InboxQueueing:         "Queueing %s ...",
	InboxQueued:           "Queued. Run batch/batch-runner.sh to evaluate it: %s",
	InboxQueueFailed:      "Could not queue the row: %s",
	InboxQueueAlready:     "Already in the batch files, nothing queued: %s",
	InboxQueueRetryFailed: "Failed in the batch; retry with batch/batch-runner.sh --retry-failed: %s",
	InboxQueueUnreadable:  "Not queued: the URL must come first after \"- [ ] \" in data/pipeline.md: %s",
	InboxQueueNoWebURL:    "Not a web address, nothing queued: %s",

	InboxSkipping:       "Skipping %s ...",
	InboxSkipped:        "Skipped; u puts it back: %s",
	InboxSkipUnchanged:  "Already skipped in data/pipeline.md, nothing changed: %s",
	InboxSkipUnreadable: "Not skipped: the URL must come first after \"- [ ] \" in data/pipeline.md: %s",
	InboxSkipFailed:     "Could not skip the row: %s",
	InboxSkipNoWebURL:   "Not a web address, nothing skipped: %s",
	InboxUndoNothing:    "Nothing to undo: no row was skipped in this session",
	InboxUndoing:        "Putting back %s ...",
	InboxUndone:         "Back in the Inbox: %s",
	InboxUndoUnchanged:  "Not skipped any more, nothing to undo: %s",
	InboxUndoGone:       "Not put back: the row is no longer in the Pending section of data/pipeline.md: %s",
	InboxUndoFailed:     "Could not undo the skip; u tries again: %s",

	InboxRankAskRow:     "Rank this row with your agent CLI? Uses tokens. y: yes, other key: no",
	InboxRankAskAll:     "Rank %d row(s) with your agent CLI? Uses tokens. y: yes, other key: no",
	InboxRankAskSome:    "Rank the next %d rows with your agent CLI? Uses tokens. y: yes, other key: no",
	InboxRankCancelled:  "Cancelled, nothing ranked",
	InboxRanking:        "Ranking %d row(s) with your agent CLI ...",
	InboxRankRunning:    "ranking %d ...",
	InboxRankBusy:       "A rank is already running; wait for it to finish",
	InboxRankAlready:    "Already ranked, nothing to do: %s",
	InboxRankNone:       "Every row is ranked, nothing to do",
	InboxRankFailed:     "Could not rank: %s",
	InboxRankNotPending: "Not ranked: the URL must come first after \"- [ ] \" in data/pipeline.md, with no rank yet: %s",
	InboxRankedRow:      "Ranked %.1f/5: %s",
	InboxRankNoScore:    "No score came back; a tries again: %s",
	InboxRankedAll:      "Rank run finished; %d row(s) still not ranked",
	InboxRankReadFailed: "Ranking finished, but the Inbox could not be read: %s",
}

// Tr is the static Turkish translation catalog.
var Tr = Catalog{
	// Screen banners & general
	AppTitle:       "KARİYER HATTI",
	OffersSummary:  "%d ilan | Ort %s/5",
	NoOffersMatch:  "Bu filtreye uyan ilan yok",
	LoadingPreview: "Önizleme yükleniyor...",

	// Tabs & filters
	TabAll:         "TÜMÜ",
	TabEvaluated:   "DEĞERLENDİRİLDİ",
	TabSpeculative: "SPEKÜLATİF",
	TabApplied:     "BAŞVURULDU",
	TabInterview:   "MÜLAKAT",
	TabResponded:   "YANIT VERİLDİ",
	TabAssessment:  "DEĞERLENDİRME",
	TabTop:         "EN İYİ ≥4",
	TabSkip:        "UYGUN DEĞİL",
	TabRejected:    "REDDEDİLDİ",
	TabDiscarded:   "İPTAL",
	TabOther:       "DİĞER",

	// Table column headers
	ColFit:      "UYUM",
	ColDate:     "TARİH",
	ColCompany:  "ŞİRKET",
	ColRole:     "POZİSYON",
	ColStatus:   "DURUM",
	ColLocation: "KONUM",
	ColPay:      "ÜCRET",
	ColPosted:   "YAYIN",
	ColLast:     "SON",

	// Preview labels
	LabelLoc:     "Konum: ",
	LabelPay:     "Ücret: ",
	LabelLast:    "Son iletişim: ",
	LabelRemote:  "Çalışma Şekli: ",
	LabelOutcome: "Sonuç: ",

	// Work modes
	ModeRemote:     "Uzaktan",
	ModeRemoteFlex: "Uzaktan (Esnek)",
	ModeHybrid:     "Hibrit",
	ModeFull:       "Ofiste",

	// Progress screen
	ProgressTitle:   "TAKİP İLERLEMESİ",
	ProgressSummary: "%d takipte | %s ort. puan",
	FunnelTitle:     "Pipeline Hunisi",
	ScoresTitle:     "Puan Dağılımı",
	RatesTitle:      "Dönüşüm Oranları",
	WeeklyTitle:     "Haftalık Aktivite",
	ActiveInfo:      "%d aktif başvuru | %d toplam teklif",

	// Stats screen
	StatsTitle:             "TAKİP İSTATİSTİKLERİ",
	StatsSummary:           "%d değerlendirildi | %d arketip",
	StatsStrategicInsights: "STRATEJİK İÇGÖRÜLER",
	FitQualityDistribution: "Uyum Kalitesi Dağılımı",
	SeniorityMix:           "Kıdem Dağılımı",
	QualityBreakdown:       "Kalite Dağılımı:",
	MeetQualityBar:         "✓ %%%.0f ≥4.0 barajını geçiyor",
	SalaryBandDist:         "Maaş Aralığı Dağılımı:",
	ArchetypeTitle:         "Arketipe Göre",
	WorkModeTitle:          "Çalışma Şekline Göre",
	LocationTitle:          "Konuma Göre",
	PayTitle:               "Ücret Aralığı (ilan üst sınırı, $)",
	ColArchetype:           "ARKETİP",
	ColCount:               "SAYI",
	ColAvgScore:            "ORT. UYUM",
	PayCount:               "Veri noktası: ",
	PayAvg:                 "Ort: ",
	PayMedian:              "Medyan: ",
	PayMax:                 "Maks: ",
	PaySourceSplit:         "%d ilan, %d tahmini",
	InsightVolumeFit:       "En yüksek hacim %s alanında (%d ilan, %%%.0f) · En yüksek uyum %s alanında (ort. %.1f/5)",
	InsightVolumePrimary:   "Ana arketip %s (%d ilan, değerlendirilen hattın %%%.0f'i)",
	InsightWorkMode:        "Çalışma yeri dağılımı: ilanların %%%.0f'i %s olarak çalışıyor",
	InsightPayBenchmark:    "Ücret karşılaştırması: medyan üst maaş $%.0fK (en yüksek $%.0fK) — %d veri noktası",

	// Seniority levels
	SeniorityExecutive:      "Yönetici",
	SeniorityStaffPrincipal: "Kıdemli Uzman / Lider",
	SeniorityLeadManager:    "Takım Lideri / Müdür",
	SenioritySenior:         "Kıdemli",
	SeniorityMidLevel:       "Orta Seviye",
	SeniorityJuniorEntry:    "Başlangıç / Giriş",

	// Relative dates
	TimeToday:     "bugün",
	TimeYesterday: "dün",
	TimeDaysAgo:   "%d gün önce",

	// Status display names
	StatusEvaluated:   "Değerlendirildi",
	StatusSpeculative: "Spekülatif",
	StatusApplied:     "Başvuruldu",
	StatusResponded:   "Yanıt Verildi",
	StatusAssessment:  "Değerlendirme",
	StatusInterview:   "Mülakat",
	StatusOffer:       "Teklif",
	StatusRejected:    "Reddedildi",
	StatusDiscarded:   "İptal Edildi",
	StatusSkip:        "Uygun Değil",
	StatusHired:       "İşe Alındı",
	StatusOther:       "Diğer",

	// Additional UI strings
	NoData:        "Veri yok",
	EmptyFile:     "(boş dosya)",
	RateResponse:  "Yanıt Oranı: ",
	RateInterview: "Mülakat Oranı: ",
	RateOffer:     "Teklif Oranı: ",

	// Footer descriptions & hints
	HelpNav:        " gezin  ",
	HelpTabs:       " sekmeler  ",
	HelpSearch:     " ara  ",
	HelpSort:       " sırala  ",
	HelpRefresh:    " yenile  ",
	HelpReport:     " rapor  ",
	HelpOpenURL:    " URL aç  ",
	HelpQueue:      " sıraya al  ",
	HelpSkip:       " atla  ",
	HelpUndoSkip:   " atlamayı geri al  ",
	HelpRankRow:    " puanla  ",
	HelpRankAll:    " tümünü puanla  ",
	HelpOpenPDF:    " PDF'i aç  ",
	HelpCopyPDF:    " PDF yolunu kopyala  ",
	HelpRegenPDF:   " PDF üret  ",
	HelpChange:     " durum  ",
	HelpColumns:    " sütunlar  ",
	HelpView:       " görünüm  ",
	HelpProgress:   " ilerleme  ",
	HelpStats:      " istatistik  ",
	HelpQuit:       " çıkış",
	HelpKeys:       " tuşlar  ",
	HelpScroll:     " kaydır  ",
	HelpPage:       " sayfa  ",
	HelpTopEnd:     " baş/son  ",
	HelpLanguage:   " dil  ",
	HelpManifesto:  " manifesto  ",
	HelpBack:       " geri",
	HelpNavigate:   " gezin  ",
	HelpToggle:     " değiştir  ",
	HelpClose:      " kapat",
	HelpConfirm:    " onayla  ",
	HelpCancel:     " iptal",
	HelpFilterLive: " canlı filtrele  ",
	HelpKeep:       " kaydet  ",
	HelpClear:      " temizle  ",

	// Picker overlay titles & bar hints
	PickerChangeStatus: "Durumu değiştir:",
	PickerColumnsTitle: "─── Sütunlar (SPACE değiştir · ESC kapat) ───",
	SearchHintInput:    "   Enter: kaydet   Esc: iptal   Ctrl+U: temizle",
	SearchHintNormal:   "   Esc: temizle   /: düzenle",
	SearchMatching:     "  %d/%d eşleşen",
	SortLabel:          "[Sırala: %s]",
	ViewLabel:          "[Görünüm: %s]",
	ShownCount:         "%d gösterilen",
	ColReport:          "RAP",
	ColPDF:             "PDF",

	// Sort & view modes
	SortScore:    "puan",
	SortDate:     "tarih",
	SortCompany:  "şirket",
	SortStatus:   "durum",
	SortLocation: "konum",
	SortPay:      "ücret",
	SortLast:     "son",
	SortPosted:   "yayın",
	ViewGrouped:  "gruplu",
	ViewFlat:     "düz",

	// Inbox tab
	TabInbox:               "GELEN",
	ColRank:                "SIRA",
	SortRank:               "sıra",
	LabelRank:              "Sıra: ",
	LabelURL:               "URL: ",
	InboxEmpty:             "data/pipeline.md içinde bekleyen satır yok",
	InboxNotRanked:         "sıralanmadı",
	InboxSummary:           "%d bekleyen · %d sıralanmadı",
	InboxNoWebURL:          "Web adresi değil, hiçbir şey açılmadı: %s",
	InboxUnavailable:       "Gelen kutusu okunamadı; önceki satırlar gösteriliyor: %s",
	InboxStatusQueued:      "Sırada",
	InboxStatusRunning:     "Çalışıyor",
	InboxStatusPaused:      "Duraklatıldı",
	InboxStatusNeedsAnswer: "Yanıt bekliyor",
	InboxStatusFailed:      "Başarısız",
	InboxStatusDone:        "Tamamlandı",

	InboxQueueing:         "Sıraya alınıyor: %s ...",
	InboxQueued:           "Sıraya alındı. Değerlendirmek için batch/batch-runner.sh çalıştırın: %s",
	InboxQueueFailed:      "Satır sıraya alınamadı: %s",
	InboxQueueAlready:     "Zaten toplu iş dosyalarında, sıraya alınmadı: %s",
	InboxQueueRetryFailed: "Toplu işte başarısız; batch/batch-runner.sh --retry-failed ile yeniden deneyin: %s",
	InboxQueueUnreadable:  "Sıraya alınmadı: data/pipeline.md içinde URL \"- [ ] \" ifadesinden hemen sonra gelmeli: %s",
	InboxQueueNoWebURL:    "Web adresi değil, sıraya alınmadı: %s",

	InboxSkipping:       "Atlanıyor: %s ...",
	InboxSkipped:        "Atlandı; u ile geri gelir: %s",
	InboxSkipUnchanged:  "data/pipeline.md içinde zaten atlanmış, değişiklik yok: %s",
	InboxSkipUnreadable: "Atlanmadı: data/pipeline.md içinde URL \"- [ ] \" ifadesinden hemen sonra gelmeli: %s",
	InboxSkipFailed:     "Satır atlanamadı: %s",
	InboxSkipNoWebURL:   "Web adresi değil, atlanmadı: %s",
	InboxUndoNothing:    "Geri alınacak bir şey yok: bu oturumda hiçbir satır atlanmadı",
	InboxUndoing:        "Geri getiriliyor: %s ...",
	InboxUndone:         "Yeniden gelen kutusunda: %s",
	InboxUndoUnchanged:  "Artık atlanmış değil, geri alınacak bir şey yok: %s",
	InboxUndoGone:       "Geri getirilmedi: satır artık data/pipeline.md dosyasının Pending bölümünde değil: %s",
	InboxUndoFailed:     "Atlama geri alınamadı; u ile yeniden deneyin: %s",

	InboxRankAskRow:     "Bu satır ajan CLI'nizle puanlansın mı? Token harcar. y: evet, diğer: hayır",
	InboxRankAskAll:     "%d satır ajan CLI'nizle puanlansın mı? Token harcar. y: evet, diğer: hayır",
	InboxRankAskSome:    "Sonraki %d satır CLI'nizle puanlansın mı? Token harcar. y: evet, diğer: hayır",
	InboxRankCancelled:  "İptal edildi, hiçbir satır puanlanmadı",
	InboxRanking:        "%d satır ajan CLI'nizle puanlanıyor ...",
	InboxRankRunning:    "%d puanlanıyor ...",
	InboxRankBusy:       "Bir puanlama zaten sürüyor; bitmesini bekleyin",
	InboxRankAlready:    "Zaten puanlanmış, yapılacak bir şey yok: %s",
	InboxRankNone:       "Tüm satırlar puanlanmış, yapılacak bir şey yok",
	InboxRankFailed:     "Puanlanamadı: %s",
	InboxRankNotPending: "Puanlanmadı: URL, data/pipeline.md içinde \"- [ ] \" ifadesinden hemen sonra gelmeli ve henüz puanı olmamalı: %s",
	InboxRankedRow:      "Puanlandı %.1f/5: %s",
	InboxRankNoScore:    "Puan dönmedi; a ile yeniden deneyin: %s",
	InboxRankedAll:      "Puanlama bitti; %d satır hâlâ sıralanmadı",
	InboxRankReadFailed: "Puanlama bitti, ama Inbox okunamadı: %s",
}

// Es is the static Spanish translation catalog.
var Es = Catalog{
	// Screen banners & general
	AppTitle:       "FLUJO DE CARRERA",
	OffersSummary:  "%d ofertas | Prom %s/5",
	NoOffersMatch:  "Ninguna oferta coincide con este filtro",
	LoadingPreview: "Cargando vista previa...",

	// Tabs & filters
	TabAll:         "TODAS",
	TabEvaluated:   "EVALUADAS",
	TabSpeculative: "ESPECULATIVAS",
	TabApplied:     "APLICADAS",
	TabInterview:   "ENTREVISTA",
	TabResponded:   "RESPONDIDAS",
	TabAssessment:  "PRUEBA",
	TabTop:         "TOP ≥4",
	TabSkip:        "OMITIR",
	TabRejected:    "RECHAZADAS",
	TabDiscarded:   "DESCARTADAS",
	TabOther:       "OTRAS",

	// Table column headers
	ColFit:      "AJUSTE",
	ColDate:     "FECHA",
	ColCompany:  "EMPRESA",
	ColRole:     "PUESTO",
	ColStatus:   "ESTADO",
	ColLocation: "UBICACIÓN",
	ColPay:      "SALARIO",
	ColPosted:   "PUBLIC.",
	ColLast:     "ÚLTIMO",

	// Preview labels
	LabelLoc:     "Ubic: ",
	LabelPay:     "Salario: ",
	LabelLast:    "Último contacto: ",
	LabelRemote:  "Remoto: ",
	LabelOutcome: "Resultado: ",

	// Work modes
	ModeRemote:     "Remoto",
	ModeRemoteFlex: "Remoto (Flex)",
	ModeHybrid:     "Híbrido",
	ModeFull:       "Presencial",

	// Progress screen
	ProgressTitle:   "PROGRESO DE BÚSQUEDA",
	ProgressSummary: "%d en seguimiento | %s puntuación media",
	FunnelTitle:     "Embudo del proceso",
	ScoresTitle:     "Distribución de puntuaciones",
	RatesTitle:      "Tasas de conversión",
	WeeklyTitle:     "Actividad semanal",
	ActiveInfo:      "%d solicitudes activas | %d ofertas totales",

	// Stats screen
	StatsTitle:             "ESTADÍSTICAS DE BÚSQUEDA",
	StatsSummary:           "%d evaluadas | %d arquetipos",
	StatsStrategicInsights: "INSIGHTS ESTRATÉGICOS",
	FitQualityDistribution: "Distribución de Calidad de Ajuste",
	SeniorityMix:           "Mix de Antigüedad",
	QualityBreakdown:       "Desglose de Calidad:",
	MeetQualityBar:         "✓ %.0f%% supera el umbral de ≥4.0",
	SalaryBandDist:         "Distribución por Rangos Salariales:",
	ArchetypeTitle:         "Por Arquetipo",
	WorkModeTitle:          "Por Modalidad",
	LocationTitle:          "Por Ubicación",
	PayTitle:               "Rango salarial (tope publicado, $)",
	ColArchetype:           "ARQUETIPO",
	ColCount:               "CANTIDAD",
	ColAvgScore:            "AJUSTE PROM",
	PayCount:               "Puntos de datos: ",
	PayAvg:                 "Prom: ",
	PayMedian:              "Mediana: ",
	PayMax:                 "Máx: ",
	PaySourceSplit:         "%d publicados, %d estimados",
	InsightVolumeFit:       "Mayor volumen en %s (%d puestos, %.0f%%) · Mayor ajuste en %s (ajuste prom. %.1f/5)",
	InsightVolumePrimary:   "Arquetipo principal: %s (%d puestos, %.0f%% del flujo evaluado)",
	InsightWorkMode:        "Distribución laboral: el %.0f%% de los puestos opera como %s",
	InsightPayBenchmark:    "Referencia salarial: La mediana de salario máximo es $%.0fK (pico $%.0fK) en %d puntos de datos",

	// Seniority levels
	SeniorityExecutive:      "Ejecutivo",
	SeniorityStaffPrincipal: "Staff / Principal",
	SeniorityLeadManager:    "Líder / Manager",
	SenioritySenior:         "Senior",
	SeniorityMidLevel:       "Nivel Medio",
	SeniorityJuniorEntry:    "Junior / Inicial",

	// Relative dates
	TimeToday:     "hoy",
	TimeYesterday: "ayer",
	TimeDaysAgo:   "hace %dd",

	// Status display names
	StatusEvaluated:   "Evaluada",
	StatusSpeculative: "Especulativa",
	StatusApplied:     "Aplicada",
	StatusResponded:   "Respondida",
	StatusAssessment:  "Prueba",
	StatusInterview:   "Entrevista",
	StatusOffer:       "Oferta",
	StatusRejected:    "Rechazada",
	StatusDiscarded:   "Descartada",
	StatusSkip:        "OMITIR",
	StatusHired:       "Contratada",
	StatusOther:       "Otras",

	// Additional UI strings
	NoData:        "Sin datos",
	EmptyFile:     "(archivo vacío)",
	RateResponse:  "Tasa de respuesta: ",
	RateInterview: "Tasa de entrevistas: ",
	RateOffer:     "Tasa de ofertas: ",

	// Footer descriptions & hints
	HelpNav:        " navegar  ",
	HelpTabs:       " pestañas  ",
	HelpSearch:     " buscar  ",
	HelpSort:       " ordenar  ",
	HelpRefresh:    " actualizar  ",
	HelpReport:     " informe  ",
	HelpOpenURL:    " abrir URL  ",
	HelpQueue:      " encolar  ",
	HelpSkip:       " omitir  ",
	HelpUndoSkip:   " deshacer omisión  ",
	HelpRankRow:    " rango  ",
	HelpRankAll:    " rango a todas  ",
	HelpOpenPDF:    " abrir PDF  ",
	HelpCopyPDF:    " copiar ruta del PDF  ",
	HelpRegenPDF:   " regenerar PDF  ",
	HelpChange:     " cambiar  ",
	HelpColumns:    " columnas  ",
	HelpView:       " vista  ",
	HelpProgress:   " progreso  ",
	HelpStats:      " estadísticas  ",
	HelpQuit:       " salir",
	HelpKeys:       " teclas  ",
	HelpScroll:     " desplazar  ",
	HelpPage:       " página  ",
	HelpTopEnd:     " inicio/fin  ",
	HelpLanguage:   " idioma  ",
	HelpManifesto:  " manifiesto  ",
	HelpBack:       " atrás",
	HelpNavigate:   " navegar  ",
	HelpToggle:     " alternar  ",
	HelpClose:      " cerrar",
	HelpConfirm:    " confirmar  ",
	HelpCancel:     " cancelar",
	HelpFilterLive: " filtrar en vivo  ",
	HelpKeep:       " guardar  ",
	HelpClear:      " limpiar  ",

	// Picker overlay titles & bar hints
	PickerChangeStatus: "Cambiar estado:",
	PickerColumnsTitle: "─── Columnas (SPACE alternar · ESC cerrar) ───",
	SearchHintInput:    "   Enter: guardar   Esc: cancelar   Ctrl+U: limpiar",
	SearchHintNormal:   "   Esc: limpiar   /: editar",
	SearchMatching:     "  %d/%d coincidencias",
	SortLabel:          "[Orden: %s]",
	ViewLabel:          "[Vista: %s]",
	ShownCount:         "%d mostradas",
	ColReport:          "INF",
	ColPDF:             "PDF",

	// Sort & view modes
	SortScore:    "puntuación",
	SortDate:     "fecha",
	SortCompany:  "empresa",
	SortStatus:   "estado",
	SortLocation: "ubicación",
	SortPay:      "salario",
	SortLast:     "último",
	SortPosted:   "publicado",
	ViewGrouped:  "agrupado",
	ViewFlat:     "plano",

	// Inbox tab
	TabInbox:               "BANDEJA",
	ColRank:                "RANGO",
	SortRank:               "rango",
	LabelRank:              "Rango: ",
	LabelURL:               "URL: ",
	InboxEmpty:             "No hay filas pendientes en data/pipeline.md",
	InboxNotRanked:         "sin rango",
	InboxSummary:           "%d pendientes · %d sin rango",
	InboxNoWebURL:          "No es una dirección web; no se abrió nada: %s",
	InboxUnavailable:       "Bandeja no disponible; se muestran las filas anteriores: %s",
	InboxStatusQueued:      "En cola",
	InboxStatusRunning:     "En curso",
	InboxStatusPaused:      "En pausa",
	InboxStatusNeedsAnswer: "Falta respuesta",
	InboxStatusFailed:      "Fallida",
	InboxStatusDone:        "Hecha",

	InboxQueueing:         "Encolando %s ...",
	InboxQueued:           "En cola. Ejecuta batch/batch-runner.sh para evaluarla: %s",
	InboxQueueFailed:      "No se pudo encolar la fila: %s",
	InboxQueueAlready:     "Ya está en los archivos de batch; no se encoló nada: %s",
	InboxQueueRetryFailed: "Falló en el batch; reinténtalo con batch/batch-runner.sh --retry-failed: %s",
	InboxQueueUnreadable:  "No se encoló: en data/pipeline.md la URL debe ir justo después de \"- [ ] \": %s",
	InboxQueueNoWebURL:    "No es una dirección web; no se encoló nada: %s",

	InboxSkipping:       "Omitiendo %s ...",
	InboxSkipped:        "Omitida; u la devuelve: %s",
	InboxSkipUnchanged:  "Ya estaba omitida en data/pipeline.md; no cambió nada: %s",
	InboxSkipUnreadable: "No se omitió: en data/pipeline.md la URL debe ir justo después de \"- [ ] \": %s",
	InboxSkipFailed:     "No se pudo omitir la fila: %s",
	InboxSkipNoWebURL:   "No es una dirección web; no se omitió nada: %s",
	InboxUndoNothing:    "Nada que deshacer: no se omitió ninguna fila en esta sesión",
	InboxUndoing:        "Devolviendo %s ...",
	InboxUndone:         "De vuelta en la bandeja: %s",
	InboxUndoUnchanged:  "Ya no está omitida; nada que deshacer: %s",
	InboxUndoGone:       "No se devolvió: la fila ya no está en la sección Pending de data/pipeline.md: %s",
	InboxUndoFailed:     "No se pudo deshacer la omisión; u lo intenta de nuevo: %s",

	InboxRankAskRow:     "¿Dar rango a esta fila con tu CLI de agente? Usa tokens. y: sí, otra: no",
	InboxRankAskAll:     "¿Dar rango a %d fila(s) con tu CLI de agente? Usa tokens. y: sí, otra: no",
	InboxRankAskSome:    "¿Dar rango a las %d filas siguientes con tu CLI? Usa tokens. y: sí, otra: no",
	InboxRankCancelled:  "Cancelado, ninguna fila recibió rango",
	InboxRanking:        "Asignando rango a %d fila(s) con tu CLI de agente ...",
	InboxRankRunning:    "asignando rango a %d ...",
	InboxRankBusy:       "Ya hay una asignación de rango en curso; espera a que termine",
	InboxRankAlready:    "Ya tiene rango, nada que hacer: %s",
	InboxRankNone:       "Todas las filas tienen rango, nada que hacer",
	InboxRankFailed:     "No se pudo asignar rango: %s",
	InboxRankNotPending: "Sin rango: la URL debe ir justo después de \"- [ ] \" en data/pipeline.md y sin rango previo: %s",
	InboxRankedRow:      "Rango %.1f/5: %s",
	InboxRankNoScore:    "No llegó ninguna puntuación; a lo intenta de nuevo: %s",
	InboxRankedAll:      "Asignación de rango terminada; %d fila(s) siguen sin rango",
	InboxRankReadFailed: "Asignación de rango terminada, pero no se pudo leer el Inbox: %s",
}

// Current points to the active language catalog. Defaults to English (&En).
var Current = &En

// languages is the single source of truth for which languages exist, in the
// order ToggleLang cycles them. SetLang, GetLang and ToggleLang all read it, so
// adding a language is one entry here rather than three separate edits that can
// drift — which is how ToggleLang came to be unable to reach Spanish.
//
// Order matters twice: it is the cycle order, and SetLang matches by prefix in
// this order. "en" before "es" is harmless since neither is a prefix of the
// other, but a future code that is a prefix of another must come after it.
var languages = []struct {
	code    string
	catalog *Catalog
}{
	{"en", &En},
	{"tr", &Tr},
	{"es", &Es},
}

// SetLang sets the active catalog based on language code prefix
// (e.g., "tr", "tr_TR" -> &Tr; "es", "es_ES" -> &Es; anything else -> &En).
func SetLang(lang string) {
	l := strings.ToLower(strings.TrimSpace(lang))
	for _, entry := range languages {
		if strings.HasPrefix(l, entry.code) {
			Current = entry.catalog
			return
		}
	}
	Current = &En
}

// ToggleLang advances Current to the next language in `languages`, wrapping.
//
// It used to flip between &En and &Tr, with every other catalog falling into
// the else branch and landing on English. Spanish was added after that was
// written, so a user who started the dashboard in Spanish pressed the key the
// help bar advertises as "lang" and could not get back — the toggle could only
// ever reach English and Turkish. Cycling makes every supported language
// reachable from every other one.
func ToggleLang() {
	for i, entry := range languages {
		if Current == entry.catalog {
			Current = languages[(i+1)%len(languages)].catalog
			return
		}
	}
	// Current points at a catalog outside the list: land somewhere defined
	// rather than leaving it unchanged, so the key always does something.
	Current = &En
}

// GetLang returns the active language code, or "en" when Current points at a
// catalog that is not in `languages`.
func GetLang() string {
	for _, entry := range languages {
		if Current == entry.catalog {
			return entry.code
		}
	}
	return "en"
}
