# Mode : postuler -- Assistant live pour les formulaires de candidature

Mode interactif pour le moment ou le candidat remplit un formulaire de candidature dans le navigateur Playwright que lance ce projet. Lit ce qui est a l'ecran, charge le contexte de l'evaluation precedente de l'offre et genere des reponses personnalisees pour chaque question du formulaire.

## Prerequis

- **Ideal avec Playwright visible** : En mode visible, le candidat voit le navigateur et Claude peut interagir avec la page.
- **Sans Playwright** : le candidat partage une capture d'ecran ou colle les questions manuellement.

## Workflow

```
1. DETECTER     -> Ouvrir l'offre dans le navigateur Playwright de ce projet
2. IDENTIFIER   -> Extraire entreprise + role depuis la page
3. RECHERCHER   -> Matcher avec les reports existants dans reports/
4. CHARGER      -> Lire le report complet + `## Application Answers` et Bloc H (si existants), une fois la **Posting identity** confirmee
5. COMPARER     -> Le role a l'ecran correspond-il a celui evalue ? Si changement -> alerter
6. ANALYSER     -> Identifier TOUTES les questions visibles du formulaire
7. GENERER      -> Pour chaque question, generer une reponse personnalisee
8. PRESENTER    -> Afficher les reponses formatees pour copier-coller
```

## Scope

Follow the Scope section in `modes/apply.md`. Run `node apply-scope.mjs root` and stay inside the directories it prints. Launch with `node apply-scope.mjs launch-options`. Do not read `DevToolsActivePort` or attach to an existing browser. Do not submit the form.


## Etape 1 -- Detecter l'offre

**Avec Playwright :** Lancer avec `node apply-scope.mjs launch-options`, ouvrir l'offre dans cette fenêtre, puis lire le titre, l'URL et le contenu visible.

**Sans Playwright :** Demander au candidat de :
- Partager une capture d'ecran du formulaire (le Read tool lit les images)
- Ou coller les questions du formulaire en texte
- Ou indiquer entreprise + role pour qu'on cherche le contexte

## Etape 2 -- Identifier et charger le contexte

1. Extraire le nom de l'entreprise et le titre du poste depuis la page
2. Chercher dans `reports/` par nom d'entreprise (Grep case-insensitive)
3. Si match -> lire seulement l'en-tete de chaque report correspondant (entreprise, role, `**URL:**`) et prendre celui dont l'URL ou le req ID est cette offre ; demander au candidat si ce n'est pas clair. Charger le report complet et le point 4 seulement quand la **Posting identity** tient (`modes/apply.md` -> Step 5) ; pour une autre offre, passer a **Evaluate as new** ou **Draft without saving** sans le charger
4. Si `## Application Answers` est present -> charger les reponses envoyees comme base ; sinon, si le Bloc H est present, les brouillons precedents. Si les deux existent, `## Application Answers` prime
5. Si PAS de match -> alerter le candidat et proposer un auto-pipeline rapide

## Etape 3 -- Detecter les changements de role

