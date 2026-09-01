/**
 * POST a JSON body and read an NDJSON stream via XMLHttpRequest.
 *
 * Next.js App Router patches `window.fetch` and aborts it on any history /
 * router update (including `history.replaceState`). Discover's scan is a
 * minutes-long POST; a patched fetch dies in ~90ms with AbortError and the
 * UI returns to the form with no message. XHR is not in that patch set.
 *
 * @param {string} url
 * @param {unknown} body
 * @param {(ev: object) => void} onEvent parsed NDJSON line
 * @returns {Promise<{status: number, errorBody: object | null}>}
 */
export function postNdjsonXhr(url, body, onEvent) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Accept", "application/x-ndjson, application/json");
    let seen = 0;
    let carry = "";

    const consume = (finished) => {
      const text = xhr.responseText || "";
      const fresh = text.slice(seen);
      seen = text.length;
      const parts = (carry + fresh).split("\n");
      carry = finished ? "" : (parts.pop() ?? "");
      for (const raw of parts) {
        const line = raw.trim();
        if (!line) continue;
        try {
          onEvent(JSON.parse(line));
        } catch {
          /* incomplete JSON or a non-NDJSON 4xx body — handled on load */
        }
      }
      if (finished && carry.trim()) {
        try {
          onEvent(JSON.parse(carry.trim()));
        } catch {
          /* ignore */
        }
        carry = "";
      }
    };

    xhr.onprogress = () => consume(false);
    xhr.onload = () => {
      consume(true);
      let errorBody = null;
      if (xhr.status >= 400) {
        try {
          errorBody = JSON.parse(xhr.responseText);
        } catch {
          errorBody = { error: xhr.responseText?.slice(0, 200) || `HTTP ${xhr.status}` };
        }
      }
      resolve({ status: xhr.status, errorBody });
    };
    xhr.onerror = () => reject(new Error("Network error during Discover"));
    xhr.onabort = () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      reject(err);
    };
    xhr.send(JSON.stringify(body));
  });
}
