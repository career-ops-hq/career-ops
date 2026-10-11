"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

type Internship = {
  id: string;
  company: string;
  role: string;
  status: string;
  dateAdded: string;
  dateApplied?: string;
  deadline?: string;
  opened?: string;
  lastVerified?: string;
  track?: string;
};

type CalendarEvent = {
  internshipId: string;
  company: string;
  role: string;
  date: string;
  type: "deadline" | "applied" | "added" | "opened";
  status: string;
  track?: string;
};

const EVENT_STYLES: Record<CalendarEvent["type"], { bg: string; dot: string; label: string }> = {
  deadline: { bg: "bg-red-500/15 text-red-700 dark:text-red-400", dot: "bg-red-400", label: "Deadline" },
  applied: { bg: "bg-sky-500/15 text-sky-700 dark:text-sky-400", dot: "bg-sky-400", label: "Applied" },
  added: { bg: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400", dot: "bg-zinc-400", label: "Added" },
  opened: { bg: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-400", label: "Opened" },
};

const TRACK_COLORS: Record<string, string> = {
  DS: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  DA: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  BIE: "bg-teal-500/15 text-teal-700 dark:text-teal-400",
  SWE: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function buildEvents(internships: Internship[]): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const i of internships) {
    const base = { internshipId: i.id, company: i.company, role: i.role, status: i.status, track: i.track };
    if (i.deadline) events.push({ ...base, date: i.deadline, type: "deadline" });
    if (i.dateApplied) events.push({ ...base, date: i.dateApplied, type: "applied" });
    if (i.opened) events.push({ ...base, date: i.opened, type: "opened" });
    if (i.dateAdded && !i.dateApplied && !i.opened) {
      events.push({ ...base, date: i.dateAdded, type: "added" });
    }
  }
  return events;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

export function CalendarView({
  internships,
  onTailor,
}: {
  internships: Internship[];
  onTailor: (id: string) => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const events = buildEvents(internships);
  // Use local date to avoid UTC/local mismatch at day boundaries
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);

  // Group events by date string
  const eventsByDate = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    const key = ev.date;
    if (!eventsByDate.has(key)) eventsByDate.set(key, []);
    eventsByDate.get(key)!.push(ev);
  }

  const prevMonth = () => {
    if (month === 0) { setYear(year - 1); setMonth(11); }
    else setMonth(month - 1);
  };

  const nextMonth = () => {
    if (month === 11) { setYear(year + 1); setMonth(0); }
    else setMonth(month + 1);
  };

  const goToday = () => {
    setYear(now.getFullYear());
    setMonth(now.getMonth());
  };

  // Build calendar grid cells
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  // Pad to fill last row
  while (cells.length % 7 !== 0) cells.push(null);

  // Upcoming events (next 14 days)
  const fourteenDaysOut = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const upcoming = events
    .filter((e) => e.date >= todayStr && e.date <= fourteenDaysOut)
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-6">
      {/* Calendar header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={prevMonth} aria-label="Previous month" className="rounded-lg p-1.5 text-muted hover:bg-surface-hover transition-colors">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h2 className="text-lg font-semibold w-48 text-center">
            {MONTHS[month]} {year}
          </h2>
          <button onClick={nextMonth} aria-label="Next month" className="rounded-lg p-1.5 text-muted hover:bg-surface-hover transition-colors">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        <button
          onClick={goToday}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-hover transition-colors"
        >
          Today
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {(["deadline", "applied", "opened", "added"] as const).map((type) => (
          <div key={type} className="flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", EVENT_STYLES[type].dot)} />
            <span className="text-muted">{EVENT_STYLES[type].label}</span>
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="rounded-xl border border-border overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-border bg-surface/50">
          {DAYS.map((d) => (
            <div key={d} className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider text-muted">
              {d}
            </div>
          ))}
        </div>

        {/* Date cells */}
        <div className="grid grid-cols-7">
          {cells.map((day, idx) => {
            if (day === null) {
              return <div key={`empty-${idx}`} className="min-h-[100px] border-b border-r border-border bg-surface/20" />;
            }

            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const dayEvents = eventsByDate.get(dateStr) ?? [];
            const isToday = dateStr === todayStr;
            const isPast = dateStr < todayStr;

            return (
              <div
                key={dateStr}
                className={cn(
                  "min-h-[100px] border-b border-r border-border p-1.5 transition-colors",
                  isToday && "bg-brand/5",
                  isPast && !isToday && "bg-surface/30",
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full text-xs",
                      isToday && "bg-brand text-white font-bold",
                      !isToday && isPast && "text-muted",
                      !isToday && !isPast && "text-foreground",
                    )}
                  >
                    {day}
                  </span>
                  {dayEvents.length > 0 && (
                    <span className="text-[10px] text-muted">{dayEvents.length}</span>
                  )}
                </div>
                <div className="space-y-0.5">
                  {dayEvents.map((ev, i) => {
                    const style = EVENT_STYLES[ev.type];
                    return (
                      <button
                        key={`${ev.internshipId}-${ev.type}-${i}`}
                        onClick={() => onTailor(ev.internshipId)}
                        className={cn(
                          "flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] leading-tight transition-opacity hover:opacity-80",
                          style.bg,
                        )}
                        aria-label={`${ev.company} — ${ev.role} (${style.label})`}
                      >
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", style.dot)} />
                        <span className="truncate">{ev.company}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Upcoming events sidebar */}
      {upcoming.length > 0 && (
        <div className="rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold mb-3">Next 14 Days</h3>
          <div className="space-y-2">
            {upcoming.map((ev, idx) => {
              const style = EVENT_STYLES[ev.type];
              const evDate = new Date(ev.date + "T12:00:00");
              const daysAway = Math.ceil((evDate.getTime() - now.getTime()) / 86400000);
              return (
                <div
                  key={`${ev.internshipId}-${ev.type}-${idx}`}
                  className="flex items-center justify-between rounded-lg border border-border px-4 py-2.5"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", style.dot)} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{ev.company}</span>
                        {ev.track && (
                          <span className={cn("rounded px-1 py-0.5 text-[9px] font-bold", TRACK_COLORS[ev.track] ?? "bg-zinc-500/15 text-zinc-500")}>
                            {ev.track}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted">{ev.role}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <Badge tone={ev.type === "deadline" ? "bad" : "info"} className="text-[10px]">
                        {style.label}
                      </Badge>
                      <p className="text-[10px] text-muted mt-0.5">
                        {daysAway === 0 ? "Today" : `${daysAway}d`} · {ev.date}
                      </p>
                    </div>
                    <button
                      onClick={() => onTailor(ev.internshipId)}
                      className="rounded p-1 text-muted hover:text-brand hover:bg-brand/10 transition-colors"
                    >
                      <Target className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
