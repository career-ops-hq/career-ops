# Contexto Compartilhado -- career-ops (Português BR)

<!-- ============================================================
     THIS FILE IS AUTO-UPDATABLE. Don't put personal data here.
     
     Your customizations go in modes/_profile.md (never auto-updated).
     This file contains system rules, scoring logic, and tool config
     that improve with each career-ops release.
     ============================================================ -->

## Fontes da Verdade (SEMPRE ler antes de cada avaliação)

| Arquivo | Caminho | Quando |
|---------|---------|--------|
| cv.md | `cv.md` (raiz do projeto) | SEMPRE |
| article-digest.md | `article-digest.md` (se existir) | SEMPRE (proof points detalhados) |
| profile.yml | `config/profile.yml` | SEMPRE (identidade e vagas-alvo) |
| _profile.md | `modes/_profile.md` | SEMPRE (arquétipos, narrativa, negociação do usuário) |

**REGRA: NUNCA fazer hardcode de métricas de proof points.** Leia-as de `cv.md` e `article-digest.md` no momento da avaliação.
**REGRA: Para métricas de artigos/projetos, `article-digest.md` tem prioridade sobre `cv.md`** (`cv.md` pode conter números desatualizados).
**REGRA: Leia `_profile.md` DEPOIS deste arquivo. As personalizações do usuário em `_profile.md` sobrescrevem os valores padrão aqui.**

---

## Sistema de Pontuação

A avaliação usa 6 blocos (A-F) com uma nota global de 1-5:

| Dimensão | O que mede |
|----------|------------|
| Match com CV | Habilidades, experiência, alinhamento de proof points |
| Alinhamento North Star | Quão bem a vaga encaixa nos arquétipos-alvo do usuário (de `_profile.md`) |
| Remuneração | Salário vs mercado (5=quartil superior, 1=bem abaixo) |
| Sinais culturais | Cultura da empresa, crescimento, estabilidade, política de trabalho remoto |
| Red flags | Bloqueadores, alertas (ajustes negativos) |
| **Global** | Média ponderada dos itens acima |

**Interpretação da nota:**
- 4.5+ → Match forte, recomendado aplicar imediatamente
- 4.0-4.4 → Bom match, vale a pena aplicar
- 3.5-3.9 → Razoável mas não ideal, aplicar apenas se houver motivo específico
- Abaixo de 3.5 → Recomendado não aplicar (veja Ethical Use no AGENTS.md)

## North Star -- Vagas-Alvo

O skill trata TODAS as vagas-alvo com o mesmo cuidado. Nenhuma é primária ou secundária — qualquer uma é uma vitória, desde que a remuneração e a perspectiva de crescimento estejam adequadas:

| Arquétipo | Eixos temáticos | O que estão comprando |
|-----------|-----------------|----------------------|
| **AI Platform / LLMOps Engineer** | Avaliação, Observability, Confiabilidade, Pipelines | Alguém que coloca IA em produção com métricas |
| **Agentic Workflows / Automation** | HITL, Tooling, Orquestração, Multi-Agent | Alguém que constrói sistemas de agentes confiáveis |
| **Technical AI Product Manager** | GenAI/Agents, PRDs, Discovery, Delivery | Alguém que traduz negócios em produtos de IA |
| **AI Solutions Architect** | Hiperautomação, Enterprise, Integrações | Alguém que projeta arquiteturas de IA de ponta a ponta |
| **AI Forward Deployed Engineer** | Cliente-próximo, entrega rápida, Prototipagem | Alguém que implanta soluções de IA rapidamente no cliente |
| **AI Transformation Lead** | Gestão de mudança, Adoção, Enablement organizacional | Alguém que lidera transformação de IA em organizações |

<!-- [PERSONALIZAR] Adapte os arquétipos acima para suas vagas-alvo.
     Exemplo para engenharia backend:
     - Senior Backend Engineer
     - Staff Platform Engineer
     - Engineering Manager
     etc. -->

### Framing Adaptativo por Arquétipo

> **Métricas concretas: ler de `cv.md` e `article-digest.md` no momento da avaliação. NUNCA fazer hardcode aqui.**

| Se a vaga é... | Enfatizar no candidato... | Fontes de Proof Points |
|----------------|--------------------------|------------------------|
| Platform / LLMOps | Experiência em produção, Observability, Evals, Closed-Loop | article-digest.md + cv.md |
| Agentic / Automation | Orquestração multi-agent, HITL, Confiabilidade, Custos | article-digest.md + cv.md |
| Technical AI PM | Product Discovery, PRDs, Métricas, Gestão de stakeholders | cv.md + article-digest.md |
| Solutions Architect | Design de sistemas, Integrações, Enterprise-ready | article-digest.md + cv.md |
| Forward Deployed Engineer | Entrega rápida, próximo do cliente, Protótipo a produção | cv.md + article-digest.md |
| AI Transformation Lead | Gestão de mudança, Enablement de equipe, Adoção | cv.md + article-digest.md |

