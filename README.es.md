<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/wordmark-dark.svg"><img src="docs/wordmark-light.svg" alt="career-ops" width="250" height="56"></picture></p>

<p align="center">
  <em>Meses mandando CVs al vacío. Así que me construí el sistema que echaba en falta.</em><br>
  Las empresas usan IA para descartarte. <strong>Yo le di a los candidatos IA para <em>elegirlas</em>.</strong><br>
  Evalúa, puntúa y redacta. <strong>Nunca envía nada: lo envías tú.</strong> Open source, en local, tuyo.
</p>

<p align="center">
  <a href="https://x.com/santifer/status/2041403685696053741"><img src="docs/demo.gif" alt="career-ops: el pipeline con las ofertas puntuadas, 219 marcadas como no aplicar, y una evaluación completa" width="800"></a>
</p>

<p align="center"><sub>Una foto a mitad de búsqueda: el pipeline, y luego una oferta abierta y evaluada de principio a fin.</sub></p>

<p align="center"><strong>De 740 ofertas, 68 merecían candidatura. 12 entrevistas. 1 oferta.</strong></p>
<p align="center"><sub>Una búsqueda, la del autor, 2026. El número que importa es el corte, no el recuento. Todas las cifras en el <a href="https://santifer.io/career-ops-system">case study</a>.</sub></p>

<p align="center"><sub>Nunca envía, nunca manda correos, nunca llama a casa: <a href="#lo-que-career-ops-no-hace">lo que no hace</a> · corre en el CLI de IA que ya usas, <a href="docs/RUNNING_ON_A_BUDGET.md">con modelos gratuitos y locales incluidos</a>.</sub></p>

<details>
<summary>Léelo en 17 idiomas</summary>
<div align="center">

[English](README.md) | [Español](README.es.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md) | [한국어](README.ko-KR.md) | [日本語](README.ja.md) | [简体中文](README.cn.md) | [繁體中文](README.zh-TW.md) | [Українська](README.ua.md) | [Русский](README.ru.md) | [Polski](README.pl.md) | [Dansk](README.da.md) | [தமிழ்](README.ta.md) | [العربية](README.ar.md) | [हिन्दी](README.hi.md) | [Türkçe](README.tr.md)

</div>
</details>

<hr>

<p align="center">
  <a href="HIRED.md"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fsantifer%2Fcareer-ops%2Fmain%2Fdocs%2Fhired-count.json&query=%24.count&label=%F0%9F%8E%89%20HIRED%20WITH%20CAREER-OPS&suffix=%20verified&color=2ea44f&style=for-the-badge&labelColor=2b3137" alt="Contratados con career-ops: recuento verificado"></a>
</p>

<p align="center"><sub>¿Has conseguido el tuyo? <a href="https://github.com/career-ops-hq/career-ops/issues/new?template=i-got-hired.yml">Compártelo →</a> · tu tarjeta le enseña a alguien en plena búsqueda que hay salida.</sub></p>

<p align="center">
  <a href="HIRED.md"><img src="docs/hired-wall.svg" alt="Las tres historias de contratación más recientes" width="800"></a>
</p>

<p align="center"><sub>Cada cifra es una historia pública que puedes <a href="HIRED.md">auditar →</a> · todas empezaron donde estás tú ahora.</sub></p>

<p align="center"><sub>APARECE EN</sub></p>

<p align="center">
  <a href="https://wired.com.gr/article/to-ai-ergaleio-pou-fernei-epanastasi-ston-tropo-pou-psachnoume-douleia/" rel="noopener noreferrer nofollow"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/press/wired-dark.svg"><img src="docs/press/wired.svg" alt="WIRED" height="32"></picture></a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.businessinsider.com/how-i-built-tool-filter-job-listings-landed-head-ai-2026-4" rel="noopener noreferrer nofollow"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/press/business-insider-dark.svg"><img src="docs/press/business-insider.svg" alt="Business Insider" height="32"></picture></a>
</p>

<p align="center">
  <a href="https://www.producthunt.com/products/santifer-io?utm_source=badge-featured&utm_medium=badge" target="_blank" rel="noopener noreferrer"><img src="docs/press/producthunt.svg" alt="career-ops on Claude | Product Hunt" style="width: 206px; height: 54px; vertical-align: middle;" width="206" height="54"/></a>
  &nbsp;&nbsp;
  <a href="https://trendshift.io/repositories/25195" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/25195" alt="santifer%2Fcareer-ops | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center"><sub>Creado y mantenido por <a href="https://santifer.io">Santiago Fernández de Valderrama Aparicio</a> (<a href="https://github.com/santifer">@santifer</a>)</sub></p>

## Qué es esto

