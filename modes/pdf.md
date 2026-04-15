# Modo: pdf — Generación de PDF ATS-Optimizado

## Pipeline completo

1. Lee `cv.md` como fuentes de verdad
2. Pide al usuario el JD si no está en contexto (texto o URL)
3. Extrae 15-20 keywords del JD
4. Detecta idioma del JD → idioma del CV (EN default)
5. Detecta ubicación empresa → formato papel:
   - US/Canada → `letter`
   - Resto del mundo → `a4`
6. Detecta arquetipo del rol → adapta framing
7. Reescribe Professional Summary inyectando keywords del JD + exit narrative bridge ("Built and sold a business. Now applying systems thinking to [domain del JD].")
8. Selecciona top 3-4 proyectos más relevantes para la oferta
9. Reordena bullets de experiencia por relevancia al JD
10. Construye competency grid desde requisitos del JD (6-8 keyword phrases)
11. Inyecta keywords naturalmente en logros existentes (NUNCA inventa)
12. Genera HTML completo desde template + contenido personalizado
13. Escribe HTML a `/tmp/cv-candidate-{company}.html`
14. Ejecuta: `node generate-pdf.mjs /tmp/cv-candidate-{company}.html output/cv-candidate-{company}-{YYYY-MM-DD}.pdf --format={letter|a4}`
15. **Verificación visual OBLIGATORIA** (ver sección abajo) — NO confirmar output hasta pasar esta verificación
16. Reporta: ruta del PDF, nº páginas, % cobertura de keywords

## Reglas ATS (parseo limpio)

- Layout single-column (sin sidebars, sin columnas paralelas)
- Headers estándar: "Professional Summary", "Work Experience", "Education", "Skills", "Certifications", "Projects"
- Sin texto en imágenes/SVGs
- Sin info crítica en headers/footers del PDF (ATS los ignora)
- UTF-8, texto seleccionable (no rasterizado)
- Sin tablas anidadas
- Keywords del JD distribuidas: Summary (top 5), primer bullet de cada rol, Skills section

## Diseño del PDF

