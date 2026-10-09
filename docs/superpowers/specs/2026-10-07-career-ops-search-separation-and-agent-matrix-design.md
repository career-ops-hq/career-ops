# Career Ops: separação das pesquisas e matriz de agentes

**Estado:** desenho e documento aprovados; plano de implementação preparado para revisão
**Data:** 2026-10-07

## Objetivo

Tornar a pesquisa do Career Ops previsível em dois percursos independentes: emprego e freelance. Um percurso não pode herdar funções, exclusões, localização ou palavras do outro. Quando uma pesquisa direta termina corretamente sem resultados, a aplicação pode preparar uma pesquisa assistida mais ampla, mas nunca deve gastar tokens sem uma confirmação explícita.

A mesma entrega deve tornar possível comparar Claude Code, Codex, Gemini CLI e Cursor Agent com a mesma consulta, dentro de uma raiz sintética e sem candidaturas, mensagens ou escritas nos dados reais.

## Resultado esperado

- Emprego e Freelance conservam filtros independentes durante a sessão.
- O primeiro acesso a Freelance começa global e vazio: sem funções, exclusões, localizações ou mercados inventados.
- Regressar a cada percurso restaura exatamente os filtros que lhe pertencem.
- Um Freelance vazio não volta a importar funções do perfil nem de `portals.yml`, incluindo em pesquisas agendadas.
- A URL e uma pesquisa guardada continuam a representar apenas a pesquisa ativa.
- Um zero saudável pode preparar uma pesquisa assistida com uma descrição derivada dos filtros.
- Preparar a pesquisa não executa o agente; o utilizador confirma no botão que identifica o uso de tokens.
- Falha, timeout, cobertura parcial ou fonte incompleta nunca são apresentados como zero saudável.
- Os quatro agentes só são ensaiados quando o respetivo percurso for comprovadamente read-only.

## Estado atual confirmado

Existe um único objeto `ExploreFilters` no `ExploreProvider`. O seletor Emprego/Freelance altera apenas `opportunityType`, pelo que os restantes campos atravessam de um percurso para o outro.

Há ainda duas fugas fora da interface:

1. `runMarketDiscovery` usa as funções-alvo do perfil quando `positive` está vazio, mesmo em Freelance.
2. O runner de pesquisas agendadas usa `portals.yml.title_filter.positive` como fallback, também em Freelance.

As pesquisas diretas já distinguem execução saudável, parcial e falhada. A pesquisa assistida já usa o modo canónico `modes/web-search.md`, a memória, a deduplicação e o agente guardado nas Definições.

Claude Code, Codex, Gemini CLI e Cursor Agent estão instalados e autenticados. Claude, Codex e Cursor têm mecanismos read-only verificáveis no percurso atual. Gemini ainda não tem fencing verificado e usa a raiz real como diretório de trabalho; não pode ser submetido ao ensaio real enquanto isso não for corrigido.

## Decisões

### 1. Dois snapshots, um filtro ativo

O provider mantém dois snapshots em memória, indexados por `employment` e `freelance`. O resto da interface continua a consumir um único `filters`, correspondente ao percurso ativo.

Ao mudar de percurso:

1. o estado atual é guardado no snapshot do tipo de origem;
2. o snapshot do destino é restaurado;
3. se o destino ainda não existir, é criado a partir das predefinições do respetivo tipo.

O primeiro snapshot de Emprego mantém o seed atual, proveniente do perfil, configuração ou URL. O primeiro snapshot de Freelance usa os limites técnicos comuns, mas começa sem palavras positivas, palavras negativas, localização ou mercados. Os ATS podem conservar a predefinição interna porque o backend já os impede em Freelance; não são apresentados como fontes executadas nesse percurso.

Os snapshots vivem apenas na sessão do provider. Não se cria uma segunda base de dados, ficheiro de configuração ou formato persistente. A URL, a gravação de pesquisas e o scheduler continuam a receber o filtro ativo completo.

### 2. Mudanças de tipo vindas do assistente

Uma alteração do assistente que inclua `opportunityType` é aplicada sobre o snapshot do tipo de destino, não sobre o snapshot atualmente visível. Os restantes patches continuam a seguir as regras atuais de substituir ou fundir listas.

Esta regra evita que um comando como «procura trabalho freelance de Flutter» transporte silenciosamente as exclusões ou a localização de Emprego.

### 3. Fallbacks de perfil apenas em Emprego

