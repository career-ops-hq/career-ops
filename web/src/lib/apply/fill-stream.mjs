/**
 * Consume full-fill NDJSON. Only a terminal record confirms completion; EOF is
 * an interruption. Return to the editor on failure so answers remain retryable.
 *
 * @param {Response} response
 * @param {(step: import("./issue").DriveStep) => void} onStep
 * @param {() => boolean} isCurrent
 * @param {AbortSignal} [signal] Aborts the pending read when the session generation is dropped.
 *   A generation check alone cannot unblock `reader.read()` if no further chunk arrives.
 * @returns {Promise<{status: "done", filled: boolean} | {status: "ready", error: string} | null>}
 */
export async function readFillResult(response, onStep, isCurrent, signal) {
  const failed = (error) => ({ status: /** @type {const} */ ("ready"), error });
  if (signal?.aborted || !isCurrent()) return null;
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (!isCurrent()) return null;
    return failed(typeof body?.error === "string" && body.error.trim()
      ? body.error
      : `The agent couldn't start filling (HTTP ${response.status}).`);
  }
  if (!response.body) return failed("The agent couldn't start filling. No response stream was received.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const cancelRead = () => {
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", cancelRead, { once: true });
  const consume = (line) => {
    if (!line) return null;
    const unreadable = () => failed("The agent sent an unreadable fill result. Check the real form before trying again.");
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return unreadable();
    }
    if (event?.t === "done") {
      return typeof event.filled === "boolean"
        ? { status: /** @type {const} */ ("done"), filled: event.filled }
        : unreadable();
    }
    if (event?.t === "error") {
      return failed(typeof event.message === "string" && event.message.trim()
        ? event.message
        : "The agent couldn't fill the form. Check the real form before trying again.");
    }
    if (event?.t === "step") onStep(event);
    return null;
  };

  try {
    for (;;) {
      let value;
      let done;
      try {
        ({ value, done } = await reader.read());
      } catch (err) {
        if (signal?.aborted || !isCurrent()) return null;
        throw err;
      }
      if (signal?.aborted || !isCurrent()) return null;
      buffer += decoder.decode(value, { stream: !done });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const result = consume(buffer.slice(0, newline).trim());
        buffer = buffer.slice(newline + 1);
        if (result) return result;
      }
      if (done) {
        const result = consume(buffer.trim());
        return result ?? failed("The agent stopped before confirming the fill finished. Check the real form before trying again.");
      }
    }
  } finally {
    signal?.removeEventListener("abort", cancelRead);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * Map a terminal fill onto the screen the user should see.
 * `drive/route.ts` emits `t:"done"` for a finished drive and puts the outcome
 * in `filled`. `filled: false` means the agent stopped short, so the editor
 * stays up and the drafted answers stay put.
 *
 * @param {{status: "done", filled: boolean} | {status: "ready", error: string}} result
 * @returns {{status: "done", issue: string} | {status: "ready", error: string}}
 */
export function screenForFill(result) {
  if (result.status === "done" && result.filled) {
    return {
      status: /** @type {const} */ ("done"),
      issue: "AI filled the form for you — review every answer on the real form, then submit it yourself.",
    };
  }
  if (result.status === "done") {
    return {
      status: /** @type {const} */ ("ready"),
      error: "AI did its best but couldn't finish. Check the real form before trying again.",
    };
  }
  return { status: /** @type {const} */ ("ready"), error: result.error };
}