career-ops ([career-ops.org](https://career-ops.org), también conocido como **careerops**) es una búsqueda de empleo con IA, open source, que corre en local dentro de cualquier CLI de programación con IA: evalúa ofertas, adapta tu CV y registra cada candidatura, y la última palabra siempre es tuya. En vez de llevar las candidaturas a mano en una hoja de cálculo, tienes un pipeline con IA que:

- **Evalúa ofertas** en un informe estructurado: bloques de la A a la H, con una nota global de 1 a 5 que sale de un juicio holístico sobre cinco dimensiones, no de una fórmula aritmética. La columna de importancia por requisito del bloque B y la valoración de legitimidad de la oferta del bloque G son señales aparte, neutras para la nota, que nunca la alteran; el bloque H solo se redacta a partir de 4.5
- **Genera PDFs a medida**: CVs optimizados para ATS y adaptados a cada descripción de puesto
- **Escanea portales** automáticamente (Greenhouse, Ashby, Lever, webs de empresas)
- **Procesa en lote**: evalúa 10+ ofertas en paralelo con subagentes
- **Lo registra todo** en una única fuente de verdad con comprobaciones de integridad
- **Investiga empresas y encuentra a la persona adecuada a la que escribir**: la candidatura te mete en la cola; la investigación te consigue una conversación

> **Importante: esto NO es una herramienta para disparar candidaturas a ciegas.** career-ops es un filtro: te ayuda a encontrar las pocas ofertas que merecen tu tiempo entre cientos. El sistema recomienda encarecidamente no aplicar a nada con una nota por debajo de 4.0/5. Tu tiempo es valioso, y el del recruiter también. Revisa siempre antes de enviar.

career-ops es agéntico: el CLI de IA que elijas navega por las páginas de empleo con Playwright, evalúa el encaje razonando sobre tu CV frente a la descripción del puesto (no por coincidencia de palabras clave) y adapta tu currículum a cada oferta.

> **Aviso: las primeras evaluaciones no serán buenas.** El sistema todavía no te conoce. Dale contexto: tu CV, tu trayectoria, tus logros demostrables, tus preferencias, en qué eres bueno, qué quieres evitar. Cuanto más lo alimentes, mejor funciona. Piensa en ello como en incorporar a un recruiter nuevo: la primera semana necesita conocerte, y después se vuelve imprescindible.

Construido por alguien que lo usó para evaluar 740 ofertas, presentar candidatura a 68 y conseguir un puesto de Head of Applied AI. [Lee el case study completo](https://santifer.io/career-ops-system).

## Lo que career-ops no hace

- **Enviar una candidatura.** Prepara las respuestas; tú abres el formulario y pulsas Enviar. El script nunca hace POST (`prepare-application.mjs`).
- **Mandar un correo.** Solo borradores. No hay ningún transporte de correo en todo el código.
- **Llamar a casa.** Sin telemetría, sin backend nuestro. Tu CV va de tu máquina al proveedor de IA que tú elijas, y a ningún otro sitio. El único registro público es este repositorio: `HIRED.md` y sus issues.
- **Empujarte a aplicar por debajo de 4.0/5.** Te dirá que no lo hagas. Puedes ignorarlo, y te lo dirá.

Reformula tu CV; nunca debe inventarlo. Hoy esa regla vive en los prompts, todavía no en un control automático. Lee cada CV antes de enviarlo. Detalles en las [preguntas frecuentes](#preguntas-frecuentes-faq).

## El Manifiesto CareerOps

career-ops es la primera implementación de referencia del [Manifiesto CareerOps](https://career-ops.org/manifesto?utm_source=readme). léelo. si dice lo que tú crees, fírmalo. tu firma se convierte en un commit.

## Funcionalidades

| Funcionalidad            | Descripción                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Auto-Pipeline**        | Pega una URL y obtén la evaluación completa + PDF + entrada en el tracker                                                                |
| **Evaluación A-H**       | Resumen del puesto, encaje con el CV (con cuánto pesa cada requisito en esta oferta y si ese peso sale de la redacción de la propia descripción, de su estructura o de una estimación, etiquetado requisito a requisito; una estimación nunca puede estar en la banda más alta), estrategia de nivel, investigación de compensación, personalización, preparación de entrevista (STAR+R), más una comprobación de legitimidad de la oferta en el bloque G que detecta estafas y ofertas fantasma, y una señal de permiso de trabajo que marca como bloqueo duro cualquier descripción que excluya expresamente el patrocinio de visado |
| **Banco de historias**   | Acumula historias STAR+Reflexión entre evaluaciones: 5-10 historias maestras que responden a cualquier pregunta de comportamiento        |
| **Guiones de negociación** | Marcos de negociación salarial, respuesta al descuento geográfico, uso de ofertas competidoras como palanca                            |
| **PDF optimizado para ATS** | CVs con palabras clave inyectadas y diseño Space Grotesk + DM Sans                                                                    |
| **Generador de cartas de presentación** | Cartas basadas en investigación con reflejo de palabras clave, cuatro preguntas interactivas de enfoque (por qué/problemas/planteamiento/tono), aprobación del borrador en el chat y PDF A4 por el mismo pipeline HTML + Playwright que los CVs. Redacta un borrador en cada evaluación; complétalo y genéralo cuando quieras con `/career-ops cover` |
| **Borradores de correo de candidatura** | Correos formales para recruiter, referido o candidatura en frío a partir de un informe o de una descripción pegada, con asunto, lista de adjuntos, puntos de encaje con fuente y un bloque de contacto sacado de tu perfil. Solo borradores: career-ops nunca envía, presenta ni hace clic en nada. |
| **Escáner de portales**  | 100+ empresas preconfiguradas (Anthropic, OpenAI, ElevenLabs, Retool, n8n...) + consultas propias en Ashby, Greenhouse, Lever, Wellfound |
| **Descubrimiento de empresas financiadas** | El comando `company:funded`, pensado para revisar antes de actuar, saca a la luz empresas con financiación reciente y diagnósticos de fuente a partir de feeds públicos estructurados, sin tocar tus datos |
| **Procesamiento en lote** | Evaluación en paralelo con workers de CLI sin interfaz (`claude -p` / `opencode run`)                                                   |
| **Dashboard TUI**        | Interfaz de terminal para navegar, filtrar y ordenar tu pipeline                                                                         |
| **Human-in-the-Loop**    | La IA evalúa y recomienda, tú decides y actúas. El sistema nunca envía una candidatura: la última palabra siempre es tuya <!-- hitl: absolute guarantee. Do not add "automatically", "by itself", "without your permission" or any other hedge when translating this row. -->               |
| **Integridad del pipeline** | Fusión automática, deduplicación, normalización de estados, comprobaciones de salud                                                    |
| **Suite de entrevistas** | Planes de preparación por bloques de tiempo, sesiones de práctica con feedback, análisis posterior a la entrevista ([`interview/`](modes/interview/README.md)) y un detector de señales de alarma de la empresa ([`interview-redflag`](modes/interview-redflag.md)) |
| **Fase de oferta**       | Acompañante de lectura del contrato: recorrido cláusula a cláusula más una lista de preguntas para el abogado ([`offer-prep`](modes/offer-prep.md)), y un analizador de la brecha entre salario deseado, anunciado y real (`salary-gap.mjs`) |
| **Seguimientos y respuestas** | Calculadora de cadencia de seguimiento y recordatorios sembrados (`followup-cadence.mjs`, `followup-seed.mjs`); clasificación de las respuestas del empleador en actualizaciones del tracker ([`reply-watch`](modes/reply-watch.md)) |
| **Análisis de patrones** | Patrones de rechazo y tasas de avance por canal ATS (`analyze-patterns.mjs`), estadísticas de embudo de toda la búsqueda (`stats.mjs`), detección de republicaciones y ofertas fantasma (`detect-reposts.mjs`) |
| **Sistema de plugins**   | Integraciones opcionales (Gmail, Notion, Apify + un registro comunitario), desactivadas por defecto; ver [docs/PLUGINS.md](docs/PLUGINS.md) |
| **Más allá del CV**      | La investigación de empresa ([`deep`](modes/deep.md)) saca a la luz su estrategia de IA, movimientos recientes, cultura de ingeniería y el ángulo que debería tomar tu perfil. La búsqueda de contactos ([`contacto`](modes/contacto.md)) identifica al hiring manager, al recruiter o al compañero de equipo al que merece la pena escribir y redacta un mensaje de LinkedIn de ≤300 caracteres ajustado a cada tipo de contacto. Los borradores de correo formal de candidatura ([`email`](modes/email.md)) convierten un informe evaluado o una descripción pegada en asunto, cuerpo y lista de adjuntos sin enviar, presentar ni hacer clic en nada. La candidatura te mete en la cola; la investigación te consigue una conversación. |

## Inicio rápido

**La forma más rápida: un solo comando:**

```bash
npx @santifer/career-ops init
```

> 💡 `npx` viene con [Node.js](https://nodejs.org): ejecuta el instalador una vez,
> sin instalar nada de forma global. ¿Aún no tienes Node? Instálalo primero.
> (¿Ya usas un CLI de Claude Code / Gemini / Codex? Entonces ya lo tienes.)

Esto clona la última versión en `./career-ops` e instala las dependencias. Después:

```bash
cd career-ops
claude   # or codex / qwen / opencode / agy / grok — open your AI CLI here
```

**En el primer arranque, career-ops te guía en la configuración (tu CV, tu perfil y los puestos que buscas) solo conversando. No hay nada que editar a mano.**

<details>
<summary><b>¿Prefieres configurarlo a mano? (git clone)</b></summary>

```bash
git clone https://github.com/career-ops-hq/career-ops.git
cd career-ops && npm install
npx playwright install chromium   # only needed for PDF generation

# 2. Check setup
npm run doctor                     # Validates all prerequisites

# 3. Configure
cp config/profile.example.yml config/profile.yml  # Edit with your details
cp templates/portals.example.yml portals.yml       # Customize companies

# 4. Add your CV
# Create cv.md in the project root with your CV in markdown

# 5. Open your AI CLI in this directory
claude   # or codex / opencode / qwen / agy / grok

# Then ask your CLI to adapt the system to you:
# "Change the archetypes to backend engineering roles"
# "Translate the modes to English"
# "Add these 5 companies to portals.yml"
# "Update my profile with this CV I'm pasting"

# 6. Start using
# Paste a job URL or JD text to trigger auto-pipeline
# If your CLI supports slash commands, use /career-ops (or its CLI-specific alias)
# In Codex, ask for the same mode in plain language, e.g.:
# "Run the career-ops scan mode"
# "Run the career-ops pipeline mode for data/pipeline.md"
# "Run the career-ops pdf mode for the latest evaluated role"
# "Run the career-ops tracker mode and summarize the current statuses"
```

</details>

### Instalación global

```bash
npm i -g @santifer/career-ops
```

Esto instala el binario `career-ops` de forma global para que puedas ejecutarlo directamente en lugar de a través de `npx`. A diferencia de `npx @santifer/career-ops init` (que prepara un directorio de proyecto), la instalación global te da un comando `career-ops` persistente, disponible desde cualquier terminal.

**¿Cuál deberías usar?**
- `npx @santifer/career-ops init`: lo mejor para el primer uso; crea una carpeta de proyecto dedicada.
- `npm i -g @santifer/career-ops`: lo mejor cuando ya tienes una carpeta de proyecto y quieres ejecutar los comandos de career-ops directamente.

> **El sistema está diseñado para que lo personalice tu propio CLI de IA.** Modos, arquetipos, pesos de la puntuación, guiones de negociación: solo pídele que los cambie. Lee los mismos ficheros que usa, así que sabe exactamente qué editar.

Consulta [docs/SETUP.md](docs/SETUP.md) para la guía de instalación completa, [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md) para ejecutar career-ops a bajo coste con modelos propios o locales (y [docs/FREE_TIER.md](docs/FREE_TIER.md) para ejecutarlo a coste cero en el nivel gratuito de Antigravity CLI), [docs/AUTOMATION.md](docs/AUTOMATION.md) para programar escaneos periódicos y una receta de triaje a lista corta sin gastar tokens, [docs/APPLY_AUTOFILL.md](docs/APPLY_AUTOFILL.md) para los detalles del flujo de rellenado de formularios ATS, [docs/LINKEDIN_JOIN.md](docs/LINKEDIN_JOIN.md) para cruzar una exportación de tus contactos de LinkedIn con las empresas de tu embudo, y [docs/FAQ.md](docs/FAQ.md) para respuestas a las dudas habituales de configuración, incluida [cómo la procedencia de las historias evita cifras inventadas](docs/FAQ.md#why-does-career-ops-refuse-to-use-a-number-from-my-story-bank). Los principios de diseño están en [ARCHITECTURE.md](ARCHITECTURE.md); los flujos en ejecución, en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Integración con Antigravity CLI

career-ops es compatible de forma nativa con Antigravity CLI, igual que con Claude Code y OpenCode. Todos los comandos de barra están disponibles a través del punto de entrada compartido de la skill, con la misma lógica de evaluación de `modes/*.md`.

Google ha migrado el acceso de consumo a Gemini CLI hacia Antigravity CLI. `GEMINI.md` es ahora una guarda de compatibilidad sin efecto, para que Antigravity no duplique las instrucciones completas del proyecto cuando lee `AGENTS.md` y `GEMINI.md` a la vez.

### Antigravity CLI nativo

```bash
# 1. Run in the career-ops directory
cd career-ops
agy

# 2. Use the unified /career-ops command with subcommands:
/career-ops "Senior AI Engineer at Anthropic..."
/career-ops pipeline
/career-ops scan
/career-ops pdf
/career-ops tracker
```

La skill se define con el estándar abierto en `.agents/skills/career-ops/SKILL.md` y se enlaza o referencia para cada CLI compatible (por ejemplo `.claude/`, `.cursor/`, `.qwen/`, `.antigravitycli/`, `.grok/`).

## Integración con Codex

career-ops es compatible con Codex a través del mismo enrutador compartido, pero el modelo de invocación es distinto al de los CLIs que registran comandos de barra automáticamente. La guía completa está en [docs/CODEX.md](docs/CODEX.md).

### Codex interactivo

```bash
cd career-ops
codex
```

Los comandos de barra no están garantizados en Codex. Si `/career-ops` no está disponible, pídele a Codex que ejecute el modo directamente en lenguaje natural:

```text
Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123
Run the career-ops scan mode and summarize new matches.
Run the career-ops pipeline mode for data/pipeline.md.
Run the career-ops pdf mode for the latest evaluated role.
Run the career-ops tracker mode and summarize the current statuses.
```

### Codex de una sola pasada (`codex exec`)

```bash
codex exec "Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123"
codex exec "Run career-ops scan mode in this repo and summarize new matches."
codex exec "Run career-ops pipeline mode for data/pipeline.md."
codex exec "Run career-ops pdf mode for the latest evaluated role."
codex exec "Run career-ops tracker mode and summarize the current statuses."
```

## Integración con Grok Build CLI

career-ops es compatible de forma nativa con Grok Build CLI, igual que con Claude Code y OpenCode. `AGENTS.md` se carga automáticamente como reglas del proyecto y todos los comandos de barra están disponibles a través del punto de entrada compartido de la skill.

### Grok Build CLI nativo

```bash
# 1. Run in the career-ops directory
cd career-ops
grok

# 2. Use the unified /career-ops command with subcommands:
/career-ops "Senior AI Engineer at Anthropic..."
/career-ops pipeline
/career-ops scan
/career-ops pdf
/career-ops tracker
```

Para workers de lote sin interfaz, usa `grok -p "prompt"` (añade `--yolo` para aprobar automáticamente la ejecución de herramientas).

### Script independiente con la API de Gemini (sin instalar ningún CLI)

```bash
# 1. Get a free API key at https://aistudio.google.com/apikey
cp .env.example .env
# Edit .env, set GEMINI_API_KEY=your_key_here

# 2. Install dependencies
npm install

# 3. Evaluate a job description
node gemini-eval.mjs "We are looking for a Senior AI Engineer..."
node gemini-eval.mjs --file ./jds/my-job.txt
node agent-inbox.mjs add "..."   # queue a request for the next session
npm run gemini:eval -- "JD text here"
```

> **Nivel gratuito:** las dos opciones funcionan sin facturación. El CLI nativo usa OAuth de Google; el script de la API usa `gemini-3.6-flash` (los límites de peticiones dependen del modelo y del nivel; consulta las cuotas vigentes en la documentación de Google AI).

## Uso

career-ops usa un enrutador de comandos compartido. En los CLIs que registran comandos de barra, se ve así:

```
/career-ops           → Muestra todos los comandos disponibles
/career-ops {JD}      → AUTO-PIPELINE: evaluación + informe + PDF + tracker (pega texto o URL)
/career-ops pipeline  → Procesa las URLs pendientes de la bandeja (data/pipeline.md)
/career-ops oferta    → Solo evaluación, bloques A a G (sin PDF automático)
/career-ops ofertas   → Compara y ordena varias ofertas
/career-ops contacto  → Jugada maestra en LinkedIn: encuentra contactos + redacta el mensaje
/career-ops deep      → Prompt de investigación en profundidad sobre la empresa
/career-ops interview-prep → Genera un documento de preparación de entrevista específico de la empresa
/career-ops interview    → Entrevista interactiva de alta de perfil y CV
/career-ops eu-swe    → Calibra una candidatura europea de SWE antes del CV, la solicitud o la entrevista
/career-ops eu-fintech → Escanea 21 portales fintech europeos buscando puestos de Product Manager (sin tokens)
/career-ops interview/plan → Plan de preparación por bloques de tiempo para una entrevista próxima
/career-ops interview/practice → Entrevista de práctica, una pregunta cada vez con feedback
/career-ops interview/debrief → Análisis posterior a la entrevista: cierra huecos, anticipa la siguiente ronda
/career-ops interview-redflag → Analiza las señales de alarma del empleador antes de incorporarte
/career-ops pdf       → Solo PDF, CV optimizado para ATS
/career-ops text      → CV adaptado en markdown (refleja cv.md, sin PDF)
/career-ops latex     → Exporta el CV a LaTeX/Overleaf .tex
/career-ops latex-tex → Adapta tu propio resume.tex en el sitio (opcional; cv.md sigue siendo el predeterminado)
/career-ops cover     → Carta de presentación: pega una descripción suelta o /career-ops cover {slug}
/career-ops email     → Borrador de correo formal de candidatura (solo borrador; nunca envía, presenta ni hace clic)
/career-ops add       → Añade un proyecto, artículo o puesto a tu CV (descarga + vista previa + confirmación)
/career-ops expand    → Descubre y añade automáticamente competencias que faltan a partir de los enlaces de tu perfil
/career-ops training  → Evalúa un curso o certificación frente a tu North Star
/career-ops project   → Evalúa una idea de proyecto de portfolio
/career-ops tracker   → Resumen del estado de las candidaturas
/career-ops agent-inbox → Encola o vacía peticiones para la siguiente sesión (data/agent-inbox.md)
/career-ops apply     → Asistente de candidatura en vivo (lee el formulario + genera las respuestas)
/career-ops scan      → Escanea portales y descubre ofertas nuevas
/career-ops discover  → Convierte una lista de empresas en tablones ATS escaneables y los añade a portals.yml (sin tokens)
/career-ops batch     → Procesamiento en lote con workers en paralelo
/career-ops patterns  → Analiza patrones de rechazo y mejora la puntería
/career-ops offer-prep → Lee una oferta o contrato recibido con el candidato: recorrido por cláusulas + preguntas para el abogado (no es asesoría legal)
/career-ops titles    → Sugiere títulos de puesto afines a partir de tu CV para ampliar la búsqueda
/career-ops upskill   → Análisis agregado de carencias de habilidades a partir de tus informes evaluados
/career-ops followup  → Seguimiento de la cadencia de contacto: marca los vencidos, genera borradores
/career-ops reply-watch → Clasifica las respuestas del empleador y sugiere actualizaciones del tracker
/career-ops outcome   → Registra el resultado de la candidatura y archiva los artefactos
/career-ops calibrate → Informe orientativo: ¿tus notas de evaluación predicen tus resultados reales? Lee los datos de /outcome; nunca cambia la puntuación
/career-ops update    → Actualiza los ficheros de sistema de career-ops con vista previa del diff + comprobación de compatibilidad
```

O simplemente pega una URL o la descripción de una oferta: career-ops la detecta y ejecuta el pipeline completo.

En Codex los comandos de barra no están garantizados. Usa los mismos nombres de modo en un prompt, o llámalos desde `codex exec`.

## Cómo funciona

```
You paste a job URL or description
        │
        ▼
┌──────────────────┐
│  Archetype       │  Classifies: LLMOps / Agentic / PM / SA / FDE / Transformation
│  Detection       │
└────────┬─────────┘
         │
┌────────▼─────────┐
│  A-H Evaluation  │  Match, gaps, comp research, STAR stories, legitimacy
│  (reads cv.md)   │
└────────┬─────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
 Report  PDF  Tracker
  .md   .pdf  entry
```

## Portales preconfigurados

El escáner viene con **100+ empresas** listas para escanear y **45+ consultas de búsqueda** en los principales portales de empleo. Copia `templates/portals.example.yml` a `portals.yml` y añade las tuyas:

**Laboratorios de IA:** Anthropic, OpenAI, Mistral, Cohere, LangChain, Pinecone
**IA de voz:** ElevenLabs, PolyAI, Parloa, Hume AI, Deepgram, Vapi, Bland AI
**Plataformas de IA:** Retool, Airtable, Vercel, Temporal, Glean, Arize AI
**Contact center:** Ada, LivePerson, Sierra, Decagon, Talkdesk, Genesys
**Enterprise:** Salesforce, Twilio, Gong, Dialpad
**LLMOps:** Langfuse, Weights & Biases, Lindy, Cognigy, Speechmatics
**Automatización:** n8n, Zapier, Make.com
**Europa:** Factorial, Attio, Tinybird, Clarity AI, Travelperk

**Portales de empleo cubiertos:** 55+ módulos de proveedor cubren APIs de ATS, feeds de portales completos, feeds XML/RSS, feeds en markdown y analizadores locales. La tabla completa está en [Portales de empleo compatibles](docs/SUPPORTED_JOB_BOARDS.md).

Por defecto `node scan.mjs` (también `npm run scan`) se fía de lo que devuelve cada feed de ATS. Algunas empresas dejan ofertas caducadas en su API pública incluso después de cerrar el puesto, así que esas entradas pueden colarse en `pipeline.md`. Pasa `--verify` para lanzar Playwright después de la pasada por la API y descartar las ofertas caducadas antes de que lleguen al pipeline:

```bash
node scan.mjs --verify          # zero-token discovery + Playwright liveness check
```

La verificación es secuencial y solo se ejecuta sobre las ofertas nuevas (tras la deduplicación), así que el coste queda acotado.

## Dashboard TUI

El dashboard integrado en la terminal te permite navegar por tu pipeline de forma visual:

```bash
npm run serve:dashboard   # launch the TUI
npm run build:dashboard   # optional: build the standalone binary
```

Funcionalidades: 6 pestañas de filtro, 4 modos de ordenación, vista agrupada o plana, previsualizaciones con carga diferida, cambios de estado en línea.

También hay una **interfaz web experimental** (alfa, opcional: no se ejecuta nada si no la arrancas tú): ver [`web/README.md`](web/README.md).

## Estructura del proyecto

```
career-ops/
├── AGENTS.md                    # Canonical agent instructions (all CLIs)
├── CLAUDE.md                    # Claude Code wrapper (imports AGENTS.md)
├── CODEX.md                     # Codex wrapper (imports AGENTS.md)
├── OPENCODE.md                  # OpenCode wrapper (imports AGENTS.md)
├── GEMINI.md                    # Legacy no-op guard to avoid Antigravity duplicate context
├── cv.md                        # Your CV (create this)
├── article-digest.md            # Your proof points (optional)
├── config/
│   └── profile.example.yml      # Template for your profile
├── modes/                       # Skill modes
│   ├── _shared.md               # Shared context (customize this)
│   ├── oferta.md                # Single evaluation
│   ├── pdf.md                   # PDF generation
│   ├── cover.md                 # Cover letter generation
│   ├── email.md                 # Formal application email drafts
│   ├── scan.md                  # Portal scanner
│   ├── batch.md                 # Batch processing
│   └── ...
├── templates/
│   ├── cv-template.html         # ATS-optimized CV template
│   ├── portals.example.yml      # Scanner config template
│   └── states.yml               # Canonical statuses
├── batch/
│   ├── batch-prompt.md          # Self-contained worker prompt
│   └── batch-runner.sh          # Orchestrator script
├── dashboard/                   # Go TUI pipeline viewer
├── data/                        # Your tracking data (gitignored)
├── reports/                     # Evaluation reports (gitignored)
├── output/                      # Generated PDFs (gitignored)
├── fonts/                       # Space Grotesk + DM Sans
├── docs/                        # Setup, customization, budget guide, architecture
└── examples/                    # Sample CV, report, proof points
```

## Directorio de datos externo (opcional)

Por defecto, los datos de la capa de usuario (como `cv.md`, `portals.yml` y las carpetas `data/`, `reports/` y `output/`) viven dentro de la carpeta raíz del proyecto.

Para separar tus datos personales del código (y así cambiar de rama, traer actualizaciones o probar varios perfiles con más facilidad), puedes configurar un directorio de datos externo con esta precedencia:

1. **Variables de entorno:** define la variable `CAREER_OPS_ROOT` o `CAREER_OPS_DATA_DIR`:
   ```bash
   export CAREER_OPS_ROOT=~/my-career-data
   ```
2. **Fichero marcador:** crea un fichero `.career-ops-data` en la raíz del repositorio con la ruta a tu directorio de datos.
3. **Por defecto:** la raíz del repositorio.

Una vez resuelto, todos los ficheros de usuario se resuelven y se escriben relativos a esa carpeta, mientras que los ficheros de prompts y los scripts siguen resolviéndose relativos al repositorio.

- **Sobrescribir el tracker:** también puedes definir `CAREER_OPS_TRACKER` para indicar directamente la ruta del fichero del tracker de candidaturas.
- **Escrituras:** todas las operaciones de escritura (como las fusiones) apuntan canónicamente a `{DATA_ROOT}/data/applications.md`.

El dashboard TUI en Go, los scripts de Node.js y los modos del agente de IA respetan automáticamente esta jerarquía de resolución.


## Stack tecnológico

![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white)
![Bubble Tea](https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white)

- **Agente**: CLI de programación con IA con skills y modos compartidos (`AGENTS.md` + envoltorio por CLI)
- **PDF**: Playwright + plantilla HTML
- **Cartas de presentación**: plantilla HTML + Playwright (PDF A4, mismo pipeline que los CVs)
- **Escáner**: Playwright + API de Greenhouse + WebSearch
- **Dashboard**: Go + Bubble Tea + Lipgloss (tema Catppuccin Mocha)
- **Datos**: tablas Markdown + configuración YAML + ficheros TSV de lote

## También open source

- **[cv-santiago](https://github.com/santifer/cv-santiago)**: la web de portfolio (santifer.io) con chatbot de IA, dashboard de LLMOps y case studies. Si necesitas un portfolio que acompañe tu búsqueda de empleo, haz un fork y hazlo tuyo.

## Preguntas frecuentes (FAQ)

**¿Qué es career-ops?**
career-ops es una búsqueda de empleo con IA, open source, que corre en local dentro de tu CLI de programación con IA (Claude Code, Codex, OpenCode y otros) y deja cada decisión en tus manos. Evalúa ofertas frente a tu CV, genera PDFs adaptados a los ATS, encuentra a la persona adecuada a la que escribir y lo registra todo en un solo sitio: la última palabra siempre es tuya. Es la primera implementación de referencia del Manifiesto CareerOps. Más en [career-ops.org](https://career-ops.org).

**¿Puede el CV personalizado inventarse cosas?**
No debe, y los prompts lo dicen: reformular, nunca inventar. Esa regla todavía no está garantizada por un control en el código. Dos issues abiertas lo siguen: [#2677](https://github.com/career-ops-hq/career-ops/issues/2677) (los cargos deben coincidir con cv.md) y [#1411](https://github.com/career-ops-hq/career-ops/issues/1411) (control de fidelidad que bloquea si falla). Hasta que se mergeen, lee cada CV antes de enviarlo. El [aviso legal](LEGAL_DISCLAIMER.md) dice lo mismo con más palabras.

**¿Puedo usar career-ops gratis, o con un modelo más barato o local?**
Sí. career-ops es independiente del CLI y funciona con modelos gratuitos y locales (modelos gratuitos de OpenRouter, Ollama o cualquier endpoint compatible con OpenAI), así que no dependes de ninguna suscripción de pago. Consulta [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md) para la configuración completa.

**Pago Claude Pro/Max pero career-ops me está consumiendo créditos de la API. ¿Por qué?**
Porque una `ANTHROPIC_API_KEY` en tu entorno tiene prioridad sobre la suscripción con la que has iniciado sesión: el CLI usa la clave y factura por token. Ejecuta `echo $ANTHROPIC_API_KEY` y, si imprime algo, quítala del perfil de tu shell, reinicia la terminal y ejecuta `/login`. El modo en lote es la excepción, porque los workers `claude -p` no usan el inicio de sesión interactivo: ejecuta `claude setup-token` una vez y exporta el resultado como `CLAUDE_CODE_OAUTH_TOKEN`. Guía completa en [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md#2b-already-paying-for-a-subscription-make-sure-you-are-using-it).

**¿Con qué CLIs de IA funciona career-ops?**
career-ops funciona con cualquier CLI de programación con IA importante (Claude Code, Codex, Gemini / Antigravity, OpenCode, Grok, Qwen y más) a través del estándar abierto Agent Skill Standard, así que nunca queda atado a un solo proveedor. Usa el CLI que ya tengas.

**¿Cómo instalo career-ops en Windows?**
career-ops funciona en Windows. La configuración específica de la plataforma y sus aristas conocidas (detección de Git Bash, finales de línea, Programador de tareas) están en [docs/WINDOWS.md](docs/WINDOWS.md). Si las skills no cargan por un error de enlace simbólico durante la instalación, la solución está en [docs/FAQ.md](docs/FAQ.md). Los pasos completos están en [docs/SETUP.md](docs/SETUP.md).

**¿career-ops aplica a las ofertas por mí?**
No. career-ops es un filtro, no un aplicador masivo a ciegas. La IA evalúa, puntúa y redacta; tú revisas y decides. Nunca envía, manda ni hace clic en nada: la última palabra siempre es tuya. Ese diseño con una persona al mando es justo el sentido de todo.

**¿career-ops es gratis y open source?**
Sí. career-ops es gratis y open source, y para el candidato siempre lo será: es la primera implementación de referencia del [Manifiesto CareerOps](https://career-ops.org/manifesto). Léelo y, si dice lo que tú crees, fírmalo.

## Sobre el autor

Soy [Santiago Fernández de Valderrama Aparicio](https://santifer.io/about) (santifer): Head of Applied AI, exfundador (monté y vendí un negocio que sigue funcionando con mi nombre). Construí career-ops para gestionar mi propia búsqueda de empleo. Funcionó: lo usé para conseguir mi puesto actual.

¿Curiosidad por cómo se mantiene este repositorio en unas 4 horas a la semana? Lee [Agentic maintenance: how career-ops is run by a fleet of AI agents](https://santifer.io/ai-agent-fleet).

Mi portfolio y otros proyectos open source → [santifer.io](https://santifer.io)

Wikidata: [Santiago Fernández de Valderrama Aparicio](https://www.wikidata.org/wiki/Q138710224) · [career-ops](https://www.wikidata.org/wiki/Q139007988).

## Aviso legal

**career-ops es una herramienta local y open source, NO un servicio alojado.** Al usar este software, aceptas que:

1. **Tú controlas tus datos.** Tu CV, tus datos de contacto y tu información personal se quedan en tu máquina y se envían directamente al proveedor de IA que elijas (Anthropic, OpenAI, etc.). No recopilamos, almacenamos ni tenemos acceso a ninguno de tus datos.
2. **Tú controlas la IA.** Los prompts por defecto instruyen a la IA para que no envíe candidaturas automáticamente, pero los modelos de IA pueden comportarse de forma impredecible. Si modificas los prompts o usas otros modelos, lo haces bajo tu responsabilidad. **Revisa siempre la exactitud del contenido generado por la IA antes de enviarlo.**
3. **Tú cumples las condiciones de terceros.** Debes usar esta herramienta de acuerdo con las condiciones de servicio de los portales de empleo con los que interactúes (Greenhouse, Lever, Workday, LinkedIn, etc.). No uses esta herramienta para hacer spam a las empresas ni para saturar sistemas ATS.
4. **Sin garantías.** Las evaluaciones son recomendaciones, no verdades. Los modelos de IA pueden inventar habilidades o experiencia. Los autores no son responsables de resultados laborales, candidaturas rechazadas, restricciones de cuenta ni de ninguna otra consecuencia.

Consulta [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md) para todos los detalles. Este software se distribuye bajo la [licencia MIT](LICENSE) "tal cual", sin garantía de ningún tipo.

## Contribuidores

<a href="https://github.com/career-ops-hq/career-ops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=career-ops-hq/career-ops" />
</a>

Todas las personas que han aportado código, documentación, traducciones o tests están en
[CONTRIBUTORS.md](CONTRIBUTORS.md), incluidas las contribuciones que no son código y que
el gráfico de arriba no puede mostrar.

¿Has conseguido trabajo con career-ops? [¡Cuenta tu historia!](https://github.com/career-ops-hq/career-ops/issues/new?template=i-got-hired.yml)

## Licencia y marca

El código se distribuye bajo licencia [MIT](LICENSE). El nombre y la marca
"career-ops" se rigen por la [política de marca](TRADEMARK.md), permisiva
para el uso comunitario y reservada para nombrar productos comerciales y
para el respaldo de los mismos.

## Reconocimientos

<p align="center">
  <a href="https://warpchart.dev/hq">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://warpchart.dev/api/chart?theme=dark&v=3">
      <img alt="Live star telemetry of career-ops-hq/career-ops" src="https://warpchart.dev/api/chart?theme=light&v=3" loading="lazy">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/Join_the_community-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
</p>

<p align="center">
  <a href="https://github.com/career-ops-hq/career-ops/releases/latest"><img src="https://img.shields.io/npm/v/%40santifer%2Fcareer-ops?style=for-the-badge&labelColor=2b3137&color=2ea44f&label=release" alt="Latest release"></a>
</p>

<p align="center">
  <a href="https://claude.com/claude-code"><img src="https://img.shields.io/badge/Built_with-Claude_Code-000?style=for-the-badge&logo=anthropic&logoColor=white" alt="Built with Claude Code"></a>
</p>

<p align="center">
  <sub>También funciona en cualquier CLI compatible con el estándar agent-skill. Ver <a href="docs/SUPPORTED_CLIS.md">CLIs compatibles</a>.</sub><br>
  <img src="https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/OpenCode-111827?style=flat&logo=terminal&logoColor=white" alt="OpenCode">
  <img src="https://img.shields.io/badge/Antigravity_CLI-4285F4?style=flat&logo=google&logoColor=white" alt="Antigravity CLI">
  <img src="https://img.shields.io/badge/Codex-412991?style=flat&logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Qwen-615CED?style=flat" alt="Qwen">
  <img src="https://img.shields.io/badge/Kimi-FF4B4B?style=flat" alt="Kimi">
  <img src="https://img.shields.io/badge/GitHub_Copilot-000?style=flat&logo=githubcopilot&logoColor=white" alt="GitHub Copilot">
  <img src="https://img.shields.io/badge/Grok_Build_CLI-000?style=flat&logo=x&logoColor=white" alt="Grok Build CLI">
  <br>
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white" alt="Playwright">
  <img src="https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white" alt="Bubble Tea">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT">
  <a href="TRADEMARK.md"><img src="https://img.shields.io/badge/Trademark-Policy-blue.svg" alt="Trademark Policy"></a>
</p>

## Conecta

[![Website](https://img.shields.io/badge/santifer.io-000?style=for-the-badge&logo=safari&logoColor=white)](https://santifer.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/santifer)
[![X](https://img.shields.io/badge/X-000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/santifer)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/8pRpHETxa4)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:hi@santifer.io)
