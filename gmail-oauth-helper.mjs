#!/usr/bin/env node
/**
 * gmail-oauth-helper.mjs — one-time setup helper, safe to delete after use.
 *
 * Gets a GMAIL_REFRESH_TOKEN for a "Desktop app" OAuth client using Google's
 * loopback IP flow (the OOB copy/paste flow is deprecated for clients created
 * after Feb 2022, and Desktop clients don't expose an editable redirect-URI
 * list, so the classic OAuth-Playground trick doesn't work for them).
 *
 * Reads GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET from .env (already there).
 * Prints the refresh_token at the end — paste it into .env yourself as
 * GMAIL_REFRESH_TOKEN. This script never writes .env itself.
 *
 * Usage: node gmail-oauth-helper.mjs
 */

import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const ROOT = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(ROOT, '.env'), quiet: true });

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET in .env — add those first.');
  process.exit(1);
}

// Set once in the listen() callback below and reused everywhere — server.address()
// returns null after server.close(), so the handler below must not call it again.
let redirectUri;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/') return res.end();

  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');
  if (err) {
    res.end(`Authorization failed: ${err}. You can close this tab.`);
    console.error(`\nGoogle returned an error: ${err}`);
    server.close();
    process.exit(1);
  }
  if (!code) return res.end('Waiting for authorization…');

  res.end('Authorized — you can close this tab and return to the terminal.');
  server.close();

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const tokens = await tokenRes.json();

  if (!tokenRes.ok || !tokens.refresh_token) {
    console.error('\nToken exchange failed:', tokens);
    console.error(
      tokens.error === 'invalid_grant'
        ? '\nTip: the auth code is single-use and short-lived — rerun this script and complete the browser step quickly.'
        : '',
    );
    process.exit(1);
  }

  console.log('\n✅ Got a refresh token. Paste this into .env yourself:\n');
  console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  process.exit(0);
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  redirectUri = `http://127.0.0.1:${port}`;
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent'); // force a refresh_token even if you've consented before

  console.log('\nOpen this URL, sign in with the Gmail account you want read access to, and consent:\n');
  console.log(authUrl.toString());
  console.log(`\n(waiting on http://127.0.0.1:${port} for the redirect…)`);
});
