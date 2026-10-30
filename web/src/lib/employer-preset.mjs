// Client-safe, fixed opt-in catalog. Never inferred from language or profile.
export const CHINA_PRESET = "china-employers";
export const CHINA_SOURCES = ["tencent", "bytedance", "meituan"];
export const EMPLOYER_LABEL = {
  tencent: "Tencent / 腾讯",
  bytedance: "ByteDance / 字节跳动",
  meituan: "Meituan / 美团",
};
export const EMPLOYER_ENTRIES = {
  tencent: {
    name: "Tencent",
    careers_url: "https://careers.tencent.com/search.html",
  },
  bytedance: {
    name: "ByteDance",
    careers_url: "https://jobs.bytedance.com",
    provider: "feishu-jobs",
  },
  meituan: {
    name: "Meituan",
    careers_url: "https://zhaopin.meituan.com/web/social",
  },
};

/** Reject invalid/empty selections instead of silently substituting sources. */
export function employerRequest(raw) {
  if (raw?.preset !== CHINA_PRESET) throw new Error("Unknown employer preset.");
  if (
    !Array.isArray(raw.employers) ||
    !raw.employers.length ||
    raw.employers.some((id) => !CHINA_SOURCES.includes(id))
  ) {
    throw new Error("Select at least one of Tencent, ByteDance and Meituan.");
  }
  const terms = (value) =>
    Array.isArray(value)
      ? [
          ...new Set(
            value
              .filter((v) => typeof v === "string")
              .map((v) => v.trim())
              .filter(Boolean),
          ),
        ]
      : [];
  // Deliberately exclude recency, negative/profile/YAML filters and scan depth.
  return {
    preset: CHINA_PRESET,
    employers: [...new Set(raw.employers)],
    positive: terms(raw.positive),
    allow: terms(raw.allow),
  };
}

/** One source can be incomplete even when it returned zero matches. */
export function employerOutcome(sources, count) {
  const complete = sources.filter((s) => s.state === "complete");
  const incomplete = sources.filter((s) => s.state !== "complete");
  const names = sources.map((s) => EMPLOYER_LABEL[s.id] ?? s.id).join(", ");
  const problems = incomplete
    .map((s) => `${EMPLOYER_LABEL[s.id] ?? s.id}: ${s.reason || s.state}`)
    .join("; ");
  if (!complete.length && sources.every((s) => s.state === "failed"))
    return { state: "failed", message: `Failed — ${problems}.` };
  if (incomplete.length)
    return {
      state: "partial",
      message: `Partial / incomplete — ${count} matches. ${problems}.`,
    };
  return {
    state: "complete",
    message: count
      ? `Completed — ${count} matches from ${names}.`
      : `No matches for this scan — ${names}.`,
  };
}
