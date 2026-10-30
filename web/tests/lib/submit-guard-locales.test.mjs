// Every locale the repo ships modes for must have its submit wording refused
// on a scripted button (type="button", submitted by a JS handler), the shape
// the type rule cannot reach.
//
// Run:  node --test tests/lib/submit-guard-locales.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { isSubmitControl } from "../../src/lib/apply/submit-guard.mjs";

const scripted = (text, inForm = true) => ({ tag: "button", type: "button", inForm, text });

const REFUSED_IN_FORM = {
  de: ["Senden", "Jetzt senden"],
  es: ["Postular", "Postularme"],
  pt: ["Candidatar", "Candidatar-me"],
  pl: ["Prześlij", "Prześlij aplikację"],
  ua: ["Надіслати", "Подати заявку", "Відгукнутися"],
  ar: ["إرسال", "تقديم الطلب"],
  id: ["Kirim", "Kirim lamaran", "Lamar"],
  hi: ["जमा करें", "सबमिट करें", "आवेदन करें"],
  da: ["Indsend", "Ansøg"],
};

const REFUSED_ANYWHERE = {
  de: ["Bewerbung senden", "Senden"],
  pl: ["Prześlij"],
  ua: ["Надіслати"],
  ar: ["إرسال"],
  id: ["Kirim"],
  hi: ["जमा करें", "सबमिट करें"],
  da: ["Indsend", "Send ansøgning"],
};

const ALLOWED = ["Weiter", "Siguiente", "Próximo", "Dalej", "Далі", "التالي", "Lanjut", "अगला", "Næste", "Sendung verfolgen", "Lamaran saya"];

for (const [locale, labels] of Object.entries(REFUSED_IN_FORM)) {
  for (const label of labels) {
    test(`${locale}: in-form "${label}" is refused`, () => {
      assert.equal(isSubmitControl(scripted(label)), true);
    });
  }
}

for (const [locale, labels] of Object.entries(REFUSED_ANYWHERE)) {
  for (const label of labels) {
    test(`${locale}: "${label}" outside a form is refused`, () => {
      assert.equal(isSubmitControl(scripted(label, false)), true);
    });
  }
}

for (const label of ALLOWED) {
  test(`navigation label "${label}" stays clickable`, () => {
    assert.equal(isSubmitControl(scripted(label)), false);
  });
}
