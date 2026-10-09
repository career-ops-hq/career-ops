# Career Ops em português de Portugal

## Objetivo

Entregar a aplicação web local em português de Portugal, com linguagem direta e factual, sem o tom promocional e os padrões visuais genéricos associados a produtos de IA.

## Âmbito aprovado

- Traduzir e reescrever toda a copy visível da aplicação web, incluindo navegação, formulários, estados vazios, confirmações, erros, tooltips, nomes acessíveis e mensagens do assistente.
- Usar `pt-PT` no documento HTML e na formatação de datas, horas e números.
- Apresentar estados canónicos em português sem alterar os valores internos persistidos em inglês.
- Fazer do português de Portugal o idioma predefinido dos outputs gerados quando `language.output` não estiver configurado; uma configuração explícita continua a prevalecer.
- Tornar o assistente direto, concreto e sóbrio: sem entusiasmo automático, promessas vagas, metáforas de copiloto, regras de três mecânicas ou anglicismos evitáveis.
- Corrigir afirmações enganosas detetadas na auditoria: no macOS as pesquisas guardadas não correm em segundo plano; zero execuções não corresponde a 100% de sucesso.
- Reduzir o aspeto genérico onde a remoção basta: não mostrar estatísticas vazias, eliminar ações repetidas e retirar decoração sem função.

## Fora do âmbito

- Não criar seletor de idioma nem instalar uma biblioteca de i18n.
- Não traduzir identificadores de API, rotas, comandos, formatos de ficheiro ou valores canónicos guardados.
- Não usar `modes/pt/`: essa pasta é específica do Brasil. A adaptação de regras laborais ao mercado português será um projeto separado em `modes/pt-PT/`.
- Não redesenhar a identidade visual existente, que mantém tipografia, paleta e estrutura de navegação.
- Não interromper nem reiniciar o servidor principal em `http://127.0.0.1:3417` durante a implementação isolada.

## Critérios de aceitação

1. Os percursos principais — Hoje, Procurar ofertas, Pesquisas guardadas, Candidaturas, Acompanhamento, Empresas, Resultados, CV, Definições, Assistente e candidatura — apresentam copy PT-PT.
2. Estados vazios, erros, confirmações, loading, labels acessíveis e tooltips relevantes também aparecem em PT-PT.
3. Datas e horas visíveis usam `pt-PT`.
4. Os valores internos `Evaluated`, `Applied`, `Interview` e restantes continuam compatíveis com o núcleo, mas a interface mostra rótulos portugueses.
5. Sem perfil, os outputs gerados usam PT-PT; `language.output` explícito continua a prevalecer.
6. A página inicial não promete pesquisas automáticas no macOS.
7. A taxa de sucesso sem execuções mostra `—`, e os quatro cartões de estatísticas não aparecem antes de existirem execuções ou pesquisas guardadas.
8. Testes web, typecheck e build passam; os percursos são verificados no navegador em desktop e móvel.