- **Fonts**: Space Grotesk (headings, 700) + DM Sans (body, 400-700) — both self-hosted in `fonts/`
- **Body base**: DM Sans 10px, line-height 1.5, color `#1E293B`
- **Header**: foto circular 60px a la IZQUIERDA (profile-card layout, sin ring/box-shadow, `margin-top: 3px`) + bloque derecho con nombre Space Grotesk 28px 700 `#0F172A` + tagline DM Sans 10.5px `#94A3B8` + contact row. Header tiene `border-bottom: 1px solid #E2E8F0; padding-bottom: 8px` — SIN línea gradiente.
- **Contact row separators**: `·` (middot), not `|`
- **Contact icons**: 4 SVGs Lucide (`fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, 9×9px, color `#94A3B8`) — phone, mail, linkedin (outline), map-pin. Cada item en `<span class="ci">` (inline-flex, gap 3px).
- **Section titles**: Space Grotesk 11.5px, uppercase, letter-spacing 0.12em, indigo `#4F46E5`, border-bottom 1px `#E2E8F0` — no left bar (same size as company names)
- **Company names**: Space Grotesk 11.5px 700, `#0F172A`
- **Date badges**: DM Sans 8.5px 500, `#475569`, background `#F1F5F9`, border-radius 4px — mismo estilo para job-period, edu-year, cert-year
- **Competency tags**: pill shape (border-radius: 20px), indigo `#4338CA` text, `#EEF2FF` bg, `#C7D2FE` border
- **Key metrics (strong)**: `color: #4338CA` + `background: rgba(79,70,229,0.08)` — highlight sutil, atrae el ojo del reclutador
- **Job separators**: `.job + .job { border-top: 1px solid #E2E8F0; padding-top: 7px; }` — evita el efecto "flotante"
- **Márgenes PDF**: 0.6in todos los lados
- **Background**: blanco puro

## Orden de secciones (optimizado "6-second recruiter scan")

1. Header (nombre grande, border-bottom limpio, contacto con iconos Lucide)
2. Professional Summary (3-4 líneas, keyword-dense)
3. Core Competencies (6-8 keyword phrases en flex-grid)
4. Work Experience (cronológico inverso)
5. Projects (top 3-4 más relevantes)
6. Education & Certifications
7. Skills (idiomas + técnicos)

## Regla de una página

**El CV debe caber en una sola página A4.** Al generar contenido:
- Professional Summary: 3-4 líneas (apuntar a 4 líneas completas para evitar whitespace vacío)
- Core Competencies: **5-6 items cortos** (≤20 chars cada uno) — el grid es `flex-wrap: nowrap`, solo hay 1 línea. Tags largos se recortan.
- Experience bullets: 2-3 por rol (priorizar los más relevantes al JD)
- Projects: máximo 2-3
- Si hay demasiado contenido, recortar bullets — nunca reducir el font-size en el HTML

## Estructura HTML de experiencia laboral

Usar esta estructura para cada entrada `{{EXPERIENCE}}`:

```html
<!-- Rol con bullets -->
<div class="job">
  <div class="job-header">
    <span class="job-company">Nombre Empresa</span>
    <span class="job-period">Mes AAAA – Mes AAAA</span>
  </div>
  <div class="job-meta">
    <span class="role">Título del Rol</span>
    <span class="dot">·</span>
    <span class="location">Ciudad</span>
  </div>
  <ul>
    <li>Bullet con <strong>métrica clave</strong> en coral</li>
  </ul>
</div>

<!-- Rol compacto (antiguo o breve) — sin lista de bullets -->
<div class="job">
  <div class="job-header">
    <span class="job-company">Nombre Empresa</span>
    <span class="job-period">Mes AAAA – Mes AAAA</span>
  </div>
  <div class="job-meta">
    <span class="role">Título del Rol</span>
    <span class="dot">·</span>
    <span class="location">Ciudad · nota adicional</span>
  </div>
  <div class="job-note">Una línea de descripción compacta.</div>
</div>
```

Los separadores entre entradas son automáticos vía CSS (`.job + .job { border-top: 1px solid #eef0f4; }`).

Para educación y certificaciones, usar el mismo badge de fecha:
```html
<span class="edu-year">2015–2020</span>
<span class="cert-year">Jan 2026</span>
```

## Reglas de contenido del CV

- **No incluir GitHub URL** en la fila de contacto por defecto. Solo añadir si el rol lo requiere explícitamente (automation engineer, technical ops, etc.) y el JD lo menciona.
- **No incluir `career-ops` en proyectos** — es una herramienta personal de job search, no un proyecto profesional relevante para la mayoría de roles.
- **Sección Proyectos (`{{PROJECTS_SECTION}}`)**: omitir la sección completa si no hay proyectos genuinamente relevantes para el JD. Usar `<!-- no projects -->` o eliminar el bloque. No inventar proyectos.
- **`{{TAGLINE}}`**: derivar del arquetipo del rol (ej. "Operations & Automation Manager", "Supply Chain Manager", "Chief of Staff"). Nunca dejar en blanco.
- **Roles compactos**: SOLO los 2 roles más antiguos o cortos pueden usar `.job-note`. Los roles de carrera media deben usar `<ul>` con bullets.
- **`{{NAME}}` — COPIAR VERBATIM de cv.md línea 1**: No reescribir el nombre manualmente. El nombre contiene `î` (U+00EE, i con circunflejo). Reescribirlo a mano arriesga sustituirlo por `ï` (i con diéresis). Copiar exactamente del archivo fuente.
- **`<strong>` OBLIGATORIO en todos los entries**: Cada `<li>` en cada job DEBE envolver al menos una métrica clave en `<strong>`. Igual para `.job-note` — envolver cifras/logros clave en `<strong>`. Esto activa el highlight indigo del CSS. No dejar ningún entry sin highlights.
- **Densidad de bullets para llenar la página A4**: roles recientes (últimos 3 años): 3–4 bullets. Roles anteriores: 2–3 bullets. Solo `.job-note` para los 2 roles más antiguos/cortos.

## Verificación visual del output — OBLIGATORIA (paso 15)

Ejecutar SIEMPRE antes de confirmar el output. NO se puede omitir.

```bash
# 1. Copiar HTML a raíz del proyecto (para que ./fonts/ y ./resources/ resuelvan bien)
cp /tmp/cv-candidate-{company}.html cv-preview.html

# 2. Servidor HTTP en background
python3 -m http.server 7788 &
HTTP_PID=$!

# 3. Screenshot con Playwright (Node.js directo, NO MCP — el MCP falla entre llamadas)
node -e "const {chromium}=require('playwright');(async()=>{const b=await chromium.launch({headless:true});const p=await b.newPage();await p.goto('http://localhost:7788/cv-preview.html',{waitUntil:'networkidle'});await p.evaluate(()=>document.fonts.ready);await p.screenshot({path:'cv-verification.png',fullPage:true});await b.close();})()"

# 4. Limpiar
kill $HTTP_PID 2>/dev/null; rm cv-preview.html
```

**Checklist de verificación** — leer `cv-verification.png` y confirmar cada punto:
- [ ] Nombre renderiza exactamente como en cv.md (ej. `Benoît`, no `Benoït`)
- [ ] Foto visible y circular
- [ ] Space Grotesk en nombre y títulos de sección
- [ ] Sin barras verticales antes de los títulos de sección
- [ ] Competencies en 1 línea (no overflow)
- [ ] Todos los job entries tienen texto en indigo (`<strong>`) — ninguno sin highlights
- [ ] Contenido llena la mayor parte de la página A4 (sin espacio vacío grande al final)
- [ ] Nada cortado por overflow

Si algún punto falla → corregir el HTML y repetir desde el paso 14.

## Herramientas condicionales

Solo incluir Make/Integromat o n8n en Skills si el JD las menciona explícitamente. Por defecto, omitir.

## Estrategia de keyword injection (ético, basado en verdad)

Ejemplos de reformulación legítima:
- JD dice "RAG pipelines" y CV dice "LLM workflows with retrieval" → cambiar a "RAG pipeline design and LLM orchestration workflows"
- JD dice "MLOps" y CV dice "observability, evals, error handling" → cambiar a "MLOps and observability: evals, error handling, cost monitoring"
- JD dice "stakeholder management" y CV dice "collaborated with team" → cambiar a "stakeholder management across engineering, operations, and business"

**NUNCA añadir skills que el candidato no tiene. Solo reformular experiencia real con el vocabulario exacto del JD.**

## Template HTML

Usar el template en `cv-template.html`. Reemplazar los placeholders `{{...}}` con contenido personalizado.

**IMPORTANTE — reemplazo global en Node.js**: Usar `s.split(key).join(value)` en lugar de `s.replace(key, value)`. `String.replace()` solo reemplaza la **primera** ocurrencia — `{{NAME}}` aparece en el `<title>` Y en el `<h1>`, y el segundo queda sin reemplazar si se usa `.replace()`.

| Placeholder | Contenido |
|-------------|-----------|
| `{{LANG}}` | `en` o `es` |
| `{{PAGE_WIDTH}}` | `8.5in` (letter) o `210mm` (A4) |
| `{{NAME}}` | (from profile.yml) |
| `{{PHONE}}` | (from profile.yml — include with its separator only when `profile.yml` has a non-empty `phone` value; omit both `<span>` and `<span class="separator">` otherwise) |
| `{{EMAIL}}` | (from profile.yml) |
| `{{LINKEDIN_URL}}` | [from profile.yml] |
| `{{LINKEDIN_DISPLAY}}` | [from profile.yml] |
| `{{PORTFOLIO_URL}}` | [from profile.yml] (o /es según idioma) |
| `{{PORTFOLIO_DISPLAY}}` | [from profile.yml] (o /es según idioma) |
| `{{PHONE}}` | `07 70 41 27 88` (from profile.yml) |
| `{{PHOTO_SRC}}` | `./resources/image.png` |
| `{{TAGLINE}}` | Archetype-specific role title, e.g. "Operations & Automation Manager" |
| `{{LOCATION}}` | [from profile.yml] |
| `{{SECTION_SUMMARY}}` | Professional Summary / Resumen Profesional |
| `{{SUMMARY_TEXT}}` | Summary personalizado con keywords |
| `{{SECTION_COMPETENCIES}}` | Core Competencies / Competencias Core |
| `{{COMPETENCIES}}` | `<span class="competency-tag">keyword</span>` × 6-8 |
| `{{SECTION_EXPERIENCE}}` | Work Experience / Experiencia Laboral |
| `{{EXPERIENCE}}` | HTML de cada trabajo con bullets reordenados |
| `{{SECTION_PROJECTS}}` | Projects / Proyectos |
| `{{PROJECTS}}` | HTML de top 3-4 proyectos |
| `{{SECTION_EDUCATION}}` | Education / Formación |
| `{{EDUCATION}}` | HTML de educación |
| `{{SECTION_CERTIFICATIONS}}` | Certifications / Certificaciones |
| `{{CERTIFICATIONS}}` | HTML de certificaciones |
| `{{SECTION_SKILLS}}` | Skills / Competencias |
| `{{SKILLS}}` | HTML de skills |

## Canva CV Generation (optional)

If `config/profile.yml` has `canva_resume_design_id` set, offer the user a choice before generating:
- **"HTML/PDF (fast, ATS-optimized)"** — existing flow above
- **"Canva CV (visual, design-preserving)"** — new flow below

If the user has no `canva_resume_design_id`, skip this prompt and use the HTML/PDF flow.

### Canva workflow

#### Step 1 — Duplicate the base design

a. `export-design` the base design (using `canva_resume_design_id`) as PDF → get download URL
b. `import-design-from-url` using that download URL → creates a new editable design (the duplicate)
c. Note the new `design_id` for the duplicate

#### Step 2 — Read the design structure

a. `get-design-content` on the new design → returns all text elements (richtexts) with their content
b. Map text elements to CV sections by content matching:
   - Look for the candidate's name → header section
   - Look for "Summary" or "Professional Summary" → summary section
   - Look for company names from cv.md → experience sections
   - Look for degree/school names → education section
   - Look for skill keywords → skills section
c. If mapping fails, show the user what was found and ask for guidance

#### Step 3 — Generate tailored content

Same content generation as the HTML flow (Steps 1-11 above):
- Rewrite Professional Summary with JD keywords + exit narrative
- Reorder experience bullets by JD relevance
- Select top competencies from JD requirements
- Inject keywords naturally (NEVER invent)

**IMPORTANT — Character budget rule:** Each replacement text MUST be approximately the same length as the original text it replaces (within ±15% character count). If tailored content is longer, condense it. The Canva design has fixed-size text boxes — longer text causes overlapping with adjacent elements. Count the characters in each original element from Step 2 and enforce this budget when generating replacements.

#### Step 4 — Apply edits

a. `start-editing-transaction` on the duplicate design
b. `perform-editing-operations` with `find_and_replace_text` for each section:
   - Replace summary text with tailored summary
   - Replace each experience bullet with reordered/rewritten bullets
   - Replace competency/skills text with JD-matched terms
   - Replace project descriptions with top relevant projects
c. **Reflow layout after text replacement:**
   After applying all text replacements, the text boxes auto-resize but neighboring elements stay in place. This causes uneven spacing between work experience sections. Fix this:
   1. Read the updated element positions and dimensions from the `perform-editing-operations` response
   2. For each work experience section (top to bottom), calculate where the bullets text box ends: `end_y = top + height`
   3. The next section's header should start at `end_y + consistent_gap` (use the original gap from the template, typically ~30px)
   4. Use `position_element` to move the next section's date, company name, role title, and bullets elements to maintain even spacing
   5. Repeat for all work experience sections
d. **Verify layout before commit:**
   - `get-design-thumbnail` with the transaction_id and page_index=1
   - Visually inspect the thumbnail for: text overlapping, uneven spacing, text cut off, text too small
   - If issues remain, adjust with `position_element`, `resize_element`, or `format_text`
   - Repeat until layout is clean
d. Show the user the final preview and ask for approval
e. `commit-editing-transaction` to save (ONLY after user approval)

#### Step 5 — Export and download PDF

a. `export-design` the duplicate as PDF (format: a4 or letter based on JD location)
b. **IMMEDIATELY** download the PDF using Bash:
   ```bash
   curl -sL -o "output/cv-{candidate}-{company}-canva-{YYYY-MM-DD}.pdf" "{download_url}"
   ```
   The export URL is a pre-signed S3 link that expires in ~2 hours. Download it right away.
c. Verify the download:
   ```bash
   file output/cv-{candidate}-{company}-canva-{YYYY-MM-DD}.pdf
   ```
   Must show "PDF document". If it shows XML or HTML, the URL expired — re-export and retry.
d. Report: PDF path, file size, Canva design URL (for manual tweaking)

#### Error handling

- If `import-design-from-url` fails → fall back to HTML/PDF pipeline with message
- If text elements can't be mapped → warn user, show what was found, ask for manual mapping
- If `find_and_replace_text` finds no matches → try broader substring matching
- Always provide the Canva design URL so the user can edit manually if auto-edit fails

## Post-generación

Actualizar tracker si la oferta ya está registrada: cambiar PDF de ❌ a ✅.
