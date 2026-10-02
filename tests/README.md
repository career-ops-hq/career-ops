# Offline checks

Run the retained business and adapter contracts with:

```sh
workflow/.venv/bin/python -B scripts/check.py
node scripts/check-syntax.mjs
```

The runner executes assert-based Python business checks and independent Node
adapter checks. Pass a quoted repository glob to run a smaller slice, for example
`'tests/workflow*-test.py'` or `'tests/providers/*.test.mjs'`.
Tests use isolated databases, source packets and process stubs; passing them does
not establish live source coverage or model quality.
