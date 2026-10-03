/**
 * Consume full-fill NDJSON. Only a terminal record confirms completion; EOF is
 * an interruption. Return to the editor on failure so answers remain retryable.
 *
 * @param {Response} response
 * @param {(step: import("./issue").DriveStep) => void} onStep
 * @param {() => boolean} isCurrent
 * @returns {Promise<{status: "done", filled: boolean} | {status: "ready", error: string} | null>}
 */
export async function readFillResult(response, onStep, isCurrent) {
  const failed = (error) => ({ status: /** @type {const} */ ("ready"), error });
  if (!isCurrent()) return null;
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
      const { value, done } = await reader.read();
      if (!isCurrent()) return null;
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
    // Stop consuming once a terminal result arrives or the session is replaced.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
