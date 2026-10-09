# Career Ops PT-PT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a aplicação web local integralmente em português de Portugal, com copy factual e uma interface menos genérica.

**Architecture:** Manter a aplicação monolingue e alterar a copy nos componentes existentes. Reutilizar `Intl` e acrescentar apenas os helpers partilhados necessários para rótulos canónicos e métricas; não instalar dependências nem criar uma camada de i18n. Preservar valores de protocolo e persistência em inglês.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-05-career-ops-pt-pt.md`

## Global Constraints

- Português de Portugal, AO90, sem traduções literais ou tom promocional.
- Idioma único nesta instalação; sem seletor e sem dependências novas.
- Valores internos, rotas e protocolos mantêm-se em inglês.
- `modes/pt/` não é alterado nem ativado.
- O servidor principal em `127.0.0.1:3417` não é interrompido durante a implementação.
- Cada comportamento novo segue RED → GREEN; copy humana é verificada no navegador, não por testes que leem o código-fonte.

## Review Focus

- Estado canónico desconhecido deve continuar visível e não ser traduzido para um valor incorreto.
- `language.output` explícito deve prevalecer sobre o novo fallback PT-PT.
- Zero execuções deve produzir `—`, sem divisão enganosa nem 100% fictício.
- Datas inválidas devem continuar a degradar para o valor original.
- Erros vindos do núcleo podem conter dados ou nomes técnicos que não devem ser alterados destrutivamente.

---

### Task 1: Fundamentos de idioma e apresentação

**Files:**
- Create: `web/src/lib/pt-pt.ts`
- Create: `web/tests/lib/pt-pt.test.mjs`
- Modify: `web/src/app/layout.tsx`
- Modify: `web/src/lib/format.ts`
- Modify: `profile-language.mjs`
- Modify: `tests/output-language.test.mjs`

**Interfaces:**
- Produces: `PT_PT_LOCALE`, `statusLabel(status)`, `scheduledSuccessRate(total, successful)`.
- Consumes: estados canónicos existentes e `language.output` do perfil.

- [x] **Step 1: Escrever testes de comportamento para locale, estados, fallback de idioma e taxa sem execuções.**
- [x] **Step 2: Executar os testes e confirmar a falha pelas funções e fallback ainda inexistentes.**
- [x] **Step 3: Implementar os helpers mínimos, `lang="pt-PT"`, metadata PT-PT e fallback de output PT-PT.**
- [x] **Step 4: Executar testes específicos e a suite web.**
- [x] **Step 5: Fazer commit do pacote.**

### Task 2: Navegação, início e descoberta

**Files:**
- Modify: `web/src/lib/nav-items.ts`
- Modify: `web/src/components/app-shell.tsx`
- Modify: `web/src/components/mobile-nav.tsx`
- Modify: `web/src/components/theme-toggle.tsx`
- Modify: `web/src/components/usage-meter.tsx`
- Modify: `web/src/components/onboarding-banner.tsx`
- Modify: `web/src/components/home/*.tsx`
- Modify: `web/src/components/explore/*.tsx`
- Modify: `web/src/components/inbox/*.tsx`
- Modify: `web/src/components/pipeline-view.tsx`
- Modify: `web/src/components/quick-evaluate.tsx`
- Modify: `web/src/lib/explore-cost.ts`

**Interfaces:**
- Consumes: `PT_PT_LOCALE` e `statusLabel` da Task 1.
- Produces: navegação e percursos de procura/candidaturas integralmente PT-PT.

- [x] **Step 1: Registar, em teste de navegador, a copy inglesa observada nos percursos principais.**
- [x] **Step 2: Executar o teste contra a versão inicial e confirmar a falha.**
- [x] **Step 3: Reescrever navegação, início, procura, inbox e candidaturas em PT-PT, corrigindo a promessa de pesquisa em segundo plano.**
- [x] **Step 4: Executar o teste de navegador e a suite web.**
- [x] **Step 5: Fazer commit do pacote.**

### Task 3: Restantes áreas e estados de erro

**Files:**
- Modify: `web/src/app/**/*.tsx`
- Modify: `web/src/components/followups/*.tsx`
- Modify: `web/src/components/portals-view.tsx`
- Modify: `web/src/components/analytics/*.tsx`
- Modify: `web/src/components/config-form.tsx`
- Modify: `web/src/components/cv*.tsx`
- Modify: `web/src/components/cv/*.tsx`
- Modify: `web/src/components/report*.tsx`
- Modify: `web/src/components/jobs/*.tsx`
- Modify: `web/src/components/status-select.tsx`
- Modify: `web/src/components/apply*.tsx`
- Modify: `web/src/components/apply/*.tsx`
- Modify: `web/src/components/beta/*.tsx`
- Modify: `web/src/app/api/**/*.ts` apenas nas mensagens apresentadas pela interface.

**Interfaces:**
- Consumes: rótulos PT-PT da Task 1.
- Produces: áreas secundárias, loading, confirmações e erros em PT-PT.

- [x] **Step 1: Acrescentar ao teste de navegador os ecrãs e estados alcançáveis sem efeitos externos.**
- [x] **Step 2: Confirmar que a versão inicial ainda apresenta inglês nesses estados.**
- [x] **Step 3: Reescrever a copy visível restante e manter intactos os tokens de protocolo.**
- [x] **Step 4: Executar testes específicos, suite web e typecheck.**
- [x] **Step 5: Fazer commit do pacote.**

### Task 4: Assistente e voz natural

**Files:**
- Modify: `web/src/app/api/assistant/route.ts`
- Modify: `web/src/app/actions/registry.ts`
- Modify: `web/src/components/assistant-console.tsx`
- Modify: `web/src/lib/job-error-hint.mjs`
- Modify: testes de comportamento afetados em `web/tests/lib/`.

**Interfaces:**
- Consumes: fallback `pt-PT` da Task 1.
- Produces: assistente PT-PT, direto e sem linguagem promocional; envelopes de ação mantêm o contrato atual.

- [x] **Step 1: Escrever teste para o prompt do assistente e mensagens de ação observáveis.**
- [x] **Step 2: Confirmar que o teste falha com o prompt promocional e inglês atual.**
- [x] **Step 3: Reescrever instruções de voz e mensagens humanas, sem alterar ações, permissões ou confirmações de segurança.**
- [x] **Step 4: Executar testes específicos e suite web.**
- [x] **Step 5: Fazer commit do pacote.**

### Task 5: Pesquisas guardadas e acabamento anti-slop

**Files:**
- Modify: `web/src/components/scheduled-jobs-view.tsx`
- Modify: `web/src/components/scheduled-scans/*.tsx`
- Modify: `web/src/components/ui/` apenas se um primitivo existente precisar de copy PT-PT.
- Modify: `web/tests/lib/pt-pt.test.mjs`

**Interfaces:**
- Consumes: `scheduledSuccessRate` e locale da Task 1.
- Produces: ecrã de pesquisas guardadas factual, sem estatísticas vazias nem sucesso fictício.

- [x] **Step 1: Acrescentar casos para zero execuções, execuções reais e estados do scheduler.**
- [x] **Step 2: Confirmar a falha com o 100% atual e copy inglesa.**
- [x] **Step 3: Aplicar a copy PT-PT, esconder métricas sem dados e remover repetição/decoração sem função.**
- [x] **Step 4: Executar testes, typecheck, build e auditoria anti-slop.**
- [x] **Step 5: Fazer commit do pacote.**

### Task 6: Verificação ponta a ponta

**Files:**
- Modify: apenas correções exigidas pela verificação.
- Evidence: `.superpowers/sdd/2026-10-05-career-ops-pt-pt/`.

**Interfaces:**
- Consumes: aplicação completa das Tasks 1–5.
- Produces: evidência de desktop, móvel, erros de consola, testes, typecheck e build.

- [x] **Step 1: Iniciar a worktree numa porta diferente, ligada ao diretório da própria worktree para a inspeção.**
- [x] **Step 2: Percorrer os destinos principais em desktop e os ecrãs de configuração, pesquisas e candidatura em móvel; verificar copy, largura e consola.**
- [x] **Step 3: Executar suite web completa, typecheck, build e teste do fallback de idioma do núcleo.**
- [x] **Step 4: Rever o diff completo, corrigir o conflito entre o campo e o botão da candidatura móvel e repetir a suite.**
- [x] **Step 5: Fazer o commit final e preservar a worktree para decisão de integração.**
