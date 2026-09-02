#!/usr/bin/env node
// gmail-oauth-setup.mjs — Gets a Gmail refresh token via localhost:8765
//
// PREREQUISITES (manual steps in Google Cloud Console):
//   1. Enable Gmail API: https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=316715982702
//   2. Add http://localhost:8765 to Authorized redirect URIs:
//      https://console.cloud.google.com/apis/credentials/oauthclient/316715982702-vp8rliqm0s13huu93rlsrt32jq832gu9.apps.googleusercontent.com?project=316715982702
//   3. Add Gmail scopes to OAuth consent screen:
//      https://console.cloud.google.com/auth/audience?project=316715982702
//
// USAGE:
//   node gmail-oauth-setup.mjs
//
// Reads GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET from .env or environment.

import { createServer } from 'http';
import { readFileSync, existsSync, appendFileSync } from 'fs';

const REDIRECT_PORT = 8765;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];

// Load .env
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('✘ Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET in .env');
  console.error('  Add them to .env first:');
  console.error('    GMAIL_CLIENT_ID=your-client-id.apps.googleusercontent.com');
  console.error('    GMAIL_CLIENT_SECRET=your-client-secret');
  process.exit(1);
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPES.join(' '));
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

console.log('');
console.log('════════════════════════════════════════════════════════════');
console.log('  Gmail OAuth — Refresh Token Acquisition');
console.log('════════════════════════════════════════════════════════════');
console.log('');
console.log('  Opening your browser for Google consent...');
console.log('');
console.log('  If it doesn’t open automatically, copy-paste this URL:');
console.log('');
console.log('  ' + authUrl.toString());
console.log('');

// Try to open browser
import { execSync } from 'child_process';
try {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  execSync(`${cmd} "${authUrl.toString()}"`, { stdio: 'ignore', timeout: 3000 });
  console.log('  ✓ Browser opened. Complete the consent in your browser.');
} catch {
  console.log('  ⚠ Could not auto-open browser. Please copy the URL above into your browser.');
}
console.log('');

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);

  if (url.pathname === '/' && url.searchParams.get('code')) {
    const code = url.searchParams.get('code');

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <html><body style="font-family:system-ui;padding:2em;text-align:center">
      <h1>✅ Authorization received!</h1>
      <p>You can close this tab and return to your terminal.</p>
      </body></html>
    `);

    console.log('  ✓ Authorization code received. Exchanging for tokens...');
    console.log('');

    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: REDIRECT_URI,
        }),
      });

      const tokens = await tokenRes.json();

      if (tokens.error) {
        console.error(`  ✘ Token exchange failed: ${tokens.error}`);
        if (tokens.error_description) console.error(`    ${tokens.error_description}`);
        if (tokens.error === 'redirect_uri_mismatch') {
          console.error('');
          console.error('  → http://localhost:8765 is NOT in your authorized redirect URIs.');
          console.error('  → Add it here:');
          console.error('    https://console.cloud.google.com/apis/credentials/oauthclient/' + clientId + '?project=316715982702');
        }
        server.close();
        process.exit(1);
      }

      if (!tokens.refresh_token) {
        console.error('  ✘ No refresh_token returned. You may have already consented before.');
        console.error('  → Revoke access at https://myaccount.google.com/permissions and try again.');
        server.close();
        process.exit(1);
      }

      // Auto-append to .env if not already there
      const envContent = existsSync('.env') ? readFileSync('.env', 'utf-8') : '';
      if (!envContent.includes('GMAIL_REFRESH_TOKEN=')) {
        appendFileSync('.env', `GMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`);
        console.log('  ✅ Refresh token automatically appended to .env!');
      } else {
        console.log('  ✅ Refresh token received (already in .env — replace the old value):');
        console.log(`     GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
      }

      console.log('');
      console.log('════════════════════════════════════════════════════════════');
      console.log('  ✅ DONE! Gmail OAuth setup complete.');
      console.log('════════════════════════════════════════════════════════════');
      console.log('');
      console.log('  Next steps:');
      console.log('    1. Test Gmail plugin:  node plugins.mjs run gmail');
      console.log('    2. Run reply-watch:    node reply-watch.mjs');
      console.log('');
      server.close();
      process.exit(0);
    } catch (err) {
      console.error(`  ✘ Error: ${err.message}`);
      server.close();
      process.exit(1);
    }
  } else if (url.pathname === '/' && url.searchParams.get('error')) {
    const error = url.searchParams.get('error');
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<html><body><h1>❌ Authorization failed: ${error}</h1></body></html>`);
    console.error(`  ✘ Authorization denied: ${error}`);
    server.close();
    process.exit(1);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(REDIRECT_PORT, () => {
  console.log(`  Listening on ${REDIRECT_URI} ...`);
  console.log('  Waiting for Google to redirect back after you consent.');
  console.log('');
  console.log('  (If you see "redirect_uri_mismatch" in your browser,');
  console.log('   add http://localhost:8765 to your Google Cloud Console)');
  console.log('');
});
