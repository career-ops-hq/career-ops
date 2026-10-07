import { describe, test, expect } from "bun:test";
import { runCLI } from "./helpers";

const LOCATION = "Copenhagen, Denmark";

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

describe("LinkedIn CLI flag validation", () => {
  describe("numeric flag validation", () => {
    test("non-numeric string exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--jobage", "foo"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/jobage/);
    });

    test("boolean flag (no value) exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--jobage"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toBeTruthy();
    });

    test("valid integer passes validation", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--jobage", "7", "--limit", "1"]);
      const err = parsedStderr(result.stderr);
      expect(err.code).not.toBe("BAD_ARG");
    });

    // Fractional values must be rejected, not truncated: parseInt("0.5") is 0,
    // and jobage 0 makes buildTimeFilter return null, so f_TPR is silently
    // omitted from the outbound request while the CLI exits 0 (#371).
    for (const name of ["jobage", "jobage-minutes", "page", "limit"]) {
      test(`--${name} fractional exits 1 with BAD_ARG instead of truncating`, async () => {
        const result = await runCLI(["search", "-l", LOCATION, `--${name}`, "1.5"]);
        expect(result.exitCode).not.toBe(0);
        const err = parsedStderr(result.stderr);
        expect(err.code).toBe("BAD_ARG");
        expect(err.error).toMatch(new RegExp(name));
      });
    }

    test("--jobage 0.5 exits 1 with BAD_ARG instead of dropping the freshness filter", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--jobage", "0.5"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
    });

    for (const name of ["jobage", "jobage-minutes", "page", "limit"]) {
      test(`--${name} 0 exits 1 with BAD_ARG`, async () => {
        const result = await runCLI(["search", "-l", LOCATION, `--${name}`, "0"]);
        expect(result.exitCode).not.toBe(0);
        const err = parsedStderr(result.stderr);
        expect(err.code).toBe("BAD_ARG");
        expect(err.error).toMatch(new RegExp(name));
      });
    }
  });

  describe("--jobage-minutes validation", () => {
    test("non-numeric string exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--jobage-minutes", "foo"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/jobage-minutes/);
    });

    test("negative value is parsed as a missing value and exits 1 with BAD_ARG", async () => {
      // parseFlags in cli.ts treats a next-token starting with "-" as absent
      // (`next.startsWith("-")` → flag becomes boolean `true`), and there is no
      // `--flag=value` syntax. So "-5" never reaches --jobage-minutes as a value;
      // it parses as a stray flag named "5", which the unknown-flag guard now
      // rejects before the NaN branch can. Either way the invariant holds: a
      // negative value fails loudly with exit 1 and a JSON error, never a
      // silent unfiltered search.
      const result = await runCLI(["search", "-l", LOCATION, "--jobage-minutes", "-5"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("UNKNOWN_FLAG");
    });
  });

  describe("--jobage / --jobage-minutes conflict", () => {
    test("both set exits 1 with CONFLICTING_AGE_FLAGS", async () => {
      const result = await runCLI([
        "search", "-l", LOCATION, "--jobage", "7", "--jobage-minutes", "30",
      ]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("CONFLICTING_AGE_FLAGS");
    });
  });

  describe("--page NaN validation", () => {
    test("non-numeric string exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--page", "abc"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/page/);
    });
  });

  describe("--limit NaN validation", () => {
    test("non-numeric string exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-l", LOCATION, "--limit", "xyz"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/limit/);
    });
  });

  describe("existing validations (regression)", () => {
    test("missing --location exits 1 with NO_LOCATION", async () => {
      const result = await runCLI(["search"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("NO_LOCATION");
    });

    test("all valid flags produce no BAD_ARG", async () => {
      const result = await runCLI([
        "search", "-l", LOCATION, "--jobage", "7", "--page", "1", "--limit", "5",
      ]);
      const err = parsedStderr(result.stderr);
      expect(err.code).not.toBe("BAD_ARG");
    });
  });
});


describe("unknown flag rejection", () => {
  // add-portal.md's contract: "a bogus flag or missing required arg exits 1
  // with a JSON error on stderr". A silently discarded flag is worse than an
  // error: on jobdanmark a wrong flag name returned the entire database
  // (13,862 results) as if it matched the query (review finding F13,
  // 2026-08-19). Rejection happens before dispatch, so these are network-free.
  test("a bogus --flag exits 1 with a JSON error instead of being silently discarded", async () => {
    const result = await runCLI(["search", "-l", "Denmark", "-q", "test", "--bogus-flag", "xyz"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const error = JSON.parse(result.stderr);
    expect(error.code).toBe("UNKNOWN_FLAG");
    expect(error.error).toContain("--bogus-flag");
  });
});