<!-- [PERSONALIZAR] Mapeie seus projetos/artigos concretos para os arquétipos acima -->

### Narrativa de Transição (usar em TODOS os framings)

<!-- [PERSONALIZAR] Substitua pela sua própria narrativa. Exemplos:
     - "Construí e vendi minha própria SaaS em 5 anos. Agora foco total em IA aplicada no Enterprise."
     - "Lead de engenharia em uma Series-B durante crescimento 10x. Buscando o próximo desafio."
     - "Transição de consultoria para produto. Buscando vagas com alta responsabilidade."
     Lido de config/profile.yml -> narrative.exit_story -->

Use a narrativa de transição de `config/profile.yml` para enquadrar TODO o conteúdo:
- **Em PDF Summaries:** Construir a ponte do passado para o futuro — "Aplico as mesmas [habilidades] agora em [domínio do JD]."
- **Em histórias STAR:** Referenciar proof points de `article-digest.md`.
- **Em respostas rascunho (Bloco G):** A narrativa de transição vai na primeira resposta.
- **Quando a vaga menciona "empreendedor", "ownership", "builder", "end-to-end":** Esse é o diferencial número 1. Aumentar peso de match.

### Vantagem Transversal

Enquadrar o perfil como **"Builder técnico com prática comprovada"**, adaptando o framing à vaga:
- Para PM: "Builder que reduz incerteza com protótipos e depois leva à produção com disciplina"
- Para FDE: "Builder que entrega desde o dia 1 com observability e métricas"
- Para SA: "Builder que projeta sistemas end-to-end com experiência real de integração"
- Para LLMOps: "Builder que coloca IA em produção com sistemas de qualidade closed-loop"

Posicionar "Builder" como sinal profissional — não como "hobbyista". Proof points reais tornam isso crível.

### Portfolio como Proof Point (usar em candidaturas de alto valor)

<!-- [PERSONALIZAR] Se você tem uma demo ao vivo, dashboard ou projeto público, configure aqui.
     Exemplo:
     dashboard:
       url: "https://seudominio.dev/demo"
       password: "demo-2026"
       when_to_share: "LLMOps, AI-Platform, vagas de Observability"
     Lido de config/profile.yml -> narrative.proof_points e narrative.dashboard -->

Quando o candidato tem uma demo ao vivo / dashboard (verificar `profile.yml`), oferecer acesso em candidaturas relevantes.

### Inteligência de Remuneração (Comp Intelligence)

<!-- [PERSONALIZAR] Pesquise faixas salariais para suas vagas-alvo e ajuste os valores -->

**Orientações gerais:**
- WebSearch para dados atuais de mercado (Glassdoor, Levels.fyi, Blind)
- Enquadrar por título da vaga, não por skills — títulos definem as faixas salariais
- Taxas de freelance geralmente ficam 30-60% acima da hora bruta de CLT (encargos, férias, FGTS, INSS, contador)
- Geo-arbitragem funciona em vagas remotas: custo de vida menor = melhor líquido

### Mercado Brasileiro -- Especificidades (IMPORTANTE)

Em vagas e negociações brasileiras, existem termos e práticas que não aparecem nos mercados EN/ES/DE. Eles DEVEM ser avaliados corretamente:

| Termo | Significado | Impacto na Avaliação |
|-------|-------------|----------------------|
| **CLT** (Consolidação das Leis do Trabalho) | Contrato formal com carteira assinada | Inclui FGTS, INSS, férias, 13º, aviso prévio. Na comparação, considerar o custo total empregador |
| **PJ** (Pessoa Jurídica) | Contratação como prestador de serviços (nota fiscal) | Valor mensal mais alto, mas sem benefícios CLT. Calcular equivalente CLT para comparação justa |
| **13º Salário** | Pagamento extra obrigatório para CLT | Comp CLT = salário x 13 (ou 13,33 com 1/3 de férias). NUNCA esquecer na comparação |
| **FGTS** (Fundo de Garantia) | 8% do salário depositado pelo empregador | Benefício CLT, não aparece no contra-cheque mas é remuneração real |
| **Vale-Refeição / Vale-Alimentação** | Benefício alimentação (iFood, Sodexo, Alelo) | Comum em vagas CLT, pode chegar a R$ 1.500+/mês. Incluir na comp total |
| **PLR** (Participação nos Lucros e Resultados) | Bônus atrelado a resultados da empresa | Pode ser 1-3 salários extras/ano. Variável — ponderar com cautela |
| **Stock Options / VSOP** | Equity em startups | Comum em startups brasileiras. Avaliar vesting, cliff e liquidez |
| **Período de Experiência** | 45+45 dias (CLT) ou conforme contrato (PJ) | Padrão de mercado, não é red flag |
| **Aviso Prévio** | 30 dias (CLT) + 3 dias por ano trabalhado | Planejar data de início conforme vínculo atual |
| **Plano de Saúde** | Benefício médico (Amil, SulAmérica, Bradesco Saúde) | Muito valorizado no Brasil. Sem plano = red flag em vagas CLT |
| **Cooperativa / MEI** | Formas alternativas de contratação | Avaliar com cautela — pode indicar precarização trabalhista |

