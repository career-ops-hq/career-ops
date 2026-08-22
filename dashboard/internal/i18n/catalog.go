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
	TabAll       string
	TabEvaluated string
	TabApplied   string
	TabInterview string
	TabResponded string
	TabTop       string
	TabSkip      string
	TabRejected  string
	TabDiscarded string

	// Table column headers
	ColFit      string
	ColApplied  string
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
	StatusEvaluated string
	StatusApplied   string
	StatusResponded string
	StatusInterview string
	StatusOffer     string
	StatusRejected  string
	StatusDiscarded string
	StatusSkip      string
	StatusHired     string

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
	HelpOpenPDF    string
	HelpRegenPDF   string
	HelpChange     string
	HelpColumns    string
	HelpView       string
	HelpProgress   string
	HelpStats      string
	HelpQuit       string
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
	ViewGrouped  string
	ViewFlat     string
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
// (interview, offer, hired, responded, applied, evaluated, skip, rejected,
// discarded).
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
	case "applied":
		return c.StatusApplied
	case "evaluated":
		return c.StatusEvaluated
	case "skip":
		return c.StatusSkip
	case "rejected":
		return c.StatusRejected
	case "discarded":
		return c.StatusDiscarded
	default:
		return norm
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
	TabAll:       "ALL",
	TabEvaluated: "EVALUATED",
	TabApplied:   "APPLIED",
	TabInterview: "INTERVIEW",
	TabResponded: "RESPONDED",
	TabTop:       "TOP ≥4",
	TabSkip:      "SKIP",
	TabRejected:  "REJECTED",
	TabDiscarded: "DISCARDED",

	// Table column headers
	ColFit:      "FIT",
	ColApplied:  "APPLIED",
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
	ModeRemoteFlex: "RemoteFlex",
	ModeHybrid:     "Hybrid",
	ModeFull:       "Full",

	// Progress screen
	ProgressTitle:   "SEARCH PROGRESS",
	ProgressSummary: "%d evaluated | %.1f avg score",
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
	StatusEvaluated: "Evaluated",
	StatusApplied:   "Applied",
	StatusResponded: "Responded",
	StatusInterview: "Interview",
	StatusOffer:     "Offer",
	StatusRejected:  "Rejected",
	StatusDiscarded: "Discarded",
	StatusSkip:      "SKIP",
	StatusHired:     "Hired",

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
	HelpOpenPDF:    " open PDF  ",
	HelpRegenPDF:   " regen PDF  ",
	HelpChange:     " change  ",
	HelpColumns:    " columns  ",
	HelpView:       " view  ",
	HelpProgress:   " progress  ",
	HelpStats:      " stats  ",
	HelpQuit:       " quit",
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
	ViewGrouped:  "grouped",
	ViewFlat:     "flat",
}

// Tr is the static Turkish translation catalog.
var Tr = Catalog{
	// Screen banners & general
	AppTitle:       "KARİYER HATTI",
	OffersSummary:  "%d ilan | Ort %s/5",
	NoOffersMatch:  "Bu filtreye uyan ilan yok",
	LoadingPreview: "Önizleme yükleniyor...",

	// Tabs & filters
	TabAll:       "TÜMÜ",
	TabEvaluated: "DEĞERLENDİRİLDİ",
	TabApplied:   "BAŞVURULDU",
	TabInterview: "MÜLAKAT",
	TabResponded: "YANIT VERİLDİ",
	TabTop:       "EN İYİ ≥4",
	TabSkip:      "UYGUN DEĞİL",
	TabRejected:  "REDDEDİLDİ",
	TabDiscarded: "İPTAL",

	// Table column headers
	ColFit:      "UYUM",
	ColApplied:  "TARİH",
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
	ProgressSummary: "%d değerlendirildi | %.1f ort. puan",
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
	StatusEvaluated: "Değerlendirildi",
	StatusApplied:   "Başvuruldu",
	StatusResponded: "Yanıt Verildi",
	StatusInterview: "Mülakat",
	StatusOffer:     "Teklif",
	StatusRejected:  "Reddedildi",
	StatusDiscarded: "İptal Edildi",
	StatusSkip:      "Uygun Değil",
	StatusHired:     "İşe Alındı",

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
	HelpOpenPDF:    " PDF'i aç  ",
	HelpRegenPDF:   " PDF üret  ",
	HelpChange:     " durum  ",
	HelpColumns:    " sütunlar  ",
	HelpView:       " görünüm  ",
	HelpProgress:   " ilerleme  ",
	HelpStats:      " istatistik  ",
	HelpQuit:       " çıkış",
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
	ViewGrouped:  "gruplu",
	ViewFlat:     "düz",
}

// Es is the static Spanish translation catalog.
var Es = Catalog{
	// Screen banners & general
	AppTitle:       "FLUJO DE CARRERA",
	OffersSummary:  "%d ofertas | Prom %s/5",
	NoOffersMatch:  "Ninguna oferta coincide con este filtro",
	LoadingPreview: "Cargando vista previa...",

	// Tabs & filters
	TabAll:       "TODAS",
	TabEvaluated: "EVALUADAS",
	TabApplied:   "APLICADAS",
	TabInterview: "ENTREVISTA",
	TabResponded: "RESPONDIDAS",
	TabTop:       "TOP ≥4",
	TabSkip:      "OMITIR",
	TabRejected:  "RECHAZADAS",
	TabDiscarded: "DESCARTADAS",

	// Table column headers
	ColFit:      "AJUSTE",
	ColApplied:  "APLICADA",
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
	ProgressSummary: "%d evaluadas | %.1f puntuación media",
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
	StatusEvaluated: "Evaluada",
	StatusApplied:   "Aplicada",
	StatusResponded: "Respondida",
	StatusInterview: "Entrevista",
	StatusOffer:     "Oferta",
	StatusRejected:  "Rechazada",
	StatusDiscarded: "Descartada",
	StatusSkip:      "OMITIR",
	StatusHired:     "Contratada",

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
	HelpOpenPDF:    " abrir PDF  ",
	HelpRegenPDF:   " regenerar PDF  ",
	HelpChange:     " cambiar  ",
	HelpColumns:    " columnas  ",
	HelpView:       " vista  ",
	HelpProgress:   " progreso  ",
	HelpStats:      " estadísticas  ",
	HelpQuit:       " salir",
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
	ViewGrouped:  "agrupado",
	ViewFlat:     "plano",
}

// Current points to the active language catalog. Defaults to English (&En).
var Current = &En

// SetLang sets the active catalog based on language code prefix
// (e.g., "tr", "tr_TR" -> &Tr; "es", "es_ES" -> &Es; anything else -> &En).
func SetLang(lang string) {
	l := strings.ToLower(strings.TrimSpace(lang))
	switch {
	case strings.HasPrefix(l, "tr"):
		Current = &Tr
	case strings.HasPrefix(l, "es"):
		Current = &Es
	default:
		Current = &En
	}
}

// ToggleLang switches Current between &En and &Tr.
func ToggleLang() {
	if Current == &En {
		Current = &Tr
	} else {
		Current = &En
	}
}

// GetLang returns the active language code ("tr" if Current == &Tr, "es" if
// Current == &Es, else "en").
func GetLang() string {
	if Current == &Tr {
		return "tr"
	}
	if Current == &Es {
		return "es"
	}
	return "en"
}
