#!/usr/bin/env node

/**
 * salary-advisor.mjs — Salary Benchmark & Offer Negotiation Advisor
 *
 * Computes market salary benchmarks and generates counter-offer negotiation scripts.
 *
 * Usage:
 *   node salary-advisor.mjs [--role="Senior Engineer"] [--offered=140000] [--currency=USD]
 */

const BENCHMARKS = {
  "Senior Software Engineer": { p25: 130000, p50: 155000, p75: 180000, p90: 210000 },
  "Senior ML Engineer": { p25: 140000, p50: 165000, p75: 195000, p90: 230000 },
  "Staff Engineer": { p25: 170000, p50: 200000, p75: 240000, p90: 280000 },
  "Software Engineer": { p25: 95000, p50: 115000, p75: 135000, p90: 155000 }
};

export function evaluateSalaryOffer(options = {}) {
  const role = options.role || 'Senior Software Engineer';
  const offered = Number(options.offered) || 140000;
  const currency = options.currency || 'USD';
  const candidateName = options.candidateName || 'Alex Chen';
  const company = options.company || 'Acme Corp';

  const bench = BENCHMARKS[role] || BENCHMARKS["Senior Software Engineer"];

  let verdict = 'Competitive';
  if (offered < bench.p50) verdict = 'Below Market Median';
  if (offered >= bench.p75) verdict = 'Above Market 75th Percentile';

  const targetCounter = Math.round(offered * 1.12);

  const counterScript = `Dear Hiring Manager,

Thank you for extending the offer to join ${company} as a ${role}! I am genuinely thrilled about the team and the technical roadmap ahead.

Given my 6+ years of experience in distributed systems and real-time ML pipelines, as well as current market data for ${role} positions in our tier, I would like to request a base salary of ${currency} $${targetCounter.toLocaleString()}.

I am confident in my ability to bring immediate impact to ${company}, and this adjustment would make accepting this offer an absolute no-brainer for me.

Thank you again for your support and flexibility, and I look forward to finalizing our start date!

Best regards,
${candidateName}`;

  return {
    role,
    offered: `${currency} $${offered.toLocaleString()}`,
    verdict,
    benchmarks: {
      p25: `${currency} $${bench.p25.toLocaleString()}`,
      p50: `${currency} $${bench.p50.toLocaleString()}`,
      p75: `${currency} $${bench.p75.toLocaleString()}`,
      p90: `${currency} $${bench.p90.toLocaleString()}`
    },
    suggestedCounter: `${currency} $${targetCounter.toLocaleString()}`,
    counterScript
  };
}

if (process.argv[1] && process.argv[1].endsWith('salary-advisor.mjs')) {
  const args = process.argv.slice(2);
  const opts = {};
  for (const arg of args) {
    if (arg.startsWith('--role=')) opts.role = arg.split('=')[1];
    if (arg.startsWith('--offered=')) opts.offered = arg.split('=')[1];
    if (arg.startsWith('--company=')) opts.company = arg.split('=')[1];
  }

  const res = evaluateSalaryOffer(opts);
  console.log('\n💰 SALARY BENCHMARK & OFFER NEGOTIATION ADVISOR');
  console.log(`=================================================`);
  console.log(`Role: ${res.role} | Offered: ${res.offered}`);
  console.log(`Verdict: ${res.verdict}\n`);
  console.log(`📊 MARKET BENCHMARKS:`);
  console.log(`  • 25th Percentile: ${res.benchmarks.p25}`);
  console.log(`  • Median (50th):   ${res.benchmarks.p50}`);
  console.log(`  • 75th Percentile: ${res.benchmarks.p75}`);
  console.log(`  • 90th Percentile: ${res.benchmarks.p90}\n`);
  console.log(`💡 SUGGESTED COUNTER-OFFER: ${res.suggestedCounter}`);
  console.log(`\n✉️  COUNTER-OFFER EMAIL TEMPLATE:\n${res.counterScript}`);
}
