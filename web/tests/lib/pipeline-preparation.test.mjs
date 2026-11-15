import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { PIPELINE_TABS, pipelineTab, pipelineQuery } from '../../src/lib/pipeline-navigation.mjs';
import { canonStatus } from '../../src/lib/status-alias.mjs';
import { classifyLeaf } from '../../src/lib/pipeline-sankey.mjs';

test('Preparation is a pre-application state with its own Pipeline tab next to Evaluated', () => {
  const states = yaml.load(readFileSync(new URL('../../../templates/states.yml', import.meta.url), 'utf8')).states;
  const evaluated = states.findIndex(state => state.id === 'evaluated');
  assert.equal(states[evaluated + 1].label, 'Preparation');
  assert.equal(states[evaluated + 2].label, 'Applied');
  assert.equal(PIPELINE_TABS[PIPELINE_TABS.indexOf('EVALUATED') + 1], 'PREPARATION');
  assert.equal(pipelineTab('preparation'), 'PREPARATION');
  assert.equal(pipelineQuery({ tab: 'PREPARATION' }), 'tab=PREPARATION');
  assert.equal(canonStatus('Preparation'), 'PREPARATION');
  assert.equal(classifyLeaf({ n: '11', status: 'Preparation' }, []), 'evaluated');
});
