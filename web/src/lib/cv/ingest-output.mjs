import { StringDecoder } from "node:string_decoder";

/** Keep CLI diagnostics (which can echo the entire prompt) out of the CV
 * protocol. Only stdout carries proposed CV content.
 * @param {{cliId: string, onText: (text: string) => void}} options
 */
export function cvOutputReader({ cliId, onText }) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let emitted = false;
  const emit = text => {
    if (!text) return;
    emitted = true;
    onText(text);
  };
  const line = raw => {
    try {
      const event = JSON.parse(raw);
      if (event?.type === "stream_event" && event.event?.type === "content_block_delta" && typeof event.event.delta?.text === "string") emit(event.event.delta.text);
    } catch { /* incomplete or diagnostic JSON is not proposed CV content */ }
  };
  const consume = text => {
    if (cliId !== "claude") { emit(text); return; }
    pending += text;
    let newline;
    while ((newline = pending.indexOf("\n")) !== -1) {
      line(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
    }
  };
  return {
    stdout(chunk) { consume(decoder.write(chunk)); },
    // Drain stderr, but never forward it: even an innocent echoed instruction
    // such as <<cv:error>>{"reason":"unreadable"} is executable protocol here.
    stderr(_chunk) {},
    finish(code) {
      consume(decoder.end());
      if (pending.trim()) line(pending);
      pending = "";
      if (code !== 0) return "cli-failed";
      return emitted ? null : "no-output";
    },
  };
}
