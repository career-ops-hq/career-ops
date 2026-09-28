# Mode: interview/plan — Planejador de preparação para entrevista

Dada uma descrição da vaga e a data/hora da entrevista, monte um plano de preparação estruturado e dividido em blocos de tempo, ajustado às lacunas específicas do candidato.

---

## Inputs

1. **Descrição da vaga** (obrigatório) — cole aqui ou forneça a URL
2. **Data e hora da entrevista** (obrigatório) — para calcular as horas disponíveis
3. **Nome e cargo do entrevistador** (se souber) — definem a profundidade e o tom da preparação
4. **Tipo de rodada** (se souber) — triagem, técnica/específica da área, design/estudo de caso, painel comportamental
5. **CV** em `cv.md` + `article-digest.md` (se existir) — leia para experiência, competências, pontos de prova
6. **Perfil** em `config/profile.yml` + `modes/_profile.md` — leia para narrativa, arquétipos e objetivos
7. **Story bank** em `interview-prep/story-bank.md` — histórias STAR+R já existentes
8. **Question bank** em `interview-prep/question-bank.md` — lacunas já conhecidas (se o arquivo existir)

---

## Step 1 — Fit Assessment

Leia o CV e a descrição da vaga. Produza uma avaliação em duas colunas:

**Pontos fortes para ancorar:** experiência, cargos, domínio e pontos de prova que correspondem diretamente à vaga.

**Lacunas a fechar:** competências, ferramentas ou experiências exigidas na vaga que estão ausentes ou frágeis no CV. Ordene pela probabilidade de serem testadas neste tipo específico de rodada.

Seja honesto. Uma lacuna é uma lacuna — sinalize-a com clareza, para que o tempo de preparação vá aos lugares certos.

---

## Step 2 — Round Intelligence

Identifique o que esta rodada realmente avalia, com base em:
- Cargo do entrevistador (gestor = comunicação + motivação + fundamentos; especialista da área = profundidade + julgamento)
- Rótulo da rodada (triagem, técnica/domínio, design/estudo de caso, final)
- Sinais da descrição da vaga (aquilo que enfatizam)

**Triagem com o recrutador:**
- Verificação de requisitos: fit, alinhamento de remuneração, logística, comunicação
- Não é um teste técnico — as perguntas de profundidade vêm com o gestor da vaga e nas rodadas seguintes
- Provável: apresentação da trajetória, "por que nós/por que esta vaga", expectativa de remuneração, prazos, uma pergunta logística
- Trate isso como o checkpoint fácil; use o tempo de preparação para construir a base do que vem depois

**Triagem com o gestor da vaga:**
- Comunicação, motivação, fit — além de filosofia de liderança e julgamento
- Fundamentos da competência central da vaga — não os detalhes internos aprofundados
- 1–2 histórias comportamentais
- Provável: trajetória, "por que nós", um conceito central da vaga, uma história de liderança, uma pergunta situacional voltada ao futuro

**Aprofundamento técnico/de domínio com um especialista:**
- Profundidade na competência central da vaga (ex.: detalhes internos de runtime para engenharia, escolhas de modelagem para dados, métodos de avaliação para finanças)
- Cenários aplicados do dia a dia da função
- Possível exercício ao vivo ou walkthrough guiado
- Histórias usadas como evidência, não como evento principal

**Painel de design / estudo de caso:**
- Solução completa — restrições, componentes, trade-offs, modos de falha
- As dimensões de qualidade que a vaga enfatiza (ex.: escalabilidade, conformidade, mensurabilidade)
- Nível sênior: defina restrições, faça perguntas de esclarecimento, conduza a conversa

Calibre o plano à rodada. Preparar profundidade em excesso para uma triagem desperdiça tempo e cria a mentalidade errada.

---

## Step 3 — Build the Time-Blocked Plan

Calcule as horas disponíveis de agora até o horário da entrevista. Divida em blocos:

Antes de dimensionar os blocos, verifique `interview-prep/question-bank.md` (se existir). Qualquer pergunta marcada com 🔴 em uma rodada anterior é uma lacuna comprovada — ela ganha um bloco dedicado, independentemente de como a análise CV-vs-vaga a classifique. Dados reais de desempenho superam o risco inferido.

