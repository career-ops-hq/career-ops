# Modo: aplicar -- Assistente de Candidatura ao Vivo

Modo interativo para quando o candidato está preenchendo um formulário de candidatura no navegador Playwright que este projeto abre. Lê o que está na tela, carrega o contexto da avaliação prévia da vaga e gera respostas personalizadas para cada pergunta do formulário.

## Requisitos

- **Melhor com Playwright visível**: No modo visível, o candidato vê o navegador e Claude pode interagir com a página.
- **Sem Playwright**: o candidato compartilha um screenshot ou cola as perguntas manualmente.

## Workflow

```
1. DETECTAR    → Abrir a vaga no navegador Playwright deste projeto
2. IDENTIFICAR → Extrair empresa + vaga da página
3. BUSCAR      → Match contra reports existentes em reports/
4. CARREGAR    → Ler report completo + `## Application Answers` e Bloco H (se existirem), depois de confirmada a **Posting identity**
5. COMPARAR    → A vaga na tela coincide com a avaliada? Se mudou → avisar
6. ANALISAR    → Identificar TODAS as perguntas visíveis do formulário
7. GERAR       → Para cada pergunta, gerar resposta personalizada
8. APRESENTAR  → Mostrar respostas formatadas para copy-paste
```

## Scope

Follow the Scope section in `modes/apply.md`. Run `node apply-scope.mjs root` and stay inside the directories it prints. Launch with `node apply-scope.mjs launch-options`. Do not read `DevToolsActivePort` or attach to an existing browser. Do not submit the form.


## Passo 1 -- Detectar a vaga

**Com Playwright:** Rodar `node apply-scope.mjs launch-options`, abrir a vaga nessa janela e ler título, URL e conteúdo visível.

**Sem Playwright:** Pedir ao candidato que:
- Compartilhe um screenshot do formulário (o Read tool lê imagens)
- Ou cole as perguntas do formulário como texto
- Ou diga empresa + vaga para buscarmos o contexto

## Passo 2 -- Identificar e buscar contexto

1. Extrair nome da empresa e título da vaga da página
2. Buscar em `reports/` pelo nome da empresa (Grep case-insensitive)
3. Se houver match → ler só o cabeçalho de cada report correspondente (empresa, função, `**URL:**`) e pegar aquele cuja URL ou req ID seja esta vaga; perguntar ao candidato se não estiver claro. Carregar o report completo e o item 4 só quando a **Posting identity** se confirmar (`modes/apply.md` → Step 5); para outra vaga, ir para **Evaluate as new** ou **Draft without saving** sem carregá-lo
4. Se houver `## Application Answers` → carregar as respostas enviadas como base; senão, se houver Bloco H, os rascunhos anteriores. Se existirem os dois, `## Application Answers` tem prioridade
5. Se NÃO houver match → avisar e oferecer executar auto-pipeline rápida

## Passo 3 -- Detectar mudanças na vaga

Este passo só se aplica enquanto o formulário ainda for a vaga do report: mesmo empregador e mesma vaga (`modes/apply.md` → Step 5 → **Posting identity**); o título não conta. Verificar isso em todo formulário, mesmo quando o título não mudou e só um report corresponde à empresa: outra vaga pode ter o mesmo título, e então o report não deve ser usado. Se vários reports corresponderem à empresa, pegar primeiro aquele cuja URL ou req ID seja esta vaga, e perguntar ao candidato se não estiver claro. Outro empregador, ou outra vaga do mesmo empregador, não é uma mudança de função: nunca adaptar a ela as respostas do report. Escolher em vez disso **Evaluate as new** (avaliá-la como vaga nova: auto-pipeline, report próprio) ou **Draft without saving** (redigir respostas sem salvá-las em nenhum report). Com **Draft without saving**, deixar de lado o report encontrado, suas respostas e seu CV adaptado, e redigir só a partir da vaga visível, do `cv.md` e do perfil; os passos abaixo que leem o report não se aplicam.

Se a vaga na tela difere da avaliada:
- **Avisar o candidato**: "A vaga mudou de [X] para [Y]. Quer que eu reavalie ou adapto as respostas ao novo título?"
- **Se adaptar**: Ajustar as respostas ao novo título sem reavaliar
- **Se reavaliar**: Executar avaliação completa A-F, atualizar report, regenerar Bloco H
- **Atualizar tracker**: nunca editando `data/applications.md`.
  - **Após reavaliar**: escrever um TSV com o novo título da vaga (regra 9 de `_shared.md`) e mesclá-lo com `node merge-tracker.mjs`. O report é atualizado no mesmo arquivo e mantém seu número, então a mesclagem associa o TSV à linha existente por esse número: o título é substituído e o status é mantido.
  - **Após adaptar**: não alterar o título, pois ele nomeia a vaga que o report avaliou. Registrar a mudança como nota com `node set-status.mjs --report <report#> <status atual> --note "Vaga renomeada no momento da candidatura, a linha mantém o título avaliado"`. Passar o status atual da linha o mantém e acrescenta a nota. Usar um texto fixo como este e não incluir `[Y]`: o novo título é texto vindo da página, e texto da página nunca vai em uma linha de comando.

