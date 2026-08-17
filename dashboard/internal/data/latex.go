package data

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

// reLaTeXDate extracts the trailing YYYY-MM-DD stamp from generated CV
// filenames (cv-{candidate}-{slug}-{date}.tex).
var reLaTeXDate = regexp.MustCompile(`(\d{4}-\d{2}-\d{2})\.tex$`)

// ResolveLaTeX returns candidate LaTeX paths (relative to careerOpsPath) for an
// application, best match first.
//
// The logic mirrors ResolvePDFs:
//  1. Filename match: output/cv-*.tex whose name contains the kebab-cased
//     company. This covers every generated LaTeX CV.
//     Multiple matches are all returned (newest first) so the caller can
//     offer a picker instead of guessing — one company can have several
//     role-variant CVs from the same day.
func ResolveLaTeX(careerOpsPath string, app model.CareerApplication) []string {
	slug := kebabCase(app.Company)
	if slug == "" {
		return nil
	}

	globbed, err := filepath.Glob(filepath.Join(careerOpsPath, "output", "cv-*.tex"))
	if err != nil {
		return nil
	}

	var matches []string
	for _, p := range globbed {
		base := strings.ToLower(filepath.Base(p))
		if matchesCompanySlug(base, slug) {
			if rel, err := filepath.Rel(careerOpsPath, p); err == nil {
				matches = append(matches, filepath.ToSlash(rel))
			}
		}
	}

	sortLaTeXNewestFirst(careerOpsPath, matches)
	return matches
}

// sortLaTeXNewestFirst orders candidate paths by the date stamp embedded in
// the filename (descending), falling back to file mtime when the stamp is
// missing or equal. A regenerated CV from today therefore outranks last
// week's, and same-day variants get a stable mtime ordering.
func sortLaTeXNewestFirst(careerOpsPath string, paths []string) {
	dateOf := func(p string) string {
		if m := reLaTeXDate.FindStringSubmatch(p); m != nil {
			return m[1]
		}
		return ""
	}
	mtimeOf := func(p string) int64 {
		info, err := os.Stat(filepath.Join(careerOpsPath, filepath.FromSlash(p)))
		if err != nil {
			return 0
		}
		return info.ModTime().UnixNano()
	}
	sort.SliceStable(paths, func(i, j int) bool {
		di, dj := dateOf(paths[i]), dateOf(paths[j])
		if di != dj {
			return di > dj
		}
		return mtimeOf(paths[i]) > mtimeOf(paths[j])
	})
}
