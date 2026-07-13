# Mode: interview/debrief — Análisis Posterior a la Entrevista (Debrief)

Después de una entrevista real, captura qué se preguntó, evalúa qué funcionó y qué no, cubre las carencias antes de la siguiente ronda y actualiza el banco de preguntas.

---

## When to Run This Skill

- Inmediatamente después de una entrevista real (mientras la memoria está fresca)
- Después de una llamada con el reclutador que haya revelado nueva información sobre el proceso
- Cuando el candidato conozca el formato y el entrevistador de la siguiente ronda

---

## Inputs

1. **Análisis de la entrevista del candidato (Debrief)** — qué preguntas se hicieron, cómo respondió, qué sintió que fue sólido o débil
2. **Nombre y rol del entrevistador** — informa la predicción de la siguiente ronda
3. **Resultado de la ronda** (si se conoce) — avanzó / rechazado / pendiente
4. **Detalles de la siguiente ronda** (si se conocen) — formato, entrevistadores, plazos
5. **Banco de preguntas** en `interview-prep/question-bank.md` — actualizar con datos reales
6. **Banco de historias** en `interview-prep/story-bank.md` — agregar nuevas historias si surgieron
7. **CV** en `cv.md` + `article-digest.md` (si está presente) — para fundamentar las respuestas sugeridas en la experiencia real
8. **Afirmaciones retractadas** en `interview-prep/retracted-claims.md` (si está presente) — barrera estricta (hard gate); nunca uses una afirmación retractada en una respuesta sugerida, incluso si el candidato la dijo en la entrevista
9. **Archivo de preparación específico del rol** — para adjuntar las notas del análisis

---

## Step 1 — Capture What Was Asked

Pide al candidato que enumere cada pregunta que recuerde, en orden si es posible. No le sugieras opciones — deja que recuerde libremente primero.

Para cada pregunta capturada:
- ¿Qué dijeron?
- ¿Cómo reaccionó el entrevistador (señal positiva, neutral, mostró rechazo, pasó a otra cosa rápidamente)?
- ¿Se sintieron seguros o con dudas?

Si la memoria está incompleta, haz preguntas dirigidas:
- "¿Hubo alguna pregunta que te tomó por sorpresa?"
- "¿Hubo algo que desearías haber respondido de otra manera?"
- "¿El entrevistador hizo preguntas de seguimiento (follow-up) sobre algo? — eso generalmente significa que querían más."

---

## Step 2 — Honest Assessment Per Question

Para cada pregunta, produce:

```markdown
**Q: [pregunta]**
- What was said: [resumen de su respuesta]
- What landed: [qué fue bueno — sé específico]
- What was missing: [carencia — término técnico preciso, resultado faltante, sin reflexión, etc.]
- Correct/complete answer: [lo que la respuesta completa debería incluir]
- Status: ✅ Strong / 🟡 Solid / 🔴 Gap
```

Sé directo. Si perdieron el concepto central que la pregunta estaba evaluando, dilo. Si una respuesta fue genuinamente sólida, dilo también. El análisis es el momento de aprendizaje más valioso — la vaguedad lo desperdicia.

---

## Step 3 — Update Question Bank

Para cada pregunta analizada, actualiza `interview-prep/question-bank.md`:
- Cambia el estado a ✅ / 🟡 / 🔴 según el rendimiento real
- Agrega notas de carencias del análisis
- Agrega cualquier nueva pregunta que haya aparecido y que aún no estuviera en el banco

Si el banco de preguntas no existe, créalo con las preguntas de esta entrevista como semilla.

---

## Step 4 — Close the Gaps

Para cada 🔴 carencia identificada:

1. **Explica la respuesta correcta** — clara, concisa, con un ejemplo desarrollado (código, cálculo, diagrama) si es útil
2. **Conecta con una historia real** si es posible — "realmente tienes esto en tu [historia existente del banco de historias] — aquí te muestro cómo usarlo"
3. **Agrega al archivo de preparación del rol** bajo una sección "Gaps to Close Before Round N"
4. **Agrega a `interview-prep/interview-prep-guide.md`** (si el candidato mantiene uno) cuando sea un principio reutilizable que se aplique más allá de este rol

---

## Step 5 — Extract New Stories

A veces, una entrevista real saca a relucir una historia que el candidato no había preparado. Si el candidato describió una experiencia que no había formalizado:

> "Mencionaste [X] en tu respuesta — parece que podría convertirse en una historia STAR+R adecuada. ¿Quieres desarrollarla ahora que está fresca?"

Si dice que sí, desarróllala como una historia STAR+R (Situación, Tarea, Acción, Resultado, Reflexión) y agrégala a `interview-prep/story-bank.md`.

---

## Step 6 — Next Round Intelligence

Si el candidato conoce el formato de la próxima ronda:

1. **Predice posibles preguntas** basándote en:
   - El rol del próximo entrevistador (ej., practitioner senior → profundidad en la habilidad central, diseño; colega interfuncional → colaboración, límites del dominio; ejecutivo → estrategia, impacto en el negocio)
   - Lo que se cubrió en esta ronda (la próxima ronda suele profundizar, no abarcar más)
   - En lo que el entrevistador de esta ronda pareció más interesado

   Etiqueta cada predicción con `[inferred]` — nunca presentes una pregunta predicha como si se hubiera obtenido de candidatos reales o expertos internos.

2. **Construye una lista de prioridades** para la preparación de la próxima ronda — ordenada por gravedad de la carencia y probabilidad de ser evaluada

3. **Sugiere ejecutar** `interview/plan` con los detalles de la próxima ronda para crear un plan de preparación completo

---

## Step 7 — Probability Assessment (Optional)

