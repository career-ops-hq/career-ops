# Career Ops: recuperação profissional, ranking e cobertura verificável

**Estado:** desenho aprovado por instrução explícita para execução contínua
**Data:** 2026-10-08

## Objetivo

Fazer com que a pesquisa direta do Career Ops encontre oportunidades reais para a profissão e o mercado pedidos, explique por que razão cada resultado é próximo e distinga ausência de resultados de ausência de cobertura. A pesquisa direta continua local, determinística e sem tokens. Uma pesquisa com agente continua a exigir confirmação explícita.

O primeiro caso de aceitação usa as funções Técnico Auxiliar de Farmácia, Ajudante de Farmácia, Assistente de Vendas, Operador de Loja, Sales Assistant e loja de roupa em Lisboa. A arquitetura não fica presa a esse caso: os conceitos profissionais, localizações e fontes são dados pequenos e auditáveis, separados do motor de pesquisa.

## Resultado observável

- Uma função escrita numa das línguas suportadas encontra títulos equivalentes nas restantes línguas relevantes para o mercado.
- Formas como `Operador/a`, `Operador(a)` e diferenças de acentos não impedem correspondências legítimas.
- `Lisboa` reconhece `Lisbon` como a mesma cidade; a expansão para a área metropolitana só acontece na fase Alargada e fica visível.
- Uma pesquisa Precisa que termine saudável com zero executa automaticamente uma única pesquisa Alargada, também sem tokens.
- A fase Alargada pode usar equivalentes profissionais, traduções, área metropolitana e até 30 dias, mas mostra um recibo exato de tudo o que mudou.
- Se a fase Alargada continuar sem resultados, a aplicação oferece a pesquisa assistida já existente, sem a executar automaticamente.
- Os resultados aparecem por Proximidade por defeito e explicam função, localização, atualidade e qualidade da evidência.
- O relatório de cobertura mostra fontes concluídas, parciais e falhadas, empresas percorridas, limites e motivos de descarte sem afirmar uma percentagem de mercado desconhecida.
- Salário, contrato, horário, prazo e número de vagas só aparecem quando a fonte os fornece explicitamente.
- Emprego e Freelance mantêm filtros e resultados independentes.

## Evidência que orienta o desenho

O zero atual é produzido por quatro barreiras acumuladas. O filtro de títulos usa correspondência textual e não conhece profissões equivalentes. O filtro `Lisboa` rejeita `Lisbon` e municípios vizinhos. O scanner ATS percorre um prefixo fixo de 150 empresas por plataforma, num universo de 28 746. Por fim, o parser Workday reconhece datas relativas em inglês mas não `Publicado hoje`, fazendo vagas portuguesas recentes parecerem sem data.

Uma consulta pública ao Workday da Auchan devolveu 228 vagas e títulos atuais de operador de loja, mas o provider do projeto produziu zero datas na primeira página. A Auchan também fica fora do prefixo fixo do Workday. A Primark publica funções de retalho em Lisboa num site Radancy, tecnologia que já tem provider no projeto, mas o seu `robots.txt` desautoriza o caminho `/search-jobs/` necessário ao provider; fica explicitamente excluída. Portanto, a primeira correção deve reutilizar apenas fontes permitidas e selecionar melhor as fontes; um scraper novo não é a condição para resolver o problema.

## Decisões de produto

### 1. Escada de pesquisa

Cada ação do utilizador começa em `precise`. Esta fase preserva a janela e a geografia pedidas, mas aplica normalizações que não mudam a intenção: acentos, maiúsculas, grafias de género e nomes equivalentes da mesma cidade.

Se todas as fontes aplicáveis terminarem de forma saudável e não houver resultados, o servidor executa uma vez `broad`. Esta fase:

- expande a profissão para aliases aprovados e traduções das línguas do mercado;
- inclui a área metropolitana quando a localização pedida tem uma definição local conhecida;
- aumenta a janela para 30 dias quando a original é menor;
- ativa fontes dirigidas do mercado e setor que não tenham sido usadas na fase precisa.

O recibo `expansion` enumera cada alteração. A fase não usa LLM, não inventa uma função adjacente e não se repete recursivamente. Falha, timeout ou cobertura parcial não acionam a expansão como se fossem um zero saudável.

### 2. Conceitos profissionais locais e auditáveis

O motor recebe um catálogo local pequeno, versionado e inspirado nos conceitos e termos preferidos/não preferidos do ESCO. Cada conceito contém:

- identificador estável;
- termos preferidos e aliases por língua;
- formas que podem ser usadas em queries;
- tokens distintivos obrigatórios para reduzir falsos positivos;
- grupos de mercado onde a tradução é relevante.

A primeira entrega inclui os conceitos necessários para farmácia auxiliar, assistência de vendas, operação de loja/retalho, desenvolvimento web/aplicações, chatbots e automação com IA. Acrescentar um conceito não requer alterar providers.

Não se descarrega a base ESCO completa nem se chama a API ESCO em cada pesquisa. Isso aumentaria a instalação e tornaria a pesquisa local dependente de outro serviço. Uma importação ESCO completa só será justificada quando o catálogo manual deixar de cobrir profissões reais observadas.

