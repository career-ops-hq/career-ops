# Offline checks

```sh
.venv/bin/python -B scripts/check.py
node scripts/check-syntax.mjs
.venv/bin/python -B tests/business/workflow-scan-test.py
```

The runner executes `tests/business/**/*-test.py` and `tests/adapters/**/*.test.mjs`.
Pass quoted repository globs for smaller checks. Python checks cover validation,
transaction idempotency, frozen inputs, and checkpoint recovery. Node checks
cover provider formats, paging, HTTP/DNS restrictions, browser observation, and
managed resume exports. Fixtures use isolated databases and process stubs;
these checks do not establish live provider coverage or model quality.
