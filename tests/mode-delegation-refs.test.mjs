// tests/mode-delegation-refs.test.mjs — mode files reference skill file for subagent delegation

import { readFileSync } from 'fs';
import { join } from 'path';
import { fail, pass, ROOT } from './helpers.mjs';

console.log('\nMode files reference skill file for subagent delegation');

const read = (path) => readFileSync(join(ROOT, path), 'utf-8').replace(/\r\n/g, '\n');
const check = (label, cond) => (cond ? pass(label) : fail(label));

// 1. Skill file has canonical delegation guide
const skill = read('.agents/skills/career-ops/SKILL.md');
const delegated = skill.split('### Modes delegated to subagent')[1] ?? '';

check('skill has CLI delegation table', /\| CLI \| Subagent Support \| How to Delegate/.test(delegated));
check('skill documents OpenCode task→general', /OpenCode.*task.*general/.test(delegated));
check('skill documents VS Code Copilot Chat runSubagent', /VS Code Copilot Chat.*runSubagent/.test(delegated));
check('skill documents GitHub Copilot CLI task', /GitHub Copilot CLI.*task.*general/.test(delegated));
check('skill documents Pi trust requirement', /Pi.*trust/.test(delegated));
check('skill documents other CLIs direct execution', /All other CLIs.*Run mode directly/.test(delegated));
check('skill has OpenCode task tool JSON example', /"tool": "task"/.test(delegated));
check('skill has OpenCode subagent_type argument', /"subagent_type": "general"/.test(delegated));
check('skill has VS Code Copilot Chat runSubagent JSON example', /"tool": "runSubagent"/.test(delegated));
check('skill has GitHub Copilot CLI task JSON example', /"toolName": "task"/.test(delegated));
check('skill has OpenCode permission note', /permission\.task.*general.*allow/.test(delegated));
check('skill has OpenCode subagent_type in example', /"subagent_type": "general"/.test(delegated));
check('skill has VS Code Copilot Chat task agent_type', /"agent_type": "general-purpose"/.test(delegated));
check('skill has GitHub Copilot CLI agent_type', /"agent_type": "general-purpose"/.test(delegated));

// 2. Mode files reference skill file, no inline Agent() blocks
const modeFiles = [
  'modes/scan.md',
  'modes/tr/scan.md',
  'modes/pipeline.md',
  'modes/pdf/hm-audit.md'
];

for (const file of modeFiles) {
  const content = read(file);
  check(`${file} references SKILL.md`, content.includes('.agents/skills/career-ops/SKILL.md'));
  check(`${file} has no inline Agent() block`, !/Agent\([\s\S]*subagent_type/.test(content));
  check(`${file} references Modes delegated to subagent`, /Modes delegated to subagent/.test(content));
}

// 3. modes/_shared.md references skill file in cost guardrail
const shared = read('modes/_shared.md');
const guardrail = shared.split('### Subagent delegation (cost guardrail)')[1]?.split('\n### ')[0] ?? '';
check('modes/_shared.md guardrail references SKILL.md', guardrail.includes('.agents/skills/career-ops/SKILL.md'));
check('modes/_shared.md guardrail mentions OpenCode task tool', /OpenCode.*task.*general/.test(guardrail));
check('modes/_shared.md guardrail mentions VS Code Copilot Chat', /VS Code Copilot Chat.*runSubagent/.test(guardrail));
check('modes/_shared.md guardrail mentions GitHub Copilot CLI', /GitHub Copilot CLI.*task.*general-purpose/.test(guardrail));
check('modes/_shared.md guardrail mentions other CLIs direct', /others: direct execution/.test(guardrail));