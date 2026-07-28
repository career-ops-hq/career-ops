# Modo: oferta -- Evaluación completa A-F

Cuando el candidato pegue una oferta (texto o URL), SIEMPRE entregar los 6 bloques.

## Paso 0 -- Detección de arquetipo

Clasificar la oferta en uno de los 6 arquetipos (ver `_shared.md`). Si es híbrida, indicar los 2 más cercanos. Esto determina:
- Qué proof points priorizar en el bloque B
- Cómo reescribir el summary en el bloque E
- Qué stories STAR preparar en el bloque F

## Bloque A -- Resumen del rol

Tabla con:
- Arquetipo detectado
- Dominio (Platform / Agentic / LLMOps / ML / Enterprise)
- Función (Build / Consultoría / Management / Deploy)
- Seniority
- Remoto (Full remote / Híbrido / Presencial)
- Tamaño del equipo (si se menciona)
- TL;DR en 1 frase

## Bloque B -- Match con el CV

Leer `cv.md`. Crear una tabla donde cada requisito de la oferta se mapea sobre líneas exactas del CV.

**Adaptado al arquetipo:**
- FDE -> priorizar los proof points de entrega rápida y cercanía al cliente
- SA -> priorizar el diseño de sistemas y las integraciones
- PM -> priorizar la product discovery y las métricas
- LLMOps -> priorizar evals, observabilidad, pipelines
- Agentic -> priorizar multi-agente, HITL, orquestación
- Transformation -> priorizar gestión del cambio, adopción, escalado

Sección **Gaps** con estrategia de mitigación para cada uno. Para cada gap:
1. ¿Es un bloqueador duro o un nice-to-have?
2. ¿Puede el candidato demostrar experiencia adyacente?
3. ¿Hay algún proyecto del portfolio que cubra este gap?
4. Plan de mitigación concreto (frase para la carta de presentación, mini-proyecto rápido, etc.)

## Bloque C -- Nivel y estrategia

1. **Nivel detectado** en la oferta vs. **nivel natural del candidato para ese arquetipo**
2. **Plan "vender senior sin mentir"**: formulaciones específicas adaptadas al arquetipo, logros concretos a destacar, cómo posicionar la experiencia de fundador como ventaja
3. **Plan "si estoy downlevel"**: aceptar si la remuneración es justa, negociar una revisión a los 6 meses, criterios de promoción claros

## Bloque D -- Remuneración y demanda

Usar WebSearch para:
- Salarios actuales del rol (Glassdoor, LinkedIn Salary Insights, InfoJobs Estudios Salariales, Levels.fyi, Talent.io, Indeed Salarios)
- Reputación de remuneración de la empresa (Glassdoor, LinkedIn)
- Tendencia de demanda del rol en el mercado hispanohablante

Tabla con datos y fuentes citadas. Si no hay datos, decirlo claramente — no inventar nada.

**Mercado español -- Verificaciones obligatorias:**
- ¿Se mencionan pagas extra (14 pagas)? Incluirlas en el cálculo del bruto anual.
- ¿Parte variable (bonus, comisión, stock options / phantom shares)?
- ¿Plan de pensiones o seguro médico mencionados? ¿Histórico disponible?
- ¿Qué convenio colectivo aplica (TIC, Consultoría, Metal…)? Si es así, verificar la categoría.
- ¿Contrato indefinido o temporal? Si es temporal: duración, motivo, posibilidad de conversión a indefinido.
- ¿Freelance / autónomo? Tarifa diaria o mensual, duración del proyecto, riesgo de falsa autonomía.

## Bloque E -- Plan de personalización

| # | Sección | Estado actual | Cambio propuesto | Justificación |
|---|---------|---------------|------------------|---------------|
| 1 | Summary | ... | ... | ... |
| ... | ... | ... | ... | ... |

Top 5 modificaciones del CV + Top 5 modificaciones de LinkedIn para maximizar el match.

## Bloque F -- Plan de entrevistas

6-10 stories STAR+R mapeadas sobre los requisitos de la oferta (STAR + **Reflexión**):

| # | Requisito de la oferta | Story STAR+R | S | T | A | R | Reflexión |
|---|------------------------|--------------|---|---|---|---|-----------|

La columna **Reflexión** captura lo aprendido o lo que se haría diferente. Señala la seniority — los juniors describen lo que ocurrió, los seniors extraen aprendizajes.

**Story Bank:** Si existe `interview-prep/story-bank.md`, verificar si estas stories ya están ahí. Si no, añadir las nuevas. Con el tiempo, esto construye un banco reutilizable de 5-10 stories maestras adaptables a cualquier pregunta de entrevista.

**Seleccionadas y enmarcadas según el arquetipo:**
- FDE -> destacar la velocidad de entrega y la cercanía al cliente
- SA -> destacar las decisiones de arquitectura
- PM -> destacar la discovery y las decisiones de priorización
- LLMOps -> destacar las métricas, evals, hardening en producción
- Agentic -> destacar la orquestación, el manejo de errores, el HITL
- Transformation -> destacar la adopción y el cambio organizacional

Incluir también:
- 1 case study recomendado (qué proyecto presentar y cómo)
- Preguntas red-flag y cómo responderlas (ej.: "¿Por qué dejaste tu empresa?", "¿Tenías equipo a cargo?", "¿Por qué un cambio tan pronto?")

---

## Post-evaluación

**SIEMPRE** ejecutar tras los bloques A-F:

### 1. Guardar el report .md

Guardar la evaluación completa en `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`.

- `{###}` = siguiente número secuencial (3 dígitos, zero-padded). Para asignarlo de forma atómica y evitar condiciones de carrera, ejecutar `node reserve-report-num.mjs` para reservar el número (stdout devuelve `{###}`), escribir el report y luego ejecutar `node reserve-report-num.mjs --release {###}` para liberar el sentinel.
- `{company-slug}` = nombre de empresa en minúsculas, sin espacios (usar guiones)
- `{YYYY-MM-DD}` = fecha de hoy

**Formato del report:**

```markdown
# Evaluación: {Empresa} -- {Rol}

**Fecha:** {YYYY-MM-DD}
**Arquetipo:** {detectado}
**Score:** {X/5}
**URL:** {URL de la oferta}
**PDF:** {ruta o pendiente}

---

## A) Resumen del rol
(contenido completo del bloque A)

## B) Match con el CV
(contenido completo del bloque B)

## C) Nivel y estrategia
(contenido completo del bloque C)

## D) Remuneración y demanda
(contenido completo del bloque D)

## E) Plan de personalización
(contenido completo del bloque E)

## F) Plan de entrevistas
(contenido completo del bloque F)

## G) Borradores de respuestas para la candidatura
(solo si score >= 4.5 -- borradores de respuestas para el formulario de candidatura)

---

## Palabras clave extraídas
(lista de 15-20 palabras clave de la oferta para optimización ATS)
```

### 2. Registrar en el tracker

**SIEMPRE** registrar en `data/applications.md`:
- Siguiente número secuencial
- Fecha de hoy
- Empresa
- Rol
- Score: media del match (1-5)
- Estado: `Evaluated`
- PDF: no (o sí si el auto-pipeline generó un PDF)
- Report: enlace relativo al archivo del report (ej.: `[001](reports/001-company-2026-01-01.md)`)

**Formato del tracker:**

```markdown
| # | Fecha | Empresa | Rol | Score | Estado | PDF | Report |
```