O texto original do utilizador permanece visível. O resultado guarda o conceito e o alias que justificaram a correspondência.

### 3. Geografia explícita

A geografia usa conceitos locais separados dos conceitos profissionais. `Lisboa`, `Lisbon` e `Lisbonne` representam a mesma cidade. A Área Metropolitana de Lisboa inclui apenas municípios enumerados no catálogo e só é ativada em `broad`.

Não se introduz geocodificação nem distância quilométrica nesta entrega. “Proximidade” significa proximidade aos critérios, e o cartão explica se a correspondência é cidade, área metropolitana, país ou remoto.

O catálogo inicial cobre Portugal, Espanha, Reino Unido, Suíça, Luxemburgo e Países Baixos nas línguas necessárias. Localizações desconhecidas continuam a usar o filtro textual atual; nunca são silenciosamente convertidas numa região maior.

### 4. Cobertura dirigida antes da amostra geral

O plano de mercado ganha `priorityCompanies`: entradas públicas conhecidas e verificadas, associadas a mercado e etiquetas de setor. Essas empresas correm pelo caminho efémero de `job_boards`, fora da amostra geral de cada ATS e sem contar para o respetivo limite. O scanner mantém o limite existente para o restante universo; não tenta percorrer dezenas de milhares de tenants por pesquisa.

O primeiro pacote inclui apenas empregadores cujo probe e `robots.txt` confirmem compatibilidade. A Auchan Portugal usa o provider Workday existente e é a primeira fonte dirigida. A Primark não entra porque o caminho exigido pelo provider Radancy está desautorizado. Portugal, Espanha, Reino Unido, Suíça, Luxemburgo e Países Baixos continuam a usar as fontes de mercado atuais; novos empregadores entram um a um depois da mesma validação, nunca apenas para preencher uma lista. Uma fonte que falhe validação fica documentada como cobertura em falta.

As fontes generalistas sem API pública, autorização clara ou leitura estável continuam na pesquisa assistida. LinkedIn, Indeed e portais autenticados não são raspados diretamente.

### 5. Ranking determinístico e explicável

O ranking é calculado depois da junção e deduplicação, sobre resultados já elegíveis. Não usa o agente e não substitui a avaliação A–F do perfil.

Pontuação total de 0 a 100:

- função: 0–60;
- localização: 0–25;
- atualidade: 0–10;
- evidência e completude: 0–5.

Correspondência pelo termo original vale mais do que alias do mesmo conceito. Uma profissão apenas adjacente não entra nesta versão. Cidade vale mais do que área metropolitana, que vale mais do que país/remoto quando estes forem aceites. Resultados sem data podem aparecer apenas quando a política da fonte os permite e não recebem pontos de atualidade.

Cada resultado guarda `match.total`, os quatro componentes e `reasons`. A ordenação predefinida passa a `match`; `recent` e `company` continuam disponíveis. Empates usam data descendente, empresa e URL para estabilidade.

`fit` mantém o significado de compatibilidade com o perfil. A palavra `assistant` deixa de ser removida genericamente na análise de senioridade porque pode ser parte essencial da profissão.

### 6. Métricas com proveniência

O contrato de oportunidade aceita campos opcionais:

- `contractType`;
- `hours`;
- `applicationDeadline`;
- `vacancyCount`;
- `observedAt`;
- `availabilityEvidence`: `feed-seen`, `confirmed-active` ou `unconfirmed`;
- `match`;
- `expansion` ao nível da execução.

Providers apenas passam valores publicados pela fonte. `vacancyCount` nunca é inferido do número de anúncios, requisition ID ou texto ambíguo. `observedAt` indica quando o Career Ops consultou a fonte, não quando a vaga foi publicada.

O verificador de liveness não corre sobre milhares de resultados. Confirma os resultados prioritários quando são guardados ou avaliados, reutilizando a infraestrutura existente.

### 7. Cobertura e diagnóstico visíveis

O estado já recolhe fontes, empresas percorridas, limites, ofertas sem data e falhas. A interface conserva esta informação depois da conclusão e apresenta:

- fase usada (`Precisa` ou `Alargada`);
- alterações do alargamento;
- anúncios devolvidos por fonte;
- estado concluído, parcial ou falhado;
- empresas percorridas e disponíveis quando conhecidos;
- contagem por motivo de descarte quando o scanner a fornecer.

Nunca apresenta “cobertura de X% do mercado” sem denominador verificável.

## Scrapling

Scrapling não entra no núcleo nem nesta implementação. O projeto já possui HTTP seguro, Playwright, parsers e uma camada de providers em Node. Instalar Scrapling agora introduziria um runtime Python e duplicaria transporte sem resolver taxonomia, geografia ou ranking.

