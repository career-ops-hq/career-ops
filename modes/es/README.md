# career-ops -- Modos en español (`modes/es/`)

Esta carpeta contiene las traducciones al español de los principales modos de career-ops para candidatos que apuntan al mercado hispanohablante (España, México, Argentina, Colombia, Chile y otros países de LATAM).

## ¿Cuándo usar estos modos?

Usa `modes/es/` si se cumple al menos una de estas condiciones:

- Aplicas principalmente a **ofertas de empleo en español** (InfoJobs, LinkedIn ES, Indeed ES, Tecnoempleo, Computrabajo, portales de empleo corporativos)
- Tu **CV está en español** o alternas entre ES e EN según la oferta
- Necesitas respuestas y cartas de presentación en **español técnico natural**, no traducido por una máquina
- Debes gestionar **especificidades contractuales hispanohablantes**: convenio colectivo, pagas extra, IRPF, Seguridad Social, período de prueba, preaviso, ticket restaurante, seguro médico, contrato indefinido/temporal

Si la mayoría de tus ofertas son en inglés, quédate con los modos estándar en `modes/`. Los modos en inglés funcionan para ofertas hispanohablantes, pero no conocen las especificidades del mercado en detalle.

## ¿Cómo activar?

### Opción 1 -- Por sesión

Di al agente al inicio de la sesión:

> "Usa los modos en español de `modes/es/`."

El agente leerá entonces los archivos de esta carpeta en lugar de `modes/`.

### Opción 2 -- De forma permanente

Añade en `config/profile.yml`:

```yaml
language:
  primary: es
  modes_dir: modes/es
```

Recuérdaselo al agente en tu primera sesión ("Mira en `profile.yml`, he configurado `language.modes_dir`"). El agente usará automáticamente los modos en español.

## ¿Qué modos están traducidos?

Esta primera iteración cubre los cuatro modos de mayor impacto:

| Archivo | Traducido desde | Rol |
|---------|-----------------|-----|
| `_shared.md` | `modes/_shared.md` (EN) | Contexto compartido, arquetipos, reglas globales, especificidades del mercado hispanohablante |
| `oferta.md` | `modes/oferta.md` (ES) | Evaluación completa de una oferta (Bloques A-F) |
| `aplicar.md` | `modes/apply.md` (EN) | Asistente en vivo para rellenar formularios de candidatura |
| `pipeline.md` | `modes/pipeline.md` (ES) | Bandeja de URLs / Second Brain para las ofertas recopiladas |

Los demás modos (`scan`, `batch`, `pdf`, `tracker`, `auto-pipeline`, `deep`, `contacto`, `ofertas`, `project`, `training`) se mantienen en EN/ES. Su contenido es principalmente tooling, rutas y comandos — debe permanecer independiente del idioma.

## Lo que permanece en inglés

No traducido intencionadamente, por ser vocabulario técnico estándar:

- `cv.md`, `pipeline`, `tracker`, `report`, `score`, `archetype`, `proof point`
- Nombres de herramientas (`Playwright`, `WebSearch`, `WebFetch`, `Read`, `Write`, `Edit`, `Bash`)
- Valores de estado en el tracker (`Evaluated`, `Applied`, `Interview`, `Offer`, `Rejected`)
- Fragmentos de código, rutas, comandos

Los modos usan español técnico natural, tal como se habla en equipos de ingeniería en Madrid, Barcelona, Ciudad de México o Buenos Aires: texto corriente en español, términos técnicos en inglés donde es el uso habitual. Sin traducción forzada de "Pipeline" a "Canalización" ni de "Deploy" a "Despliegue aplicativo".

## Glosario de referencia

Para mantener un tono coherente si modificas o amplías los modos:

| Inglés | Español (en esta codebase) |
|--------|---------------------------|
| Job posting | Oferta de empleo / Anuncio |
| Application | Candidatura |
| Cover letter | Carta de presentación |
| Resume / CV | CV |
| Salary | Salario / Remuneración |
| Compensation | Remuneración / Paquete retributivo |
| Skills | Competencias / Habilidades |
| Interview | Entrevista |
| Hiring manager | Manager de contratación / Hiring manager |
| Recruiter | Reclutador (o Recruiter) |
| AI | IA (Inteligencia Artificial) |
| Requirements | Requisitos |
| Career history | Trayectoria profesional |
| Notice period | Preaviso |
| Probation | Período de prueba |
| Vacation | Vacaciones / Días de libre disposición |
| Extra pay / 13th month | Pagas extra (14 pagas al año) |
| Permanent employment | Contrato indefinido |
| Fixed-term contract | Contrato temporal |
| Freelance | Freelance / Autónomo |
| Collective agreement | Convenio colectivo |
| Works council | Comité de empresa |
| Profit sharing | Participación en beneficios |
| Meal vouchers | Ticket restaurante / Cheque gourmet |
| Health insurance | Seguro médico privado |
| Disability/life insurance | Seguro de vida / Incapacidad |
| Income tax withholding | IRPF |
| Social security | Seguridad Social |

## Contribuir

Para mejorar una traducción o añadir un modo:

1. Abre un Issue con tu propuesta (ver `CONTRIBUTING.md`)
2. Respeta el glosario anterior para mantener un tono coherente
3. Traduce de forma idiomática — sin traducción palabra por palabra
4. Conserva los elementos estructurales (Bloques A-F, tablas, bloques de código, instrucciones de herramientas) tal cual
5. Prueba con una oferta hispanohablante real (InfoJobs, LinkedIn ES, Indeed ES) antes de enviar el PR
