# Career Ops para macOS e pesquisa por mercados

**Estado:** desenho aprovado em conversa; aguarda revisão do documento antes do plano de implementação
**Data:** 2026-10-06

## Objetivo

Transformar a versão local do Career Ops numa aplicação para macOS que abre pelo Finder ou pela Dock, sem exigir Terminal nem a introdução manual de um endereço `localhost`.

Na mesma entrega, alargar a descoberta de ofertas aos mercados onde Hamilton procura trabalho: Portugal, Espanha, Europa e trabalho remoto internacional, com foco inicial em tecnologia, produto, criatividade, marketing e operações digitais.

## Resultado esperado

- Um ícone `Career Ops.app` abre uma janela própria e apresenta a aplicação em português de Portugal.
- A aplicação inicia e encerra o serviço web local que lhe pertence.
- O endereço e a porta ficam escondidos do utilizador; não é necessário manter um terminal aberto.
- Os dados continuam guardados no diretório Career Ops existente.
- A área **Procurar ofertas** permite escolher mercados, além dos sistemas ATS já disponíveis.
- Uma pesquisa pode devolver resultados parciais quando uma fonte falha, identificando a fonte que não respondeu.
- Cada oferta mantém origem, localização e data conhecida. O resumo identifica se cada fonte terminou, falhou ou devolveu resultados incompletos.

## Estado atual confirmado

- A aplicação web local funciona em Next.js e usa rotas de servidor para ler ficheiros, executar scanners e comunicar com CLIs de IA.
- O Explorador já executa `scan-ats-full.mjs` para Greenhouse, Lever, Ashby e Workday.
- O núcleo já contém um segundo motor, `scan.mjs`, e um catálogo extenso de providers. Entre os providers já existentes estão Landing.jobs, getManfred, Welcome to the Jungle, RemoteOK, Remotive, Himalayas, Jobicy, Jobspresso, Working Nomads e We Work Remotely.
- O `scan.mjs --dry-run --json` já faz a descoberta sem escrever nos ficheiros do utilizador. O recibo atual contém contagens, erros e URLs, mas não contém os restantes campos de cada oferta.
- O servidor deixou de estar disponível porque o processo que escutava a porta terminou; não foi encontrada uma falha funcional da aplicação. A versão PT-PT foi reposta em `127.0.0.1:3427`.

## Decisões

### 1. Aplicação nativa fina

A primeira versão será uma aplicação macOS pequena, escrita com Swift, AppKit e WebKit. Usa componentes do próprio sistema e não acrescenta Electron, Chromium, Tauri ou outra framework.

A aplicação nativa tem quatro responsabilidades:

1. localizar o projeto e o diretório de dados configurados;
2. iniciar uma única instância do servidor Next em `127.0.0.1` numa porta livre;
3. esperar até a aplicação responder e carregá-la numa `WKWebView`;
4. terminar apenas o processo que iniciou quando a aplicação fecha.

O servidor local continua a existir como detalhe interno porque as rotas Next executam Node, acedem ao sistema de ficheiros e lançam os scanners. Removê-lo implicaria reescrever a aplicação e o núcleo. Para o utilizador, a experiência é a de uma aplicação normal: ícone, janela e arranque automático.

### 2. Fronteira da primeira versão

Esta é uma instalação local para este Mac, não um produto distribuível para terceiros. A aplicação usa o Node e o checkout Career Ops já instalados. Guarda os caminhos nas preferências locais e apresenta um erro acionável se o executável, o build ou o diretório de dados deixarem de existir.

Não serão incluídos nesta fase:

- assinatura e notarização Apple;
- atualizador automático;
- Node e `node_modules` dentro do pacote `.app`;
- instalador para outros computadores;
- execução permanente em segundo plano depois de fechar a aplicação.

Estas partes só se justificam quando houver necessidade de distribuir o Career Ops para outro Mac.

### 3. Uma janela e uma instância

- Um segundo clique no ícone traz a janela existente para a frente.
- A app liga o serviço apenas a `127.0.0.1`; não o expõe na rede local.
- A porta é escolhida pelo sistema no arranque. A app lê o endereço anunciado pelo servidor e só abre a interface depois de receber uma resposta HTTP válida.
- Se o serviço falhar, a janela mostra o erro e permite tentar novamente ou abrir o registo local.
- Ao fechar, a app envia primeiro um encerramento normal e o launcher escala para terminação forçada apenas sobre o seu filho se este não responder dentro do limite definido.
- A app nunca encerra processos apenas porque ocupam uma porta. Só termina o processo filho cujo identificador guardou.

