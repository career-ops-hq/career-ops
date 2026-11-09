package screens

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
	"github.com/santifer/career-ops/dashboard/internal/i18n"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func TestWorkModeShowsTheCatalogLabel(t *testing.T) {
	t.Cleanup(func() { i18n.SetLang("en") })
	apps := []model.CareerApplication{
		{Number: 1, Company: "Onsite Co", Role: "Analyst", Status: "Evaluated", WorkMode: "Full", Location: "Austin, TX"},
		{Number: 2, Company: "Flex Co", Role: "Analyst", Status: "Evaluated", WorkMode: "RemoteFlex"},
	}
	cases := []struct {
		lang, onsite, flex, internalToken string
	}{
		{"en", "On-site · Austin, TX", "Remote (flex)", "Full ·"},
		{"es", "Presencial · Austin, TX", "Remoto (Flex)", "Full ·"},
		{"tr", "Ofiste · Austin, TX", "Uzaktan (Esnek)", "Full ·"},
	}
	for _, tc := range cases {
		t.Run(tc.lang, func(t *testing.T) {
			i18n.SetLang(tc.lang)
			pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 160, 40)
			pm.viewMode = "flat"
			onsite := ansi.Strip(pm.renderLocCell(apps[0], 40))
			flex := ansi.Strip(pm.renderLocCell(apps[1], 40))
			if !strings.Contains(onsite, tc.onsite) {
				t.Errorf("on-site cell = %q, want it to contain %q", onsite, tc.onsite)
			}
			if !strings.Contains(flex, tc.flex) {
				t.Errorf("flex cell = %q, want it to contain %q", flex, tc.flex)
			}
			if view := ansi.Strip(pm.View()); strings.Contains(view, tc.internalToken) || strings.Contains(view, "RemoteFlex") {
				t.Errorf("pipeline view shows an internal work-mode token:\n%s", view)
			}
		})
	}
}

func TestStatsWorkModeTableShowsTheCatalogLabel(t *testing.T) {
	t.Cleanup(func() { i18n.SetLang("en") })
	i18n.SetLang("en")
	metrics := model.StatsMetrics{WorkModes: []model.LabelCountStat{{Label: "Full", Count: 3, Pct: 75}, {Label: "RemoteFlex", Count: 1, Pct: 25}}}
	sm := NewStatsModel(theme.NewTheme("catppuccin-mocha"), metrics, 4, 160, 60)
	view := ansi.Strip(sm.View())
	if !strings.Contains(view, "On-site") || !strings.Contains(view, "Remote (flex)") {
		t.Errorf("stats view lacks the localized work-mode labels:\n%s", view)
	}
	if strings.Contains(view, "Full ") || strings.Contains(view, "RemoteFlex") {
		t.Errorf("stats view shows an internal work-mode token:\n%s", view)
	}
}
