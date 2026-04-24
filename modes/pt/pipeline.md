# Modo: pipeline -- Inbox de URLs (Second Brain)

Processa URLs de vagas acumuladas em `data/pipeline.md`. O candidato adiciona URLs quando quiser e depois executa `/career-ops pipeline` para processar todas de uma vez.

## Workflow

1. **Ler** `data/pipeline.md` → buscar itens `- [ ]` na seção "Pendentes"
2. **Para cada URL pendente**:
   a. Calcular próximo `REPORT_NUM` sequencial (ler `reports/`, pegar o número mais alto + 1)
   b. **Extrair JD** usando Playwright (browser_navigate + browser_snapshot) → WebFetch → WebSearch
   c. Se a URL não for acessível → marcar como `- [!]` com nota e continuar
   d. **Executar auto-pipeline completa**: Avaliação A-F → Report .md → PDF (se score >= 3.0) → Tracker
   e. **Mover de "Pendentes" para "Processadas"**: `- [x] #NNN | URL | Empresa | Vaga | Score/5 | PDF ✅/❌`
3. **Se houver 3+ URLs pendentes**, lançar agentes em paralelo apenas para etapas sem Playwright (ex.: organização, WebSearch/WebFetch).
   Se a extração exigir Playwright, processar serialmente (1 vaga por vez) para evitar conflito de sessão.
4. **Ao terminar**, mostrar tabela resumo:

```
| # | Empresa | Vaga | Score | PDF | Ação recomendada |
```

## Formato de pipeline.md

```markdown
## Pendentes
- [ ] https://jobs.example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Company Inc | Senior PM
- [!] https://private.url/job — Erro: login necessário

## Processadas
- [x] #143 | https://jobs.example.com/posting/789 | Acme Corp | AI PM | 4.2/5 | PDF ✅
- [x] #144 | https://boards.greenhouse.io/xyz/jobs/012 | BigCo | SA | 2.1/5 | PDF ❌
```

> Nota: Os títulos das seções podem estar em EN ("Pending"/"Processed"), ES ("Pendientes"/"Procesadas"), DE ("Offen"/"Verarbeitet") ou PT-BR ("Pendentes"/"Processadas"). Ao ler, ser flexível; ao escrever, manter o estilo do arquivo existente.

## Detecção inteligente de JD a partir da URL

1. **Playwright (preferido):** `browser_navigate` + `browser_snapshot`. Funciona com todas as SPAs.
2. **WebFetch (fallback):** Para páginas estáticas ou quando Playwright não está disponível.
3. **WebSearch (último recurso):** Buscar em portais secundários que indexam o JD.

**Casos especiais:**
- **LinkedIn**: Pode exigir login → marcar com `[!]` e pedir ao candidato para colar o texto
- **PDF**: Se a URL aponta para um PDF, ler diretamente com o Read tool
- **`local:` prefix**: Ler arquivo local. Exemplo: `local:jds/linkedin-pm-ai.md` → ler `jds/linkedin-pm-ai.md`
- **Gupy / Greenhouse / Lever**: Plataformas comuns no Brasil. Playwright funciona bem com todas
- **Vagas.com.br / InfoJobs / Catho**: Portais brasileiros, geralmente acessíveis via WebFetch
- **LinkedIn BR**: Mesmas restrições do LinkedIn global — pode exigir login

## Numeração automática

1. Listar todos os arquivos em `reports/`
2. Extrair o número do prefixo (ex: `142-medispend...` → 142)
3. Novo número = máximo encontrado + 1

## Sincronização de fontes

Antes de processar qualquer URL, verificar sincronização:

```bash
node cv-sync-check.mjs
```

Se houver dessincronização, avisar o candidato antes de continuar.
