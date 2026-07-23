package data

import (
	"fmt"
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
	// Pay amounts in user-written Notes. Currencies are listed in currencyTokens
	// below — the regex is assembled from that slice in three positions
	// (prefix, optional range-prefix, suffix) so adding a new currency is a
	// one-line append. The B suffix is matched too (not for pay itself, but so
	// a billion-scale valuation like "$7.6B" is captured as one token and can
	// be excluded by reFundingContext below — otherwise the "B" would be left
	// dangling after the match and the trailing "valuation" check would never
	// see it). payCeiling is currency-naive; PayMax sorts numerically.
	reMoneySpan = buildMoneySpanRegex(currencyTokens)
	// ISO dates embedded in notes ("Rejected 2026-06-04", "viewed 2026-06-04")
	reISODate = regexp.MustCompile(`\b20\d{2}-\d{2}-\d{2}\b`)
	// "City ST" / "City, ST" with a strict two-letter US state code so prose like
	// "Sams AI" or "Kerin Colby DONE" can't false-positive.
	reCityState = regexp.MustCompile(`\b([A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){0,2}),? (A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\b`)
	// International cities, checked only when no US "City, ST" matches, so
	// European/other non-US roles still surface a Location. Cities only (not bare
	// country names) to avoid prose false-positives like "Portugal eligible" or
	// "remote in Germany", which describe eligibility, not the job's location.
	reCityIntl = regexp.MustCompile(`(?i)\b(Porto|Lisbon|London|Berlin|Munich|Hamburg|Frankfurt|Cologne|D(?:ü|u)sseldorf|Stuttgart|Z(?:ü|u)rich|Geneva|Lausanne|Basel|Dublin|Cork|Amsterdam|Rotterdam|Eindhoven|Utrecht|Paris|Lyon|Madrid|Barcelona|Valencia|Stockholm|Gothenburg|Malm(?:ö|o)|Copenhagen|Oslo|Helsinki|Milan|Rome|Turin|Vienna|Brussels|Ghent|Antwerp|Luxembourg|Warsaw|Krak(?:ó|o)w|Wroc(?:ł|l)aw|Tallinn|Riga|Vilnius|Prague|Brno|Budapest|Bucharest|Sofia|Athens|Bengaluru|Bangalore|Singapore|Sydney|Toronto|Vancouver|Tel Aviv|S(?:ã|a)o Paulo)\b`)
	// Individual amounts inside an already-matched span: "140", "210K", "209,983"
	reMoneyPart = regexp.MustCompile(`(\d[\d,]*(?:\.\d+)?)\s*([KkMmBb]?)`)
	// Estimate markers: "(est)", "(est;", "market est)" or "market" as its own
	// word — but not "(EST/CST" timezones, "interest)" or "marketing".
	reEstHint = regexp.MustCompile(`\(est[),;. ]|\best\)|\bmarket\b`)
	// Funding/valuation context immediately after a money match: "$600M
	// valuation", "$124M total raised", "$70M Series C" describe the company,
	// not pay, and must not be picked up as the Pay column's figure.
	reFundingContext = regexp.MustCompile(`(?i)^\s*(valuation|(total\s+)?raised|series\s|round\b)`)
)

// currencyTokens is the single source of truth for currencies the dashboard
// recognizes in Notes. Suffix tokens emit without trailing space — the
// leading \s+ prevents the trailing-space-eat bug ("150-200K PLN ").
var currencyTokens = []string{
	"$", "€", "£", "¥", "₹", "₺", "₩", "zł", "₴",
	"CHF", "EUR", "USD", "GBP", "PLN", "UAH",
	"JPY", "CNY", "INR", "BRL", "SEK", "NOK", "DKK", "TRY", "KRW",
	"AUD", "CAD", "MXN", "SGD", "HKD", "ZAR",
}

// buildMoneySpanRegex assembles the regex from an explicit currency list,
// emitting each token in three positions (prefix, optional range-prefix,
// suffix). Adding a new currency is a one-line append to currencyTokens;
// An empty list produces a regex that matches nothing.
func buildMoneySpanRegex(currencies []string) *regexp.Regexp {
	if len(currencies) == 0 {
		return regexp.MustCompile(`\b\B`)
	}
	prefixParts, rangePrefixParts, suffixParts := make([]string, 0, len(currencies)), make([]string, 0, len(currencies)), make([]string, 0, len(currencies))
	for _, tok := range currencies {
		// QuoteMeta: "$" is end-of-string anchor, "." is wildcard, etc.
		q := regexp.QuoteMeta(tok)
		if isBareSymbol(tok) {
			prefixParts = append(prefixParts, q)
			rangePrefixParts = append(rangePrefixParts, q)
			suffixParts = append(suffixParts, q)
		} else {
			prefixParts = append(prefixParts, q+" ?")
			rangePrefixParts = append(rangePrefixParts, q+" ?")
			suffixParts = append(suffixParts, q)
		}
	}
	pattern := fmt.Sprintf(
		`~?(?:(?:%s)\s*\d[\d,]*(?:\.\d+)?[KkMmBb]?`+
			`(?:\s*[-–]\s*(?:%s)?\d[\d,]*(?:\.\d+)?[KkMmBb]?)?`+
			`|\d[\d,]*(?:\.\d+)?[KkMmBb]?`+
			`(?:\s*[-–]\s*\d[\d,]*(?:\.\d+)?[KkMmBb]?)?`+
			`\s+(?:%s))`,
		strings.Join(prefixParts, "|"),
		strings.Join(rangePrefixParts, "|"),
		strings.Join(suffixParts, "|"),
	)
	return regexp.MustCompile(pattern)
}

// isBareSymbol reports whether a currency token is a symbol ("$", "€", "£",
// "zł", "₴") rather than an ISO code ("PLN", "UAH", "CHF"). Rule: no
// uppercase ASCII letter ⇒ bare.
func isBareSymbol(tok string) bool {
	for _, r := range tok {
		if r >= 'A' && r <= 'Z' {
			return false
		}
	}
	return true
}

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
		case "b":
			v *= 1_000_000_000
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
	// (some tracker rows carry the city there, e.g. "... — Charlotte, NC"). When
	// no US "City, ST" is present, fall back to an international city/country so
	// European and other non-US roles still show a Location.
	if m := reCityState.FindStringSubmatch(app.Notes); m != nil {
		app.Location = m[1] + ", " + m[2]
	} else if m := reCityState.FindStringSubmatch(app.Role); m != nil {
		app.Location = m[1] + ", " + m[2]
	} else if m := reCityIntl.FindString(app.Notes); m != "" {
		app.Location = m
	} else if m := reCityIntl.FindString(app.Role); m != "" {
		app.Location = m
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
	// (e.g. "$170K min floor") only when no range exists. Skip money spans
	// that are actually funding/valuation figures ("$600M valuation", "$70M
	// Series C") — they describe the company, not compensation.
	var matches []string
	for _, idx := range reMoneySpan.FindAllStringIndex(app.Notes, -1) {
		if reFundingContext.MatchString(app.Notes[idx[1]:]) {
			continue
		}
		matches = append(matches, app.Notes[idx[0]:idx[1]])
	}
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
