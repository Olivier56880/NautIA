# Proposition Supabase pour NautIA

## Analyse et périmètre

Le dépôt contient uniquement un README d’initialisation. Aucun code applicatif,
schéma SQL, export Supabase ou configuration de la base existante n’est disponible.
Ces fichiers proposent donc une structure nouvelle ; ils ne constituent pas une
migration validée de votre base actuelle. Aucune connexion à celle-ci n’a été faite.

Les fichiers sont volontairement placés dans `proposals/`, et non dans
`supabase/migrations/`, pour éviter une application automatique par le CLI.
Ne pas les exécuter en production avant comparaison avec le schéma existant.

## Changements proposés

| Table | Usage |
| --- | --- |
| `nautia_chantiers` | Chantier, propriétaire et description |
| `nautia_members` | Membres lecteurs ou éditeurs, propres à chaque chantier |
| `nautia_hourly_rates` | Tarifs horaires, monnaie et dates de validité |
| `nautia_suppliers` | Fournisseurs propres au chantier |
| `nautia_catalog_items` | Catalogue de chaque fournisseur, référence et unité |
| `nautia_price_history` | Prix datés, ajoutés sans réécriture de l’historique |
| `nautia_pdfs` | Métadonnées et échéance des fichiers privés |

Les montants sont des décimaux, jamais des nombres flottants. Convention proposée :
prix et tarifs hors taxes ; aucune TVA ni conversion monétaire n’est implémentée.
Le prix courant est la dernière entrée applicable pour un article et une monnaie,
triée par `effective_at DESC, recorded_at DESC, id DESC`, avec `effective_at <= now()`.
Ne pas comparer directement des prix de monnaies différentes.
Les tarifs horaires acceptent plusieurs métiers et périodes. L’absence de
chevauchement entre périodes d’un même métier n’est pas imposée dans cette version.

## Séparation des chantiers

- Toutes les tables métier portent `chantier_id`.
- Les clés étrangères composites interdisent un article lié au fournisseur d’un
  autre chantier, ou un prix lié à l’article d’un autre chantier.
- RLS filtre les lignes avec l’identité Supabase Auth (`auth.uid()`).
- Le propriétaire gère les membres et les informations du chantier. Un éditeur
  modifie les tarifs/catalogues et ajoute des prix/PDF. Un lecteur consulte.
- Seul le propriétaire peut donner un accès. Un membre ne peut pas se promouvoir.
- Les utilisateurs anonymes n’ont aucun accès aux tables métier.
- Les colonnes d’identité, de rattachement et d’expiration ne sont pas modifiables
  par les clients. Les PDF et les prix historiques ne sont pas effaçables par eux.

Un utilisateur membre de plusieurs chantiers voit les chantiers qui lui sont
explicitement attribués. Les propriétaires de la base et la clé `service_role`
contournent RLS : conserver cette clé uniquement côté serveur. Ne jamais la
distribuer à un navigateur. Ne pas exposer le schéma `nautia_private` via l’API.

La suppression d’un article ayant un historique est bloquée. La suppression d’un
chantier ayant des métadonnées PDF est également bloquée : un futur flux serveur
devra supprimer les objets Storage, puis les métadonnées, avant le chantier.
Une suppression de chantier sans PDF efface ses autres données par cascade.

## PDF : téléchargement et conservation

Le bucket `nautia-pdfs` est privé, limité à 20 Mio par fichier et au MIME
`application/pdf`. Le MIME ne prouve pas le contenu : vérifier aussi les fichiers
à l’ingestion côté serveur si nécessaire.

Procédure d’ajout :

1. Générer un UUID de document côté client.
2. Insérer `id`, `chantier_id`, `filename` et `object_path` dans `nautia_pdfs`.
3. Envoyer le PDF dans `nautia-pdfs`, au chemin exact
   `<chantier_uuid>/<document_uuid>/document.pdf`, sans `upsert`.
4. En cas d’échec d’upload, conserver l’UUID pour réessayer le même objet ; un
   traitement serveur pourra aussi nettoyer les métadonnées sans fichier.

