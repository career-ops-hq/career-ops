# Mode: interview/plan — Planificateur de préparation d'entretien

Étant donné une description de poste et la date/heure de l'entretien, créez un plan de préparation structuré et organisé par blocs de temps, adapté aux lacunes spécifiques du candidat.

---

## Inputs

1. **Description de poste** (requis) — collez en ligne ou fournissez l'URL
2. **Date et heure de l'entretien** (requis) — pour calculer les heures disponibles
3. **Nom et rôle de l'intervieweur** (si connu) — oriente la profondeur et le ton de la préparation
4. **Type de round** (si connu) — sélection (screening), technique/spécifique au domaine, conception/étude de cas, panel comportemental
5. **CV** dans `cv.md` + `article-digest.md` (si présent) — lire pour l'expérience, les compétences, les points de preuve
6. **Profil** dans `config/profile.yml` + `modes/_profile.md` — lire pour la narration, les archétypes et les cibles
7. **Banque d'histoires** dans `interview-prep/story-bank.md` — histoires STAR+R existantes
8. **Banque de questions** dans `interview-prep/question-bank.md` — lacunes existantes (si le fichier existe)

---

## Step 1 — Fit Assessment

Lisez le CV et la JD (description de poste). Produisez une évaluation sur deux colonnes :

**Points forts sur lesquels s'appuyer :** expérience, titres, domaine, points de preuve qui correspondent directement à la JD.

**Lacunes à combler :** compétences, outils ou expériences mentionnés dans la JD qui sont absents ou faibles dans le CV. Classez par probabilité d'être testés dans ce type spécifique de round.

Soyez honnête. Une lacune est une lacune — signalez-la clairement pour que le temps de préparation soit alloué aux bons endroits.

---

## Step 2 — Round Intelligence

Identifiez ce que ce round évalue réellement en fonction de :