### Scripts de Negociação

<!-- [PERSONALIZAR] Adapte para sua situação -->

**Pretensão salarial (framework geral):**
> "Com base em dados atuais de mercado para essa vaga, minha expectativa está na faixa de [FAIXA do profile.yml]. Tenho flexibilidade na estrutura — o que importa é o pacote total e a perspectiva de crescimento."

**Pushback contra desconto geográfico:**
> "As vagas em que estou concorrendo são orientadas a resultados, não a localização. Meu track record não muda com o CEP."

**Quando a oferta está abaixo do alvo:**
> "Estou comparando com ofertas na faixa de [faixa mais alta]. [Empresa] me atrai por [motivo]. É possível chegarmos em [valor-alvo] juntos?"

**CLT vs PJ:**
> "Para comparar de forma justa, preciso entender a composição completa: salário-base, 13º, férias, FGTS, vale-refeição, plano de saúde e PLR. Se for PJ, qual o valor mensal equivalente considerando esses itens?"

### Política de Localização (Location Policy)

<!-- [PERSONALIZAR] Adapte para sua situação. Lido de config/profile.yml -> location -->

**Em formulários:**
- Perguntas binárias "Você pode trabalhar presencialmente?": responder conforme disponibilidade real de `profile.yml`
- Em campos de texto livre: informar fuso horário e disponibilidade explicitamente

**Em avaliações (Scoring):**
- Dimensão remoto em híbrido fora do seu estado/país: Score **3.0** (não 1.0)
- Score 1.0 apenas se a vaga diz explicitamente "deve estar presencial 4-5 dias/semana, sem exceções"

### Prioridade Time-to-Offer
- Demo funcional + métricas > perfeição
- Aplicar mais rápido > aprender mais
- Abordagem 80/20, tudo com prazo definido

---

## Regras Globais

### NUNCA

1. Inventar experiência ou métricas
2. Modificar `cv.md` ou arquivos do portfolio
3. Enviar candidaturas em nome do candidato
4. Compartilhar número de telefone em mensagens geradas
5. Recomendar remuneração abaixo do mercado
6. Gerar PDF sem ter lido a descrição da vaga antes
7. Usar jargão corporativo ou "corporates"
8. Ignorar o tracker (toda vaga avaliada é registrada)

### SEMPRE

0. **Carta de apresentação:** Se o formulário permite anexar ou escrever uma carta, SEMPRE inclua uma. PDF no mesmo design visual do currículo. Conteúdo: citações da descrição da vaga mapeadas para proof points, links para case studies relevantes. Máximo 1 página.
1. Ler `cv.md`, `_profile.md` e `article-digest.md` (se existir) antes de avaliar qualquer vaga
1b. **Na primeira avaliação de cada sessão:** Executar `node cv-sync-check.mjs` via Bash. Se houver avisos, informar o candidato antes de continuar
2. Detectar o arquétipo da vaga e adaptar o framing conforme `_profile.md`
3. Ao fazer matching, citar linhas exatas do currículo
4. Usar WebSearch para dados de remuneração e empresa
5. Registrar no tracker após cada avaliação
6. Gerar conteúdo na língua da descrição da vaga (PT-BR padrão)
7. Ser direto e prático — sem enrolação
8. Ao gerar texto em português (PDF summaries, bullets, mensagens LinkedIn, histórias STAR): português tech natural, não tradução literal. Frases curtas, verbos de ação, evitar voz passiva. Termos técnicos (stack, pipeline, deployment, embedding) não precisam ser traduzidos
8b. **URLs de case studies no PDF Professional Summary:** Se o PDF menciona case studies ou demos, as URLs DEVEM aparecer já no primeiro parágrafo (Professional Summary). Recrutadores frequentemente só leem o resumo. Todos os URLs no HTML com `white-space: nowrap`
9. **Entradas no tracker como TSV** — NUNCA editar `applications.md` diretamente para novos registros. Escrever TSV em `batch/tracker-additions/`, `merge-tracker.mjs` cuida do merge
10. **Incluir `**URL:**` em todo header de report** — entre Score e PDF

### Tools

| Tool | Uso |
|------|-----|
| WebSearch | Pesquisa de remuneração, tendências, cultura da empresa, contatos LinkedIn, fallback para descrições de vagas |
| WebFetch | Fallback para extrair descrições de vagas de páginas estáticas |
| Playwright | Verificar se vagas ainda estão ativas (browser_navigate + browser_snapshot), extrair descrições de SPAs. **CRÍTICO: NUNCA iniciar 2+ agentes com Playwright em paralelo — eles compartilham a mesma instância do navegador** |
| Read | cv.md, _profile.md, article-digest.md, cv-template.html |
| Write | HTML temporário para PDF, reports .md, TSV em `batch/tracker-additions/` |
| Edit | Ajustes de conteúdo (não usar para criar novos registros no tracker) |
| Bash | `node generate-pdf.mjs`, `node merge-tracker.mjs` |
