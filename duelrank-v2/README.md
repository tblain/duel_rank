# DuelRank V2

Web app locale de classement adaptatif par duels.

## Lancement

```bash
python -m http.server 8080
```

Ouvrir ensuite `http://localhost:8080`.

## V2

- Phase 1 : tri fusion interactif pour obtenir un classement complet.
- Phase 2 : raffinement ciblé sur les objets voisins du classement.
- 4 niveaux de précision : Rapide, Équilibrée, Précise, Maximale.
- Estimation séparée du tri initial et du raffinement.
- Sauvegarde IndexedDB, sans stockage récursif de tout l'historique dans localStorage.
- Historique d'annulation limité à 20 snapshots en mémoire, non persisté dans IndexedDB.
- Intégration YouTube via `youtube-nocookie.com`.
- Export CSV avec rang, victoires, défaites et nombre de vérifications.

## Pourquoi le bug quota de V1 arrivait

La V1 exécutait `state.history.push(JSON.stringify(state))`.

Chaque snapshot contenait lui-même `history`, donc chaque nouvelle sauvegarde embarquait les snapshots précédents. La taille de l'état augmentait de façon explosive. Puis `localStorage.setItem` atteignait son quota.

La V2 :
1. utilise IndexedDB ;
2. crée des snapshots non récursifs ;
3. limite l'annulation à 20 choix et ne la persiste pas dans IndexedDB ;
4. temporise les écritures de sauvegarde.

## CSV

Colonnes :
- `nom` obligatoire
- `description` optionnel
- `lien` optionnel
- `image` optionnel