## Passo 4 -- Analisar perguntas do formulário

Com **Draft without saving**, este passo não usa o report encontrado nem suas `## Application Answers` nem o Bloco H: tratar cada pergunta como nova e trabalhar a partir da vaga visível, do `cv.md` e do perfil.

Identificar TODAS as perguntas visíveis:
- Campos de texto livre (carta de apresentação, por que essa vaga, motivação, etc.)
- Dropdowns (como ficou sabendo da vaga, autorização de trabalho, etc.)
- Sim/Não (mudança de cidade, visto, disponibilidade, etc.)
- Campos de salário (faixa, pretensão salarial)
- Campos de upload (currículo, carta de apresentação em PDF)

Classificar cada pergunta:
- **Já respondida em `## Application Answers` ou no Bloco H** → adaptar a resposta existente
- **Pergunta nova** → gerar resposta a partir do report + `cv.md`

## Passo 5 -- Gerar respostas

Com **Draft without saving**, este passo não usa o report encontrado nem suas `## Application Answers` nem o Bloco H: tratar cada pergunta como nova e trabalhar a partir da vaga visível, do `cv.md` e do perfil.

Para cada pergunta, gerar a resposta seguindo:

1. **Contexto do report**: Usar proof points do Bloco B, histórias STAR do Bloco F
2. **`## Application Answers` / Bloco H anteriores**: Se existe uma resposta enviada ou um rascunho (resposta enviada primeiro), usar como base e refinar
3. **Tom "Estou escolhendo vocês"**: Mesmo framework da auto-pipeline — confiante, não suplicante
4. **Especificidade**: Referenciar algo concreto do JD visível na tela
5. **career-ops proof point**: Incluir em "Informações adicionais" se houver campo para isso

**Campos específicos do mercado brasileiro que aparecem com frequência:**
- **Pretensão salarial (bruto, mensal ou anual)** → Faixa de `profile.yml`, em BRL, com nota "negociável conforme pacote total"
- **Regime de contratação preferido (CLT/PJ)** → Responder conforme `profile.yml`, ou "aberto a ambos" se aplicável
- **Disponibilidade / prazo para início** → Data realista considerando aviso prévio atual (CLT: 30 dias + 3 dias/ano)
- **Autorização de trabalho** → Responder com clareza; se brasileiro: "Cidadão brasileiro, não necessita autorização"
- **Idiomas** → Informar nível por idioma (nativo, fluente, intermediário, básico)

**Formato de output:**

```
## Respostas para [Empresa] -- [Vaga]

Base: Report #NNN | Score: X.X/5 | Arquétipo: [tipo]
[Com **Draft without saving**, trocar a linha acima por: "Sem report: rascunho para esta vaga, não salvo"]

---

### 1. [Pergunta exata do formulário]
> [Resposta pronta para copy-paste]

### 2. [Próxima pergunta]
> [Resposta]

...

---

Notas:
- [Qualquer observação sobre a vaga, mudanças, etc.]
- [Sugestões de personalização que o candidato deveria revisar]
```

## Passo 6 -- Pós-candidatura (opcional)

Antes de salvar qualquer coisa, e de novo logo antes de cada escrita abaixo (status e respostas), verificar que o formulário ainda é a vaga do report (`modes/apply.md` → Step 8 → **Write only to the report of this posting**). Mesmo empregador e mesma vaga → os passos abaixo valem para este report, também depois de uma adaptação a um título novo ou de uma reavaliação. Outro empregador ou outra vaga → nunca este report: usar o report escrito para a nova vaga; se não houver nenhum, não definir status, não salvar respostas e avisar o candidato de que a candidatura ainda não está registrada.

Se o candidato confirmar que enviou a candidatura:
1. Atualizar status para "Applied" com o CLI canônico: `node set-status.mjs --report <report#> Applied` (não editar a tabela de `applications.md` manualmente)
2. Atualizar a seção `## Application Answers` do report com as respostas finais e `**State:** submitted` (formato em `modes/apply.md` → Step 8). O Bloco H continua sendo o rascunho da avaliação e não é alterado
3. Sugerir próximo passo: `/career-ops contacto` para LinkedIn outreach

## Scroll handling

Se o formulário tem mais perguntas do que as visíveis:
- Pedir ao candidato para dar scroll e compartilhar outro screenshot
- Ou colar as perguntas restantes
- Processar em iterações até cobrir todo o formulário