- Le rôle de l'intervieweur (manager = communication + passion + fondamentaux ; praticien = profondeur + jugement)
- L'étiquette du round (sélection, technique/domaine, conception/étude de cas, final)
- Les signaux de la JD (ce qu'ils mettent en évidence)

**Recruiter screen :**

- Coche les cases : adéquation, alignement de la rémunération, logistique, communication
- Ce n'est pas un test technique — les questions approfondies viennent avec le Hiring Manager et dans les rounds suivants
- Probable : pitch de présentation, "pourquoi nous / pourquoi ce rôle", attente salariale, calendrier, une question logistique
- Traitez ceci comme le point de contrôle facile ; utilisez le temps de préparation pour construire les fondations de ce qui vient ensuite

**Hiring-manager screen :**

- Communication, passion, adéquation — plus la philosophie de leadership et le jugement
- Fondamentaux de la compétence principale de la JD — pas les composants internes profonds
- 1–2 histoires comportementales
- Probable : parcours, "pourquoi nous", un concept central de la JD, une histoire de leadership, une question de mise en situation orientée vers l'avenir

**Technical / domain deep-dive with a practitioner :**

- Profondeur dans la compétence principale de la JD (par ex., fonctionnement interne pour l'ingénierie, choix de modélisation pour la data, méthodes d'évaluation pour la finance)
- Scénarios appliqués issus du quotidien du rôle
- Exercice en direct ou explication d'un cas travaillé possible
- Les histoires sont utilisées comme preuves, pas comme événement principal

**Design / case study panel :**

- Solution complète — contraintes, composants, compromis, modes de défaillance
- Les dimensions de qualité que la JD souligne (par ex., scalabilité, conformité, mesurabilité)
- Niveau senior : définir les contraintes, poser des questions de clarification, mener la conversation

Calibrez le plan au round. Trop préparer en profondeur pour un round de sélection fait perdre du temps et crée le mauvais état d'esprit.

---

## Step 3 — Build the Time-Blocked Plan

Calculez les heures disponibles entre maintenant et l'heure de l'entretien. Divisez en blocs :

Avant de dimensionner les blocs, vérifiez `interview-prep/question-bank.md` (s'il existe). Toute question marquée 🔴 lors d'un round précédent est une lacune prouvée — elle obtient un bloc dédié indépendamment de la façon dont l'analyse CV-vs-JD la classe. Les données de performance réelles priment sur le risque inféré.

**Modèle (ajustez la taille des blocs en fonction des heures totales disponibles) :**

```text
Block 1 — Fixez votre narration (en premier, toujours)
  - Rédigez explicitement la chronologie de votre parcours
  - Préparez "pourquoi cette entreprise" avec un lien spécifique à votre histoire
  - Préparez l'histoire de votre point de preuve le plus fort (version de 30 secondes)
  - Temps : ~15% des heures disponibles

Block 2 — Sujet de domaine prioritaire (lacune à plus haut risque en premier)
  - Un sujet par bloc — ne mélangez pas
  - Pour chacun : concept → votre accroche d'histoire → questions de suivi probables
  - Temps : ~25% des heures disponibles

Block 3 — Sujet de domaine secondaire
  - Lacune avec le deuxième risque le plus élevé
  - Temps : ~20% des heures disponibles

Block 4 — Histoires comportementales
  - Associez les histoires existantes aux types de questions probables
  - Pratiquez la version verbale de 2 minutes pour chacune
  - Préparez la Réflexion pour chacune — l'élément différenciateur du candidat senior
  - Temps : ~15% des heures disponibles

Block 5 — Recherche sur l'entreprise
  - Pages de produits pertinentes pour le rôle
  - Lien entre votre parcours et leur domaine spécifique
  - 3–4 questions pointues à leur poser
  - Temps : ~10% des heures disponibles

Block 6 — Test pratique (si le temps le permet)
  - Une question par sujet probable — à voix haute, chronométrée
  - Temps : ~10% des heures disponibles

Block 7 — Marge + repos
  - Arrêtez d'étudier 60–90 minutes avant l'entretien
  - Bachoter dans la dernière heure ajoute du bruit, pas du signal
  - Temps : restant
```

Ajustez la taille des blocs en fonction de la gravité des lacunes et du type de round. S'il s'agit d'une sélection (screening), le Block 4 (comportemental) et le Block 5 (recherche sur l'entreprise) sont plus importants que les blocs approfondis du domaine.

---

## Step 4 — Priority Quick-Reference

À la fin du plan, produisez une référence rapide d'une page que le candidat peut parcourir 15 minutes avant l'entretien :

```markdown
## 15-Minute Pre-Interview Review

**Votre phrase d'ancrage :** [une phrase qui capture pourquoi vous êtes le candidat idéal pour ce rôle]

**Les 3 choses principales à retenir :**
1. [message le plus important avec lequel laisser l'intervieweur]
2. [question la plus probable et la première phrase de votre réponse]
3. [le lien entre votre parcours et leur domaine]

**Vos questions à poser :**
1. [question 1]
2. [question 2]
3. [question 3]
```

---

## Step 5 — Save Output

Sauvegardez le plan dans `interview-prep/{company-slug}-{role-slug}.md` si un fichier n'existe pas, ou ajoutez une section `## Prep Plan` s'il existe.

---

## Rules

- **Calibrez en fonction du round.** Un plan de préparation de screening est très différent d'un plan pour un panel de conception. Ne prenez pas par défaut une profondeur maximale pour chaque entretien.
- **Les lacunes d'abord.** Le temps est limité. Les points forts du candidat n'ont pas besoin de préparation — ses lacunes, si.
- **Les lacunes 🔴 de la banque de questions priment sur les lacunes déduites.** Les données réelles de performance valent mieux que l'analyse CV-vs-JD. Si le candidat sait déjà qu'il a des difficultés sur un sujet, ne l'ignorez pas.
- **Un sujet par bloc.** Mélanger les sujets dans un seul bloc réduit la rétention.
- **Prévoyez toujours du temps de repos.** Un candidat reposé est plus performant qu'un candidat qui a bachoté.
- **Ne générez jamais de fausses informations sur l'entreprise.** Si vous n'avez pas fait de recherches, dites-le — n'inventez pas d'affirmations sur la culture ou de détails techniques sur l'entreprise.
- **N'inventez jamais d'affirmations pour le candidat.** La phrase d'ancrage et les points de discussion pré-entretien dans la référence rapide (Step 4) doivent être fondés sur ce que le candidat a réellement — `cv.md`, `article-digest.md` ou la banque d'histoires. Ne rédigez pas d'affirmations qui dépendent d'une expérience ou de mesures que le candidat n'a pas. Si une affirmation apparaît dans `interview-prep/retracted-claims.md`, ne l'incluez jamais.
