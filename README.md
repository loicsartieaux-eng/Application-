# NumLo Followers

Application mobile (PWA) pour suivre l'évolution du nombre de followers des pages gérées, aux couleurs de la charte NumLo.

## Fonctionnalités

- **Encoder** : choisir la page, noter le nombre de followers et la date. Un seul relevé par page et par jour (une nouvelle saisie remplace l'ancienne). Historique avec la variation depuis le relevé précédent.
- **Graphique** : courbes d'évolution (jusqu'à 5 pages comparées), filtres 30 j / 3 mois / 1 an / tout, chiffres clés avec la progression, infobulle au toucher et vue en tableau.
- **Comptes** : ajouter ou supprimer des pages, exporter en JSON ou CSV (Excel), importer des relevés.

## Stockage : Airtable

Les données sont enregistrées dans la base Airtable **NumLo Followers** (tables *Comptes* et *Relevés*) : elles sont identiques sur le téléphone et sur le PC. Des relevés peuvent aussi être ajoutés directement dans Airtable (Date, Followers et Page liée) ; l'application les affiche.

L'accès est réservé par mot de passe :

1. Créer une clé sur https://airtable.com/create/tokens avec les droits `data.records:read` et `data.records:write`, limitée à la base *NumLo Followers*.
2. Au premier lancement, coller la clé et choisir un mot de passe (8 caractères minimum).
3. L'application affiche un **code de connexion** (la clé chiffrée avec le mot de passe). Le coller dans `config.js` (`CODE_CONNEXION`) : ensuite, chaque appareil ne demande plus que le mot de passe.

Le code de connexion est public (il est dans le dépôt) : choisis un mot de passe solide, car c'est lui seul qui le protège.

## Installation sur smartphone

1. Publier le dépôt avec **GitHub Pages** : *Settings → Pages → Deploy from a branch*, choisir la branche, dossier `/ (root)`.
2. Ouvrir l'adresse fournie sur le téléphone :
   - **iPhone (Safari)** : bouton Partager → *Sur l'écran d'accueil*.
   - **Android (Chrome)** : menu ⋮ → *Installer l'application*.

## Charte graphique

Couleurs relevées sur le logo NumLo (`logo.png`) :

| Rôle | Couleur |
|---|---|
| Bleu marine (titres, boutons) | `#003a5e` |
| Bleu (première courbe, liens) | `#1391b5` |
| Turquoise (accents) | `#26cbb7` |
| Menthe (dégradé) | `#3fdfb7` |

Le dégradé menthe → bleu du symbole est repris sous l'en-tête et dans les filets de titres. Les icônes de l'application sont générées à partir du symbole du logo.

Police : Archivo (Google Fonts), en remplacement provisoire de la police de la charte.
