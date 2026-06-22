# Mode : offre -- Evaluation complete A-F

Quand le candidat colle une offre (texte ou URL), TOUJOURS livrer les 6 blocs.

## Etape 0 -- Detection d'archetype

Classer l'offre dans l'un des 6 archetypes (voir `_shared.md`). Si hybride, indiquer les 2 plus proches. Cela determine :
- Quels proof points prioriser dans le bloc B
- Comment reecrire le summary dans le bloc E
- Quelles stories STAR preparer dans le bloc F

## Bloc A -- Resume du role

Tableau avec :
- Archetype detecte
- Domaine (Platform / Agentic / LLMOps / ML / Enterprise)
- Fonction (Build / Conseil / Management / Deploy)
- Seniorite
- Remote (Full remote / Hybride / Sur site)
- Taille d'equipe (si mentionnee)
- TL;DR en 1 phrase

## Bloc B -- Match avec le CV

Lire `cv.md`. Creer un tableau ou chaque prerequis de l'offre est mappe sur des lignes exactes du CV.

**Adapte a l'archetype :**
- FDE -> prioriser les proof points de livraison rapide et proximite client
- SA -> prioriser la conception systeme et les integrations
- PM -> prioriser la product discovery et les metriques
- LLMOps -> prioriser evals, observability, pipelines
- Agentic -> prioriser multi-agent, HITL, orchestration
- Transformation -> prioriser conduite du changement, adoption, passage a l'echelle

Section **Lacunes (Gaps)** avec strategie de mitigation pour chacune. Pour chaque lacune :
1. Est-ce un bloqueur dur ou un nice-to-have ?
2. Le candidat peut-il demontrer une experience adjacente ?
3. Y a-t-il un projet portfolio qui couvre cette lacune ?
4. Plan de mitigation concret (phrase pour la lettre de motivation, mini-projet rapide, etc.)

## Bloc C -- Niveau et strategie

1. **Niveau detecte** dans l'offre vs **niveau naturel du candidat pour cet archetype**
2. **Plan "vendre senior sans mentir"** : formulations specifiques adaptees a l'archetype, realisations concretes a mettre en avant, comment positionner l'experience de fondateur comme un atout
3. **Plan "si je suis downlevel"** : accepter si la remuneration est juste, negocier une revue a 6 mois, criteres de promotion clairs

## Bloc D -- Remuneration et demande

Utiliser WebSearch pour :
- Salaires actuels du role (Glassdoor, Levels.fyi, Welcome to the Jungle, APEC, Talent.io, Indeed Salaires)
- Reputation de remuneration de l'entreprise (Glassdoor, WTTJ)
- Tendance de demande du role sur le marche francophone

Tableau avec donnees et sources citees. Si pas de donnees, le dire clairement -- ne rien inventer.

**Marche francais -- Verifications obligatoires :**
- 13e mois / prime de fin d'annee mentionne ? L'inclure dans le calcul brut annuel.
- Part variable (bonus, commission, BSPCE / stock-options) ?
- Interessement / Participation mentionnes ? Historique disponible ?
- Convention collective (SYNTEC, Metallurgie, etc.) applicable ? Si oui, verifier la classification.
- CDI ou CDD ? Si CDD : duree, motif, possibilite de CDI-isation.
- Freelance / Portage salarial ? TJM, duree de mission, risque de requalification.

## Bloc E -- Plan de personnalisation

| # | Section | Etat actuel | Changement propose | Justification |
|---|---------|-------------|--------------------|----- ---------|
| 1 | Summary | ... | ... | ... |
| ... | ... | ... | ... | ... |

Top 5 modifications du CV + Top 5 modifications LinkedIn pour maximiser le match.

## Bloc F -- Plan d'entretiens

6-10 stories STAR+R mappees sur les prerequis de l'offre (STAR + **Reflection**) :

| # | Prerequis de l'offre | Story STAR+R | S | T | A | R | Reflection |
|---|---------------------|--------------|---|---|---|---|------------|

La colonne **Reflection** capture ce qui a ete appris ou ce qui serait fait differemment. Cela signale la seniorite -- les juniors decrivent ce qui s'est passe, les seniors en tirent des enseignements.

**Story Bank :** Si `interview-prep/story-bank.md` existe, verifier si ces stories y sont deja. Sinon, ajouter les nouvelles. Avec le temps, cela construit une banque reutilisable de 5-10 stories maitre adaptables a n'importe quelle question d'entretien.

**Selectionnees et cadrees selon l'archetype :**
- FDE -> mettre en avant la vitesse de livraison et la proximite client
- SA -> mettre en avant les decisions d'architecture
- PM -> mettre en avant la discovery et les arbitrages
- LLMOps -> mettre en avant les metriques, evals, hardening en production
- Agentic -> mettre en avant l'orchestration, la gestion d'erreurs, le HITL
- Transformation -> mettre en avant l'adoption et le changement organisationnel

Inclure aussi :
- 1 case study recommandee (quel projet presenter et comment)
- Questions red-flag et comment y repondre (ex : "Pourquoi avez-vous vendu votre entreprise ?", "Aviez-vous une equipe sous votre responsabilite ?", "Pourquoi un changement apres si peu de temps ?")

---

## Post-evaluation

**TOUJOURS** executer apres les blocs A-F :

### 1. Sauvegarder le report .md

Sauvegarder l'evaluation complete dans `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`.

- `{###}` = prochain numero sequentiel (3 chiffres, zero-padded). Pour l'allouer de maniere atomique et eviter les conditions de concurrence, vous devez executer `node reserve-report-num.mjs` pour reserver le numero (stdout renvoie `{###}`), ecrire le rapport, puis executer `node reserve-report-num.mjs --release {###}` pour liberer le sentinel.
- `{company-slug}` = nom d'entreprise en minuscules, sans espaces (utiliser des tirets)
- `{YYYY-MM-DD}` = date du jour

**Format du report :**

```markdown
# Evaluation : {Entreprise} -- {Role}

**Date :** {YYYY-MM-DD}
**Archetype :** {detecte}
**Score :** {X/5}
**URL :** {URL de l'offre}
**PDF :** {chemin ou en attente}

---

## A) Resume du role
(contenu complet du bloc A)

## B) Match avec le CV
(contenu complet du bloc B)

## C) Niveau et strategie
(contenu complet du bloc C)

## D) Remuneration et demande
(contenu complet du bloc D)

## E) Plan de personnalisation
(contenu complet du bloc E)

## F) Plan d'entretiens
(contenu complet du bloc F)

## G) Brouillons de reponses pour la candidature
(uniquement si score >= 4.5 -- brouillons de reponses pour le formulaire de candidature)

---

## Mots-cles extraits
(liste de 15-20 mots-cles de l'offre pour l'optimisation ATS)
```

### 2. Enregistrer dans le tracker

**TOUJOURS** enregistrer dans `data/applications.md` :
- Prochain numero sequentiel
- Date du jour
- Entreprise
- Role
- Score : moyenne du match (1-5)
- Statut : `Evaluated`
- PDF : non (ou oui si l'auto-pipeline a genere un PDF)
- Report : lien relatif vers le fichier report (ex : `[001](reports/001-company-2026-01-01.md)`)

**Format du tracker :**

```markdown
| # | Date | Entreprise | Role | Score | Statut | PDF | Report |
```
