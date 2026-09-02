package data

import (
	"fmt"
	"sort"
	"strings"
	"unicode"

	"github.com/santifer/career-ops/dashboard/internal/i18n"
	"github.com/santifer/career-ops/dashboard/internal/model"
)

// CanonicalizeArchetype maps raw, noisy LLM-extracted archetype strings
// into structured canonical categories for high-signal analytics.
func CanonicalizeArchetype(raw string) string {
	r := strings.ToLower(strings.TrimSpace(raw))
	if r == "" || r == "unknown" || r == "none" || r == "n/a" || r == "—" || r == "-" || strings.HasPrefix(r, "none ") {
		return "Unclassified"
	}

	// Priority-based keyword classification
	if strings.Contains(r, "agentic") || strings.Contains(r, "automation") {
		return "Agentic & Automation"
	}
	if strings.Contains(r, "solutions architect") || strings.Contains(r, "forward deployed") || strings.Contains(r, "deployment architect") {
		return "AI Solutions & FDE"
	}
	if strings.Contains(r, "technical ai pm") || (strings.Contains(r, "ai") && strings.Contains(r, "pm")) || (strings.Contains(r, "ai") && strings.Contains(r, "product manager")) {
		return "Technical AI PM"
	}
	if strings.Contains(r, "llmops") || strings.Contains(r, "mlops") || strings.Contains(r, "platform") || strings.Contains(r, "infrastructure") {
		return "AI Platform & LLMOps"
	}
	if strings.Contains(r, "ai/ml") || strings.Contains(r, "ml engineer") || strings.Contains(r, "ai engineer") || strings.Contains(r, "ki- entwickler") || strings.Contains(r, "genai") || strings.Contains(r, "applied ai") {
		return "AI & ML Engineering"
	}
	if strings.Contains(r, "transformation") || strings.Contains(r, "strategy") || strings.Contains(r, "consultant") || strings.Contains(r, "governance") || strings.Contains(r, "policy") {
		return "AI Transformation & Governance"
	}
	if strings.Contains(r, "product") || strings.Contains(r, "project") || strings.Contains(r, "program") || strings.Contains(r, "pm") || strings.Contains(r, "projektkoordin") {
		return "Product & Program Mgmt"
	}
	if strings.Contains(r, "data") || strings.Contains(r, "analytics") || strings.Contains(r, "business intelligence") {
		return "Data & Analytics"
	}
	if strings.Contains(r, "support") || strings.Contains(r, "helpdesk") || strings.Contains(r, "service desk") || strings.Contains(r, "customer service") || strings.Contains(r, "onboarding") || strings.Contains(r, "administrator") || strings.Contains(r, "operations") || strings.Contains(r, "admin") {
		return "IT & Technical Operations"
	}
	if strings.Contains(r, "research") || strings.Contains(r, "wissenschaft") || strings.Contains(r, "universit") || strings.Contains(r, "bildung") {
		return "Research & Academia"
	}

	return "Other / Cross-Functional"
}

// isFalseCityState checks if extracted strings represent false positive location fragments.
func isFalseCityState(city, state string) bool {
	c := strings.ToLower(strings.TrimSpace(city))
	s := strings.ToUpper(strings.TrimSpace(state))
	if c == "req" || c == "job" || c == "id" || c == "user" || c == "applicant" ||
		strings.HasPrefix(c, "req") ||
		strings.Contains(c, "science") || strings.Contains(c, "department") ||
		strings.Contains(c, "faculty") || strings.Contains(c, "studies") ||
		(s == "ID" && (strings.EqualFold(c, "req") || strings.EqualFold(c, "job"))) {
		return true
	}
	return false
}

// titleCase returns a UTF-8 rune-aware title-cased version of s:
// each word is lowercased and its first rune is converted with unicode.ToUpper.
func titleCase(s string) string {
	words := strings.Fields(s)
	for i, w := range words {
		runes := []rune(strings.ToLower(w))
		if len(runes) == 0 {
			continue
		}
		runes[0] = unicode.ToUpper(runes[0])
		words[i] = string(runes)
	}
	return strings.Join(words, " ")
}

