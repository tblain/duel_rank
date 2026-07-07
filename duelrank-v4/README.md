# DuelRank V4

Web app locale de classement adaptatif par duels.

## Lancement

```bash
python -m http.server 8082
```

Ouvrir ensuite `http://localhost:8082`.

## Architecture

- `index.html` : structure de l'interface.
- `styles.css` : design responsive et mode compact.
- `src/ranking.js` : moteur d'active ranking.
- `src/csv.js` : parsing CSV, mapping de colonnes et validation.
- `src/autocomplete.js` : autocompletion par type d'objet et candidats YouTube.
- `src/storage.js` : IndexedDB, migration de session et sauvegarde locale.
- `src/exporters.js` : exports CSV, tiers, Markdown, HTML et session JSON.
- `src/app.js` : liaison UI.
- `src/scoring-worker.js` : worker optionnel pour calculer les prochains duels.
- `tests/engine.test.mjs` : tests du moteur.

## Fonctionnalites principales

- Ranking actif sous budget avec score d'information.
- Objectifs de ranking : global, top fiable, tiers fiables, classement complet.
- Criteres d'arret : budget, tiers stables, top stable, confiance globale.
- Calibration initiale pour faire apparaitre chaque objet.
- Mode Bradley-Terry / Glicko simplifie avec score et incertitude.
- Bouton egalite.
- Detection de contradictions.
- Priorite aux frontieres de tiers.
- Anti-repetition avec repli controle si aucune paire stricte n'est disponible.
- Budget modifiable pendant les duels et continuation depuis le resultat.
- Tiers configurables et verrouillage manuel de tier sur un objet.
- Classement lateral en liste, tiers ou debug.
- Dashboard : confiance globale, top, tiers stables, objets jamais vus, contradictions.
- Historique des duels avec annulation jusqu'a une decision recente.
- Assistant CSV : detection de colonnes, preview et validation.
- Autocompletion par presets : YouTube, film, album, jeu video, restaurant, article, produit.
- Si des champs optionnels sont vides, l'autocompletion se fait avant le ranking.
- Les objets autocompletes sont visibles avant de commencer, avec un statut par objet.
- Les erreurs de recherche sont affichees par objet et bloquent le lancement tant qu'il reste des champs incomplets.
- Revue de candidats avant application.
- Incrustation YouTube via `youtube-nocookie.com` seulement pour les URLs YouTube valides.
- Exports : CSV complet, CSV tier list, Markdown, HTML, session JSON.
- Sauvegarde locale IndexedDB et export fichier via File System Access API quand disponible.
- Benchmark integre 171 objets / 500 duels.

## Tests

```bash
node tests/engine.test.mjs
```

Le test moteur couvre le parsing CSV, 171 objets en 500 duels, la continuation du budget et les egalites.
Le test autocompletion couvre le fallback sans cle API et le rapport d'erreur par objet.
