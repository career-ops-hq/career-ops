# Career-Ops

[English](README.md) | [Español](README.es.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md) | [한국어](README.ko-KR.md) | [日本語](README.ja.md) | [简体中文](README.cn.md) | [繁體中文](README.zh-TW.md) | [Українська](README.ua.md) | [Русский](README.ru.md) | [Polski](README.pl.md) | [العربية](README.ar.md)

<p align="center">
  <a href="https://x.com/santifer"><img src="docs/hero-banner.jpg" alt="Career-Ops Sistema Multi-Agente de Busqueda de Empleo" width="800"></a>
</p>

<p align="center">
  <em>Meses mandando CVs al vacio. Asi que me construi el sistema que echaba en falta.</em><br>
  Las empresas usan IA para descartarte. <strong>Yo le di a los candidatos IA para <em>elegirlas</em>.</strong><br>
  <em>Ahora es open source.</em>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/25195" target="_blank"><img src="https://trendshift.io/api/badge/repositories/25195" alt="santifer%2Fcareer-ops | Trendshift" style="width: 245px; height: 54px; vertical-align: middle;" width="245" height="54"/></a>
  &nbsp;&nbsp;
  <a href="https://www.producthunt.com/products/santifer-io?utm_source=badge-featured&utm_medium=badge" target="_blank"><img src="docs/press/producthunt.svg" alt="Career-Ops on Claude | Product Hunt" style="width: 206px; height: 54px; vertical-align: middle;" width="206" height="54"/></a>
</p>

<p align="center"><sub>APARECE EN</sub></p>

<p align="center">
  <a href="https://wired.com.gr/article/to-ai-ergaleio-pou-fernei-epanastasi-ston-tropo-pou-psachnoume-douleia/" rel="noopener noreferrer nofollow"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/press/wired-dark.svg"><img src="docs/press/wired.svg" alt="WIRED" height="32"></picture></a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.businessinsider.com/how-i-built-tool-filter-job-listings-landed-head-ai-2026-4" rel="noopener noreferrer nofollow"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/press/business-insider-dark.svg"><img src="docs/press/business-insider.svg" alt="Business Insider" height="32"></picture></a>
</p>

---

<p align="center">
  <img src="docs/demo.gif" alt="Career-Ops Demo" width="800">
</p>

<p align="center"><strong>740+ ofertas evaluadas · 100+ CVs personalizados · 1 trabajo soñado conseguido</strong></p>

<p align="center">
  <a href="https://warpchart.dev/hq">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://warpchart.dev/api/chart?theme=dark&v=3">
      <img alt="Live star telemetry of santifer/career-ops" src="https://warpchart.dev/api/chart?theme=light&v=3" loading="lazy">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/Unete_a_la_comunidad-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/@santifer/career-ops"><img src="https://img.shields.io/npm/dt/@santifer/career-ops?style=for-the-badge&logo=npm&color=CB3837&label=npx%20installs" alt="npm installs"></a>
</p>

<p align="center">
  <sub>Construido con</sub><br>
  <img src="https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/OpenCode-111827?style=flat&logo=terminal&logoColor=white" alt="OpenCode">
  <img src="https://img.shields.io/badge/Gemini_CLI-4285F4?style=flat&logo=google&logoColor=white" alt="Gemini CLI">
  <img src="https://img.shields.io/badge/Codex-412991?style=flat&logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Qwen-615CED?style=flat" alt="Qwen">
  <img src="https://img.shields.io/badge/GitHub_Copilot-000?style=flat&logo=githubcopilot&logoColor=white" alt="GitHub Copilot">
  <br>
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white" alt="Playwright">
  <img src="https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white" alt="Bubble Tea">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT">
  <a href="TRADEMARK.md"><img src="https://img.shields.io/badge/Trademark-Policy-blue.svg" alt="Trademark Policy"></a>
</p>

## Que es esto

