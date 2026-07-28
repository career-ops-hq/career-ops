// Client-safe (no playwright import). A structured, user-facing problem the
// interpreter hit, so the apply UI NEVER fails mute.
//   block = can't proceed (captcha / login wall / expired posting)
//   warn  = proceeded, but the user should look (unread field, validation error)
//   info  = FYI (we auto-dismissed a cookie banner)
export type ApplyIssue = { level: "block" | "warn" | "info"; code: string; message: string; field?: string };

// One step of the agentic drive loop (the AI reaching/filling the form live).
export type DriveStep = { turn: number; action: string; detail: string; thumb?: string; note?: string };
