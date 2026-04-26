# Modo: oferta -- Avaliação Completa A-F

Quando o candidato cola uma vaga (texto ou URL), entregar SEMPRE os 6 blocos:

## Passo 0 -- Detecção de Arquétipo

Classificar a vaga em um dos 6 arquétipos (ver `_shared.md`). Se for híbrido, indicar os 2 mais próximos. Isso determina:
- Quais proof points priorizar no bloco B
- Como reescrever o summary no bloco E
- Quais histórias STAR preparar no bloco F

## Bloco A -- Resumo da Vaga

Tabela com:
- Arquétipo detectado
- Domain (platform/agentic/LLMOps/ML/enterprise)
- Função (build/consult/manage/deploy)
- Senioridade
- Remoto (full/híbrido/presencial)
- Tamanho do time (se mencionado)
- TL;DR em 1 frase

## Bloco B -- Match com o Currículo

Ler `cv.md`. Criar tabela com cada requisito do JD mapeado para linhas exatas do currículo.

**Adaptado ao arquétipo:**
- Se FDE → priorizar proof points de entrega rápida e proximidade com cliente
- Se SA → priorizar design de sistemas e integrações
- Se PM → priorizar product discovery e métricas
- Se LLMOps → priorizar evals, observability, pipelines
- Se Agentic → priorizar multi-agent, HITL, orquestração
- Se Transformation → priorizar gestão de mudança, adoção, escalabilidade

Seção de **gaps** com estratégia de mitigação para cada um. Para cada gap:
1. É um hard blocker ou um nice-to-have?
2. O candidato consegue demonstrar experiência adjacente?
3. Existe um projeto do portfolio que cubra esse gap?
4. Plano de mitigação concreto (frase para carta de apresentação, projeto rápido, etc.)

## Bloco C -- Nível e Estratégia

1. **Nível detectado** no JD vs **nível natural do candidato para esse arquétipo**
2. **Plano "vender senior sem mentir"**: frases específicas adaptadas ao arquétipo, conquistas concretas a destacar, como posicionar experiência de founder como vantagem
3. **Plano "se me downlevelearem"**: aceitar se a remuneração for justa, negociar revisão em 6 meses, critérios claros de promoção

## Bloco D -- Remuneração e Demanda

Usar WebSearch para:
- Salários atuais da vaga (Glassdoor, Levels.fyi, Blind, Glassdoor BR)
- Reputação de remuneração da empresa
- Tendência de demanda da vaga

Tabela com dados e fontes citadas. Se não houver dados, dizer isso em vez de inventar.

**Mercado Brasileiro -- Checks obrigatórios:**
- CLT ou PJ? Se CLT: considerar 13º, férias, FGTS, plano de saúde, VR/VA na comparação.
- Se PJ: qual o valor mensal? Calcular equivalente CLT.
- PLR mencionado? Quantos salários extras?
- Stock options / VSOP? Avaliar vesting, cliff e liquidez.
- Vale-refeição / vale-alimentação? Valor mensal?
- Plano de saúde? Coparticipação ou integral?

## Bloco E -- Plano de Personalização

| # | Seção | Estado atual | Mudança proposta | Por que |
|---|-------|-------------|------------------|---------|
| 1 | Summary | ... | ... | ... |
| ... | ... | ... | ... | ... |

Top 5 mudanças no currículo + Top 5 mudanças no LinkedIn para maximizar o match.

## Bloco F -- Plano de Entrevistas

6-10 histórias STAR+R mapeadas para requisitos do JD (STAR + **Reflection**):

| # | Requisito do JD | História STAR+R | S | T | A | R | Reflection |
|---|----------------|-----------------|---|---|---|---|------------|

A coluna **Reflection** captura o que foi aprendido ou o que seria feito diferente. Isso sinaliza senioridade — candidatos juniores descrevem o que aconteceu, candidatos seniores extraem lições.

**Story Bank:** Se `interview-prep/story-bank.md` existir, verificar se alguma dessas histórias já está lá. Se não, adicionar as novas. Com o tempo, isso constrói um banco reutilizável de 5-10 histórias-mestre que podem ser adaptadas para qualquer pergunta de entrevista.

**Selecionadas e enquadradas conforme o arquétipo:**
- FDE → enfatizar velocidade de entrega e proximidade com cliente
- SA → enfatizar decisões de arquitetura
- PM → enfatizar discovery e trade-offs
- LLMOps → enfatizar métricas, evals, production hardening
- Agentic → enfatizar orquestração, tratamento de erros, HITL
- Transformation → enfatizar adoção e mudança organizacional

Incluir também:
- 1 case study recomendado (qual projeto apresentar e como)
- Perguntas red-flag e como respondê-las (ex: "Por que você vendeu sua empresa?", "Você tinha reports diretos?")

---

## Pós-avaliação

**SEMPRE** após gerar os blocos A-F:

### 1. Salvar report .md

Salvar avaliação completa em `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`.

- `{###}` = próximo número sequencial (3 dígitos, zero-padded)
- `{company-slug}` = nome da empresa em lowercase, sem espaços (usar hifens)
- `{YYYY-MM-DD}` = data atual

**Formato do report:**

```markdown
# Avaliação: {Empresa} -- {Vaga}

**Data:** {YYYY-MM-DD}
**Arquétipo:** {detectado}
**Score:** {X/5}
**URL:** {URL da vaga}
**PDF:** {caminho ou pendente}

---

## A) Resumo da Vaga
(conteúdo completo do bloco A)

## B) Match com o Currículo
(conteúdo completo do bloco B)

## C) Nível e Estratégia
(conteúdo completo do bloco C)

## D) Remuneração e Demanda
(conteúdo completo do bloco D)

## E) Plano de Personalização
(conteúdo completo do bloco E)

## F) Plano de Entrevistas
(conteúdo completo do bloco F)

## G) Rascunhos de Respostas para Candidatura
(apenas se score >= 4.5 -- rascunhos de respostas para o formulário de candidatura)

---

## Keywords extraídas
(lista de 15-20 keywords do JD para otimização ATS)
```

### 2. Registrar no tracker

**SEMPRE** registrar em `data/applications.md`:
- Próximo número sequencial
- Data atual
- Empresa
- Vaga
- Score: média do match (1-5)
- Status: `Evaluated`
- PDF: ❌ (ou ✅ se a auto-pipeline gerou PDF)
- Report: link relativo ao report .md (ex: `[001](reports/001-company-2026-01-01.md)`)

**Formato do tracker:**

```markdown
| # | Data | Empresa | Vaga | Score | Status | PDF | Report |
```
