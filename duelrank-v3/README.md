# DuelRank V3

Web app locale de classement adaptatif par duels.

## Lancement

```bash
python -m http.server 8081
```

Ouvrir ensuite `http://localhost:8081`.

## Nouveautes V3

- Raffinement dynamique inspire de Bradley-Terry : les duels de controle sont choisis parmi les voisins dont la probabilite de victoire est la plus incertaine.
- Auto-remplissage des champs optionnels vides du CSV : `description`, `lien`, `image`.
- Champ `Type d'objet a rechercher` pour contextualiser l'autocompletion.
- Mode special `video youtube` : DuelRank tente de trouver une video YouTube correspondant au nom, puis remplit le lien et la miniature. Si le navigateur bloque la lecture de YouTube, il conserve un lien de recherche YouTube cible.
- Rang actuel visible sur chaque participant pendant un duel.
- Classement general lateral pendant les duels, avec uniquement les noms.
- Export CSV du classement courant.
- Export JSON de session a tout moment pour continuer le ranking sur une autre machine.
- Import JSON de session depuis l'accueil.
- Sauvegarde locale IndexedDB, sans persister l'historique d'annulation.

## CSV

Colonnes :

- `nom` obligatoire
- `description` optionnel
- `lien` optionnel
- `image` optionnel

## Session portable

Le bouton `Exporter session` telecharge un fichier `session-duelrank-v3.json`.
Sur une autre machine, ouvrir la V3 puis utiliser `Importer une session V3`.