## Pesquisa por mercados

### 1. Conceito de mercado

Os quatro ATS atuais continuam disponíveis. Acima deles, o Explorador passa a ter seleções de mercado:

- **Portugal**
- **Espanha**
- **Europa**
- **Remoto internacional**

Uma seleção de mercado define fontes e regras geográficas. Não afirma que todas as ofertas de uma fonte aceitam candidatos nesse mercado. Quando a elegibilidade não estiver explícita, a interface mostra-a como desconhecida em vez de presumir que a vaga é mundial.

As seleções podem ser combinadas. A pesquisa continua a usar as palavras, exclusões, antiguidade e limite definidos pelo utilizador.

As regras geográficas são deliberadamente conservadoras:

- **Portugal** exige uma referência inequívoca a Portugal ou uma localização portuguesa normalizada;
- **Espanha** exige uma referência inequívoca a Espanha ou uma localização espanhola normalizada;
- **Europa** inclui União Europeia, Espaço Económico Europeu, Reino Unido e Suíça;
- **Remoto internacional** exige que a fonte seja integralmente remota ou que a oferta indique trabalho remoto; isso não prova que aceite candidatos de qualquer país.

Numa pesquisa limitada por mercado, uma oferta sem localização utilizável não atravessa silenciosamente o filtro. É excluída e entra na contagem `localização não indicada`. Quando o utilizador combina mercados, as regras funcionam como alternativas: uma oferta que corresponda a qualquer seleção pode entrar.

### 2. Fontes da primeira entrega

| Mercado | Fontes iniciais |
| --- | --- |
| Portugal | Landing.jobs; resultados europeus e remotos dos ATS selecionados |
| Espanha | getManfred em espanhol e inglês; resultados espanhóis dos ATS selecionados |
| Europa | Welcome to the Jungle; Landing.jobs; getManfred; resultados europeus dos ATS selecionados |
| Remoto internacional | RemoteOK; Remotive; Himalayas; Jobicy; Jobspresso; Working Nomads; We Work Remotely |

Welcome to the Jungle exige termos de pesquisa. Esses termos são derivados das palavras positivas já introduzidas no Explorador e, se estas estiverem vazias, das funções-alvo do perfil. Se ambos estiverem vazios, essa fonte não é executada e a interface pede uma função-alvo; não é criado um segundo campo com a mesma função.

### 3. Fontes a acrescentar depois da primeira entrega

Net-Empregos e ITJobs serão os primeiros providers novos a investigar para Portugal. Só entram no produto depois de um ensaio isolado confirmar:

- acesso público sem conta;
- compatibilidade com `robots.txt` e termos aplicáveis;
- paginação estável;
- título, empresa, URL e localização suficientemente fiáveis;
- falha explícita quando o HTML ou a API mudam.

InfoJobs fica preparado como possibilidade, mas desativado até existirem credenciais oficiais e condições de utilização compatíveis. IEFP, EURES, Empléate e Tecnoempleo ficam fora da primeira entrega e são avaliados um a um; não haverá contorno de autenticação, bloqueios ou proteção anti-bot.

## Integração com a engenharia existente

### 1. Dois scanners, um resultado

O percurso ATS atual permanece intacto. A pesquisa de mercado corre em paralelo lógico através de `scan.mjs` e da registry de providers existente.

Para tornar o resultado consumível pela interface, o recibo `careerops.scan.receipt@1` passa a incluir um campo opcional `offers` com os dados normalizados que o motor já mantém em memória:

- `company`
- `title`
- `location`
- `postedAt`
- `url`
- `source`
- `salary`, quando a fonte a fornecer no formato normalizado atual

Adicionar um campo opcional mantém compatibilidade com consumidores atuais. O modo continua a ser `--dry-run`: pesquisar não altera `pipeline.md`, histórico, candidaturas nem configuração permanente.

### 2. Configuração efémera

O Explorador já cria um `portals.yml` temporário para os filtros. Esse ficheiro passa também a receber apenas as entradas `job_boards` correspondentes aos mercados selecionados. O scanner recebe o caminho por `CAREER_OPS_PORTALS` e o ficheiro é removido no fim.

O `portals.yml` real do utilizador não é alterado por uma pesquisa manual.

### 3. Normalização e deduplicação

Os resultados ATS e de portais são convertidos no tipo `DiscoveredOffer` já usado pela interface. A junção reutiliza a normalização de URL e as regras de deduplicação existentes.

Quando a mesma vaga aparece em várias fontes:

