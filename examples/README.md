# Examples

Reference files that demonstrate career-ops data formats and conventions. None of these are used at runtime -- they exist so you can see the expected structure before creating your own files.

## Files

| File | Demonstrates |
|------|-------------|
| `cv-example.md` | How to structure `cv.md` -- sections, metrics formatting, and proof-point style for a fictional AI engineer (Alex Chen) |
| `article-digest-example.md` | How to write `article-digest.md` -- compact proof points with hero metrics, architecture summaries, and key decisions per project |
| `sample-report.md` | The A-F evaluation report format produced by the evaluation pipeline, with all six blocks (Role Summary through Interview Plan) |
| `ats-normalization-test.md` | Regression fixture for `generate-pdf.mjs` Unicode normalization -- lists every problematic codepoint and its ASCII-safe replacement |
| `dual-track-engineer-instructor/` | Complete profile config for a candidate with two primary archetypes (engineer + instructor), including `cv.md`, `profile.yml`, and a README explaining when and how to use the dual-track pattern |

## Usage

These files are read-only references. To set up your own career-ops instance:

1. Run `npm run doctor` to check prerequisites.
2. Use `cv-example.md` as a structural guide when writing your `cv.md`.
3. Use `article-digest-example.md` as a template for your `article-digest.md` (optional but improves evaluation quality).
4. See the `dual-track-engineer-instructor/` folder if your career spans two distinct archetypes.
