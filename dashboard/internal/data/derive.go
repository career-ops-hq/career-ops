package data

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

// The tracker's Notes column is free-text, but evaluations write it with stable
// conventions: work mode ("Remote US", "Charlotte NC (Hybrid)"), a pay range
// ("$140-210K (POSTED)" / "~$150-220K (est)") and event dates ("Rejected
// 2026-06-04"). These regexes lift that structure back out so the dashboard can
// show Location / Pay / Last-contact columns without a tracker schema change.
var (
	// $-amounts, optionally a range: "$140-210K", "$174,986-209,983", "~$124.2-198.7K"
	reMoneySpan = regexp.MustCompile(`~?\$\d[\d,]*(?:\.\d+)?[KkMm]?(?:\s*[-–]\s*\$?\d[\d,]*(?:\.\d+)?[KkMm]?)?`)
	// ISO dates embedded in notes ("Rejected 2026-06-04", "viewed 2026-06-04")
	reISODate = regexp.MustCompile(`\b20\d{2}-\d{2}-\d{2}\b`)
	// "City ST" / "City, ST" with a strict two-letter US state code so prose like
	// "Sams AI" or "Kerin Colby DONE" can't false-positive.
	reCityState = regexp.MustCompile(`\b([A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){0,2}),? (A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\b`)
	// Individual amounts inside an already-matched span: "140", "210K", "209,983"
	reMoneyPart = regexp.MustCompile(`(\d[\d,]*(?:\.\d+)?)\s*([KkMm]?)`)
	// Estimate markers: "(est)", "(est;", "market est)" or "market" as its own
	// word — but not "(EST/CST" timezones, "interest)" or "marketing".
	reEstHint = regexp.MustCompile(`\(est[),;. ]|\best\)|\bmarket\b`)
)

// payCeiling converts a matched pay span to its top dollar amount for sorting:
// "$140-210K" → 210000, "$174,986-209,983" → 209983, "$170K" → 170000.
func payCeiling(span string) float64 {
	top := 0.0
	for _, p := range reMoneyPart.FindAllStringSubmatch(span, -1) {
		v, err := strconv.ParseFloat(strings.ReplaceAll(p[1], ",", ""), 64)
		if err != nil {
			continue
		}
		switch strings.ToLower(p[2]) {
		case "k":
			v *= 1_000
		case "m":
			v *= 1_000_000
		}
		if v > top {
			top = v
		}
	}
	return top
}

// deriveNoteFields populates Location, WorkMode, PayRange, PaySource and
// LastContact from the application's Notes (plus Role for work-mode keywords).
func deriveNoteFields(app *model.CareerApplication) {
	lower := strings.ToLower(app.Role + " " + app.Notes)

	// Location: first "City, ST" in the notes, falling back to the role title
	// (some tracker rows carry the city there, e.g. "... — Charlotte, NC").
	if m := reCityState.FindStringSubmatch(app.Notes); m != nil {
		app.Location = m[1] + ", " + m[2]
	} else if m := reCityState.FindStringSubmatch(app.Role); m != nil {
		app.Location = m[1] + ", " + m[2]
	}

	// Work mode: hybrid beats remote ("Remote/hybrid" means office days exist);
	// "remote-first" / "remote + flex" is softer than fully remote;
	// a bare city+state with no keyword implies fully on-site.
	switch {
	case strings.Contains(lower, "hybrid"):
		app.WorkMode = "Hybrid"
	case strings.Contains(lower, "remote") &&
		(strings.Contains(lower, "flex") ||
			strings.Contains(lower, "remote-first") ||
			strings.Contains(lower, "remote first")):
		app.WorkMode = "RemoteFlex"
	case strings.Contains(lower, "remote"):
		app.WorkMode = "Remote"
	case strings.Contains(lower, "onsite") || strings.Contains(lower, "on-site") || strings.Contains(lower, "in-office"):
		app.WorkMode = "Full"
	case app.Location != "":
		app.WorkMode = "Full"
	}

	// Pay: prefer the first $-range; fall back to the first lone $-amount
	// (e.g. "$170K min floor") only when no range exists.
	matches := reMoneySpan.FindAllString(app.Notes, -1)
	for _, mm := range matches {
		if strings.ContainsAny(mm, "-–") {
			app.PayRange = mm
			break
		}
	}
	if app.PayRange == "" && len(matches) > 0 {
		app.PayRange = matches[0]
	}
	app.PayMax = payCeiling(app.PayRange)
	if app.PayRange != "" {
		switch {
		case strings.Contains(lower, "(posted"):
			app.PaySource = "POSTED"
		case reEstHint.MatchString(lower):
			app.PaySource = "est"
		}
	}

	// Last contact: the most recent ISO date mentioned anywhere in the notes
	// (rejections, recruiter views, phone screens), else the applied date.
	last := app.Date
	for _, d := range reISODate.FindAllString(app.Notes, -1) {
		if d > last {
			last = d
		}
	}
	app.LastContact = last
}
