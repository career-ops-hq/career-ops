/**
 * @typedef {{ type: "text", text: string } | { type: "tool", name: string } | { type: "status", label: string }} JobProgress
 * @typedef {{ status: "done", tokens?: number, costUsd?: number } | { status: "error", message: string }} JobCompletion
 */

/**
 * Read the /api/run NDJSON protocol. A closed connection is not proof that the
 * worker saved its report or rendered its PDF: only the server's `done` event is.
 *
 * @param {ReadableStream<Uint8Array>} stream
 * @param {(event: JobProgress) => void} onProgress
 * @returns {Promise<JobCompletion>}
 */
export async function readJobStream(stream, onProgress) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ended = false;

  /** @param {string} line @returns {JobCompletion | null} */
  const consume = (line) => {
    if (!line.trim()) return null;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return { status: "error", message: "Invalid response from the local server. Check the pipeline before retrying." };
    }
    if (event?.type === "error") {
      return { status: "error", message: typeof event.msg === "string" && event.msg ? event.msg : "Error" };
    }
    if (event?.type === "done") {
      return {
        status: "done",
        ...(typeof event.tokens === "number" ? { tokens: event.tokens } : {}),
        ...(typeof event.costUsd === "number" ? { costUsd: event.costUsd } : {}),
      };
    }
    if (event?.type === "text" && typeof event.text === "string") onProgress(event);
    else if (event?.type === "tool" && typeof event.name === "string") onProgress(event);
    else if (event?.type === "status" && typeof event.label === "string") onProgress(event);
    // Keepalives and future non-terminal events do not confirm completion.
    return null;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      ended = done;
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const completion = consume(line);
        if (completion) return completion;
      }
      if (done) {
        // A final record need not have a trailing newline.
        return consume(buffer) ?? {
          status: "error",
          message: "Connection ended before the server confirmed completion. Check the pipeline before retrying.",
        };
      }
    }
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error && error.name === "AbortError" ? "Interrupted. Check the pipeline before retrying." : "Connection error",
    };
  } finally {
    // A terminal error can arrive while the worker is still streaming. Release
    // the response instead of leaving an unread body and its reader behind.
    if (!ended) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
