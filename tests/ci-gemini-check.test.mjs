#!/usr/bin/env node

/**
 * tests/ci-gemini-check.test.mjs
 * Verification for the extraction flow against gemini-3.6-flash.
 */

import { config } from 'dotenv';
config(); 

import { GoogleGenerativeAI } from '@google/generative-ai'; 
import * as yaml from 'js-yaml';

const apiKey = process.env.GEMINI_API_KEY;
const modelName = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

if (!apiKey) {
  console.log('⚠️ Skipping Gemini CI check: GEMINI_API_KEY not found.');
  process.exit(0);
}

async function verifyAI() {
  console.log(`🤖 Verifying ${modelName} extraction flow...`);
  
  const genAI = new GoogleGenerativeAI(apiKey); 
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: `Extract job data into YAML keys: company, title, location.
    CRITICAL: You must return valid YAML. Every key must have a colon and a value. 
    Example: 
    company: Acme
    title: Engineer
    location: Remote`,
    generationConfig: { maxOutputTokens: 200 },
  });

  const sampleText = "Hiring at Stripe for an Infrastructure Engineer in Dublin.";
  const prompt = `--- BEGIN UNTRUSTED DATA ---\n${sampleText}\n--- END UNTRUSTED DATA ---`;

  try {
    const result = await model.generateContent(prompt);
    const response = result.response.text();
    const clean = response.replace(/```yaml|```/g, '').trim();
    
    let parsed;
    try {
      parsed = yaml.load(clean);
    } catch (parseErr) {
      console.error("❌ YAML Parse Error. Raw Response was:\n", response);
      process.exitCode = 1;
      return;
    }

    if (parsed && parsed.company && parsed.title) {
      console.log("✅ CI Verification Passed:", parsed);
      process.exitCode = 0;
    } else {
      console.error("❌ CI Verification Failed: Incomplete data. Received:", parsed);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("❌ CI Verification Error:", err.message);
    process.exitCode = 1;
  }
}

// Windows-safe execution: avoid process.exit inside async
verifyAI().then(() => {
  console.log("🏁 Verification process finished.");
});