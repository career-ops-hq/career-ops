package model

// CareerApplication represents a single job application from the tracker.
type CareerApplication struct {
	Number       int
	Date         string
	Company      string
	Role         string
	Status       string
	Score        float64
	ScoreRaw     string
	HasPDF       bool
	ReportPath   string
	ReportNumber string
	Notes        string
	JobURL       string // URL of the original job posting
	// Derived from Notes free-text (see data.deriveNoteFields)
	Location    string  // "City, ST" when a US city+state appears in the notes
	WorkMode    string  // "Remote" | "Hybrid" | "Full" (onsite), "" when unknown
	PayRange    string  // first $-range found in the notes, e.g. "$140-210K"
	PayMax      float64 // top of PayRange in dollars (sort key), 0 when unknown
	PaySource   string  // "POSTED" when the JD listed it, "est" for estimates, "" unknown
	PostedOn    string  // YYYY-MM-DD from a "posted <date>" note — when the req went live, "" unknown
	LastContact string  // max YYYY-MM-DD found in notes (falls back to applied date)
	// Enrichment (lazy loaded from report)
	Archetype    string
	TlDr         string
	Remote       string
	CompEstimate string
}

// PipelineMetrics holds aggregate stats for the pipeline dashboard.
type PipelineMetrics struct {
	Total      int
	ByStatus   map[string]int
	AvgScore   float64
	TopScore   float64
	WithPDF    int
	Actionable int
}

// ProgressMetrics holds job search progress analytics.
type ProgressMetrics struct {
	// Funnel
	FunnelStages []FunnelStage

	// Score distribution
	ScoreBuckets []ScoreBucket

	// Timeline (weekly activity)
	WeeklyActivity []WeekActivity

	// Rates
	ResponseRate  float64 // Responded / Applied
	InterviewRate float64 // Interview / Applied
	OfferRate     float64 // Offer / Applied

	// Averages
	AvgScore    float64
	TopScore    float64
	TotalOffers int
	ActiveApps  int // not skip/rejected/discarded
}

// FunnelStage represents one stage of the application funnel.
type FunnelStage struct {
	Label string
	Count int
	Pct   float64 // percentage of total
}

// ScoreBucket represents a score range and its count.
type ScoreBucket struct {
	Label string // e.g., "4.5-5.0", "4.0-4.4", "3.5-3.9", "3.0-3.4", "<3.0"
	Count int
}

// WeekActivity represents application activity for a given ISO week.
type WeekActivity struct {
	Week  string // e.g., "2026-W14", "2026-W13"
	Count int
}

// StatsMetrics holds cross-cutting breakdowns for the stats analytics screen,
// complementing ProgressMetrics (which is funnel/rate-focused) with
// dimension-based tables: what kinds of roles convert, where they are, and
// what they pay.
type StatsMetrics struct {
	Archetypes    []ArchetypeStat
	WorkModes     []LabelCountStat
	Locations     []LabelCountStat
	Pay           PayStats
	PayHistogram  []LabelCountStat
	ScoreTiers    []LabelCountStat
	SeniorityMix  []LabelCountStat
	QualityBarPct float64 // percentage of scored apps with score >= 4.0
}

// ArchetypeStat aggregates applications by report-derived archetype.
type ArchetypeStat struct {
	Label    string
	Count    int
	Pct      float64
	AvgScore float64
}

// LabelCountStat is a generic label+count(+pct) row used for work-mode and
// location breakdown tables.
type LabelCountStat struct {
	Label string
	Count int
	Pct   float64
}

// PayStats summarizes the PayMax field (top of the posted/estimated pay
// range, in dollars) across applications that have a parsed pay figure.
type PayStats struct {
	Count        int // apps with a known PayMax
	PostedCount  int // of those, PaySource == "POSTED"
	EstCount     int // of those, PaySource == "est"
	AvgPayMax    float64
	MedianPayMax float64
	MaxPayMax    float64
}
