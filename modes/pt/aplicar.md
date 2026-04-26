# Modo: aplicar -- Assistente de Candidatura ao Vivo

Modo interativo para quando o candidato está preenchendo um formulário de candidatura no Chrome. Lê o que está na tela, carrega o contexto da avaliação prévia da vaga e gera respostas personalizadas para cada pergunta do formulário.

## Requisitos

- **Melhor com Playwright visível**: No modo visível, o candidato vê o navegador e Claude pode interagir com a página.
- **Sem Playwright**: o candidato compartilha um screenshot ou cola as perguntas manualmente.

## Workflow

```
1. DETECTAR    → Ler aba ativa do Chrome (screenshot/URL/título)
2. IDENTIFICAR → Extrair empresa + vaga da página
3. BUSCAR      → Match contra reports existentes em reports/
4. CARREGAR    → Ler report completo + Bloco G (se existir)
5. COMPARAR    → A vaga na tela coincide com a avaliada? Se mudou → avisar
6. ANALISAR    → Identificar TODAS as perguntas visíveis do formulário
7. GERAR       → Para cada pergunta, gerar resposta personalizada
8. APRESENTAR  → Mostrar respostas formatadas para copy-paste
```

## Passo 1 -- Detectar a vaga

**Com Playwright:** Tirar snapshot da página ativa. Ler título, URL e conteúdo visível.

**Sem Playwright:** Pedir ao candidato que:
- Compartilhe um screenshot do formulário (o Read tool lê imagens)
- Ou cole as perguntas do formulário como texto
- Ou diga empresa + vaga para buscarmos o contexto

## Passo 2 -- Identificar e buscar contexto

1. Extrair nome da empresa e título da vaga da página
2. Buscar em `reports/` pelo nome da empresa (Grep case-insensitive)
3. Se houver match → carregar o report completo
4. Se houver Bloco G → carregar os rascunhos de respostas anteriores como base
5. Se NÃO houver match → avisar e oferecer executar auto-pipeline rápida

## Passo 3 -- Detectar mudanças na vaga

Se a vaga na tela difere da avaliada:
- **Avisar o candidato**: "A vaga mudou de [X] para [Y]. Quer que eu reavalie ou adapto as respostas ao novo título?"
- **Se adaptar**: Ajustar as respostas ao novo título sem reavaliar
- **Se reavaliar**: Executar avaliação completa A-F, atualizar report, regenerar Bloco G
- **Atualizar tracker**: Alterar título da vaga em `applications.md` se necessário

## Passo 4 -- Analisar perguntas do formulário

Identificar TODAS as perguntas visíveis:
- Campos de texto livre (carta de apresentação, por que essa vaga, motivação, etc.)
- Dropdowns (como ficou sabendo da vaga, autorização de trabalho, etc.)
- Sim/Não (mudança de cidade, visto, disponibilidade, etc.)
- Campos de salário (faixa, pretensão salarial)
- Campos de upload (currículo, carta de apresentação em PDF)

Classificar cada pergunta:
- **Já respondida no Bloco G** → adaptar a resposta existente
- **Pergunta nova** → gerar resposta a partir do report + `cv.md`

## Passo 5 -- Gerar respostas

Para cada pergunta, gerar a resposta seguindo:

1. **Contexto do report**: Usar proof points do Bloco B, histórias STAR do Bloco F
2. **Bloco G anterior**: Se existe um rascunho, usar como base e refinar
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

Se o candidato confirmar que enviou a candidatura:
1. Atualizar status em `applications.md` de "Evaluated" para "Applied"
2. Atualizar Bloco G do report com as respostas finais
3. Sugerir próximo passo: `/career-ops contacto` para LinkedIn outreach

## Scroll handling

Se o formulário tem mais perguntas do que as visíveis:
- Pedir ao candidato para dar scroll e compartilhar outro screenshot
- Ou colar as perguntas restantes
- Processar em iterações até cobrir todo o formulário
