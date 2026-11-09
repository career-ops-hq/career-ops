// Only this action awaits a canonical tracker write. A failed transport is not
// evidence that the write did not land; only known pre-write failures may retry.
export class StatusWriteError extends Error {
  constructor(message, { unconfirmed = false, retryable = false } = {}) {
    super(message);
    this.unconfirmed = unconfirmed;
    this.retryable = retryable;
  }
}

export async function writeAssistantStatus(n, status, fetchFn = fetch) {
  let response;
  try {
    response = await fetchFn("/api/status", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ n, status }), signal: AbortSignal.timeout(35_000),
    });
  } catch {
    throw new StatusWriteError("The status change could not be confirmed. Check the current tracker status before trying again.", { unconfirmed: true });
  }
  const data = await response.json().catch(() => null);
  if (response.ok && data?.ok === true && data.status === status) return;
  const reason = typeof data?.error === "string" ? data.error : `HTTP ${response.status}`;
  if (response.status === 503 && data?.code === "lock-timeout") {
    throw new StatusWriteError(`Status was not saved: ${reason}. You can retry when the tracker is available.`, { retryable: true });
  }
  if ([400, 404, 409].includes(response.status) || (response.status === 503 && data?.code === "core-script-missing")) {
    throw new StatusWriteError(`Status was not saved: ${reason}. Check the tracker before making a corrected request.`);
  }
  throw new StatusWriteError(`The status change could not be confirmed (${reason}). Check the current tracker status before trying again.`, { unconfirmed: true });
}
