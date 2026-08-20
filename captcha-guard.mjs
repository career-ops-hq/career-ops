#!/usr/bin/env node

/**
 * captcha-guard.mjs — CAPTCHA, 2FA & Bot Challenge Human-in-the-Loop Helper
 *
 * Detects Cloudflare Turnstile, reCAPTCHA, or 2FA prompts in Playwright sessions,
 * pauses execution, triggers human alert notifications, and resumes cleanly.
 *
 * Usage:
 *   node captcha-guard.mjs [--test]
 */

import { execSync } from 'child_process';

const CAPTCHA_SIGNATURES = [
  'cf-turnstile',
  'g-recaptcha',
  'h-captcha',
  'bot-challenge',
  'verify you are human',
  'security check',
  'enter verification code'
];

export function detectCaptcha(htmlOrText) {
  if (!htmlOrText) return false;
  const lower = htmlOrText.toLowerCase();
  return CAPTCHA_SIGNATURES.some(sig => lower.includes(sig));
}

export function notifyHuman(message = 'CAPTCHA or 2FA Challenge Detected!') {
  console.log(`\n🚨 [CAPTCHA GUARD ALERT] ${message}`);
  console.log(`👉 Please complete the challenge in your browser window to resume automated submission.\n`);

  try {
    if (process.platform === 'linux') {
      execSync(`notify-send "ApplyPilot Alert" "${message}"`, { stdio: 'ignore' });
    }
  } catch (_) {}
}

if (process.argv[1] && process.argv[1].endsWith('captcha-guard.mjs')) {
  console.log('🧪 Testing CAPTCHA Guard Detection Engine...');
  const sampleChallengeHtml = '<div class="cf-turnstile">Please verify you are human</div>';
  const isDetected = detectCaptcha(sampleChallengeHtml);

  if (isDetected) {
    console.log('✅ CAPTCHA Guard successfully detected Turnstile challenge signature.');
    notifyHuman('Test Alert: Cloudflare Turnstile Detected');
  } else {
    console.error('❌ Detection failed');
    process.exit(1);
  }
}
