# Mode : pipeline -- Inbox d'URLs (Second Brain)

Traite les URLs d'offres accumulees dans `data/pipeline.md`. Le candidat ajoute des URLs quand il veut et lance ensuite `/career-ops pipeline` pour toutes les traiter d'un coup.

## Workflow

1. **Lire** `data/pipeline.md` -> trouver les items `- [ ]` dans la section "En attente" / "Pending" / "Pendientes"
2. **Pour chaque URL en attente** :
   a. Reserver le prochain `REPORT_NUM` sequentiel de maniere atomique en executant `node reserve-report-num.mjs` (et liberer le sentinel en executant `node reserve-report-num.mjs --release <num>` une fois le rapport ecrit)
   b. **Extraire l'offre** avec Playwright (`browser_navigate` + `browser_snapshot`) -> WebFetch -> WebSearch
   c. Si l'URL n'est pas accessible -> marquer comme `- [!]` avec une note et continuer
   d. **Executer l'auto-pipeline complet** : Evaluation A-F -> Report .md -> PDF (si score >= 3.0) -> Tracker
   e. **Deplacer de "En attente" vers "Traitees"** : `- [x] #NNN | URL | Entreprise | Role | Score/5 | PDF oui/non`
3. **Si 3+ URLs en attente**, lancer des agents en parallele (Agent tool avec `run_in_background`) pour maximiser la vitesse.
4. **A la fin**, afficher un tableau recapitulatif :

```
| # | Entreprise | Role | Score | PDF | Action recommandee |
```

## Format de pipeline.md

```markdown
## En attente
- [ ] https://jobs.example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Company SAS | Senior PM
- [!] https://private.url/job -- Erreur : login requis

## Traitees
- [x] #143 | https://jobs.example.com/posting/789 | Acme SAS | AI PM | 4.2/5 | PDF oui
- [x] #144 | https://boards.greenhouse.io/xyz/jobs/012 | BigCo | SA | 2.1/5 | PDF non
```

> Note : Les en-tetes de section peuvent etre en EN ("Pending"/"Processed"), ES ("Pendientes"/"Procesadas"), DE ("Offen"/"Verarbeitet") ou FR ("En attente"/"Traitees"). Etre flexible a la lecture, fidele au style existant a l'ecriture.

## Detection intelligente de l'offre depuis l'URL

1. **Playwright (prefere) :** `browser_navigate` + `browser_snapshot`. Fonctionne avec toutes les SPAs.
2. **WebFetch (fallback) :** Pour les pages statiques ou quand Playwright n'est pas disponible.
3. **WebSearch (dernier recours) :** Chercher sur des portails secondaires qui indexent l'offre.

**Cas particuliers :**
- **LinkedIn** : Peut necessiter un login -> marquer `[!]` et demander au candidat de coller le texte
- **PDF** : Si l'URL pointe vers un PDF, le lire directement avec le Read tool
- **Prefixe `local:`** : Lire le fichier local. Exemple : `local:jds/linkedin-pm-ai.md` -> lire `jds/linkedin-pm-ai.md`
- **Welcome to the Jungle / Indeed FR / APEC** : Portails francophones courants. Playwright gere bien les cookie banners
- **France Travail (ex-Pole emploi)** : Offres structurees, bien lisibles par machine. WebFetch suffit generalement

## Numerotation automatique

1. Executer `node reserve-report-num.mjs` pour reserver le prochain numero sequentiel de maniere atomique (stdout renvoie `{###}`).
2. Ecrire le rapport avec ce numero.
3. Liberer le sentinel en executant `node reserve-report-num.mjs --release {###}` une fois le rapport ecrit.

## Synchronisation des sources

Avant de traiter une URL, verifier la sync :

```bash
node cv-sync-check.mjs
```

En cas de desynchronisation, alerter le candidat avant de continuer.
