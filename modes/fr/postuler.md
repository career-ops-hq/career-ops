# Mode : postuler -- Assistant live pour les formulaires de candidature

Mode interactif pour le moment ou le candidat remplit un formulaire de candidature dans Chrome. Lit ce qui est a l'ecran, charge le contexte de l'evaluation precedente de l'offre et genere des reponses personnalisees pour chaque question du formulaire.

## Prerequis

- **Ideal avec Playwright visible** : En mode visible, le candidat voit le navigateur et Claude peut interagir avec la page.
- **Sans Playwright** : le candidat partage une capture d'ecran ou colle les questions manuellement.

## Workflow

```
1. DETECTER     -> Lire l'onglet Chrome actif (capture/URL/titre)
2. IDENTIFIER   -> Extraire entreprise + role depuis la page
3. RECHERCHER   -> Matcher avec les reports existants dans reports/
4. CHARGER      -> Lire le report complet + Bloc G (si existant)
5. COMPARER     -> Le role a l'ecran correspond-il a celui evalue ? Si changement -> alerter
6. ANALYSER     -> Identifier TOUTES les questions visibles du formulaire
7. GENERER      -> Pour chaque question, generer une reponse personnalisee
8. PRESENTER    -> Afficher les reponses formatees pour copier-coller
```

## Etape 1 -- Detecter l'offre

**Avec Playwright :** Snapshot de la page active. Lire titre, URL et contenu visible.

**Sans Playwright :** Demander au candidat de :
- Partager une capture d'ecran du formulaire (le Read tool lit les images)
- Ou coller les questions du formulaire en texte
- Ou indiquer entreprise + role pour qu'on cherche le contexte

## Etape 2 -- Identifier et charger le contexte

1. Extraire le nom de l'entreprise et le titre du poste depuis la page
2. Chercher dans `reports/` par nom d'entreprise (Grep case-insensitive)
3. Si match -> charger le report complet
4. Si Bloc G present -> charger les brouillons de reponses precedents comme base
5. Si PAS de match -> alerter le candidat et proposer un auto-pipeline rapide

## Etape 3 -- Detecter les changements de role

Si le role a l'ecran differe de celui evalue :
- **Alerter le candidat** : "Le role a change de [X] a [Y]. Souhaites-tu que je reevalue ou que j'adapte les reponses au nouveau titre ?"
- **Si adapter** : Ajuster les reponses au nouveau role sans reevaluer
- **Si reevaluer** : Lancer l'evaluation complete A-F, mettre a jour le report, regenerer le Bloc G
- **Mettre a jour le tracker** : Modifier le titre du role dans applications.md si necessaire

## Etape 4 -- Analyser les questions du formulaire

Identifier TOUTES les questions visibles :
- Champs de texte libre (lettre de motivation, "pourquoi ce poste", motivation, etc.)
- Listes deroulantes (comment avez-vous connu l'entreprise, autorisation de travail, etc.)
- Oui/Non (mobilite, visa, disponibilite, etc.)
- Champs de salaire (fourchette, pretentions salariales -- en brut annuel pour la France)
- Champs d'upload (CV, lettre de motivation PDF, references)

Classifier chaque question :
- **Deja repondue dans le Bloc G** -> reprendre la reponse existante
- **Nouvelle question** -> generer la reponse depuis le report + `cv.md`

## Etape 5 -- Generer les reponses

Pour chaque question, construire la reponse selon ce schema :

1. **Contexte du report** : Utiliser les proof points du bloc B, les stories STAR du bloc F
2. **Bloc G precedent** : Si un brouillon existe, le prendre comme base et affiner
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

Si le candidat confirme que la candidature est envoyee :
1. Mettre a jour le statut vers "Applied" via le CLI canonique : `node set-status.mjs <report#> Applied` (ne pas editer la table `applications.md` a la main)
2. Mettre a jour le Bloc G du report avec les reponses finales
3. Suggerer l'etape suivante : `/career-ops contacto` pour du LinkedIn outreach vers le hiring manager

## Gestion du defilement

Si le formulaire a plus de questions que ce qui est visible :
- Demander au candidat de defiler et de partager une autre capture d'ecran
- Ou de coller les questions restantes
- Traiter par iterations jusqu'a couvrir tout le formulaire
