# Proposition Supabase pour NautIA

## Analyse et périmètre

Le dépôt contient le README d’initialisation et les propositions SQL. L'utilisateur
a fourni un résumé du schéma existant (`client`, une table de demandes, RLS sans
policies, aucun objet `nautia_*`, Vault présent, `pg_cron`/`pg_net` absents), mais
aucun export exhaustif du schéma ou des policies Storage n'est disponible. Ces
fichiers proposent donc une structure nouvelle ; ils ne constituent pas une
migration validée de la base actuelle. Aucune connexion à celle-ci n’a été faite.

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
| `nautia_pdfs` | Catalogues PDF privés, attachés à un fournisseur et un chantier |

Les montants sont des décimaux, jamais des nombres flottants. Convention proposée :
prix et tarifs hors taxes ; aucune TVA ni conversion monétaire n’est implémentée.
Le prix courant est la dernière entrée applicable pour un article et une monnaie,
triée par `effective_at DESC, recorded_at DESC, id DESC`, avec `effective_at <= now()`.
Ne pas comparer directement des prix de monnaies différentes.
Les tarifs horaires acceptent plusieurs métiers et périodes. L’absence de
chevauchement entre périodes d’un même métier n’est pas imposée dans cette version.

## Séparation des chantiers

- Toutes les tables métier portent `chantier_id`. Chaque PDF de catalogue référence
  également un fournisseur du même chantier.
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
explicitement attribués. Les propriétaires de la base contournent RLS. Le rôle
`service_role` n'a aucun droit direct sur les tables NautIA : il peut seulement
appeler les deux RPC de rétention. Sa clé conserve néanmoins des privilèges de
plateforme, notamment pour Storage ; elle reste exclusivement dans le runtime de
l'Edge Function et ne doit jamais être transmise au navigateur ou au cron.
Ne pas exposer le schéma `nautia_private` via l’API.

La suppression d’un article ayant un historique est bloquée. La suppression d’un
chantier ayant des métadonnées PDF est également bloquée : un futur flux serveur
devra supprimer les objets Storage, puis les métadonnées, avant le chantier.
Une suppression de chantier sans PDF efface ses autres données par cascade.

## PDF : téléchargement et conservation

Le bucket `nautia-pdfs` est privé, limité à 20 Mio par fichier et au MIME
`application/pdf`. Le MIME ne prouve pas le contenu : vérifier aussi les fichiers
à l’ingestion côté serveur si nécessaire.

Des policies restrictives protègent la ligne `storage.buckets` elle-même : même
si une ancienne policy permissive existe, `anon` et `authenticated` ne peuvent
pas rendre le bucket public, modifier ses limites, le remplacer ou le supprimer.
Des garde-fous équivalents protègent les objets. Seuls les rôles administratifs
de la plateforme peuvent modifier la configuration du bucket.

Procédure d’ajout :

1. Générer un UUID de document côté client.
2. Insérer `id`, `chantier_id`, `supplier_id`, `filename` et `object_path` dans
   `nautia_pdfs`. Le fournisseur doit déjà appartenir à ce chantier.
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

### Suppression physique automatique préparée

Le SQL seul ne supprime pas les fichiers binaires Supabase Storage. La proposition
inclut maintenant quatre éléments complémentaires :

1. `03_retention.sql` réserve les documents expirés par lots avec `SKIP LOCKED`.
   Un lot abandonné redevient disponible après quinze minutes.
2. L'Edge Function `purge-nautia-pdfs` utilise l'API Storage pour effacer chaque
   binaire, puis appelle une seconde RPC qui supprime les métadonnées uniquement
   si le document est expiré et avait été réservé, et si le chemin n'existe plus
   dans `storage.objects`.
3. L'endpoint exige un secret dédié d'au moins 32 caractères, comparé par son
   empreinte. La clé `service_role` reste dans le runtime de la fonction.
4. `04_retention_schedule.sql` appelle la fonction toutes les dix minutes via
   `pg_cron` et `pg_net`. L'URL et le secret proviennent de Supabase Vault.

Ne jamais supprimer directement des lignes de `storage.objects` en SQL : cela ne
garantit pas l’effacement du binaire. L’accès est bloqué exactement à l’échéance ;
la suppression physique intervient normalement dans les dix minutes suivantes,
ou plus tard en cas d’incident. Surveiller les journaux Edge Function,
`cron.job_run_details` et les réponses de `net._http_response`. Les sauvegardes et
leurs propres durées de conservation doivent être examinées séparément.

La purge ne devient réellement active qu'après déploiement de la fonction,
création des deux secrets Vault et application du planning. Ces étapes sont
volontairement séparées : aucun secret et aucun identifiant de projet n'est écrit
dans Git.

## Revue avant toute application

Exporter le schéma actuel sans données ni secrets : tables, contraintes,
fonctions, grants, policies RLS et paramètres/policies Storage. Vérifier les
conflits avec les noms `nautia_*`, les données à reprendre, les utilisateurs et
les droits existants, ainsi que la version PostgreSQL du projet.

Commencer par `00_preflight_readonly.sql` pour inventorier les métadonnées de
`client`, `demande_devis`, des policies et de Storage, sans lire les lignes
métier. Les scripts créent de nouveaux objets et échouent en cas de conflit ; ils
ne sont pas idempotents et ne remplacent ni ne suppriment des objets préexistants.
Sur une base Supabase de test dédiée, après revue, l’ordre serait :

1. `01_schema.sql` : tables, contraintes, grants et RLS.
2. `02_storage.sql` : bucket privé et policies d’accès.
3. `03_retention.sql` : RPC minimales du worker.
4. Déployer `purge-nautia-pdfs`, configurer `NAUTIA_RETENTION_SECRET`, puis créer
   dans Vault `nautia_retention_url` et `nautia_retention_secret`.
5. `04_retention_schedule.sql` : planification automatique toutes les dix minutes.

Chaque fichier SQL est transactionnel, mais les quatre fichiers ne forment pas une
transaction commune. Prévoir une sauvegarde et une procédure de reprise avant
toute migration réelle. Aucun script de rollback destructif n’est fourni.

## Validation locale

Les scripts ont été exécutés sur PostgreSQL 17 dans un conteneur jetable avec des
simulations minimales d’Auth et Storage. Les tests vérifient la séparation entre
deux chantiers, les rôles lecteur/éditeur, les clés étrangères inter-chantiers,
l’impossibilité de réécrire les historiques ou l’expiration, les accès Storage
et la configuration du bucket même face à d’anciennes policies permissives, le
blocage après expiration, les claims concurrents et les droits RPC limités de
`service_role`.
Les quatre fichiers SQL passent également une analyse syntaxique PostgreSQL et
l'Edge Function passe `deno check` avec Deno 2.5.4. Ce contrôle ne teste pas l’API
Supabase, les fichiers binaires, les URL signées, Vault/`pg_cron` en conditions
réelles, ni le worker déployé. Une validation sur un projet Supabase de test reste
nécessaire.

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
