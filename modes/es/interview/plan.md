# Mode: interview/plan — Planificador de Preparación para Entrevistas

Dada una descripción de puesto (JD) y la fecha/hora de la entrevista, construye un plan de preparación estructurado y con bloques de tiempo, adaptado a las carencias específicas del candidato.

---

## Inputs

1. **Descripción del puesto (JD)** (requerido) — pégalo en línea o proporciona la URL
2. **Fecha y hora de la entrevista** (requerido) — para calcular las horas disponibles
3. **Nombre y rol del entrevistador** (si se conoce) — determina la profundidad y el tono de la preparación
4. **Tipo de ronda** (si se conoce) — filtro (screening), técnico/específico del dominio, diseño/estudio de caso, panel conductual (behavioral)
5. **CV** en `cv.md` + `article-digest.md` (si está presente) — lee para obtener experiencia, habilidades y puntos de prueba
6. **Perfil** en `config/profile.yml` + `modes/_profile.md` — lee para la narrativa, arquetipos y objetivos
7. **Banco de historias** en `interview-prep/story-bank.md` — historias STAR+R existentes
8. **Banco de preguntas** en `interview-prep/question-bank.md` — carencias existentes (si el archivo existe)

---

## Step 1 — Evaluación de Ajuste

Lee el CV y la JD. Produce una evaluación de dos columnas:

**Fortalezas en las que anclarse:** experiencia, títulos, dominio, puntos de prueba que coincidan directamente con la JD.

**Carencias a cubrir:** habilidades, herramientas o experiencia mencionadas en la JD que estén ausentes o sean débiles en el CV. Clasifícalas por la probabilidad de ser evaluadas en este tipo de ronda específica.

Sé honesto. Una carencia es una carencia — márcala claramente para que el tiempo de preparación se dedique a los lugares correctos.

---

## Step 2 — Inteligencia de la Ronda

Identifica qué está evaluando realmente esta ronda basándote en:

- Rol del entrevistador (manager = comunicación + pasión + fundamentos; practitioner = profundidad + criterio)
- Etiqueta de la ronda (filtro, técnico/dominio, diseño/caso de estudio, final)
- Señales de la JD (qué enfatizan)

**Filtro del reclutador (Recruiter screen):**

- Verificación de requisitos: ajuste, alineación de compensación, logística, comunicación
- No es una prueba técnica — las preguntas de profundidad vienen en las rondas con el HM (Hiring Manager) y posteriores
- Probable: presentación de background, "por qué nosotros/por qué este rol", expectativa salarial, plazos, una pregunta de logística
- Trata esto como el punto de control fácil; usa el tiempo de preparación para construir la base de lo que viene después

**Filtro del Hiring Manager:**

- Comunicación, pasión, ajuste — además de filosofía de liderazgo y criterio
- Fundamentos de la habilidad central de la JD — no aspectos internos profundos
- 1–2 historias conductuales
- Probable: background, "por qué nosotros", un concepto central de la JD, una historia de liderazgo, pregunta situacional con visión de futuro

**Inmersión técnica / de dominio con un practitioner:**

- Profundidad en la habilidad central de la JD (ej. internals del runtime para ingeniería, opciones de modelado para datos, métodos de valoración para finanzas)
- Escenarios aplicados del día a día del rol
- Es posible un ejercicio en vivo o un recorrido guiado
- Las historias se usan como evidencia, no como el evento principal

**Panel de diseño / caso de estudio:**

- Solución completa — restricciones, componentes, compensaciones (trade-offs), modos de fallo
- Las dimensiones de calidad que enfatiza la JD (ej. escalabilidad, cumplimiento, medibilidad)
- Nivel senior: establecer restricciones, hacer preguntas aclaratorias, dirigir la conversación

Calibra el plan según la ronda. Prepararse en exceso para un filtro desperdicia tiempo y crea la mentalidad equivocada.

---

## Step 3 — Construir el Plan de Bloques de Tiempo

Calcula las horas disponibles desde ahora hasta la hora de la entrevista. Divide en bloques:

Antes de dimensionar los bloques, revisa `interview-prep/question-bank.md` (si existe). Cualquier pregunta marcada con 🔴 de una ronda anterior es una carencia comprobada — obtiene un bloque dedicado independientemente de cómo la clasifique el análisis CV-vs-JD. Los datos de rendimiento reales superan al riesgo inferido.

