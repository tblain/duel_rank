# DuelRank V5

V5 garde le moteur de ranking local de la V4, supprime le remplissage automatique et ajoute un onglet `Catalogue` sauvegarde sur un backend Supabase.

## Lancement local

```bash
node serve-v5.mjs
```

Ouvrir `http://localhost:8083`.

## Backend Supabase

1. Creer un projet Supabase.
2. Ouvrir le SQL editor.
3. Executer `supabase/migrations/001_create_catalogs.sql`.
4. Activer l'auth email / magic link dans Supabase Auth.
5. Dans Supabase Auth > URL Configuration, autoriser les URLs de redirection :
   - `http://localhost:8083`
   - l'URL de production quand l'app sera deployee
6. Dans l'app, ouvrir `Catalogue`.
7. Coller la `Project URL` et la `anon public key`.
8. Se connecter par email.

La cle anon est publique par conception, mais les lignes sont protegees par Row Level Security : chaque utilisateur ne voit que ses propres catalogues.

## Catalogue

- `Enregistrer au catalogue` sauvegarde la liste CSV importee dans Supabase.
- `Catalogue > Utiliser` recharge une liste dans l'ecran Importer.
- `Supprimer` efface la liste du backend.
- `Exporter JSON` telecharge une copie de securite d'une liste.

Les sessions de ranking restent locales/exportables comme avant. Le catalogue stocke les CSV/listes, pas l'etat complet d'un ranking.

La V5 ne fait pas de remplissage automatique : elle sauvegarde et recharge les listes telles qu'elles sont dans le CSV ou telles qu'elles ont ete corrigees manuellement.

## Ameliorations UX

- Interface plus confortable sur smartphone : onglets compacts, actions de duel en grille, classement lateral limite en hauteur.
- Importer une session recharge aussi la liste CSV dans l'ecran Importer, ce qui permet ensuite de la sauvegarder dans le catalogue.
- `Reprendre la sauvegarde` restaure aussi la liste CSV associee a la session locale.
- Tous les 50 duels, une animation de confettis apparait.
- Le classement lateral peut etre modifie manuellement :
  - glisser-deposer une ligne sur une autre ;
  - ou utiliser les boutons `↑` / `↓`, plus pratiques sur mobile.

## Tests

```bash
node tests/engine.test.mjs
```