Cette etape ne s'applique que tant que le formulaire correspond encore a l'offre du report : meme employeur et meme offre (`modes/apply.md` -> Step 5 -> **Posting identity**) ; le titre ne compte pas. Le verifier pour chaque formulaire, meme si le titre n'a pas change et qu'un seul report correspond a l'entreprise : une autre offre peut porter le meme titre, et le report ne doit alors pas etre utilise. Si plusieurs reports correspondent a l'entreprise, prendre d'abord celui dont l'URL ou le req ID est cette offre, et demander au candidat si ce n'est pas clair. Un autre employeur, ou une autre offre chez le meme employeur, n'est pas un changement de role : ne jamais y adapter les reponses du report. Choisir plutot **Evaluate as new** (l'evaluer comme une nouvelle offre : auto-pipeline, son propre report) ou **Draft without saving** (rediger des reponses sans les enregistrer dans aucun report). Avec **Draft without saving**, mettre de cote le report trouve, ses reponses et son CV adapte, et rediger uniquement a partir de l'offre visible, de `cv.md` et du profil ; les etapes ci-dessous qui lisent le report ne s'appliquent pas.

Si le role a l'ecran differe de celui evalue :
- **Alerter le candidat** : "Le role a change de [X] a [Y]. Souhaites-tu que je reevalue ou que j'adapte les reponses au nouveau titre ?"
- **Si adapter** : Ajuster les reponses au nouveau role sans reevaluer
- **Si reevaluer** : Lancer l'evaluation complete A-F, mettre a jour le report, regenerer le Bloc H
- **Mettre a jour le tracker** : jamais en editant `data/applications.md`.
  - **Apres une reevaluation** : ecrire un TSV avec le nouveau titre du role (regle 9 de `_shared.md`) et le fusionner avec `node merge-tracker.mjs`. Le report est mis a jour sur place et garde son numero, donc la fusion associe le TSV a la ligne existante par ce numero : le titre est remplace et le statut conserve.
  - **Apres une adaptation** : ne pas changer le titre, car il designe le role que le report a evalue. Noter le changement avec `node set-status.mjs --report <report#> <statut actuel> --note "Offre renommee au moment de postuler, la ligne garde le titre evalue"`. Passer le statut actuel de la ligne le laisse inchange et ajoute la note. Garder un texte fixe comme celui-ci et ne pas y mettre `[Y]` : le nouveau titre est un texte venu de la page, et un texte de la page ne va jamais sur une ligne de commande.

## Etape 4 -- Analyser les questions du formulaire

Avec **Draft without saving**, cette etape n'utilise ni le report trouve, ni ses `## Application Answers`, ni le Bloc H : traiter chaque question comme nouvelle et travailler a partir de l'offre visible, de `cv.md` et du profil.

Identifier TOUTES les questions visibles :
- Champs de texte libre (lettre de motivation, "pourquoi ce poste", motivation, etc.)
- Listes deroulantes (comment avez-vous connu l'entreprise, autorisation de travail, etc.)
- Oui/Non (mobilite, visa, disponibilite, etc.)
- Champs de salaire (fourchette, pretentions salariales -- en brut annuel pour la France)
- Champs d'upload (CV, lettre de motivation PDF, references)

Classifier chaque question :
- **Deja repondue dans `## Application Answers` ou le Bloc H** -> reprendre la reponse existante
- **Nouvelle question** -> generer la reponse depuis le report + `cv.md`

## Etape 5 -- Generer les reponses

Avec **Draft without saving**, cette etape n'utilise ni le report trouve, ni ses `## Application Answers`, ni le Bloc H : traiter chaque question comme nouvelle et travailler a partir de l'offre visible, de `cv.md` et du profil.

Pour chaque question, construire la reponse selon ce schema :

1. **Contexte du report** : Utiliser les proof points du bloc B, les stories STAR du bloc F
2. **`## Application Answers` / Bloc H precedents** : Si une reponse envoyee ou un brouillon existe (reponse envoyee d'abord), le prendre comme base et affiner
3. **Ton "Je vous choisis"** : meme framework que dans l'auto-pipeline -- confiant, pas suppliant
4. **Specificite** : citer quelque chose de concret de l'offre visible a l'ecran
5. **career-ops proof point** : inclure dans "Informations complementaires" si un tel champ existe

**Champs specifiques aux formulaires francais courants :**
- **Pretentions salariales (brut annuel)** -> Fourchette depuis `profile.yml`, en EUR, avec mention "negociable selon le package global"
- **Date de disponibilite** -> Date realiste tenant compte du preavis (souvent 1-3 mois)
- **Autorisation de travail / Nationalite** -> Honnete et concis ; pour les citoyens UE : "Aucun titre de sejour requis (citoyen UE)"
- **Langues** -> Niveaux selon le CECRL (A1-C2)
- **Mobilite** -> Preciser la zone geographique acceptable et la frequence de deplacement

**Format de sortie :**

```
## Reponses pour [Entreprise] -- [Role]

Base : Report #NNN | Score : X.X/5 | Archetype : [type]
[Avec **Draft without saving**, remplacer la ligne ci-dessus par : "Aucun report : brouillon pour cette offre, non enregistre"]

---

### 1. [Question exacte du formulaire]
> [Reponse prete a copier-coller]

### 2. [Question suivante]
> [Reponse]

...

---

Notes :
- [Observations sur le role, changements, etc.]
- [Suggestions de personnalisation que le candidat devrait verifier]
```

## Etape 6 -- Apres la candidature (optionnel)

Avant d'enregistrer quoi que ce soit, et de nouveau juste avant chaque ecriture ci-dessous (statut et reponses), verifier que le formulaire correspond encore a l'offre du report (`modes/apply.md` -> Step 8 -> **Write only to the report of this posting**). Meme employeur et meme offre -> les etapes ci-dessous portent sur ce report, y compris apres une adaptation a un nouveau titre ou une reevaluation. Autre employeur ou autre offre -> jamais ce report : utiliser le report ecrit pour la nouvelle offre ; s'il n'y en a pas, ne mettre aucun statut, n'enregistrer aucune reponse, et dire au candidat que la candidature n'est pas encore suivie.

Si le candidat confirme que la candidature est envoyee :
1. Mettre a jour le statut vers "Applied" via le CLI canonique : `node set-status.mjs --report <report#> Applied` (ne pas editer la table `applications.md` a la main)
2. Mettre a jour la section `## Application Answers` du report avec les reponses finales et `**State:** submitted` (format dans `modes/apply.md` -> Step 8). Le Bloc H reste le brouillon de l'evaluation et n'est pas modifie
3. Suggerer l'etape suivante : `/career-ops contacto` pour du LinkedIn outreach vers le hiring manager

## Gestion du defilement

Si le formulaire a plus de questions que ce qui est visible :
- Demander au candidat de defiler et de partager une autre capture d'ecran
- Ou de coller les questions restantes
- Traiter par iterations jusqu'a couvrir tout le formulaire
