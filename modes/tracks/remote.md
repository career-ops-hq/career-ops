# Track: remote

Read `tracks.remote` from `config/profile.yml`: `preference` (`remote_only`,
`remote_first`, `hybrid_ok`, `any`), `timezone`, `hybrid_cities`,
`max_onsite_days_per_month`, and the home country from `tracks.europe.base_country`
or `location.country`.

"Remote" on a posting says how the work is done, not who may do it. The
question for this track is whether **this candidate, where they live**, can
hold the role.

## What to establish

1. **Arrangement**: remote, hybrid, on-site or not stated. The location field
   and the title come first; a binding attendance rule in the body overrides a
   "Remote" tag (that is Block A's geo-mismatch, and it stays as it is).
2. **Scope**: which countries or regions the remote role is open to.
   - Covers a Europe-based candidate: `worldwide`, `anywhere`, `global`,
     "EMEA", "Europe", "EU", "EEA", a regional group that includes the home
     country (DACH, Nordics, Benelux), or the home country itself.
   - Does not: "US only", "Remote (United States)", "North America", "LATAM",
     "APAC", a single other country, "must be authorized to work in the US",
     "US-based candidates", a US state list. A UK-only remote role is not open
     to someone living in the EU.
   - A bare "Remote" with no region is **not stated**. Do not read a US
     company's bare "Remote" as worldwide, and do not read it as US-only.
3. **Time zone**: required working hours or overlap. From Central European
   Time a normal working day shares about 3 hours with US Eastern and none
   with US Pacific. "Work Pacific hours" or "US business hours" is a
   mismatch. "4 hours of overlap with ET" is workable with a late shift: a
   caution, with the hours spelled out. Hours stated in CET, GMT or "European
   time zones" are a match.
4. **Hybrid or on-site**: where, and how many days. Compare with
   `hybrid_cities` and `max_onsite_days_per_month`.

Thresholds, unless `modes/_profile.md` sets its own: a required overlap that fits
inside 09:00-18:00 at home is a match; one that needs work until about 20:00 is
a caution; one that needs regular work after 20:00 or before 07:00, or the
other region's full business hours, is a mismatch.

## Verdicts

| Verdict | Meaning | In the report |
|---------|---------|---------------|
| match | Remote and the scope covers the candidate, or hybrid in a listed city under `hybrid_ok` | Block A "Remote fit: match", with the scope quoted |
| partial | Workable with a compromise: hybrid under `remote_first`, thin overlap | Caution, with the compromise stated in days or hours |
| mismatch | A stated restriction rules the candidate out | Blocker flag line; Global Score capped at 2.0 |
| unknown | The posting does not say | A question for the recruiter in the Risk Summary |

Preference decides how hybrid and on-site read: `remote_only` treats both as
a mismatch; `remote_first` accepts hybrid as partial when the city is listed
(or no cities are listed) and treats on-site as a mismatch; `hybrid_ok`
accepts hybrid and treats on-site as a mismatch unless the city is listed.

## Questions to hand the user

When the scope is not stated: "Is this role open to candidates based in
{country}, and through which entity would I be engaged (local entity, employer
of record, or contractor)?" When hours are not stated for a team in another
region: "Which hours of overlap do you expect with {their zone}?"

## In the scanner

`tracks_filter.remote_fit: drop` in `portals.yml` drops postings with a stated
mismatch before they reach the pipeline, using the same reader. Postings that
do not say stay in. See `docs/TRACKS.md`.
