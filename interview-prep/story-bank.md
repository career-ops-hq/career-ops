# Story Bank — Master STAR+R Stories

This file accumulates your best interview stories over time. Each evaluation (Block F) adds new stories here. Instead of memorizing 100 answers, maintain 5-10 deep stories that you can bend to answer almost any behavioral question.

## How it works

1. Every time `/career-ops oferta` generates Block F (Interview Plan), new STAR+R stories get appended here
2. Before your next interview, review this file — your stories are already organized by theme
3. The "Big Three" questions can be answered with stories from this bank:
   - "Tell me about yourself" → combine 2-3 stories into a narrative
   - "Tell me about your most impactful project" → pick your highest-impact story
   - "Tell me about a conflict you resolved" → find a story with a Reflection

## Stories

<!-- Stories will be added here as you evaluate offers -->
<!-- Format:
### [Theme] Story Title
**Source:** Report #NNN — Company — Role
**S (Situation):** ...
**T (Task):** ...
**A (Action):** ...
**R (Result):** ...
**Reflection:** What I learned / what I'd do differently
**Best for questions about:** [list of question types this story answers]
-->

### [Automation] Slack Bots en Production — Anti-délai Campagnes
**Source:** Report #081 — Beev — Lead Operations Manager
**S (Situation):** getinside n'avait aucun système d'alerte sur les délais d'impression — les retards se découvraient au dernier moment.
**T (Task):** Réduire les retards de campagne sans recruter ni mobiliser l'équipe tech.
**A (Action):** Buildé @print_bot (Slack API + Google Sheets) — digest quotidien des jobs en cours et à venir. Puis @operations_bot pour le statut hebdomadaire des campagnes en distribution.
**R (Result):** Zéro SLA breach sur 3,000+ commandes/an depuis le déploiement. Visibilité permanente pour toute l'équipe sans réunion de suivi.
**Reflection:** Un bot simple en prod > 10 workflows Zapier complexes jamais utilisés. La valeur est dans l'adoption, pas dans la sophistication.
**Best for questions about:** Initiative technique, automatisation, impact sans ressources supplémentaires, priorisation

---

### [Process Design] Documentation Opérationnelle — Handbook Externalisé
**Source:** Report #081 — Beev — Lead Operations Manager
**S (Situation):** Aucune documentation opérationnelle à l'arrivée chez getinside — tout était dans les têtes, risque de perte de connaissance à chaque départ.
**T (Task):** Construire une base de connaissance durable, accessible à toute l'équipe et aux partenaires.
**A (Action):** Créé et maintenu getinside-ops.github.io/handbook avec VS Code + Claude Code + NotebookLM. Documentation hébergée sur GitHub Pages, partagée en externe avec les partenaires.
**R (Result):** Référence opérationnelle centrale, consultation régulière par l'équipe et les nouveaux arrivants. Onboarding accéléré (2–3 semaines vs. 2+ mois).
**Reflection:** La documentation n'est pas un livrable, c'est un produit — il faut la maintenir comme du code, pas la rédiger une fois et l'oublier.
**Best for questions about:** Process design, knowledge management, scalabilité, culture de la documentation

---

### [AI Enablement] Revenue Simulator — Outil Self-Serve IA
**Source:** Report #083 — La Fourche — Business Operations Manager
**S (Situation):** Les retailers ne pouvaient pas estimer leur ROI potentiel avant de signer — frein commercial non adressé par le produit.
**T (Task):** Créer un outil self-serve utilisable par l'équipe commerciale sans formation technique.
**A (Action):** Prototypé avec Google AI Studio, migré vers Claude Code + GitHub — outil fonctionnel livré en 2 semaines sans mobiliser l'équipe tech.
**R (Result):** Outil en production, utilisé par l'équipe commerciale pour qualifier les leads et présenter des projections aux prospects.
**Reflection:** L'enablement IA commence par résoudre un problème réel et urgent — pas par déployer un outil générique. La contrainte de temps (2 semaines) a forcé la simplicité.
**Best for questions about:** IA en contexte professionnel, initiative, build vs. buy, time-to-value

---

