import type { Page, Frame } from "playwright-core";

export type ApplyField = {
  id: string; // our stable handle, also set as data-co-field on the live element
  type: "text" | "email" | "tel" | "url" | "number" | "date" | "textarea" | "select" | "checkbox" | "radio" | "file" | "password";
  label: string;
  required: boolean;
  options?: string[];
  maxLength?: number;
  value?: string;
  combobox?: boolean; // react-select-style widget → fill via click+type+Enter, not selectOption
  nativeId?: string; // the live element's id/name — used to match ATS API schemas (Greenhouse)
  nativeName?: string;
};

export type ExtractedForm = { title: string; url: string; fields: ApplyField[] };

// Extract the application form's STRUCTURE (not pixels) and TAG each control with
// a stable `data-co-field` id on the LIVE page (which the session keeps open), so
// the later fill phase can locate each field deterministically. Generic DOM/a11y
// introspection — clean ATS (Ashby/Lever/Greenhouse) work well; Workday best-effort.
export async function extractForm(ctx: Page | Frame): Promise<ExtractedForm> {
  const data = await ctx.evaluate(() => {
    const normalize = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();
    // The shown label stays short. A trailing star is read on the full text,
    // before this cut, so a star past 160 characters is not lost and a star
    // that merely lands on the cut is not treated as the required mark.
    const clean = (s: string | null | undefined) => normalize(s).slice(0, 160);
    const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
    // generic placeholders that masquerade as labels (Ashby/react-select)
    const isGenericPh = (s: string) => /^(start typing|select\b|choose|search\b|type\b|--|please select|e\.?g\.?)/i.test(s.trim());
    // a usable label: not empty, not a UUID, not a generic placeholder
    const ok = (s: string | null | undefined) => {
      const t = (s || "").trim();
      return t && !isUuid(t) && !isGenericPh(t) ? t : "";
    };
    // Pure label text: a wrapping <label>Gender<select>…</select></label> would
    // otherwise swallow all option text (Lever). Strip controls/options first.
    const pure = (node: Element | null): string => {
      if (!node) return "";
      const c = node.cloneNode(true) as Element;
      c.querySelectorAll?.("input, select, textarea, option, button, [role=option], [class*='menu' i]").forEach((n) => n.remove());
      return normalize(c.textContent);
    };
    // A heading that also wraps the radios keeps its own text. Drop each option
    // label, including a sibling label[for], so a star after the question stays
    // at the end.
    const textWithoutRadios = (node: Element): string => {
      const copy = node.cloneNode(true) as Element;
      copy.querySelectorAll("input[type=radio]").forEach((radio) => {
        const id = (radio as HTMLInputElement).id;
        const wrapped = radio.closest("label");
        if (wrapped && wrapped !== copy && copy.contains(wrapped)) wrapped.remove();
        else radio.remove();
        if (!id) return;
        copy.querySelectorAll("label").forEach((label) => {
          if (label !== copy && label.getAttribute("for") === id) label.remove();
        });
      });
      return normalize(copy.textContent);
    };

    // The field WRAPPER (Ashby `ashby-application-form-field-entry`, Greenhouse
    // `select__container`/`field`, generic `form-group`/`fieldset`) — deliberately
    // NOT a bare `div` (that matches the immediate parent and misses the real label
    // which lives one wrapper up).
    function fieldGroup(el: Element): Element | null {
      return el.closest(
        '[class*="field-entry" i], [class*="fieldEntry" i], [class*="form-group" i], [class*="question" i], [class*="field__" i], [class*="__field" i], fieldset, [class*="field" i]',
      );
    }

    // Same skips as the extract loop. A hidden honeypot or an autofill helper
    // is not a second question, so it must not knock out the wrapper title.
    function isEligibleControl(node: Element): boolean {
      const tag = node.tagName.toLowerCase();
      const type = ((node as HTMLInputElement).type || "").toLowerCase();
      if (tag === "input" && ["hidden", "submit", "button", "image", "reset"].includes(type)) return false;
      if ((node as HTMLElement).offsetParent === null && type !== "radio" && type !== "checkbox") return false;
      if (node.closest('[class*="autofill" i]')) return false;
      return true;
    }

    // A shared box whose class contains "field" is not one question. Another
    // control in that box means its first label belongs to someone else.
    function hasOtherControl(container: Element, el: Element): boolean {
      const ownName = (el as HTMLInputElement).name;
      for (const node of Array.from(container.querySelectorAll("input, textarea, select"))) {
        if (node === el || !isEligibleControl(node)) continue;
        const type = ((node as HTMLInputElement).type || "").toLowerCase();
        if (type === "radio" && ownName && (node as HTMLInputElement).name === ownName) continue;
        const dummy = node.closest('[class*="select__"], .select-shell') && node.getAttribute("role") !== "combobox";
        if (dummy && el.getAttribute("role") === "combobox") continue;
        return true;
      }
      return false;
    }

    // A display:none honeypot has no box. display:contents also has no box,
    // but its text stays on screen, so walk up until an ancestor has one.
    function isVisibleNode(node: Element): boolean {
      let current: HTMLElement | null = node as HTMLElement;
      while (current && current !== document.body) {
        if (current.offsetParent !== null) return true;
        if (getComputedStyle(current).display !== "contents") return false;
        current = current.parentElement;
      }
      return current === document.body;
    }

    function labelFor(el: Element): string {
      const aria = el.getAttribute("aria-label");
      if (ok(aria)) return aria!;
      const labelledby = el.getAttribute("aria-labelledby");
      if (labelledby) {
        const t = labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ");
        if (ok(t)) return t;
      }
      const id = (el as HTMLElement).id;
      if (id) {
        const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (l && ok(pure(l))) return pure(l);
      }
      const parentLabel = el.closest("label");
      if (parentLabel && ok(pure(parentLabel))) return pure(parentLabel);
      // the question title inside the field wrapper (handles Ashby's
      // `ashby-application-form-question-title`, Greenhouse `select__label`, etc.)
      const grp = fieldGroup(el);
      if (grp && !hasOtherControl(grp, el)) {
        const lab = Array.from(grp.querySelectorAll(
          'label, legend, [class*="question-title" i], [class*="heading" i], [class*="label" i], [class*="title" i]',
        )).find((node) => isVisibleNode(node));
        if (lab && ok(pure(lab))) return pure(lab);
      }
      let c: Element | null = el.parentElement;
      for (let i = 0; i < 4 && c; i++, c = c.parentElement) {
        if (hasOtherControl(c, el)) break;
        const lab = Array.from(c.querySelectorAll('label, legend, [class*="label" i], [class*="title" i], h3, h4, h5'))
          .find((node) => isVisibleNode(node));
        if (lab && ok(pure(lab))) return pure(lab);
      }
      const ph = (el as HTMLInputElement).placeholder;
      if (ok(ph)) return ph;
      const name = (el as HTMLInputElement).name;
      return ok(name); // never a UUID/placeholder; "" → caller shows "Untitled"
    }

    // The QUESTION of a radio group — NOT the first option's label. Look for a
    // radiogroup/fieldset aria-label/legend, else the first label/heading in the
    // group's container that isn't one of the options.
    function groupLabel(firstRadio: Element, options: string[]): string {
      const rg = firstRadio.closest("[role=radiogroup], fieldset");
      if (rg) {
        const al = rg.getAttribute("aria-label");
        if (al) return al;
        const lb = rg.getAttribute("aria-labelledby");
        if (lb) {
          const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ");
          if (t.trim()) return t;
        }
        const legend = rg.querySelector("legend");
        if (legend?.textContent?.trim()) return legend.textContent;
      }
      const optSet = new Set(options.map((o) => o.toLowerCase()));
      const container = fieldGroup(firstRadio) || firstRadio.parentElement?.parentElement || firstRadio.parentElement;
      if (container && !hasOtherControl(container, firstRadio)) {
        const cands = container.querySelectorAll(
          'label, legend, h1, h2, h3, h4, h5, h6, [class*="question-title" i], [class*="heading" i], [class*="label" i], [class*="title" i], [class*="question" i]',
        );
        for (const c of Array.from(cands)) {
          if (!isVisibleNode(c)) continue;
          const t = c.querySelectorAll("input[type=radio]").length > 1 ? textWithoutRadios(c) : pure(c);
          // Keep a long title. clean() shortens what is shown, and the trailing
          // star is read from this full text. Options are matched on their full
          // text too. The 160-character cut would hide a real question that only
          // shares that prefix with an option, and it would let a long option
          // through as the question.
          if (t && t.length > 2 && !optSet.has(t.toLowerCase()) && !isUuid(t) && !isGenericPh(t)) return t;
        }
      }
      return "";
    }

    const fields: Array<Record<string, unknown>> = [];
    const seenRadio = new Set<string>();
    const els = Array.from(document.querySelectorAll("input, textarea, select"));
    let n = 0;

    for (const el of els) {
      const tag = el.tagName.toLowerCase();
      const itype = ((el as HTMLInputElement).type || "").toLowerCase();
      if (!isEligibleControl(el)) continue;

      // react-select widgets render an extra internal/autosize <input> next to the
      // real role=combobox input. Keep ONLY the combobox; drop the dummy (it's the
      // "Untitled field" noise). The combobox carries the question's aria label.
      const inReactSelect = (el as Element).closest('[class*="select__"], .select-shell');
      const isCombobox = el.getAttribute("role") === "combobox";
      if (inReactSelect && tag === "input" && !isCombobox) continue;

      const domRequired = (el as HTMLInputElement).required || el.getAttribute("aria-required") === "true";
      // A trailing star is the board's required mark. A star inside the sentence is not.
      // The argument is the full label, before clean() cuts it to 160 characters.
      const requiredFor = (label: string) => domRequired || /\*\s*$/.test(normalize(label));
      const nativeId = (el as HTMLElement).id || undefined;
      const nativeName = (el as HTMLInputElement).name || undefined;
      const fid = `co${n++}`;

      if (isCombobox) {
        el.setAttribute("data-co-field", fid);
        const labelRaw = labelFor(el);
        const label = clean(labelRaw);
        fields.push({ id: fid, type: "select", combobox: true, label, required: requiredFor(labelRaw), options: [], nativeId, nativeName });
        continue;
      }

      if (itype === "radio") {
        const name = (el as HTMLInputElement).name;
        if (name && seenRadio.has(name)) {
          n--;
          continue;
        }
        if (name) seenRadio.add(name);
        const group = Array.from(document.querySelectorAll(`input[type=radio][name="${CSS.escape(name)}"]`));
        const fullLabels = group.map((r) => normalize(labelFor(r)));
        // The same text on every radio is the question or the input name, not a
        // choice. Use each input's value so Yes and No stay distinct.
        const shared = fullLabels.length > 1 && fullLabels.every((text) => text && text === fullLabels[0]);
        const options = group.map((r, i) => {
          const value = clean((r as HTMLInputElement).value);
          const full = fullLabels[i];
          const text = clean(full);
          const rawName = (r as HTMLInputElement).name || "";
          if (!full || full === rawName || (shared && value)) return value || text;
          return text || value;
        }).filter(Boolean);
        // Match the question against the full choice text. clean() is only what
        // we show. When every radio repeats one label, match the values instead,
        // so that repeated label can still be the question.
        const matchTexts = shared
          ? options
          : fullLabels.map((full, i) => full || normalize((group[i] as HTMLInputElement).value)).filter(Boolean);
        group.forEach((r, i) => {
          r.setAttribute("data-co-field", fid);
          r.setAttribute("data-co-option", options[i] ?? String(i));
        });
        const radioRaw = groupLabel(el, matchTexts);
        const radioLabel = clean(radioRaw) || name;
        fields.push({ id: fid, type: "radio", label: radioLabel, required: requiredFor(clean(radioRaw) ? radioRaw : (name || "")), options });
        continue;
      }

      el.setAttribute("data-co-field", fid);

      if (tag === "select") {
        const options = Array.from((el as HTMLSelectElement).options).map((o) => clean(o.textContent)).filter((o) => o && !/^(select|choose|--)/i.test(o));
        const selectRaw = labelFor(el);
        const selectLabel = clean(selectRaw);
        fields.push({ id: fid, type: "select", label: selectLabel, required: requiredFor(selectRaw), options, nativeId, nativeName });
        continue;
      }
      const type = tag === "textarea" ? "textarea" : ["email", "tel", "url", "number", "date", "checkbox", "file", "password"].includes(itype) ? itype : "text";
      const ml = (el as HTMLInputElement).maxLength;
      const labelRaw = labelFor(el);
      const label = clean(labelRaw);
      fields.push({
        id: fid,
        type,
        label,
        required: requiredFor(labelRaw),
        maxLength: ml && ml > 0 ? ml : undefined,
        value: (el as HTMLInputElement).value || undefined,
        nativeId,
        nativeName,
      });
    }
    return { title: document.title, fields };
  });

  return { title: data.title, url: ctx.url(), fields: data.fields as ApplyField[] };
}
