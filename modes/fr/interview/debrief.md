# Mode: interview/debrief — Débriefing post-entretien

Après un véritable entretien, capturez ce qui a été demandé, évaluez ce qui a fonctionné et ce qui n'a pas fonctionné, comblez les lacunes avant le prochain round et mettez à jour la banque de questions.

---

## When to Run This Skill

- Immédiatement après un vrai entretien (pendant que la mémoire est fraîche)
- Après un appel avec un recruteur qui a fait remonter de nouvelles informations sur le processus
- Lorsque le candidat apprend le format du prochain round et le nom de l'intervieweur

---

## Inputs

1. **Débriefing de l'entretien par le candidat** — quelles questions ont été posées, comment il a répondu, ce qui a semblé solide ou faible
2. **Nom et rôle de l'intervieweur** — informe la prédiction pour le prochain round
3. **Résultat du round** (si connu) — avance / rejeté / en attente
4. **Détails du prochain round** (si connu) — format, intervieweurs, calendrier
5. **Banque de questions** dans `interview-prep/question-bank.md` — mise à jour avec de vraies données
6. **Banque d'histoires** dans `interview-prep/story-bank.md` — ajoute de nouvelles histoires si elles font surface
7. **CV** dans `cv.md` + `article-digest.md` (si présent) — pour ancrer les réponses suggérées dans une expérience réelle
8. **Affirmations rétractées** dans `interview-prep/retracted-claims.md` (si présent) — barrière stricte ; n'utilisez jamais une affirmation rétractée dans une réponse suggérée même si le candidat l'a dite pendant l'entretien
9. **Fichier de préparation spécifique au rôle** — ajoutez les notes de débriefing

---

## Step 1 — Capture What Was Asked

Demandez au candidat d'énumérer toutes les questions dont il se souvient, dans l'ordre si possible. Ne suggérez pas d'options — laissez-le d'abord se souvenir librement.

Pour chaque question capturée :

- Qu'ont-ils dit ?
- Comment l'intervieweur a-t-il réagi (signal positif, neutre, a repoussé, est passé rapidement à autre chose) ?
- Se sont-ils sentis confiants ou incertains ?

Si la mémoire est incomplète, posez des questions ciblées :

- "Y a-t-il eu des questions qui vous ont pris au dépourvu ?"
- "Y a-t-il quelque chose auquel vous auriez souhaité répondre différemment ?"
- "L'intervieweur a-t-il relancé sur quoi que ce soit — cela signifie généralement qu'il en voulait plus ?"

---

## Step 2 — Honest Assessment Per Question

Pour chaque question, produisez :

```markdown
**Q: [question]**
- Ce qui a été dit : [résumé de leur réponse]
- Ce qui a fonctionné : [ce qui était bon — soyez spécifique]
- Ce qui manquait : [lacune — terme technique précis, résultat manquant, pas de réflexion, etc.]
- Réponse correcte/complète : [ce que la réponse complète devrait inclure]
- Statut : ✅ Solide / 🟡 Correct / 🔴 Lacune
```

Soyez direct. S'ils ont raté le concept central que la question testait, dites-le. Si une réponse était véritablement forte, dites-le aussi. Le débriefing est le moment d'apprentissage le plus précieux — l'imprécision le gaspille.

---

## Step 3 — Update Question Bank

Pour chaque question débriefée, mettez à jour `interview-prep/question-bank.md` :

- Changez le statut en ✅ / 🟡 / 🔴 en fonction de la performance réelle
- Ajoutez des notes de lacune à partir du débriefing
- Ajoutez toute nouvelle question qui est apparue et qui n'était pas encore dans la banque

Si la banque de questions n'existe pas, créez-la avec les questions de cet entretien comme point de départ.

---

## Step 4 — Close the Gaps

Pour chaque 🔴 lacune identifiée :