Si el candidato pide una lectura honesta sobre sus posibilidades:

Evalúa en base a:
- Número y gravedad de las carencias (🔴 en fundamentos = mayor riesgo que 🔴 en temas avanzados)
- Señales del entrevistador (dio detalles específicos de la siguiente ronda = positivo; vago = neutral; llamada corta = riesgo)
- Ajuste al rol (años de experiencia, coincidencia de dominio, ubicación)
- Diferenciadores (cosas que dijo el candidato que la mayoría de los candidatos no dirían)

Sé honesto. Un rango de probabilidad con un razonamiento claro es más útil que la falsa confianza.

---

## Step 8 — Save Debrief

Agrega a `interview-prep/{company-slug}-{role-slug}.md`:

```markdown
## Round [N] Debrief — [YYYY-MM-DD]

**Interviewer:** [nombre, rol]
**Round type:** [screening / technical / design-case-study / behavioral]
**Outcome:** [pending / moved forward / rejected]

### Questions Asked
[lista]

### Gaps Identified
[lista con las respuestas correctas]

### Next Round
**Format:** [si se conoce]
**Interviewers:** [si se conocen]
**Priority prep:** [los 3 temas principales a cubrir antes de la siguiente ronda]

### Process Intel (recruiter / HM screens — omit if not applicable)
**Comp discussed:** [sí / no — si es sí, qué se dijo y en qué se ancló]
**Timeline:** [cualquier fecha o plazo mencionado]
**Other candidates:** [si se revelaron]
**Next steps:** [lo que el entrevistador dijo que sucede a continuación y para cuándo]
```

---

## Step 9 — Write Session Transcript

Después del análisis, escribe también una transcripción de la sesión legible por máquina en `interview-prep/sessions/{company-slug}-{role-slug}-{round}-{YYYY-MM-DD}.md`. Este es un registro estructurado de la ronda para modos de análisis posteriores; los turnos etiquetados por hablante permiten a un consumidor leer cualquier lado sin tener que volver a inferir quién habló. El contrato completo vive en `interview-prep/sessions/README.md`.

Formato:

```markdown
---
company: [empresa]
role: [rol]
round: [screen | hiring-manager | technical | system-design | behavioral | onsite | final]
date: YYYY-MM-DD
interviewer_role: [rol, si se conoce]
source: debrief
---

## Q1
**Interviewer:** [pregunta tal como se hizo]
<!-- competency: tag[, tag...] -->
**Candidate:** [respuesta tal como se entregó / reconstruida en este análisis]

## Q2
...
```

Reglas para la transcripción:

- **Asigna el tipo de ronda al enum** anterior (ej. filtro del reclutador → `screen`, filtro del HM → `hiring-manager`, inmersión técnica → `technical`, diseño/estudio de caso → `system-design`).
- **Etiqueta cada respuesta.** En la línea directamente arriba de cada línea `**Candidate:**`, emite `<!-- competency: tag[, tag...] -->` — en minúsculas (lowercase-kebab-case), separado por comas para respuestas con múltiples competencias (ej. `system-design`, `people-leadership`, `incident-response`). Ya evaluaste cada respuesta en el Step 2, así que etiqueta a partir de esa evaluación en lugar de volver a leer. Las etiquetas son de formato libre; elige la competencia que la pregunta realmente evaluó.
- **Reconstruye el turno del candidato fielmente.** Usa lo que el candidato informó haber dicho en el Step 1, no una respuesta idealizada. La "respuesta correcta/completa" del Step 2 pertenece al archivo de análisis, nunca a la transcripción — la transcripción registra lo que sucedió.
- **`source: debrief`.**
- El archivo de sesión aterriza en un directorio ignorado por git (los nombres/empresas reales nunca entran en el control de versiones); escríbelo sin censurar.

---

## Rules

- **Analiza inmediatamente.** La memoria de los detalles de la entrevista se degrada rápidamente — en cuestión de horas, las preguntas y reacciones específicas se olvidan. Ejecuta esta habilidad el mismo día.
- **No suavices las carencias.** Una carencia 🔴 que se llama 🟡 por amabilidad volverá a aparecer en la siguiente ronda.
- **Nunca pongas afirmaciones inventadas en boca del candidato.** Las respuestas correctas/completas pueden basarse en el conocimiento general del dominio, pero cualquier afirmación personal o métrica sugerida debe provenir de lo que dijo el candidato, `cv.md`, `article-digest.md` o el banco de historias.
- **Las afirmaciones retractadas son una barrera estricta.** Si una afirmación aparece en `interview-prep/retracted-claims.md`, nunca sugieras que el candidato la use — incluso si la dijo en la entrevista real. Márcala: "Esa afirmación está en tu lista de retractadas — no es defendible bajo presión. Aquí tienes una versión que no depende de ella."
- **Registra nuevas retractaciones.** Si el análisis revela una afirmación que el candidato usó en la entrevista real y que ahora acepta que no es defendible, ofrece agregarla a `interview-prep/retracted-claims.md`: `**"[afirmación]"** ([contexto]). Razón: [razón de una línea + encuadre correcto si aplica].`
- **Extrae las carencias de vocabulario de forma explícita.** Si el candidato usó un término impreciso donde existe uno preciso, agrégalo a `interview-prep/interview-prep-guide.md` en la sección de vocabulario (si el candidato mantiene uno).
- **Una carencia = una solución.** No abrumes con un plan de estudio completo para cada carencia. Prioriza las 1 o 2 con mayor probabilidad de ser evaluadas en la siguiente ronda.
- **Celebra lo que funcionó.** El análisis no se trata solo de carencias. Nombra lo que fue sólido — refuerza el comportamiento correcto y construye confianza para la próxima ronda.
