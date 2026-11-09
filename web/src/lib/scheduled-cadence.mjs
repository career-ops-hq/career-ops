function intervalMs(every, unit) {
  const amount = Number(every);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (unit === "days") return amount * 86_400_000;
  if (unit === "hours") return amount * 3_600_000;
  if (unit === "minutes") return amount * 60_000;
  return null;
}

function localParts(epochMs, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(epochMs));
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute, second: values.second };
}

function localToEpochMs(parts, timezone) {
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let guess = wall;
  for (let i = 0; i < 3; i += 1) {
    const observed = localParts(guess, timezone);
    const observedWall = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
    guess += wall - observedWall;
  }
  return guess;
}

function nextDailyRun(startAt, every, timezone, nowMs) {
  try {
    const start = localParts(Date.parse(startAt), timezone);
    const current = localParts(nowMs, timezone);
    const anchor = Date.UTC(start.year, start.month - 1, start.day, start.hour, start.minute, start.second);
    const localNow = Date.UTC(current.year, current.month - 1, current.day, current.hour, current.minute, current.second);
    const period = Number(every) * 86_400_000;
    let steps = Math.max(0, Math.floor((localNow - anchor) / period));
    for (;;) {
      const target = new Date(anchor + steps * period);
      const candidate = localToEpochMs({
        ...start,
        year: target.getUTCFullYear(),
        month: target.getUTCMonth() + 1,
        day: target.getUTCDate(),
      }, timezone);
      if (candidate > nowMs) return new Date(candidate).toISOString();
      steps += 1;
    }
  } catch {
    return null;
  }
}

export function nextScheduledRun(startAt, every, unit, nowMs = Date.now(), timezone = "UTC") {
  const first = Date.parse(startAt);
  const interval = intervalMs(every, unit);
  if (!Number.isFinite(first) || !interval) return null;
  if (unit === "days") return nextDailyRun(startAt, every, timezone, nowMs);
  if (first > nowMs) return new Date(first).toISOString();
  const steps = Math.floor((nowMs - first) / interval) + 1;
  return new Date(first + steps * interval).toISOString();
}