### [Negotiation] Renégociation CPM Fournisseurs — Construction Marge Print
**Source:** Report #083 — La Fourche — Business Operations Manager / Report #085 — Brigad — Marketplace Ops Lead
**S (Situation):** Les CPM initiaux des distributeurs (€300) rendaient les campagnes print non rentables pour les annonceurs.
**T (Task):** Construire un centre de marge print rentable et garantir le ROI des annonceurs.
**A (Action):** Analyse des benchmarks marché, préparation dossier de négociation avec données de volume, renégociation Greenweez (€300→€150, -50%) et Cadeaux.com (€300→€200, -33%). Mise en place de suivi P&L granulaire.
**R (Result):** +11pp marge opérationnelle (30%→41%) en 11 mois. €22,700+ gross margin sur insertions flyers en moins d'un an.
**Reflection:** La négociation fournisseur n'est efficace que si on a les données pour la préparer — les dashboards ont été buildés en amont pour pouvoir négocier avec des arguments.
**Best for questions about:** Négociation, gestion fournisseurs, P&L, impact commercial, supply/demand balance

---

### [Crisis Management] Détection Pré-Launch — Bose @ Boulanger
**Source:** Report #081 — Beev — Lead Operations Manager
**S (Situation):** Problème critique détecté avant le lancement d'une campagne Bose chez Boulanger — URL tracking cassée et pixel mal intégré.
**T (Task):** Résoudre avant le lancement live pour éviter l'impact sur une campagne à budget significatif.
**A (Action):** La QA platform (archive-news) avait détecté l'anomalie automatiquement. Collaboration immédiate avec l'équipe tech, correction et validation en 24h avant le go-live.
**R (Result):** Zéro impact sur la campagne. Incident documenté comme cas test pour améliorer la QA platform.
**Reflection:** La prévention coûte 10x moins cher que la crise — c'est pour ça que la QA platform a été buildée avant que les problèmes arrivent, pas après.
**Best for questions about:** Gestion de crise, prévention, qualité, proactivité, outils de monitoring

---

### [Automation] Brief Intake Automation — Standardisation via Tally + Sheets
**Source:** Report #103 — LITY (partenaire SaaS) — Growth Operations
**S (Situation):** Chaque campagne arrivait avec un brief différent — format libre, infos manquantes, retours multiples avant validation.
**T (Task):** Créer un pipeline standardisé sans mobiliser l'équipe tech ni recruter.
**A (Action):** Formulaire Tally.so → Google Sheets → auto-archivage → génération PDF de brief. Déployé seul en quelques jours.
**R (Result):** Zéro brief perdu, onboarding accéléré des nouveaux commerciaux, adoption immédiate par l'équipe.
**Reflection:** J'aurais impliqué l'équipe commerciale plus tôt pour adapter les champs du formulaire — certaines itérations auraient pu être évitées.
**Best for questions about:** No-code automation, process standardisation, rapidité de déploiement, build sans tech

---

### [AI Enablement] Creative Scoring via Gemini API — Validation Automatisée
**Source:** Report #103 — LITY (partenaire SaaS) — Growth Operations
**S (Situation):** Valider la qualité des créas avant lancement de campagne prenait 30 min par fichier — tâche répétitive et source d'erreurs humaines.
**T (Task):** Passer sous les 2 minutes de validation sans perte de fiabilité.
**A (Action):** Gemini API + Google Apps Script — scoring automatique sur critères métier (format, tracking, URLs, pixel).
**R (Result):** Temps de validation divisé par ~15. Zéro relance qualité post-lancement sur les campagnes passées par le scoring.
**Reflection:** Aurais dû documenter les critères de scoring dans un référentiel partagé dès le début — l'outil était opaque pour l'équipe au lancement.
**Best for questions about:** LLM en production, IA opérationnelle, ROI concret de l'automatisation, scalabilité

---

### [Ops from Scratch] Structuration Complète — getinside Layer Ops
**Source:** Report #085 — Brigad — Marketplace Operations Lead
**S (Situation):** getinside créé de zéro, aucun processus ops défini, équipe restreinte, première campagne à livrer en quelques semaines.
**T (Task):** Construire la couche opérationnelle complète (supply chain print, studio, tooling, partenaires) en autonomie totale.
**A (Action):** Mapping des flows prioritaires, documentation handbook en parallèle de l'exécution, automatisation des points de friction, onboarding structuré des partenaires distributeurs.
**R (Result):** 950 campagnes livrées, 3K orders/an, 0 SLA breach — système autonome, documenté, transmissible.
**Reflection:** Dans une nouvelle entité, la première priorité est de documenter pendant qu'on fait — pas après. Un système non documenté ne s'appartient qu'à son créateur.
**Best for questions about:** Fondation d'une nouvelle entité, scalabilité, autonomie, entrepreneurship interne