As funções do perfil e `portals.yml.title_filter.positive` continuam a preencher pesquisas de Emprego vazias. Em Freelance, vazio significa vazio.

Esta regra aplica-se em dois pontos:

- pesquisa manual através de `runMarketDiscovery`;
- overlay temporário criado pelo runner de pesquisas guardadas.

Não se altera o contrato do `buildMarketPlan`: continua a receber explicitamente os termos que deve usar. A correção acontece nos chamadores que hoje escolhem o fallback errado.

### 4. Pesquisa assistida depois de um zero saudável

Os estados `empty-current` e `empty-loose` ganham uma ação secundária para preparar a pesquisa assistida. A ação:

1. transforma os filtros ativos numa frase curta em português de Portugal;
2. muda para o modo Pesquisa assistida;
3. preenche a caixa de intenção;
4. não chama `discoverAI`.

A execução continua dependente do botão «Pesquisar na web», que identifica o agente escolhido e o uso de tokens. Se não existir um agente configurado, a aplicação encaminha para Definições como já acontece.

Estados `degraded` e `failed` não oferecem este fallback como se a pesquisa tivesse acabado corretamente. Mantêm repetição e diagnóstico da fonte.

A descrição preparada inclui apenas informação realmente presente: tipo de oportunidade, funções, exclusões, período, localização e mercados. Não inventa senioridade, salário, regime remoto ou país.

### 5. Fontes e âmbito

Não serão acrescentados scrapers nesta entrega.

Jobicy, Remote OK, We Work Remotely e Remotive já fazem parte da engenharia de remoto do projeto. A pesquisa direta de Freelance continua a usar o Welcome to the Jungle com `contract_type:freelance`.

Contra, Wellfound, Malt, PeoplePerHour, IEFP, BEP e os portais nacionais sem API de leitura comprovada ficam disponíveis apenas através de pesquisa assistida ou abertura manual. O agente deve privilegiar a página original e nunca contornar autenticação, `robots.txt`, termos ou proteção anti-bot.

Freelancer.com e Upwork só podem ser providers diretos num trabalho posterior, depois de existirem credenciais e autorização oficial para o caso de uso. We Work Remotely e Remotive só justificam novas regras específicas se um ensaio de deduplicação demonstrar ganho real sobre os providers já ativos.

### 6. Segurança dos quatro agentes

Antes do ensaio real, a rota da pesquisa assistida recebe testes de integração com executáveis simulados para Claude, Codex, Gemini e Cursor. Os testes confirmam argv, isolamento, streaming, resultado não-zero, timeout e ausência de escrita.

Todos os agentes devem correr num diretório temporário, não na raiz real de dados. O prompt continua a transportar apenas o contexto necessário. A limpeza do diretório temporário ocorre em sucesso, erro, cancelamento e timeout.

Para Gemini, a execução real fica bloqueada até existir um modo de aprovação sem escrita e uma forma verificável de desativar hooks ou ferramentas mutáveis. Se a versão instalada não suportar esse contrato, a interface deve explicar que o agente está instalado mas não é seguro para esta operação. Não se baixa o nível de proteção para completar a matriz.

Claude, Codex e Cursor conservam o fencing existente; os testes devem provar que alterações posteriores não o removem. A deteção de instalação não é tratada como prova de autenticação: uma sessão expirada deve produzir um erro acionável do agente.

### 7. Matriz de comparação

Depois dos testes simulados e do hardening, os quatro agentes recebem sequencialmente a mesma consulta:

> Encontra até cinco oportunidades freelance atuais para websites, aplicações, chatbots ou automação com IA; Portugal, Espanha, Reino Unido, Suíça, Luxemburgo, Países Baixos ou remoto Europa; só URLs públicas concretas; não guardar nem candidatar.

O ensaio usa uma raiz de dados sintética e não seleciona, guarda, avalia ou envia nenhuma oportunidade. Regista, quando o CLI realmente fornecer:

- sucesso ou erro e código de saída;
- duração;
- envelopes válidos;
- resultados únicos;
- completude de URL, título, empresa e localização;
- disponibilidade HTTP através do verificador existente;
- tokens e custo reportado.

Campos não fornecidos são marcados como «não disponível». Nunca se converte ausência de telemetria em custo zero.

Durante a matriz, o agente pedido tem de ser o agente executado. O fallback automático para outro CLI continua útil no produto normal, mas é recusado pelo harness de comparação porque tornaria os resultados atribuídos ao agente errado.

### 8. Telemetria mínima da rota

