# DuelRank local

Application web locale de classement par duels.

## Lancer

Option recommandée, depuis ce dossier :

```bash
python -m http.server 8080
```

Puis ouvrir `http://localhost:8080` dans le navigateur.

L'application n'a aucune dépendance npm et n'envoie pas le CSV à un serveur.
Les vidéos YouTube nécessitent évidemment une connexion Internet pour être lues.

## CSV

En-têtes acceptés :

- `nom` obligatoire
- `description` optionnel
- `lien` optionnel
- `image` optionnel

Des alias anglais courants sont aussi acceptés (`name`, `title`, `description`, `link`, `url`, `image`, `cover`, `thumbnail`).

Exemple : voir `exemple.csv`.

## Algorithme

Le classement exact est construit avec un tri fusion interactif. Chaque comparaison demandée à l'utilisateur résout le prochain choix nécessaire à la fusion de deux sous-classements déjà ordonnés.

Le nombre maximal de duels est :
`n × ceil(log2(n)) - 2^ceil(log2(n)) + 1`

L'interface affiche aussi une estimation moyenne basée sur l'espérance du nombre de comparaisons lors des fusions.

Fonctions incluses : import CSV, estimation, drag-and-drop, vidéos YouTube intégrées, images distantes, liens externes, raccourcis clavier, annulation, sauvegarde locale automatique, reprise et export CSV du classement.
