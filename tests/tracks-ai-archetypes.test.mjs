// tests/tracks-ai-archetypes.test.mjs — lib/ai-archetypes.mjs names the kind of AI work a posting is, and tells expert from crowd work (job-engine search tracks, docs/TRACKS.md).
//
// Run:  node --test tests/tracks-ai-archetypes.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAiRole, AI_ARCHETYPES } from '../lib/ai-archetypes.mjs';

const primary = (title, description = '') => classifyAiRole({ title, description }).primary;

test('archetype from the title, in English and German', () => {
  assert.equal(primary('Senior LLM Engineer', 'Build RAG pipelines and prompts.'), 'llm_engineer');
  assert.equal(primary('AI Agent Engineer', 'LangGraph, tool calling, multi-agent orchestration'), 'agent_engineer');
  assert.equal(primary('Forward Deployed Engineer', 'Work with customers to deploy LLM applications'), 'applied_ai');
  assert.equal(primary('Machine Learning Engineer', 'PyTorch training'), 'ml_engineer');
  assert.equal(primary('MLOps Engineer', 'Kubernetes, model serving, monitoring'), 'llmops');
  assert.equal(primary('LLM Evaluation Engineer', 'evals, benchmarks'), 'evals');
  assert.equal(primary('AI Automation Engineer', 'n8n, Zapier, Make workflows with OpenAI'), 'ai_automation');
  assert.equal(primary('KI-Berater (m/w/d)', 'Workshops, Use-Case-Analyse, KI-Strategie'), 'ai_consulting');
  assert.equal(primary('AI Product Manager', 'roadmap for AI features'), 'ai_product');
});

test('a generic role at an "AI-powered" company is not an AI role', () => {
  const r = classifyAiRole({ title: 'Backend Engineer', description: 'We are an AI-powered company. Build REST APIs in Go and Postgres.' });
  assert.deepEqual([r.isAiRole, r.primary, r.crowdWork], [false, null, 'no']);
});

test('per-task training work is told apart by the expertise it asks for', () => {
  assert.equal(classifyAiRole({ title: 'AI Trainer - German', description: 'Rate and label model responses. Flexible hours, paid per task.' }).crowdWork, 'crowd');
  assert.equal(classifyAiRole({ title: 'AI Trainer - Software Engineering', description: 'Use your coding expertise to write rubrics and evaluate model code outputs, red teaming.' }).crowdWork, 'expert');
  assert.equal(classifyAiRole({ title: 'Senior Data Annotation Specialist' }).crowdWork, 'expert');
  assert.equal(classifyAiRole({ title: 'Senior LLM Engineer' }).crowdWork, 'no');
});

test('every archetype id is unique and input is never trusted to be well-formed', () => {
  assert.equal(new Set(AI_ARCHETYPES.map(a => a.id)).size, AI_ARCHETYPES.length);
  assert.equal(classifyAiRole(null).isAiRole, false);
  assert.equal(classifyAiRole({ title: 42, description: {} }).isAiRole, false);
});
