# Career-ops Web UI Launcher Documentation

Career-ops includes a local-first web interface located in the `web/` directory. The `npm run ui` launcher script (`scripts/ui-server.mjs`) provides a zero-setup daemon to start the local Next.js server, verify environment readiness, canonically resolve the career-ops data root, and open the dashboard in your default browser.

---

## Getting Started

The web UI has its own dependencies. Install them once:

```bash
npm --prefix web ci
```

Then launch the local web server and open the browser dashboard:

```bash
npm run ui
```

The server starts locally on `http://127.0.0.1:3000` by default and automatically opens your browser once the server is ready.

---

## Command-Line Options

You can pass command-line options directly to `npm run ui`:

| Flag | Default | Description |
|---|:---:|---|
| `--port=<number>` or `--port <number>` | `3000` | Custom port to listen on. |
| `--host=<ip>` or `--host <ip>` | `127.0.0.1` | Network interface host (default: `127.0.0.1`; network exposure requires `CAREER_OPS_WEB_ALLOWED_HOSTS`). |
| `--no-open` or `--noopen` | `false` | Start the server without opening the browser automatically. |

### Examples

```bash
# Run on a custom port
npm run ui -- --port=3030

# Start without automatically launching a browser
npm run ui -- --no-open
```

---

## Process Lifecycle & Architecture

- **Canonical Data Root Resolution**: The launcher resolves the user data directory using `path-resolver.mjs` (`CAREER_OPS_ROOT` / `CAREER_OPS_DATA_DIR` / `.career-ops-data`), ensuring the web application reads and writes user-layer files according to the Data Contract.
- **Readiness Polling**: Polls the server until it responds before launching the browser, draining responses properly via `res.resume()`.
- **Graceful Shutdown**: Handles `SIGINT` (Ctrl+C) and `SIGTERM` signals cleanly across Linux, macOS, and Windows (terminating the launched child process and waiting for shutdown before exiting).

