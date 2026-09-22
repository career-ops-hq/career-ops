package data

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func funnelRank(status string) int {
	switch NormalizeStatus(status) {
	case "applied":
		return 1
	case "responded", "rejected":
		return 2
	case "interview":
		return 3
	case "offer", "hired":
		return 4
	}
	return 0
}

// ReadFunnelHistory reads only the ledger beside the active tracker, including
// tracker overrides and the legacy root layout. Missing history is harmless.
func ReadFunnelHistory(root string) map[int]int {
	content, err := os.ReadFile(filepath.Join(filepath.Dir(resolveTrackerPath(root)), "status-log.tsv"))
	if err != nil {
		return nil
	}
	return parseFunnelHistory(string(content))
}

func parseFunnelHistory(content string) map[int]int {
	reached := make(map[int]int)
	for _, line := range strings.Split(content, "\n") {
		c := strings.Split(strings.TrimSuffix(line, "\r"), "\t")
		if len(c) < 4 {
			continue
		}
		for i := 0; i < 4; i++ {
			c[i] = strings.TrimSpace(c[i])
		}
		if c[0] == "" || strings.IndexFunc(c[0], func(r rune) bool { return r < '0' || r > '9' }) >= 0 || c[1] == "" || c[2] == "" || c[3] == "" {
			continue
		}
		num, err := strconv.Atoi(c[0])
		if err != nil {
			continue
		}
		for _, status := range c[2:4] {
			if rank := funnelRank(status); rank > reached[num] {
				reached[num] = rank
			}
		}
	}
	return reached
}
