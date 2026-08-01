# Modo: aplicar -- Asistente en vivo para formularios de candidatura

Modo interactivo para el momento en que el candidato rellena un formulario de candidatura en Chrome. Lee lo que hay en pantalla, carga el contexto de la evaluación previa de la oferta y genera respuestas personalizadas para cada pregunta del formulario.

## Requisitos previos

- **Ideal con Playwright visible**: En modo visible, el candidato ve el navegador y el agente puede interactuar con la página.
- **Sin Playwright**: el candidato comparte una captura de pantalla o pega las preguntas manualmente.

## Workflow

```
1. DETECTAR     -> Leer la pestaña activa de Chrome (captura/URL/título)
2. IDENTIFICAR  -> Extraer empresa + rol desde la página
3. BUSCAR       -> Hacer match con los reports existentes en reports/
4. CARGAR       -> Leer el report completo + Bloque G (si existe)
5. COMPARAR     -> ¿El rol en pantalla coincide con el evaluado? Si cambió -> avisar
6. ANALIZAR     -> Identificar TODAS las preguntas visibles del formulario
7. GENERAR      -> Para cada pregunta, generar una respuesta personalizada
8. PRESENTAR    -> Mostrar las respuestas formateadas para copiar y pegar
```

## Paso 1 -- Detectar la oferta

**Con Playwright:** Snapshot de la página activa. Leer título, URL y contenido visible.

**Sin Playwright:** Pedir al candidato que:
- Comparta una captura de pantalla del formulario (la herramienta Read lee imágenes)
- O pegue las preguntas del formulario en texto
- O indique empresa + rol para buscar el contexto

## Paso 2 -- Identificar y cargar el contexto

1. Extraer el nombre de la empresa y el título del puesto desde la página
2. Buscar en `reports/` por nombre de empresa (Grep case-insensitive)
3. Si hay match -> cargar el report completo
4. Si hay Bloque G -> cargar los borradores de respuestas previos como base
5. Si NO hay match -> avisar al candidato y proponer un auto-pipeline rápido

## Paso 3 -- Detectar cambios de rol

Si el rol en pantalla difiere del evaluado:
- **Avisar al candidato**: "El rol ha cambiado de [X] a [Y]. ¿Quieres que reevalúe o que adapte las respuestas al nuevo título?"
- **Si adaptar**: Ajustar las respuestas al nuevo rol sin reevaluar
- **Si reevaluar**: Lanzar la evaluación completa A-F, actualizar el report, regenerar el Bloque G
- **Actualizar el tracker**: Modificar el título del rol en applications.md si es necesario

## Paso 4 -- Analizar las preguntas del formulario

Identificar TODAS las preguntas visibles:
- Campos de texto libre (carta de presentación, "¿por qué este puesto?", motivación, etc.)
- Listas desplegables (cómo conociste la empresa, permiso de trabajo, etc.)
- Sí/No (movilidad, visado, disponibilidad, etc.)
- Campos de salario (horquilla, pretensiones salariales — en bruto anual)
- Campos de subida de archivos (CV, carta de presentación en PDF, referencias)

Clasificar cada pregunta:
- **Ya respondida en el Bloque G** -> retomar la respuesta existente
- **Pregunta nueva** -> generar la respuesta desde el report + `cv.md`

## Paso 5 -- Generar las respuestas

Para cada pregunta, construir la respuesta según este esquema:

1. **Contexto del report**: Usar los proof points del bloque B, las stories STAR del bloque F
2. **Bloque G previo**: Si existe un borrador, tomarlo como base y refinarlo
3. **Tono "Te elijo a ti"**: mismo framework que en el auto-pipeline — confiado, no suplicante
4. **Especificidad**: citar algo concreto de la oferta visible en pantalla
5. **career-ops proof point**: incluir en "Información adicional" si existe ese campo

**Campos específicos en formularios hispanohablantes habituales:**
- **Pretensiones salariales (bruto anual)** -> Horquilla desde `profile.yml`, en EUR (o divisa local), con la indicación "negociable según el paquete global"
- **Fecha de disponibilidad** -> Fecha realista teniendo en cuenta el preaviso (habitualmente 15 días a 3 meses)
- **Permiso de trabajo / Nacionalidad** -> Honesto y conciso; para ciudadanos UE: "Sin necesidad de permiso de trabajo (ciudadano UE)"
- **Idiomas** -> Niveles según el MCER (A1-C2)
- **Movilidad** -> Especificar la zona geográfica aceptable y la frecuencia de desplazamiento

**Formato de salida:**

```
## Respuestas para [Empresa] -- [Rol]

Base: Report #NNN | Score: X.X/5 | Arquetipo: [tipo]

---

### 1. [Pregunta exacta del formulario]
> [Respuesta lista para copiar y pegar]

### 2. [Siguiente pregunta]
> [Respuesta]

...

---

Notas:
- [Observaciones sobre el rol, cambios, etc.]
- [Sugerencias de personalización que el candidato debería revisar]
```

## Paso 6 -- Tras la candidatura (opcional)

Si el candidato confirma que la candidatura ha sido enviada:
1. Actualizar el estado a "Applied" con el CLI canónico: `node set-status.mjs <report#> Applied` (no editar la tabla de `applications.md` a mano)
2. Actualizar el Bloque G del report con las respuestas finales
3. Sugerir el siguiente paso: `/career-ops contacto` para LinkedIn outreach hacia el hiring manager

## Gestión del desplazamiento

Si el formulario tiene más preguntas de las que son visibles:
- Pedir al candidato que desplace y comparta otra captura de pantalla
- O que pegue las preguntas restantes
- Tratar por iteraciones hasta cubrir todo el formulario