Career-Ops convierte cualquier CLI de IA en un centro de mando de busqueda de empleo. En vez de trackear aplicaciones en un spreadsheet, tienes un pipeline AI que:

- **Evalua ofertas** con scoring estructurado A-F (10 dimensiones ponderadas)
- **Genera PDFs personalizados** -- CVs ATS-optimizados por oferta
- **Escanea portales** automaticamente (Greenhouse, Ashby, Lever, webs de empresas)
- **Procesa en batch** -- evalua 10+ ofertas en paralelo con sub-agentes
- **Trackea todo** en una fuente de verdad unica con checks de integridad

> **Importante: Esto NO es para spamear empresas.** Career-ops es un filtro -- te ayuda a encontrar las pocas ofertas que merecen tu tiempo entre cientos. El sistema recomienda encarecidamente no aplicar a nada por debajo de 4.0/5. Tu tiempo es valioso, y el del recruiter tambien. Siempre revisa antes de enviar.

> **Aviso: las primeras evaluaciones no seran buenas.** El sistema no te conoce todavia. Dale contexto -- tu CV, tu historia profesional, tus proof points, tus preferencias, en que eres bueno, que quieres evitar. Cuanto mas lo nutras, mejor filtra. Piensa en ello como hacer onboarding a un recruiter nuevo: la primera semana necesita conocerte, luego se vuelve invaluable.