A rota deve distinguir fecho limpo de saída não-zero para todos os CLIs. O produto não precisa de um sistema analítico novo. O relatório do ensaio pode recolher duração e telemetria estruturada num harness local em `work/`, enquanto a interface continua a mostrar apenas informação que consegue confirmar.

Não se cria uma base de dados de custos nem um dashboard novo nesta entrega.

## Fluxo de dados

1. O seed inicial cria o snapshot de Emprego ou restaura o filtro codificado na URL.
2. O utilizador altera apenas o snapshot ativo.
3. A mudança Emprego/Freelance guarda a origem e restaura o destino.
4. A pesquisa direta envia apenas o filtro ativo para `/api/explore`.
5. O core remove ATS de Freelance e escolhe termos sem fallback de emprego.
6. Uma conclusão saudável com zero permite preparar a intenção assistida.
7. O utilizador confirma «Pesquisar na web»; a rota resolve o agente, aplica isolamento e transmite resultados.
8. Guardar continua a ser uma ação separada e explícita.

## Erros e recuperação

- Um snapshot ausente é criado com as predefinições do seu tipo.
- Uma URL inválida continua a ser normalizada pelas funções existentes.
- Uma pesquisa direta parcial mantém resultados e identifica fontes incompletas.
- Uma pesquisa direta sem fonte válida termina como falhada ou degradada, nunca como zero saudável.
- Uma sessão de agente expirada produz erro de autenticação; não muda silenciosamente para outro agente quando isso esconder o problema da matriz.
- Um CLI sem fencing adequado é recusado antes de receber o prompt.
- Cancelamento e timeout terminam apenas o processo criado pela rota e removem o diretório temporário.
- A app instalada permanece ativa durante a preparação; só é substituída depois de build e testes completos.

## Verificação

### Testes determinísticos

- Emprego com funções de farmácia, `iOS` excluído e Lisboa abre Freelance vazio.
- Configurar Freelance, regressar a Emprego e voltar restaura os dois snapshots.
- Um patch que muda `opportunityType` usa o snapshot de destino.
- O round-trip da URL conserva apenas o filtro ativo.
- Freelance vazio não usa as funções do perfil na pesquisa manual.
- Freelance vazio agendado não herda `title_filter.positive` de `portals.yml`.
- Uma pesquisa guardada Freelance continua sem ATS e com `contract_type:freelance`.
- O gerador de intenção não inventa valores ausentes.
- O fallback assistido só aparece em zeros saudáveis e não executa o agente.
- Quatro CLIs simulados confirmam argv, fencing, isolamento, streaming, erro e timeout.

### Ensaio operacional

- Suite web, typecheck, build e gate integral da raiz passam.
- Uma build de produção isolada usa dados sintéticos.
- Emprego e Freelance são alternados e restaurados na interface.
- Uma pesquisa direta real é validada com pelo menos um zero saudável e um resultado, quando as fontes públicas o permitirem.
- O fallback prepara a intenção e permanece parado até confirmação.
- A matriz real corre sequencialmente apenas nos agentes cujo fencing passou.
- URLs candidatas são verificadas sem guardar, avaliar ou candidatar.
- A aplicação macOS é reconstruída, assinada ad-hoc, instalada e aberta; a versão anterior só é terminada no momento da troca.

## Fora do âmbito

- Submissão automática de candidaturas ou mensagens.
- Scraping de portais sem API ou autorização comprovada.
- Credenciais novas de Freelancer.com ou Upwork.
- Base de dados de custos ou observabilidade permanente.
- Instalação do Playwright MCP para Claude, por não ser necessária ao motor de pesquisa.
- Personalização automática de `modes/_brief.md`; esse conteúdo exige factos pessoais aprovados pelo utilizador.

## Critérios de aceitação

1. Nenhum filtro de Emprego influencia Freelance, nem o inverso.
2. Freelance vazio mantém queries vazias na execução manual e agendada.
3. Alternar entre os dois percursos não perde o trabalho do utilizador.
4. A pesquisa assistida após zero exige uma confirmação que mostra consumo de tokens.
5. Erros ou cobertura incompleta nunca são apresentados como ausência de ofertas.
6. Nenhum agente pode escrever no checkout ou nos dados durante a pesquisa assistida.
7. A matriz usa a mesma consulta e distingue dados medidos de dados indisponíveis.
8. Nenhuma fonte nova entra por scraping ou por acesso não autorizado.
9. Os testes completos e o fluxo real da aplicação instalada passam antes da entrega.