Le serveur fixe l’échéance à six mois calendaires UTC après l’insertion des
métadonnées (pas 180 jours). L’accès SQL/Storage est refusé après cette échéance.
Les garde-fous Storage restrictifs bloquent aussi les anciennes policies
permissives pour ce bucket, sans changer les droits des autres buckets.

Utiliser les téléchargements authentifiés pour revérifier RLS à chaque requête.
Une URL signée déjà émise reste utilisable jusqu’à sa propre expiration, même si
les droits changent. Éviter les URL signées pour cette proposition ; si un serveur
en émet, vérifier lui-même les droits et limiter leur durée au temps restant avant
`expires_at`. Les copies déjà téléchargées ne peuvent pas être révoquées.

### Suppression physique : composant restant à mettre en place

Le SQL seul ne supprime pas les fichiers binaires Supabase Storage. Le fichier
`03_retention.sql` expose une RPC réservée à `service_role` pour obtenir les PDF
expirés ; il ne crée pas de tâche planifiée.

Un worker serveur / Edge Function planifié doit :

1. Appeler `nautia_expired_pdfs` avec `p_limit = 100`.
2. Supprimer chaque `object_path` par l’API Storage
   `storage.from('nautia-pdfs').remove([object_path])`.
3. Après confirmation de suppression, effacer la ligne de `nautia_pdfs` avec son
   `id` et un filtre `expires_at <= maintenant`. Un objet déjà absent peut être
   traité comme supprimé ; les autres erreurs doivent être réessayées.
4. Répéter par lots jusqu’à épuisement, avec une limite de durée et des alertes
   en cas d’échec, pour éviter une boucle permanente sur un objet en erreur.

Ne jamais supprimer directement des lignes de `storage.objects` en SQL : cela
ne garantit pas l’effacement du binaire. Prévoir une exécution fréquente, par
exemple chaque heure ; la purge effective aura alors un retard pouvant atteindre
une heure, davantage en cas d’incident, tandis que les accès sont déjà bloqués.
La rétention physique de six mois n’est donc pas opérationnelle tant que ce
worker et sa supervision ne sont pas déployés. Les sauvegardes et leurs propres
durées de conservation devront être examinées séparément.

## Revue avant toute application

Exporter le schéma actuel sans données ni secrets : tables, contraintes,
fonctions, grants, policies RLS et paramètres/policies Storage. Vérifier les
conflits avec les noms `nautia_*`, les données à reprendre, les utilisateurs et
les droits existants, ainsi que la version PostgreSQL du projet.

Les scripts créent de nouveaux objets et échouent en cas de conflit ; ils ne sont
pas idempotents et ne remplacent ni ne suppriment des objets préexistants.
Sur une base Supabase de test dédiée, après revue, l’ordre serait :

1. `01_schema.sql` : tables, contraintes, grants et RLS.
2. `02_storage.sql` : bucket privé et policies d’accès.
3. `03_retention.sql` : RPC du futur worker.

Chaque fichier est transactionnel, mais les trois fichiers ne forment pas une
transaction commune. Prévoir une sauvegarde et une procédure de reprise avant
toute migration réelle. Aucun script de rollback destructif n’est fourni.

## Validation locale

Les scripts ont été exécutés sur PostgreSQL 17 dans un conteneur jetable avec des
simulations minimales d’Auth et Storage. Les tests vérifient la séparation entre
deux chantiers, les rôles lecteur/éditeur, les clés étrangères inter-chantiers,
l’impossibilité de réécrire les historiques ou l’expiration, les accès Storage
même face à une ancienne policy permissive, et le blocage après expiration.
Ce contrôle ne teste pas l’API Supabase, les fichiers binaires, les URL signées,
ni un worker réel. Une validation sur un projet Supabase de test reste nécessaire.

Pour reproduire, avec Docker, utiliser un conteneur **neuf** portant ce nom :

```sh
docker run --detach --name nautia-sql-check \
  --env POSTGRES_PASSWORD=local-validation-only postgres:17
# Attendre que docker exec nautia-sql-check pg_isready -U postgres réussisse.
python supabase/tests/validate_proposal.py
docker rm --force --volumes nautia-sql-check
```

Exécuter depuis la racine du dépôt. Le validateur utilise uniquement ce conteneur,
jamais une URL de base externe. Ne pas réutiliser un conteneur contenant des données.
