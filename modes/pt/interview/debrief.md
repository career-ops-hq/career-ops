# Mode: interview/debrief — Debrief pós-entrevista

Após uma entrevista real, registre o que foi perguntado, avalie o que funcionou e o que não funcionou, feche lacunas antes da próxima rodada e atualize a question bank.

---

## When to Run This Skill

- Imediatamente após uma entrevista real (enquanto a memória está fresca)
- Após uma ligação com o recrutador que trouxe novas informações sobre o processo
- Quando o candidato descobre o formato da próxima rodada e o entrevistador

---

## Inputs

1. **Debrief do candidato** — quais perguntas foram feitas, como ele respondeu, o que pareceu forte ou fraco
2. **Nome e cargo do entrevistador** — orienta a previsão da próxima rodada
3. **Resultado da rodada** (se souber) — avançou / rejeitado / pendente
4. **Detalhes da próxima rodada** (se souber) — formato, entrevistadores, prazos
5. **Question bank** em `interview-prep/question-bank.md` — atualize com dados reais
6. **Story bank** em `interview-prep/story-bank.md` — adicione novas histórias se surgirem
7. **CV** em `cv.md` + `article-digest.md` (se existir) — para ancorar respostas sugeridas em experiência real
8. **Alegações retiradas** em `interview-prep/retracted-claims.md` (se existir) — barreira rígida; nunca use uma alegação retirada em uma resposta sugerida, mesmo que o candidato a tenha dito na entrevista
9. **Arquivo de preparação específico da vaga** — acrescente as notas do debrief

---

## Step 1 — Capture What Was Asked

Peça ao candidato que liste todas as perguntas de que se lembra, em ordem se possível. Não sugira opções — deixe-o recordar livremente primeiro.

Para cada pergunta registrada:
- O que ele disse?
- Como o entrevistador reagiu (sinal positivo, neutro, contestou, seguiu adiante rapidamente)?
- Ele se sentiu confiante ou inseguro?

Se a memória estiver incompleta, faça perguntas direcionadas:
- "Houve alguma pergunta que te pegou de surpresa?"
- "Houve algo que você gostaria de ter respondido de forma diferente?"
- "O entrevistador fez algum acompanhamento sobre algo — isso normalmente significa que ele queria mais?"

---

## Step 2 — Honest Assessment Per Question

Para cada pergunta, produza:

```markdown
**Q: [pergunta]**
- What was said: [resumo da resposta dele]
- What landed: [o que foi bom — seja específico]
- What was missing: [lacuna — termo técnico preciso, resultado ausente, sem reflection, etc.]
- Correct/complete answer: [o que a resposta completa deveria incluir]
- Status: ✅ Strong / 🟡 Solid / 🔴 Gap
```

Seja direto. Se ele errou o conceito central que a pergunta testava, diga isso. Se uma resposta foi genuinamente forte, diga isso também. O debrief é o momento de aprendizado mais valioso — a vagueza o desperdiça.

---

## Step 3 — Update Question Bank

Para cada pergunta do debrief, atualize `interview-prep/question-bank.md`:
- Mude o status para ✅ / 🟡 / 🔴 com base no desempenho real
- Acrescente notas de lacuna a partir do debrief
- Acrescente quaisquer novas perguntas que apareceram e ainda não estavam na bank

Se a question bank não existir, crie-a usando as perguntas desta entrevista como base.

---

## Step 4 — Close the Gaps

Para cada lacuna 🔴 identificada:

1. **Explique a resposta correta** — clara, concisa, com um exemplo resolvido (código, cálculo, diagrama) onde ajudar
2. **Conecte a uma história real** se possível — "você na verdade tem isto na sua [história existente da story bank] — veja como usá-la"
3. **Acrescente ao arquivo de preparação da vaga** sob uma seção "Gaps to Close Before Round N"
4. **Acrescente a `interview-prep/interview-prep-guide.md`** (se o candidato mantiver um) quando for um princípio reutilizável que se aplica além desta vaga

---

## Step 5 — Extract New Stories

Às vezes uma entrevista real revela uma história que o candidato não havia preparado. Se o candidato descreveu uma experiência que não havia formalizado:

> "Você mencionou [X] na sua resposta — parece que isso poderia virar uma história STAR+R completa. Quer montá-la agora enquanto está fresca?"

Se sim, monte-a como uma história STAR+R (Situation, Task, Action, Result, Reflection) e acrescente-a a `interview-prep/story-bank.md`.

---

## Step 6 — Next Round Intelligence

Se o candidato sabe o formato da próxima rodada:

1. **Preveja perguntas prováveis** com base em:
   - Cargo do próximo entrevistador (ex.: especialista sênior → profundidade na competência central, design; par multifuncional → colaboração, fronteiras de domínio; executivo → estratégia, impacto no negócio)
   - O que foi coberto nesta rodada (a próxima rodada normalmente vai mais fundo, não mais amplo)
   - Aquilo em que o entrevistador desta rodada pareceu mais interessado

   Rotule toda previsão como `[inferred]` — nunca apresente uma pergunta prevista como se tivesse origem em candidatos reais ou fontes internas.

2. **Monte uma lista de prioridades** para a preparação da próxima rodada — ordenada por gravidade da lacuna e probabilidade de ser testada

3. **Sugira rodar** `interview/plan` com os detalhes da próxima rodada para montar um plano de preparação completo

---

## Step 7 — Probability Assessment (Optional)

