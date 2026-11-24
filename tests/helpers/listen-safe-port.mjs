// tests/helpers/listen-safe-port.mjs — listen on an OS-assigned port that fetch() accepts.
//
// fetch() (undici) refuses every port on the WHATWG "bad port" list with
// "fetch failed" (cause: "bad port"), so a loopback test server that the OS put
// on one of them fails its own requests. The default ephemeral ranges never
// reach that list, but a host whose ip_local_port_range starts lower can.
// https://fetch.spec.whatwg.org/#port-blocking
import { createServer } from 'node:net';

const BAD_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6679, 6697, 10080,
]);

const MAX_ATTEMPTS = 100;

export const isFetchBadPort = (port) => BAD_PORTS.has(port);

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
}

/** Listen on an OS-assigned port that fetch() allows; resolves with the port. */
export async function listenOnSafePort(server, host = '127.0.0.1') {
  // Linux hands the same free port back after a close, so each refused port is
  // held by a placeholder until a usable one comes up.
  const held = [];
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await listen(server, 0, host);
      const { port } = server.address();
      if (!BAD_PORTS.has(port)) return port;
      await new Promise((resolve) => server.close(resolve));
      const placeholder = createServer();
      try {
        await listen(placeholder, port, host);
      } catch (err) {
        // Another process took the port after the close; try the next one.
        if (err.code !== 'EADDRINUSE') throw err;
        continue;
      }
      held.push(placeholder);
    }
    throw new Error(`no fetch-safe port after ${MAX_ATTEMPTS} attempts`);
  } finally {
    await Promise.all(held.map((s) => new Promise((resolve) => s.close(resolve))));
  }
}