// CanonicalizeLocation normalizes casing and eliminates noise strings from location data.
func CanonicalizeLocation(raw string) string {
	loc := strings.TrimSpace(raw)
	if loc == "" || loc == "—" || loc == "-" || loc == "N/A" {
		return ""
	}

	parts := strings.Split(loc, ",")
	if len(parts) == 1 {
		c := strings.ToLower(strings.TrimSpace(parts[0]))
		if isFalseCityState(c, "") {
			return ""
		}
		switch c {
		case "berlin":
			return "Berlin"
		case "munich", "münchen":
			return "Munich"
		case "frankfurt":
			return "Frankfurt"
		case "hamburg":
			return "Hamburg"
		case "london":
			return "London"
		case "madrid":
			return "Madrid"
		case "barcelona":
			return "Barcelona"
		case "paris":
			return "Paris"
		case "amsterdam":
			return "Amsterdam"
		case "zurich", "zürich":
			return "Zurich"
		case "dublin":
			return "Dublin"
		case "vienna", "wien":
			return "Vienna"
		default:
			return titleCase(c)
		}
	} else if len(parts) == 2 {
		city := CanonicalizeLocation(parts[0])
		state := strings.TrimSpace(parts[1])
		if isFalseCityState(city, state) {
			return ""
		}
		if city == "" {
			return ""
		}
		// Trailing comma produces an empty state component (e.g. "Berlin,").
		// Return just the canonical city rather than appending a bare ", ".
		if state == "" {
			return city
		}
		if len(state) <= 2 {
			state = strings.ToUpper(state)
		} else {
			state = titleCase(state)
		}
		return city + ", " + state
	}

	// 3+ parts: normalize every component using the stable casing rule and filter false positives.
	var normalized []string
	for i, p := range parts {
		trimmed := strings.TrimSpace(p)
		if trimmed == "" {
			continue
		}
		if i == 0 {
			city := CanonicalizeLocation(trimmed)
			if city == "" {
				return ""
			}
			normalized = append(normalized, city)
		} else {
			if len(trimmed) <= 2 {
				normalized = append(normalized, strings.ToUpper(trimmed))
			} else {
				normalized = append(normalized, titleCase(trimmed))
			}
		}
	}
	if len(normalized) >= 2 && isFalseCityState(normalized[0], normalized[1]) {
		return ""
	}
	if len(normalized) == 0 {
		return ""
	}
	return strings.Join(normalized, ", ")
}