Construido por alguien que lo uso para evaluar 740+ ofertas, generar 100+ CVs personalizados, y conseguir un rol de Head of Applied AI. [Lee el case study completo](https://santifer.io/career-ops).

## Features

| Feature                    | Descripcion                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Auto-Pipeline**          | Pega una URL, obtiene evaluacion + PDF + entrada en tracker                                                                    |
| **Evaluacion A-F**         | Resumen del rol, match con CV, estrategia de nivel, research de comp, personalizacion, prep de entrevista (STAR+R) -- mas una verificacion de legitimidad de la oferta (Bloque G) que detecta estafas y ofertas fantasma |
| **Banco de historias**     | Acumula historias STAR+Reflexion entre evaluaciones -- 5-10 historias maestras que responden cualquier pregunta behavioral     |
| **Scripts de negociacion** | Frameworks de negociacion salarial, pushback de descuentos geograficos, leverage de ofertas competidoras                       |
| **PDFs ATS**               | CVs con keywords inyectados, diseño Space Grotesk + DM Sans                                                                    |
| **Scanner de portales**    | 45+ empresas pre-configuradas (Anthropic, OpenAI, ElevenLabs, Retool, n8n...) + queries en Ashby, Greenhouse, Lever, Wellfound |
| **Batch**                  | Evaluacion en paralelo con workers `claude -p`                                                                                 |
| **Dashboard TUI**          | Terminal UI para navegar, filtrar y ordenar tu pipeline                                                                        |
| **Human-in-the-Loop**      | La IA evalua y recomienda, tu decides y actuas. El sistema nunca envia una aplicacion -- tu siempre tienes la ultima palabra   |
| **Integridad de pipeline** | Merge automatico, dedup, normalizacion de estados, health checks                                                               |

## Inicio rapido

**La forma mas rapida — un solo comando:**

```bash
npx @santifer/career-ops init
```

> 💡 `npx` viene incluido con [Node.js](https://nodejs.org) — ejecuta el instalador una vez, sin instalar nada de forma global. ¿No tienes Node? Instalalo primero. (¿Ya usas un CLI como Claude Code / Gemini / Codex? Entonces ya lo tienes.)

Esto clona la ultima release en `./career-ops` e instala las dependencias. Despues:

```bash
cd career-ops
claude   # o gemini / codex / qwen / opencode — abre tu CLI de IA aqui
```

**En el primer arranque, career-ops te guia en la configuracion — tu CV, tu perfil y los roles que buscas — simplemente conversando. No hay nada que editar a mano.**

<details>
<summary><b>¿Prefieres instalarlo manualmente? (git clone)</b></summary>

```bash
git clone https://github.com/santifer/career-ops.git
cd career-ops && npm install
npx playwright install chromium   # solo para generar PDFs
claude   # abre tu CLI de IA — te guiara en el primer arranque
```

</details>

> **El sistema esta diseñado para que Claude lo personalice.** Modes, arquetipos, scoring, scripts de negociacion -- solo pidelo. Claude lee los mismos archivos que usa, asi que sabe exactamente que editar.

Guia completa en [docs/SETUP.md](docs/SETUP.md).

## Uso

Career-ops es un unico slash command con multiples modos:

```
/career-ops                → Mostrar todos los comandos
/career-ops {pega un JD}   → Pipeline completo (evaluar + PDF + tracker)
/career-ops scan           → Escanear portales
/career-ops pdf            → Generar CV ATS-optimizado
/career-ops batch          → Evaluar ofertas en batch
/career-ops tracker        → Ver estado de aplicaciones
/career-ops apply          → Rellenar formularios con IA
/career-ops pipeline       → Procesar URLs pendientes
/career-ops contacto       → Mensaje LinkedIn outreach
/career-ops deep           → Research profundo de empresa
```

O simplemente pega una URL o descripcion de oferta -- career-ops la detecta y ejecuta el pipeline completo.

## Como funciona

```
Pegas una URL o descripcion de oferta
        │
        ▼
┌──────────────────┐
│  Deteccion de    │  Clasifica: LLMOps / Agentic / PM / SA / FDE / Transformation
│  Arquetipo       │
└────────┬─────────┘
         │
┌────────▼─────────┐
│  Evaluacion A-F  │  Match, gaps, comp research, historias STAR
│  (lee cv.md)     │
└────────┬─────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
 Report  PDF  Tracker
  .md   .pdf   .tsv
```

## Portales incluidos

El scanner viene con **45+ empresas** pre-configuradas y **19 queries** en los principales portales de empleo. Copia `templates/portals.example.yml` a `portals.yml` y añade las tuyas:

**AI Labs:** Anthropic, OpenAI, Mistral, Cohere, LangChain, Pinecone
**Voice AI:** ElevenLabs, PolyAI, Parloa, Hume AI, Deepgram, Vapi, Bland AI
**Plataformas AI:** Retool, Airtable, Vercel, Temporal, Glean, Arize AI
**Contact Center:** Ada, LivePerson, Sierra, Decagon, Talkdesk, Genesys
**Enterprise:** Salesforce, Twilio, Gong, Dialpad
**LLMOps:** Langfuse, Weights & Biases, Lindy, Cognigy, Speechmatics
**Automatizacion:** n8n, Zapier, Make.com
**Europa:** Factorial, Attio, Tinybird, Clarity AI, Travelperk

**Portales de empleo:** Ashby, Greenhouse, Lever, Wellfound, Workable, RemoteFront

## Dashboard TUI

El dashboard integrado en terminal te permite navegar tu pipeline visualmente:

```bash
cd dashboard
go build -o career-dashboard .
./career-dashboard --path ..
```

Features: 6 pestañas de filtro, 4 modos de ordenacion, vista agrupada/plana, previews lazy-loaded, cambios de estado inline.

## Estructura del proyecto

```
career-ops/
├── AGENTS.md                    # Instrucciones canónicas del agente (todos los CLIs)
├── CLAUDE.md                    # Wrapper Claude Code (importa AGENTS.md)
├── cv.md                        # Tu CV (crealo tu)
├── article-digest.md            # Tus proof points (opcional)
├── config/
│   └── profile.example.yml      # Template para tu perfil
├── modes/                       # 14 modos
│   ├── _shared.md               # Contexto compartido (personalizable)
│   ├── oferta.md                # Evaluacion individual
│   ├── pdf.md                   # Generacion de PDF
│   ├── scan.md                  # Scanner de portales
│   ├── batch.md                 # Procesamiento batch
│   └── ...
├── templates/
│   ├── cv-template.html         # Template de CV ATS-optimizado
│   ├── portals.example.yml      # Config del scanner
│   └── states.yml               # Estados canonicos
├── batch/
│   ├── batch-prompt.md          # Prompt autocontenido del worker
│   └── batch-runner.sh          # Script orquestador
├── dashboard/                   # Visor de pipeline en Go TUI
├── data/                        # Tus datos de tracking (gitignored)
├── reports/                     # Reports de evaluacion (gitignored)
├── output/                      # PDFs generados (gitignored)
├── fonts/                       # Space Grotesk + DM Sans
├── docs/                        # Setup, personalizacion, arquitectura
└── examples/                    # CV de ejemplo, report, proof points
```

## Tech Stack

![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white)
![Bubble Tea](https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white)

- **Agente**: Claude Code con skills y modos personalizados
- **PDF**: Playwright/Puppeteer + template HTML
- **Scanner**: Playwright + Greenhouse API + WebSearch
- **Dashboard**: Go + Bubble Tea + Lipgloss (tema Catppuccin Mocha)
- **Datos**: Tablas Markdown + config YAML + ficheros TSV batch

## Sobre el autor

Soy Santiago -- Head of Applied AI, ex-fundador (monte y vendi un negocio que sigue funcionando con mi nombre). Construi career-ops para gestionar mi propia busqueda de empleo. Funciono: lo use para conseguir mi puesto actual.

Mi portfolio y otros proyectos open source → [santifer.io](https://santifer.io)

## Documentacion

- [SETUP.md](docs/SETUP.md) -- Guia de instalacion
- [CUSTOMIZATION.md](docs/CUSTOMIZATION.md) -- Como personalizar
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) -- Como funciona el sistema

## Tambien Open Source

- **[cv-santiago](https://github.com/santifer/cv-santiago)** -- El portfolio (santifer.io) con chatbot IA, dashboard LLMOps y case studies. Si necesitas un portfolio para acompañar tu busqueda de empleo, echale un vistazo.


## Aviso legal

**career-ops es una herramienta local y open source — NO un servicio alojado.** Al usar este software, aceptas que:

1. **Tu controlas tus datos.** Tu CV, datos de contacto e informacion personal se quedan en tu maquina y se envian directamente al proveedor de IA que elijas (Anthropic, OpenAI, etc.). No recopilamos, almacenamos ni tenemos acceso a tus datos.
2. **Tu controlas la IA.** Los prompts por defecto instruyen a la IA a no enviar aplicaciones automaticamente, pero los modelos pueden comportarse de forma impredecible. Si modificas los prompts o usas otros modelos, lo haces bajo tu responsabilidad. **Revisa siempre el contenido generado antes de enviarlo.**
3. **Tu cumples con los terminos de terceros.** Debes usar esta herramienta de acuerdo con los Terminos de Servicio de los portales de empleo (Greenhouse, Lever, Workday, LinkedIn, etc.). No uses esta herramienta para spamear empresas.
4. **Sin garantias.** Las evaluaciones son recomendaciones, no verdad absoluta. Los modelos pueden inventar habilidades o experiencia. Los autores no son responsables de resultados laborales, candidaturas rechazadas, restricciones de cuenta ni ninguna otra consecuencia.

Ver [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md) para mas detalles. Este software se proporciona bajo la [Licencia MIT](LICENSE) "tal cual", sin garantia de ningun tipo.

## Licencia

MIT

## Conecta

[![Website](https://img.shields.io/badge/santifer.io-000?style=for-the-badge&logo=safari&logoColor=white)](https://santifer.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/santifer)
[![X](https://img.shields.io/badge/X-000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/santifer)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/8pRpHETxa4)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:hola@santifer.io)
