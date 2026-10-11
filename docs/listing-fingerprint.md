# Local listing fingerprint v1

This is the **local schema** approved in [#1030](https://github.com/career-ops-hq/career-ops/issues/1030#issuecomment-4944351269).
It identifies one public ATS posting from an explicitly resolved
`ats_provider + board_slug + posting_id` triple. A local cache can use the key
across branded/ATS URLs and URL rotations, provided the caller has established
that both URLs refer to the same ATS-native triple.

V1 supplies a pure function and a local validator. `scan.mjs` uses the strong
key as an additional dedup token for Greenhouse, Ashby and Lever postings,
persisting it in the trailing `listing_key` scan-history column. A provider must
return the complete ATS-native triple; incomplete identities produce no key and
fall back to existing scan dedup. This integration does not fetch URLs or add
tracker, sharing, transport, endpoint, service or opt-in behavior.

## Schema

```json
{
  "schema_version": 1,
  "identity": "strong",
  "strong": {
    "ats_provider": "greenhouse",
    "board_slug": "example",
    "posting_id": "12345"
  },
  "canonical_host": "boards.greenhouse.io",
  "canonical_path": "/example/jobs/12345",
  "listing_key": "listing_v1_a8b20889013d5069bc5173d8f948309aef3a2bf1946e7190f628ea053271ecc6"
}
```

| Field | V1 contract |
| --- | --- |
| `schema_version` | Integer `1`. Unknown versions are invalid, never reinterpreted as v1. |
| `identity` | `strong` or `partial`. |
| `strong` | Present only for strong identity. Exactly the three string fields above, all nonempty. |
| `canonical_host` | URL `host`: lowercase hostname and any non-default port. IPv6 retains brackets. `null` when no URL is supplied. |
| `canonical_path` | URL `pathname`, with trailing slashes removed (root stays `/`). Case and encoded path components are preserved according to WHATWG URL parsing. `null` when no URL is supplied. |
| `listing_key` | Version-prefixed SHA-256 key for strong identity; exactly `null` for partial context. |

No other fields are accepted, including within `strong`. Host and path must
both be normalized strings or both be `null`. Query strings, fragments, URL
credentials and the raw source URL are not stored. Input URLs must be absolute
HTTP(S) URLs without credentials; malformed input is rejected. Scheme, query
and fragment never contribute to identity. Host/path context loses information
(a query may even contain the posting ID), so **equal context is not proof of
the same posting**.

Direct JavaScript callers must pass plain objects with own data properties;
inherited fields, accessors and hidden unknown fields are rejected too.

### Authoritative triple

`ats_provider` is the provider's lowercase slug (`greenhouse`, `ashby`, `lever`,
`workday`, etc.), matching `[a-z][a-z0-9_-]*`. There is no fixed provider enum.
`board_slug` is the ATS-native board/tenant namespace within that provider;
`posting_id` is the posting's stable native ID within that namespace. Callers
must establish the full namespace where a provider uses several tenant/site
levels; a company display name or an unscoped requisition number is not enough.
If the full identity cannot be resolved, supply no triple.

Board and posting IDs are opaque, case-sensitive strings. V1 does not trim,
case-fold, URL-decode, normalize Unicode, remove punctuation, or coerce numbers.
For example, `00123` and `123`, and `REQ-A1` and `req-a1`, remain distinct.
Empty or whitespace-only strings count as missing during computation. A
nonempty identifier with surrounding whitespace or ASCII control characters is
invalid. A non-string identifier is invalid, even in an incomplete triple.
An incomplete triple produces partial context; no incomplete `strong` object
is retained. Persisted strong records require all three complete fields.

The caller obtains these public fields from the provider's authoritative
response or a verified alias resolution. This module deliberately does not
infer identity from a URL. Existing liveness URL routing and heuristic job-ID
extraction do not establish a complete, stable namespace for every provider.
Validation proves record consistency, not that an ATS issued an ID or that a
claimed alias is true.

### Exact key algorithm

Encode the following array using JavaScript `JSON.stringify`, hash its UTF-8
bytes with SHA-256, then prefix the full lowercase hexadecimal digest with
`listing_v1_`:

```js
["listing-fingerprint", 1, ats_provider, board_slug, posting_id]
```

The fixed array avoids object-order and delimiter ambiguity. No URL, company,
title, location, work mode, description or content hash contributes to the key.
Same triple means same key even if every URL component changes. A different
provider, board or posting ID means a different identity; cross-provider or
cross-board aliases require separate evidence and are not merged by v1.

The `schema_version` and key prefix are both versioned. Any future change to
identity inputs, normalization or serialization requires a new version. Keep
old records with their original version; never silently recompute them under
new rules. A future migration needs the authoritative source fields, not just
the old digest.

### Partial context

```json
{
  "schema_version": 1,
  "identity": "partial",
  "canonical_host": "careers.example.com",
  "canonical_path": "/jobs/12345",
  "listing_key": null
}
```

Partial is a valid schema record with **no authoritative identity**. Never
authorize a cache hit, deduplication or merge from it, including when both
records have identical host/path. Never treat `null === null` as a match.

## Local API and validator

```js
import {
  LISTING_FINGERPRINT_VERSION,
  computeListingFingerprint,
  validateListingFingerprint,
  listingKey,
} from './listing-fingerprint.mjs';

const record = computeListingFingerprint({
  url: 'https://boards.greenhouse.io/example/jobs/12345?gh_src=ref#apply',
  strong: { ats_provider: 'greenhouse', board_slug: 'example', posting_id: '12345' },
});
const result = validateListingFingerprint(record); // { valid: true, errors: [] }
const key = listingKey(record); // string for strong, null for partial
// Only use a key after this guard:
if (key !== null) { /* localCache.get(key), or compare to another validated key */ }
```

- `computeListingFingerprint({ url?, strong? })` returns a new v1 record;
  omitted or `null` URL yields null context. It throws `TypeError` for malformed
  input or unsupported fields. It neither mutates input nor calls a provider.
- `validateListingFingerprint(record)` returns `{ valid, errors }`, with a
  diagnostic for invalid shape, unknown fields/version, noncanonical context,
  or a key inconsistent with the triple. It does not coerce or repair records.
- `listingKey(record)` validates first and throws `TypeError` for invalid
  records. It returns `null` for valid partial records.

The CLI accepts a single JSON argument. Computation prints the record;
validation prints `{ valid, errors }`. Invalid input or failed validation exits
nonzero. `--help`/`-h` prints usage. Nothing is read from or written to user files.

```sh
node listing-fingerprint.mjs '{"url":"https://careers.example.com/jobs/12345"}'
node listing-fingerprint.mjs --validate '{"schema_version":1,"identity":"partial","canonical_host":null,"canonical_path":null,"listing_key":null}'
```

## Existing JD similarity

The existing `jd_fingerprint` concept in scan history (the column called
`fingerprint` in scanner code) is a **64-bit SimHash of JD text**, generated by
`fingerprint-core.mjs` / `fingerprintText()`. It supports advisory near-duplicate
detection through `similarity()` / `findCrossListings()`. It is neither a stable
posting identity nor this SHA-256 key. Preserve the existing column and its
semantics; do not replace it with `listing_key` or add another JD SimHash.

Any future weak/similarity tier needs separate sign-off. It would be advisory,
outside the authoritative triple, and should reference that existing
`jd_fingerprint` rather than compute a second body fingerprint. V1 accepts no
weak-tier fields and ships no heuristic fallback.

## Public fields and privacy

Only public posting identifiers and public URL context belong in this record.
Candidate CV/profile, scores, application status, notes, answers, private URLs,
emails and access tokens are not schema fields. The validator rejects extra
fields; callers still must ensure the allowed fields contain public values
(a validator cannot detect a private token disguised as a posting ID).

The public identifiers are suitable inputs for a separately designed sharing
layer, but this schema grants no sharing permission and performs no sharing.
A deterministic digest is not anonymization: public IDs can be guessed and
rehashed. Local consumers should retain only the context they need and never
infer that an arbitrary URL path is safe to publish.