// ComputeStatsMetrics builds dimension-based breakdowns (archetype, work
// mode, location, pay, pay histogram, and insight captions) from parsed applications.
func ComputeStatsMetrics(apps []model.CareerApplication) model.StatsMetrics {
	sm := model.StatsMetrics{}

	// 1. Archetype aggregation
	type archAcc struct {
		count      int
		scoreSum   float64
		scoreCount int
	}
	archAccs := make(map[string]*archAcc)
	archTotal := 0

	for _, app := range apps {
		label := strings.TrimSpace(app.Archetype)
		if label == "" {
			continue
		}
		canonical := CanonicalizeArchetype(label)
		a, ok := archAccs[canonical]
		if !ok {
			a = &archAcc{}
			archAccs[canonical] = a
		}
		a.count++
		archTotal++
		if app.Score > 0 {
			a.scoreSum += app.Score
			a.scoreCount++
		}
	}

	for label, a := range archAccs {
		avg := 0.0
		if a.scoreCount > 0 {
			avg = a.scoreSum / float64(a.scoreCount)
		}
		sm.Archetypes = append(sm.Archetypes, model.ArchetypeStat{
			Label:    label,
			Count:    a.count,
			Pct:      safePct(a.count, archTotal),
			AvgScore: avg,
		})
	}
	sort.Slice(sm.Archetypes, func(i, j int) bool {
		if sm.Archetypes[i].Count != sm.Archetypes[j].Count {
			return sm.Archetypes[i].Count > sm.Archetypes[j].Count
		}
		return sm.Archetypes[i].Label < sm.Archetypes[j].Label
	})

	// 2. Work mode breakdown
	modeCounts := make(map[string]int)
	modeTotal := 0
	for _, app := range apps {
		mode := strings.TrimSpace(app.WorkMode)
		if mode == "" {
			continue
		}
		modeCounts[mode]++
		modeTotal++
	}
	sm.WorkModes = labelCountStats(modeCounts, modeTotal)
	sort.Slice(sm.WorkModes, func(i, j int) bool {
		if sm.WorkModes[i].Count != sm.WorkModes[j].Count {
			return sm.WorkModes[i].Count > sm.WorkModes[j].Count
		}
		return sm.WorkModes[i].Label < sm.WorkModes[j].Label
	})

	// 3. Location breakdown
	locCounts := make(map[string]int)
	locTotal := 0
	for _, app := range apps {
		loc := CanonicalizeLocation(app.Location)
		if loc == "" {
			continue
		}
		locCounts[loc]++
		locTotal++
	}
	sm.Locations = labelCountStats(locCounts, locTotal)
	sort.Slice(sm.Locations, func(i, j int) bool {
		if sm.Locations[i].Count != sm.Locations[j].Count {
			return sm.Locations[i].Count > sm.Locations[j].Count
		}
		return sm.Locations[i].Label < sm.Locations[j].Label
	})
	const maxLocations = 8
	if len(sm.Locations) > maxLocations {
		sm.Locations = sm.Locations[:maxLocations]
	}

	// 4. Pay statistics and histogram
	var payValues []float64
	payBuckets := map[string]int{
		"< $100K":       0,
		"$100K - $140K": 0,
		"$140K - $180K": 0,
		"$180K - $220K": 0,
		"$220K+":        0,
	}

	for _, app := range apps {
		if app.PayMax <= 0 {
			continue
		}
		payValues = append(payValues, app.PayMax)
		sm.Pay.Count++
		switch app.PaySource {
		case "POSTED":
			sm.Pay.PostedCount++
		case "est":
			sm.Pay.EstCount++
		}
		sm.Pay.AvgPayMax += app.PayMax
		if app.PayMax > sm.Pay.MaxPayMax {
			sm.Pay.MaxPayMax = app.PayMax
		}

		switch {
		case app.PayMax < 100000:
			payBuckets["< $100K"]++
		case app.PayMax <= 140000:
			payBuckets["$100K - $140K"]++
		case app.PayMax <= 180000:
			payBuckets["$140K - $180K"]++
		case app.PayMax <= 220000:
			payBuckets["$180K - $220K"]++
		default:
			payBuckets["$220K+"]++
		}
	}

	if sm.Pay.Count > 0 {
		sm.Pay.AvgPayMax /= float64(sm.Pay.Count)
		sort.Float64s(payValues)
		sm.Pay.MedianPayMax = median(payValues)

		orderedBands := []string{"< $100K", "$100K - $140K", "$140K - $180K", "$180K - $220K", "$220K+"}
		for _, band := range orderedBands {
			count := payBuckets[band]
			sm.PayHistogram = append(sm.PayHistogram, model.LabelCountStat{
				Label: band,
				Count: count,
				Pct:   safePct(count, sm.Pay.Count),
			})
		}
	}

	// 5. Score Quality Tiers for Pie Chart breakdown
	tierCounts := map[string]int{
		"Elite (≥4.5)":      0,
		"Strong (4.0-4.4)":  0,
		"Viable (3.5-3.9)":  0,
		"Moderate (3.0-3.4)": 0,
		"Below Bar (<3.0)":  0,
	}
	scoreTotal := 0
	for _, app := range apps {
		if app.Score <= 0 {
			continue
		}
		scoreTotal++
		switch {
		case app.Score >= 4.5:
			tierCounts["Elite (≥4.5)"]++
		case app.Score >= 4.0:
			tierCounts["Strong (4.0-4.4)"]++
		case app.Score >= 3.5:
			tierCounts["Viable (3.5-3.9)"]++
		case app.Score >= 3.0:
			tierCounts["Moderate (3.0-3.4)"]++
		default:
			tierCounts["Below Bar (<3.0)"]++
		}
	}
	if scoreTotal > 0 {
		orderedTiers := []string{
			"Elite (≥4.5)",
			"Strong (4.0-4.4)",
			"Viable (3.5-3.9)",
			"Moderate (3.0-3.4)",
			"Below Bar (<3.0)",
		}
		qualityBarCount := 0
		for _, t := range orderedTiers {
			count := tierCounts[t]
			if count > 0 {
				sm.ScoreTiers = append(sm.ScoreTiers, model.LabelCountStat{
					Label: t,
					Count: count,
					Pct:   safePct(count, scoreTotal),
				})
			}
			// Elite and Strong together = score >= 4.0
			if t == "Elite (≥4.5)" || t == "Strong (4.0-4.4)" {
				qualityBarCount += count
			}
		}
		sm.QualityBarPct = safePct(qualityBarCount, scoreTotal)
	}

	// 5.5 Seniority Mix Pie Chart
	seniorityCounts := map[string]int{
		"Executive":         0,
		"Staff / Principal": 0,
		"Lead / Manager":    0,
		"Senior":            0,
		"Mid-Level":         0,
		"Junior / Entry":    0,
	}
	seniorityTotal := 0
	for _, app := range apps {
		if app.Role == "" {
			continue
		}
		seniorityTotal++
		sen := deriveSeniority(app.Role)
		seniorityCounts[sen]++
	}
	if seniorityTotal > 0 {
		orderedSen := []string{"Executive", "Staff / Principal", "Lead / Manager", "Senior", "Mid-Level", "Junior / Entry"}
		for _, s := range orderedSen {
			count := seniorityCounts[s]
			if count > 0 {
				sm.SeniorityMix = append(sm.SeniorityMix, model.LabelCountStat{
					Label: s,
					Count: count,
					Pct:   safePct(count, seniorityTotal),
				})
			}
		}
	}

	// Insights are generated at render time (renderInsights) to respect the
	// active language toggle; do not store them here.

	return sm
}