1. **Expliquez la bonne réponse** — claire, concise, avec un exemple travaillé (code, calcul, diagramme) là où cela aide
2. **Connectez à une vraie histoire** si possible — "vous avez en fait cela dans votre [histoire existante de la banque d'histoires] — voici comment l'utiliser"
3. **Ajoutez au fichier de préparation spécifique au rôle** sous une section "Lacunes à combler avant le round N"
4. **Ajoutez à `interview-prep/interview-prep-guide.md`** (si le candidat en maintient un) quand il s'agit d'un principe réutilisable qui s'applique au-delà de ce rôle

---

## Step 5 — Extract New Stories

Parfois, un vrai entretien fait ressortir une histoire que le candidat n'avait pas préparée. Si le candidat a décrit une expérience qu'il n'avait pas formalisée :

> "Vous avez mentionné [X] dans votre réponse — cela ressemble à ce qui pourrait devenir une vraie histoire STAR+R. Voulez-vous la construire maintenant pendant que c'est frais ?"

Si oui, construisez-la comme une histoire STAR+R (Situation, Tâche, Action, Résultat, Réflexion) et ajoutez-la à `interview-prep/story-bank.md`.

---

## Step 6 — Next Round Intelligence

Si le candidat connaît le format du prochain round :

1. **Prévoyez les questions probables** en fonction de :
   - Le rôle du prochain intervieweur (par ex., praticien senior → profondeur dans la compétence centrale, conception ; pair interfonctionnel → collaboration, limites du domaine ; dirigeant → stratégie, impact sur l'entreprise)
   - Ce qui a été couvert dans ce round (le round suivant va généralement plus en profondeur, pas en largeur)
   - Ce qui a semblé le plus intéresser l'intervieweur dans ce round

   Étiquetez chaque prédiction `[inferred]` — ne présentez jamais une question prédite comme si elle provenait de vrais candidats ou d'initiés.

2. **Créez une liste de priorités** pour la préparation du prochain round — ordonnée par gravité de la lacune et probabilité d'être testée

3. **Suggérez d'exécuter** `interview/plan` avec les détails du prochain round pour construire un plan de préparation complet

---

## Step 7 — Probability Assessment (Optional)

Si le candidat demande une lecture honnête de ses chances :

Évaluez en fonction de :

- Nombre et gravité des lacunes (🔴 sur les fondamentaux = risque plus élevé que 🔴 sur les sujets avancés)
- Signaux de l'intervieweur (a donné des détails spécifiques sur le prochain round = positif ; vague = neutre ; appel court = risque)
- Adéquation au rôle (années d'expérience, correspondance de domaine, localisation)
- Différenciateurs (choses que le candidat a dites et que la plupart des candidats ne diraient pas)

Soyez honnête. Une fourchette de probabilité avec un raisonnement clair est plus utile qu'une fausse confiance.

---

## Step 8 — Save Debrief

Ajoutez à `interview-prep/{company-slug}-{role-slug}.md` :

```markdown
## Round [N] Debrief — [YYYY-MM-DD]

**Intervieweur :** [nom, rôle]
**Type de round :** [screening / technical / design-case-study / behavioral]
**Résultat :** [pending / moved forward / rejected]

### Questions Asked
[liste]

### Gaps Identified
[liste avec les bonnes réponses]

### Next Round
**Format :** [si connu]
**Intervieweurs :** [si connu]
**Préparation prioritaire :** [top 3 des sujets à combler avant le prochain round]

### Process Intel (recruiter / HM screens — omit if not applicable)
**Rémunération discutée :** [oui / non — si oui, ce qui a été dit et ce qui a été ancré]
**Calendrier :** [toutes les dates ou échéances mentionnées]
**Autres candidats :** [si divulgué]
**Prochaines étapes :** [ce que l'intervieweur a dit qu'il se passerait ensuite et d'ici quand]
```

---

## Step 9 — Write Session Transcript

Après le débriefing, rédigez également une transcription de session lisible par machine vers `interview-prep/sessions/{company-slug}-{role-slug}-{round}-{YYYY-MM-DD}.md`. C'est un enregistrement structuré du round pour les modes d'analyse en aval ; les tours étiquetés par l'intervenant permettent à un consommateur de lire les deux côtés sans réinférer qui a parlé. Le contrat complet se trouve dans `interview-prep/sessions/README.md`.

Format :

```markdown
---
company: [company]
role: [role]
round: [screen | hiring-manager | technical | system-design | behavioral | onsite | final]
date: YYYY-MM-DD
interviewer_role: [rôle, si connu]
source: debrief
---

## Q1
**Interviewer:** [question telle que posée]
<!-- competency: tag[, tag...] -->
**Candidate:** [réponse telle que livrée / reconstruite dans ce débriefing]

## Q2
...
```

Règles pour la transcription :

- **Mappez le type de round à l'énumération** ci-dessus (par ex. recruteur screen → `screen`, HM screen → `hiring-manager`, plongée technique approfondie → `technical`, conception/étude de cas → `system-design`).
- **Taguez chaque réponse.** Sur la ligne juste au-dessus de chaque ligne `**Candidate:**`, émettez `<!-- competency: tag[, tag...] -->` — en minuscules kebab-case, séparés par des virgules pour les réponses multi-compétences (par ex. `system-design`, `people-leadership`, `incident-response`). Vous avez déjà évalué chaque réponse à l'étape 2, donc taguez à partir de cette évaluation plutôt que de relire. Les tags sont libres ; choisissez la compétence que la question a réellement testée.
- **Reconstruisez fidèlement le tour du candidat.** Utilisez ce que le candidat a déclaré avoir dit à l'étape 1, et non une réponse idéalisée. La "réponse correcte/complète" de l'étape 2 appartient au fichier de débriefing, jamais dans la transcription — la transcription enregistre ce qui s'est passé.
- **`source: debrief`.**
- Le fichier de session atterrit dans un répertoire gitignored (les vrais noms/entreprises n'entrent jamais dans le contrôle de version) ; rédigez-le sans expurger.

---

## Rules

- **Débriefez immédiatement.** Le souvenir des détails de l'entretien se dégrade vite — en quelques heures, les questions et réactions spécifiques sont oubliées. Exécutez cette compétence le même jour.
- **Ne minimisez pas les lacunes.** Une 🔴 lacune qui est qualifiée de 🟡 par gentillesse réapparaîtra lors du prochain round.
- **Ne mettez jamais d'affirmations inventées dans la bouche du candidat.** Les réponses correctes/complètes peuvent s'appuyer sur des connaissances générales du domaine, mais toute affirmation personnelle ou mesure suggérée doit provenir de ce que le candidat a dit, de `cv.md`, de `article-digest.md` ou de la banque d'histoires.
- **Les affirmations rétractées sont une barrière stricte.** Si une affirmation apparaît dans `interview-prep/retracted-claims.md`, ne suggérez jamais au candidat de l'utiliser — même s'il l'a dite lors du vrai entretien. Signalez-le : "Cette affirmation est dans votre liste rétractée — elle n'est pas défendable sous pression. Voici une version qui n'en dépend pas."
- **Enregistrez de nouvelles rétractations.** Si le débriefing révèle une affirmation que le candidat a utilisée lors du vrai entretien et qu'il accepte maintenant de ne pas être défendable, proposez de l'ajouter à `interview-prep/retracted-claims.md` : `**"[affirmation]"** ([contexte]). Raison : [raison d'une ligne + formulation correcte si applicable].`
- **Extrayez explicitement les lacunes de vocabulaire.** Si le candidat a utilisé un terme imprécis là où un terme précis existe, ajoutez-le à `interview-prep/interview-prep-guide.md` sous la section vocabulaire (si le candidat en maintient un).
- **Une lacune = un correctif.** Ne surchargez pas avec un plan d'étude complet pour chaque lacune. Donnez la priorité à la ou aux deux plus susceptibles d'être testées lors du prochain round.
- **Célébrez ce qui a fonctionné.** Le débriefing ne concerne pas seulement les lacunes. Nommez ce qui était solide — cela renforce le bon comportement et donne confiance pour le prochain round.
