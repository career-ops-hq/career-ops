"use client";

import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import type { ExploreFilters } from "@/lib/explore";
import { Button } from "@/components/ui/button";
import { cadenceMinimum, createScheduledJobRequest } from "@/lib/scheduled-job-client.mjs";

type ScheduleUnit = "minutes" | "hours" | "days";

export function ScheduleJobAction({ filters }: { filters: ExploreFilters }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Scheduled scan");
  const [every, setEvery] = useState(3);
  const [unit, setUnit] = useState<ScheduleUnit>("hours");
  const [state, setState] = useState("");
  const [saving, setSaving] = useState(false);
  const minimum = cadenceMinimum(unit);

  const save = async () => {
    setSaving(true);
    setState("Saving...");
    try {
      await createScheduledJobRequest({
          name,
          every: Math.max(minimum, every),
          unit,
          filters,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          startAt: new Date().toISOString(),
      });
      setState("Scheduled scan created.");
      setOpen(false);
    } catch (error) {
      setState(error instanceof Error ? error.message : "Could not create the scheduled scan.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" onClick={() => setOpen((value) => !value)}>
        <CalendarPlus className="size-4" />
        Schedule
      </Button>
      {open && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-3 text-sm">
          <label className="grid gap-1 text-xs text-muted">
            Name
            <input
              className="rounded-md border border-border bg-background px-2 py-1.5 text-foreground"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Repeat every
            <input
              className="w-16 rounded-md border border-border bg-background px-2 py-1.5 text-foreground"
              type="number"
              min={minimum}
              value={every}
              onChange={(event) => setEvery(Number(event.target.value))}
            />
          </label>
          <select
            aria-label="Schedule unit"
            className="rounded-md border border-border bg-background px-2 py-1.5 text-foreground"
            value={unit}
            onChange={(event) => setUnit(event.target.value as ScheduleUnit)}
          >
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
          <Button
            type="button"
            disabled={saving || !name.trim() || !Number.isFinite(every) || every < minimum}
            onClick={() => void save()}
          >
            {saving ? "Saving..." : "Add scheduled scan"}
          </Button>
          {state && <span className="text-xs text-muted">{state}</span>}
        </div>
      )}
      {!open && state && <span role="status" className="text-xs text-muted">{state}</span>}
    </div>
  );
}