1. mantém-se preferencialmente o URL direto do empregador ou ATS;
2. conserva-se a lista de origens para transparência;
3. os campos não vazios mais específicos completam o registo, sem inventar dados;
4. a oferta aparece uma única vez na lista.

Adicionar ao pipeline continua a exigir uma ação explícita do utilizador e usa o escritor canónico existente.

## Interface

- O seletor de mercado aparece junto dos filtros do Explorador e não como uma nova página.
- ATS e mercados têm nomes diferentes: um é tecnologia de recrutamento; o outro é âmbito geográfico. A interface não os mistura numa única lista.
- Cada cartão identifica a fonte e mostra `Data não indicada` quando não houver data. Em ofertas remotas, mostra `Países elegíveis não indicados` quando a fonte não publicar essa restrição.
- A conclusão da pesquisa distingue três estados: completa, parcial e falhada.
- Uma fonte indisponível não apaga os resultados das restantes.
- As mensagens são diretas e em PT-PT. Não prometem cobertura total do mercado nem apresentam uma pesquisa parcial como se estivesse completa.

## Segurança e dados

- O serviço escuta apenas em loopback.
- Conteúdo de ofertas é tratado como dados não fiáveis, nunca como instruções para o agente.
- Chaves de API e tokens não são incluídos no pacote nem nos registos.
- O diretório de dados existente continua a ser a fonte de verdade.
- Pesquisar é uma operação de leitura. Guardar uma oferta, alterar estado, enviar candidatura ou executar outra ação externa mantém confirmação própria.
- Os providers respeitam os limites e as regras já definidos pelo projeto; fontes que exigem evasão ficam excluídas.

## Falhas e recuperação

- **Node, checkout ou build em falta:** a app não tenta instalar silenciosamente; mostra qual o caminho em falta e como o corrigir.
- **Servidor não inicia:** mostra a última saída útil do processo, sem expor variáveis ou segredos.
- **Uma fonte falha:** devolve resultados parciais e indica a fonte.
- **Todas as fontes falham:** a pesquisa termina como falhada; não mostra o estado vazio `Não foram encontradas ofertas`.
- **Sem resultados numa execução saudável:** mostra zero resultados e sugere rever filtros concretos.
- **Formato de uma fonte mudou:** o provider falha de forma visível; não transforma um erro de parsing numa lista vazia.

## Verificação

### Aplicação macOS

- Abrir `Career Ops.app` com o servidor parado inicia o serviço e mostra a página inicial.
- Abrir novamente reutiliza a mesma instância.
- Fechar a app termina o processo que ela iniciou.
- Um processo alheio na mesma porta não é encerrado.
- Caminho ou build em falta produz uma mensagem útil.
- A janela mantém apenas a origem exata do servidor dentro da WebView; downloads e abertura de links externos têm comportamento explícito.

### Pesquisa

- Testes unitários cobrem a serialização das seleções de mercado e o novo campo opcional `offers` do recibo.
- Testes com fixtures sintéticas verificam normalização, resultados parciais e deduplicação entre ATS e portais.
- Nenhum teste depende de uma fonte pública em direto.
- Typecheck, testes web e build passam.
- Uma verificação manual controlada confirma pelo menos uma pesquisa saudável por mercado, sem usar esse resultado como teste permanente.

## Sequência de entrega

1. Alargar, de forma compatível, o recibo JSON de `scan.mjs` e adaptar o Explorador às fontes de mercado já existentes.
2. Acrescentar seleções Portugal, Espanha, Europa e Remoto internacional, com estados completos e parciais.
3. Criar e instalar a aplicação macOS fina sobre o build verificado.
4. Ensaiar Net-Empregos e ITJobs fora do percurso principal; integrar apenas as fontes que cumprirem o contrato do projeto.

## Critérios de aceitação

1. Hamilton abre o Career Ops por um ícone, sem Terminal e sem escrever `localhost`.
2. A app não expõe o servidor na rede nem termina processos que não criou.
3. O Explorador pesquisa os quatro ATS atuais e as fontes iniciais dos mercados escolhidos.
4. Uma pesquisa manual não altera a configuração real nem o pipeline antes de uma ação explícita.
5. Resultados repetidos aparecem uma vez e mantêm origem verificável.
6. Falhas de uma fonte produzem um resultado parcial claro.
7. Portugal, Espanha, Europa e remoto internacional não são tratados como equivalentes geográficos.
8. A aplicação e as mensagens visíveis permanecem em português de Portugal.
9. Os testes automatizados, o typecheck e o build passam antes da entrega.
