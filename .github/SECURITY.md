# Security Policy

## Reporting a Vulnerability

**Do NOT open a public issue for security vulnerabilities.**

Instead, please email **hi@santifer.io** with:

1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

You will receive a response within 72 hours. We will work with you to understand and address the issue before any public disclosure.

## Scope

Security issues in the following are in scope:

- **Scripts** (`*.mjs`) — command injection, path traversal, SSRF
- **Dashboard** (`dashboard/`) — any Go binary vulnerabilities
- **Web dashboard** (`web/`) — anything reachable while it is running, including cross-origin requests from a page the user visits, requests from other hosts on the same network, and command injection through its API
- **Templates** (`templates/`) — XSS in generated HTML/PDF
- **Configuration** — secrets exposure, unsafe defaults

## Out of Scope

- Issues in third-party dependencies (report upstream)
- Issues requiring physical access to the user's machine
- Social engineering attacks
- Attacks on hosted infrastructure — career-ops runs locally, so there is no server of ours to attack

**"Local" does not mean "unreachable".** The web dashboard is a local HTTP server, and a local server is still reachable by a cross-origin page the user happens to visit and by any device on the same network. If an issue needs nothing more than the user running career-ops and browsing normally, it is in scope — please report it rather than assuming the local-tool line excludes it.

## Disclosure Policy

We follow coordinated disclosure. Once a fix is released, we will credit the reporter (unless they prefer anonymity) in the release notes.