**Template (ajuste o tamanho dos blocos conforme o total de horas disponíveis):**

```text
Bloco 1 — Fixe a sua narrativa (primeiro, sempre)
  - Escreva de forma explícita a linha do tempo da sua trajetória
  - Prepare o "por que esta empresa" com uma conexão específica ao seu histórico
  - Prepare a história do seu ponto de prova mais forte (versão de 30 segundos)
  - Tempo: ~15% das horas disponíveis

Bloco 2 — Tópico de domínio prioritário (primeiro a lacuna de maior risco)
  - Um tópico por bloco — não misture
  - Para cada um: conceito → gancho com a sua história → prováveis perguntas de acompanhamento
  - Tempo: ~25% das horas disponíveis

Bloco 3 — Tópico de domínio secundário
  - Segunda lacuna de maior risco
  - Tempo: ~20% das horas disponíveis

Bloco 4 — Histórias comportamentais
  - Mapeie as histórias existentes para os prováveis tipos de pergunta
  - Pratique a versão verbal de 2 minutos de cada uma
  - Prepare a Reflection de cada uma — o diferencial do candidato sênior
  - Tempo: ~15% das horas disponíveis

Bloco 5 — Pesquisa sobre a empresa
  - Páginas de produto relevantes para a função
  - Conexão entre o seu histórico e o domínio específico deles
  - 3–4 perguntas afiadas para fazer a eles
  - Tempo: ~10% das horas disponíveis

Bloco 6 — Simulação prática (se o tempo permitir)
  - Uma pergunta por tópico provável — em voz alta, cronometrada
  - Tempo: ~10% das horas disponíveis

Bloco 7 — Folga + descanso
  - Pare de estudar 60–90 minutos antes da entrevista
  - Estudar na última hora acrescenta ruído, não sinal
  - Tempo: o restante
```

Ajuste o tamanho dos blocos conforme a gravidade das lacunas e o tipo de rodada. Se for uma triagem, o Bloco 4 (comportamental) e o Bloco 5 (pesquisa sobre a empresa) são mais importantes do que os blocos de domínio aprofundado.

---

## Step 4 — Priority Quick-Reference

Ao final do plano, produza um resumo de uma página que o candidato possa revisar 15 minutos antes da entrevista:

```markdown
## 15-Minute Pre-Interview Review

**Your anchor sentence:** [uma frase que resume por que você é a pessoa certa para esta vaga]

**Top 3 things to remember:**
1. [a mensagem mais importante a deixar com o entrevistador]
2. [a pergunta mais provável e a primeira frase da sua resposta]
3. [a conexão entre o seu histórico e o domínio deles]

**Your questions to ask:**
1. [pergunta 1]
2. [pergunta 2]
3. [pergunta 3]
```

---

## Step 5 — Save Output

Salve o plano em `interview-prep/{company-slug}-{role-slug}.md` se o arquivo não existir, ou acrescente uma seção `## Prep Plan` se já existir.

---

## Rules

- **Calibre à rodada.** Um plano de preparação para triagem é muito diferente de um para painel de design. Não use profundidade máxima por padrão em toda entrevista.
- **Lacunas primeiro.** O tempo é finito. Os pontos fortes do candidato não precisam de preparação — as lacunas dele, sim.
- **Lacunas 🔴 da question bank têm prioridade sobre lacunas inferidas.** Dados reais de desempenho vencem a análise CV-vs-vaga. Se o candidato já sabe que tem dificuldade em um tópico, não o enterre.
- **Um tópico por bloco.** Misturar tópicos em um único bloco reduz a retenção.
- **Sempre inclua tempo de descanso.** Um candidato descansado tem melhor desempenho do que um que estuda até o último minuto.
- **Nunca gere informações falsas sobre a empresa.** Se você não tem pesquisa, diga isso — não invente alegações sobre a cultura ou detalhes técnicos da empresa.
- **Nunca invente alegações para o candidato.** A frase-âncora e os pontos de fala pré-entrevista do resumo (Step 4) devem se basear no que o candidato realmente tem — `cv.md`, `article-digest.md` ou a story bank. Não redija alegações que dependam de experiências ou métricas que o candidato não possui. Se uma alegação aparecer em `interview-prep/retracted-claims.md`, nunca a inclua.