Pode existir mais tarde como worker opcional de um único provider quando uma fonte pública aprovada não tiver API, o parser Node for comprovadamente frágil e a recuperação adaptativa de seletores mostrar ganho num spike. Esse worker terá os mesmos limites: sem login, sem CAPTCHA, sem evasão de Cloudflare, sem proxies de rotação, com `robots.txt`, pacing, timeout, SSRF guard e testes de fixtures. O modo Stealthy não é permitido.

Fora do Career Ops, a mesma ferramenta pode servir monitorização de páginas públicas de vendas, concursos, sinais de contratação e alterações de catálogo, mas cada caso exige fonte e finalidade definidas.

## Fluxo de dados

1. O utilizador envia filtros e `opportunityType`.
2. O normalizador resolve conceitos profissionais e aliases da mesma cidade.
3. `runDiscovery` executa o plano `precise` sobre ATS, mercados e empresas prioritárias.
4. Os resultados passam pelos filtros de elegibilidade, são deduplicados e recebem `match`.
5. Um zero saudável cria e executa uma única variante `broad`.
6. A resposta devolve ofertas, estados das fontes, recibo de expansão e contagens de descarte.
7. A interface ordena por `match`, mostra razões, métricas confirmadas e cobertura.
8. Um segundo zero oferece preparar pesquisa assistida. O agente só corre depois do botão explícito com aviso de tokens.

## Erros e recuperação

- Catálogo sem conceito: pesquisa literal normalizada; não inventa aliases.
- Localização sem conceito: filtro textual atual; não expande região.
- Fonte prioritária falhada: estado parcial/falhado visível; resultados das restantes fontes permanecem.
- Resultado sem data por parser localizado desconhecido: contabilizado como `droppedNoDate`; não convertido em data atual.
- Zero com qualquer fonte incompleta: não dispara automaticamente a fase Alargada como prova de ausência.
- Alias demasiado amplo: exige token distintivo ou correspondência de frase; os testes de corpus fixam falsos positivos conhecidos.
- Dados opcionais inválidos: são omitidos no boundary do provider em vez de inferidos.

## Verificação

### Testes determinísticos

- `Operador de Loja` corresponde a `Operador/a de loja` e `Retail Assistant`, mas não a um título apenas com a palavra `operator`.
- `Assistente de Vendas` e `Sales Assistant` partilham conceito sem remover `assistant`.
- `Técnico Auxiliar de Farmácia` encontra aliases PT, ES e EN e não encontra farmacêutico responsável.
- `Lisboa` precisa aceita `Lisbon`; a fase alargada aceita Amadora, Sintra, Oeiras e Cascais e explica a expansão.
- `Publicado hoje`, `Publicado ontem` e `Publicado há N dias` produzem datas Workday válidas; texto desconhecido permanece sem data.
- Empresas prioritárias são pesquisadas antes da amostra e deduplicadas.
- Zero saudável executa uma única expansão; parcial/falhado não expande.
- Ranking usa a pesquisa ativa, abrange ATS e mercados, é estável e explica componentes.
- `vacancyCount` e restantes métricas só sobrevivem quando fornecidos e válidos.
- Resultados e filtros continuam isolados entre Emprego e Freelance.

### Ensaio real e nativo

- Suite da raiz, suite web, typecheck e build de produção passam.
- Probes públicos confirmam pelo menos uma fonte relevante de retalho em Portugal e registam limitações das restantes.
- Uma pesquisa real para retalho/farmácia em Lisboa encontra pelo menos uma oferta concreta ou apresenta cobertura incompleta/falha honesta; nunca um zero falso.
- Uma pesquisa remota de websites, aplicações, chatbots ou automação com IA valida o percurso internacional.
- Alternar Emprego/Freelance conserva filtros e resultados independentes.
- A fase Alargada mostra o recibo e a pesquisa assistida permanece parada até confirmação.
- A aplicação macOS é reconstruída, assinada, instalada e validada no fluxo real sem desligar o servidor atual antes de existir substituição verificada.

## Fora do âmbito

- Candidaturas, mensagens ou submissões automáticas.
- Geocodificação e distância quilométrica.
- Importação completa do ESCO.
- Percentagem estimada do mercado total.
- Scraping de LinkedIn, Indeed ou áreas autenticadas.
- Integração de Scrapling sem uma fonte concreta aprovada.
- Inferência de salário, contrato, horário, prazo ou número de vagas.

## Critérios de aceitação

1. O caso Lisboa/retalho/farmácia deixa de depender de títulos literais e do prefixo ATS fixo.
2. Um resultado apresenta pontuação e razões reproduzíveis relativamente à pesquisa ativa.
3. A fase Alargada é automática, única, sem tokens e totalmente explicada.
4. A pesquisa assistida continua dependente de confirmação explícita.
5. Cobertura parcial ou falhada nunca é mostrada como ausência comprovada de vagas.
6. Métricas opcionais têm proveniência e nunca são inferidas.
7. Os países pedidos têm catálogo geográfico e uma estratégia de fontes explícita, mesmo quando uma fonte concreta fica documentada como indisponível.
8. Scrapling não aumenta a superfície de segurança nem as dependências desta entrega.
9. Testes completos, build e fluxo nativo passam antes da conclusão.