// GenerateInsights produces localized strategic insights from metrics.
func GenerateInsights(sm model.StatsMetrics) []string {
	var insights []string

	// Volume & Fit insight
	if len(sm.Archetypes) > 0 {
		topArch := sm.Archetypes[0]
		var bestFitArch model.ArchetypeStat
		bestFitScore := 0.0
		for _, a := range sm.Archetypes {
			if a.Count >= 3 && a.AvgScore > bestFitScore && a.Label != "Unclassified" {
				bestFitScore = a.AvgScore
				bestFitArch = a
			}
		}
		if bestFitScore > 0 && bestFitArch.Label != topArch.Label {
			insights = append(insights, fmt.Sprintf(i18n.Current.InsightVolumeFit,
				topArch.Label, topArch.Count, topArch.Pct, bestFitArch.Label, bestFitScore))
		} else {
			insights = append(insights, fmt.Sprintf(i18n.Current.InsightVolumePrimary,
				topArch.Label, topArch.Count, topArch.Pct))
		}
	}

	// Work Mode insight
	if len(sm.WorkModes) > 0 {
		topMode := sm.WorkModes[0]
		insights = append(insights, fmt.Sprintf(i18n.Current.InsightWorkMode,
			topMode.Pct, topMode.Label))
	}

	// Pay insight
	if sm.Pay.Count > 0 {
		insights = append(insights, fmt.Sprintf(i18n.Current.InsightPayBenchmark,
			sm.Pay.MedianPayMax/1000, sm.Pay.MaxPayMax/1000, sm.Pay.Count))
	}

	return insights
}

// labelCountStats converts a label->count map into sorted LabelCountStat
// rows with pct-of-total computed against denom.
func labelCountStats(counts map[string]int, denom int) []model.LabelCountStat {
	stats := make([]model.LabelCountStat, 0, len(counts))
	for label, count := range counts {
		stats = append(stats, model.LabelCountStat{
			Label: label,
			Count: count,
			Pct:   safePct(count, denom),
		})
	}
	return stats
}

// median returns the median of a pre-sorted slice of float64s.
func median(sorted []float64) float64 {
	n := len(sorted)
	if n == 0 {
		return 0
	}
	if n%2 == 1 {
		return sorted[n/2]
	}
	return (sorted[n/2-1] + sorted[n/2]) / 2
}

// deriveSeniority extracts the seniority level from a raw job title.
func deriveSeniority(role string) string {
	r := strings.ToLower(role)
	if strings.Contains(r, "chief") || strings.Contains(r, "vp ") || strings.Contains(r, "vice president") || strings.Contains(r, "head") || strings.Contains(r, "director") {
		return "Executive"
	}
	if strings.Contains(r, "staff") || strings.Contains(r, "principal") || strings.Contains(r, "architect") || strings.Contains(r, "founding") {
		return "Staff / Principal"
	}
	if strings.Contains(r, "senior") || strings.Contains(r, "sr.") || strings.Contains(r, "sr ") {
		return "Senior"
	}
	if strings.Contains(r, "lead") || strings.Contains(r, "manager") {
		return "Lead / Manager"
	}
	if strings.Contains(r, "junior") || strings.Contains(r, "jr.") || strings.Contains(r, "intern") || strings.Contains(r, "student") || strings.Contains(r, "graduate") {
		return "Junior / Entry"
	}
	return "Mid-Level"
}