Se o candidato pedir uma leitura honesta das chances dele:

Avalie com base em:
- Número e gravidade das lacunas (🔴 em fundamentos = risco maior do que 🔴 em tópicos avançados)
- Sinais do entrevistador (deu detalhes específicos da próxima rodada = positivo; vago = neutro; ligação curta = risco)
- Fit da vaga (anos de experiência, correspondência de domínio, localização)
- Diferenciais (coisas que o candidato disse que a maioria dos candidatos não diria)

Seja honesto. Uma faixa de probabilidade com raciocínio claro é mais útil do que falsa confiança.

---

## Step 8 — Save Debrief

Acrescente a `interview-prep/{company-slug}-{role-slug}.md`:

```markdown
## Round [N] Debrief — [YYYY-MM-DD]

**Interviewer:** [nome, cargo]
**Round type:** [screening / technical / design-case-study / behavioral]
**Outcome:** [pending / moved forward / rejected]

### Questions Asked
[lista]

### Gaps Identified
[lista com respostas corretas]

### Next Round
**Format:** [se souber]
**Interviewers:** [se souber]
**Priority prep:** [3 principais tópicos a fechar antes da próxima rodada]

### Process Intel (recruiter / HM screens — omit if not applicable)
**Comp discussed:** [sim / não — se sim, o que foi dito e o que foi ancorado]
**Timeline:** [quaisquer datas ou prazos mencionados]
**Other candidates:** [se revelado]
**Next steps:** [o que o entrevistador disse que acontece a seguir e até quando]
```

---

## Step 9 — Write Session Transcript

Após o debrief, escreva também uma transcrição da sessão legível por máquina em `interview-prep/sessions/{company-slug}-{role-slug}-{round}-{YYYY-MM-DD}.md`. Este é um registro estruturado da rodada para modos de análise posteriores; os turnos com rótulo de quem fala permitem que um consumidor leia qualquer um dos lados sem reinferir quem falou. O contrato completo está em `interview-prep/sessions/README.md`.

Formato:

```markdown
---
company: [company]
role: [role]
round: [screen | hiring-manager | technical | system-design | behavioral | onsite | final]
date: YYYY-MM-DD
interviewer_role: [role, if known]
source: debrief
---

## Q1
**Interviewer:** [pergunta como foi feita]
<!-- competency: tag[, tag...] -->
**Candidate:** [resposta como foi dada / reconstruída neste debrief]

## Q2
...
```

Regras para a transcrição:

- **Mapeie o tipo de rodada para o enum** acima (ex.: triagem com recrutador → `screen`, triagem com gestor → `hiring-manager`, aprofundamento técnico → `technical`, design/estudo de caso → `system-design`).
- **Marque cada resposta.** Na linha diretamente acima de cada linha `**Candidate:**`, emita `<!-- competency: tag[, tag...] -->` — em lowercase-kebab-case, separada por vírgulas para respostas com múltiplas competências (ex.: `system-design`, `people-leadership`, `incident-response`). Você já avaliou cada resposta no Step 2, então marque a partir dessa avaliação, sem reler. As tags são livres; escolha a competência que a pergunta realmente testou.
- **Reconstrua o turno do candidato fielmente.** Use o que o candidato relatou ter dito no Step 1, não uma resposta idealizada. A "correct/complete answer" do Step 2 pertence ao arquivo de debrief, nunca à transcrição — a transcrição registra o que aconteceu.
- **`source: debrief`.**
- O arquivo da sessão fica em um diretório no gitignore (nomes/empresas reais nunca entram no controle de versão); escreva-o sem censurar.

---

## Rules

- **Faça o debrief imediatamente.** A memória dos detalhes da entrevista degrada rápido — em horas, perguntas e reações específicas são esquecidas. Rode esta skill no mesmo dia.
- **Não suavize as lacunas.** Uma lacuna 🔴 chamada de 🟡 por gentileza vai reaparecer na próxima rodada.
- **Nunca coloque alegações inventadas na boca do candidato.** As respostas corretas/completas podem recorrer a conhecimento geral da área, mas qualquer alegação pessoal ou métrica sugerida deve vir do que o candidato disse, de `cv.md`, `article-digest.md` ou da story bank.
- **Alegações retiradas são uma barreira rígida.** Se uma alegação aparecer em `interview-prep/retracted-claims.md`, nunca sugira que o candidato a use — mesmo que ele a tenha dito na entrevista real. Sinalize-a: "Essa alegação está na sua lista de retiradas — não é defensável sob pressão. Aqui está uma versão que não depende dela."
- **Registre novas retratações.** Se o debrief revelar uma alegação que o candidato usou na entrevista real e que agora concorda não ser defensável, ofereça-se para acrescentá-la a `interview-prep/retracted-claims.md`: `**"[claim]"** ([context]). Reason: [one-line reason + correct framing if applicable].`
- **Extraia lacunas de vocabulário explicitamente.** Se o candidato usou um termo impreciso onde existe um preciso, acrescente-o a `interview-prep/interview-prep-guide.md` na seção de vocabulário (se o candidato mantiver uma).
- **Uma lacuna = uma correção.** Não sobrecarregue com um plano de estudo completo para cada lacuna. Priorize as 1–2 com maior probabilidade de serem testadas na próxima rodada.
- **Celebre o que funcionou.** O debrief não é só sobre lacunas. Nomeie o que foi forte — isso reforça o comportamento certo e constrói confiança para a próxima rodada.
