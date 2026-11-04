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
check('skill documents VS Code Copilot Chat (Local) runSubagent', /VS Code Copilot Chat.*Local.*runSubagent/.test(delegated));
check('skill documents VS Code Copilot Chat (Copilot) task→general-purpose', /VS Code Copilot Chat.*Copilot.*task.*general\-purpose/.test(delegated));
check('skill documents GitHub Copilot CLI task→general-purpose', /GitHub Copilot CLI.*task.*general\-purpose/.test(delegated));
check('skill documents other CLIs direct execution', /All other CLIs.*Run mode directly/.test(delegated));

const openCodeSection = delegated.split('#### OpenCode — `task` tool → `general` subagent')[1] ?? '';
check('skill has OpenCode task tool JSON example', /"tool": "task"/.test(openCodeSection));
check('skill has OpenCode subagent_type argument', /"subagent_type": "general"/.test(openCodeSection));

check('skill has OpenCode permission note', /permission\.task.*general.*allow/.test(delegated));

check('skill has VS Code Copilot Chat (Local) runSubagent JSON example', /"tool": "runSubagent"/.test(delegated));

const copilotSection = delegated.split('#### VS Code Copilot Chat - Session Type `Copilot` — `task` tool')[1] ?? '';
check('skill has VS Code Copilot Chat (Copilot) task JSON example', /"tool": "task"/.test(copilotSection));
check('skill has VS Code Copilot Chat (Copilot) agent_type argument', /"agent_type": "general-purpose"/.test(copilotSection));

const githubSection = delegated.split('#### GitHub Copilot CLI — `task` tool → `general-purpose` subagent')[1] ?? '';
check('skill has GitHub Copilot CLI task JSON example', /"toolName": "task"/.test(githubSection));
check('skill has GitHub Copilot CLI agent_type argument', /"agent_type": "general-purpose"/.test(githubSection));


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
check('modes/_shared.md guardrail mentions VS Code Copilot Chat (Local)', /VS Code Copilot Chat.*runSubagent.*Local/.test(guardrail));
check('modes/_shared.md guardrail mentions VS Code Copilot Chat (Copilot)', /VS Code Copilot Chat.*task.*Copilot/.test(guardrail));
check('modes/_shared.md guardrail mentions GitHub Copilot CLI', /GitHub Copilot CLI.*task.*general-purpose/.test(guardrail));
check('modes/_shared.md guardrail mentions other CLIs direct', /others: direct execution/.test(guardrail));