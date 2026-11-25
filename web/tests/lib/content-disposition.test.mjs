import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentDisposition, cvPdfDisposition, inlineDisposition } from "../../src/lib/content-disposition.mjs";

const NAMES = [
  "cv-jane-doe-007-acme-2026-07-01.pdf",
  "cv-łukasz-acme-2026-07-01.pdf",
  "cv-陈伟-acme-2026-07-01.pdf",
  "acme-инженер-cover.pdf",
  'odd "quoted" name\\x.pdf',
  "it's (draft)*.pdf",
];

for (const name of NAMES) {
  test(`"${name}" yields a header a Response accepts and that decodes back`, () => {
    const value = inlineDisposition(name);
    const res = new Response("x", { headers: { "Content-Disposition": value } });
    const star = res.headers.get("content-disposition").match(/filename\*=UTF-8''(.+)$/)[1];
    assert.equal(decodeURIComponent(star), name);
  });
}

test("an ASCII name keeps its plain filename", () => {
  assert.equal(
    inlineDisposition("cv-a-001-acme.pdf"),
    `inline; filename="cv-a-001-acme.pdf"; filename*=UTF-8''cv-a-001-acme.pdf`,
  );
});

test("a non-ASCII name gets a quoted ASCII fallback", () => {
  assert.match(inlineDisposition("cv-łukasz.pdf"), /^inline; filename="cv-\?ukasz\.pdf"; /);
});

test("attachment names a plain file and a name with a non-ASCII character and a quote", () => {
  const plain = attachmentDisposition("cv-a-001-acme.pdf");
  assert.equal(
    plain,
    `attachment; filename="cv-a-001-acme.pdf"; filename*=UTF-8''cv-a-001-acme.pdf`,
  );
  new Response("x", { headers: { "Content-Disposition": plain } });

  const quoted = 'cv-łukasz "acme".pdf';
  const header = attachmentDisposition(quoted);
  assert.equal(
    header,
    'attachment; filename="cv-?ukasz \\"acme\\".pdf"; filename*=UTF-8\'\'cv-%C5%82ukasz%20%22acme%22.pdf',
  );
  const res = new Response("x", { headers: { "Content-Disposition": header } });
  const star = res.headers.get("content-disposition").match(/filename\*=UTF-8''(.+)$/)[1];
  assert.equal(decodeURIComponent(star), quoted);
});

test("download=1 attaches the on-disk basename and a missing flag stays inline", () => {
  const file = "/opt/output/cv-a-001-acme.pdf";
  assert.equal(
    cvPdfDisposition(file, "1"),
    `attachment; filename="cv-a-001-acme.pdf"; filename*=UTF-8''cv-a-001-acme.pdf`,
  );
  assert.equal(
    cvPdfDisposition(file, null),
    `inline; filename="cv-a-001-acme.pdf"; filename*=UTF-8''cv-a-001-acme.pdf`,
  );
});
