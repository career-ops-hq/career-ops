#!/usr/bin/env node
// sheets-oauth-setup.mjs — Gets a Google Sheets refresh token via localhost:8765
//
// PREREQUISITES (manual steps in Google Cloud Console, project 316715982702):
//   1. Enable Google Sheets API: https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=316715982702
//   2. http://localhost:8765 is already an Authorized redirect URI (used by gmail-oauth-setup.mjs)
//   3. Add the Sheets + Drive.file scopes to the OAuth consent screen:
//      https://console.cloud.google.com/auth/audience?project=316715982702
//
// USAGE:
//   node sheets-oauth-setup.mjs
//
// Reads GOOGLE_SHEETS_CLIENT_ID + GOOGLE_SHEETS_CLIENT_SECRET from .env or
// environment, falling back to the GMAIL_* pair (same OAuth client).
// Saves GOOGLE_SHEETS_REFRESH_TOKEN to .env on success.

import { createServer } from 'http';
import { readFileSync, existsSync, appendFileSync } from 'fs';

const REDIRECT_PORT = 8765;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

// Load .env
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const clientId = process.env.GOOGLE_SHEETS_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GOOGLE_SHEETS_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('✘ Missing GOOGLE_SHEETS_CLIENT_ID/SECRET (or GMAIL_* fallback) in .env');
  process.exit(1);
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPES.join(' '));
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

console.log('\n1. Open this URL in your browser and approve access:\n');
console.log(authUrl.toString());
console.log('\n2. Waiting for the redirect on http://localhost:8765 ...\n');

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Missing code parameter.');
    return;
  }
  try {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    });
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(JSON.stringify(data));
    appendFileSync('.env', `\nGOOGLE_SHEETS_REFRESH_TOKEN=${data.refresh_token}\n`);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>Google Sheets connection authorized. You can close this tab.</h2>');
    console.log('✔ Refresh token saved to .env as GOOGLE_SHEETS_REFRESH_TOKEN');
    console.log('  Scopes granted:', data.scope || SCOPES.join(' '));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Token exchange failed: ${err.message}`);
    console.error('✘ Token exchange failed:', err.message);
  } finally {
    server.close();
    process.exit(0);
  }
});

server.listen(REDIRECT_PORT, () => {});