**Plantilla (ajusta el tamaño de los bloques según el total de horas disponibles):**

```text
Block 1 — Fija tu narrativa (primero, siempre)
  - Escribe la cronología de tu background explícitamente
  - Prepara "por qué esta empresa" con una conexión específica a tu historia
  - Prepara la historia de tu punto de prueba más fuerte (versión de 30 segundos)
  - Tiempo: ~15% de las horas disponibles

Block 2 — Tema de dominio prioritario (carencia de mayor riesgo primero)
  - Un tema por bloque — no mezclar
  - Para cada uno: concepto → gancho de tu historia → posibles preguntas de seguimiento
  - Tiempo: ~25% de las horas disponibles

Block 3 — Tema de dominio secundario
  - Segunda carencia de mayor riesgo
  - Tiempo: ~20% de las horas disponibles

Block 4 — Historias conductuales
  - Asigna las historias existentes a los tipos de preguntas probables
  - Practica la versión verbal de 2 minutos de cada una
  - Prepara la Reflexión para cada una — el diferenciador de un candidato senior
  - Tiempo: ~15% de las horas disponibles

Block 5 — Investigación de la empresa
  - Páginas de productos relevantes para el rol
  - Conexión entre tu historia y su dominio específico
  - 3–4 preguntas agudas para hacerles
  - Tiempo: ~10% de las horas disponibles

Block 6 — Ensayo práctico (si el tiempo lo permite)
  - Una pregunta por tema probable — en voz alta, cronometrada
  - Tiempo: ~10% de las horas disponibles

Block 7 — Búfer + descanso
  - Deja de estudiar 60–90 minutos antes de la entrevista
  - Estudiar de más en la última hora añade ruido, no señal
  - Tiempo: el restante
```

Ajusta el tamaño de los bloques según la gravedad de la carencia y el tipo de ronda. Si es un filtro, el Block 4 (conductual) y el Block 5 (investigación) son más importantes que los bloques de dominio profundo.

---

## Step 4 — Referencia Rápida de Prioridad

Al final del plan, produce una referencia rápida de una página que el candidato pueda leer 15 minutos antes de la entrevista:

```markdown
## 15-Minute Pre-Interview Review

**Your anchor sentence:** [una frase que capture por qué eres adecuado para este rol]

**Top 3 things to remember:**
1. [el mensaje más importante a dejarle al entrevistador]
2. [la pregunta más probable y tu primera frase de la respuesta]
3. [la conexión entre tu historia y su dominio]

**Your questions to ask:**
1. [pregunta 1]
2. [pregunta 2]
3. [pregunta 3]
```

---

## Step 5 — Guardar Resultados

Guarda el plan en `interview-prep/{company-slug}-{role-slug}.md` si el archivo no existe, o añade una sección `## Prep Plan` si ya existe.

---

## Rules

- **Calibra según la ronda.** Un plan de preparación para un filtro se ve muy diferente a uno para un panel de diseño. No apliques profundidad máxima por defecto para todas las entrevistas.
- **Las carencias primero.** El tiempo es finito. Las fortalezas del candidato no necesitan preparación — sus carencias sí.
- **Las carencias marcadas con 🔴 en el banco de preguntas tienen prioridad sobre las carencias inferidas.** Los datos de rendimiento reales superan el análisis CV-vs-JD. Si el candidato ya sabe que le cuesta un tema, no lo ocultes.
- **Un tema por bloque.** Mezclar temas en un solo bloque reduce la retención.
- **Siempre incluye tiempo de descanso.** Un candidato descansado supera a uno que ha estudiado de más en el último momento.
- **Nunca inventes información sobre la empresa.** Si no tienes investigación, dilo — no inventes afirmaciones sobre la cultura o detalles técnicos sobre la empresa.
- **Nunca inventes afirmaciones para el candidato.** La frase ancla y los puntos de conversación previos a la entrevista en la referencia rápida (Step 4) deben estar basados en lo que el candidato realmente tiene — `cv.md`, `article-digest.md` o el banco de historias. No redactes afirmaciones que dependan de experiencia o métricas que el candidato no tiene. Si una afirmación aparece en `interview-prep/retracted-claims.md`, nunca la incluyas.
