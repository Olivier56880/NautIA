# Comparaison et intégration sans perte

## État connu et limites

Selon les informations fournies, la base contient déjà `public.client` et
`public.demande_devis`. Le contenu de ces tables, leurs colonnes, leurs liens,
leurs données et leurs policies ne sont pas visibles dans le dépôt. La comparaison
ci-dessous est donc un plan de comparaison, pas une attestation sur la base live.
L'export de schéma attendu doit être partagé séparément avant de conclure sur les
conflits exacts.

| Élément | État rapporté | Proposition | Traitement prévu |
| --- | --- | --- | --- |
| `client` | Existe déjà ; détail inconnu | Aucune table `client` créée | Ne pas modifier, renommer, migrer, joindre ou supprimer |
| `demande_devis` | Existe déjà ; détail inconnu | Aucune table de demande créée | Aucune écriture du chatbot dans Supabase ; traiter la demande par e-mail Resend |
| Tarifs horaires | État inconnu | `nautia_hourly_rates` | Nouveau stockage par chantier |
| Fournisseurs | État inconnu | `nautia_suppliers` | Nouveau stockage par chantier |
| Catalogues PDF | État inconnu | `nautia_pdfs` lié au fournisseur du même chantier | Bucket privé `nautia-pdfs`; rétention six mois |
| Articles et historique tarifaire | État inconnu | `nautia_catalog_items`, `nautia_price_history` | Nouveaux objets rattachés au chantier et au fournisseur/article |
| Sécurité Storage | Policies actuelles inconnues | Policies restrictives sur `storage.buckets` et `storage.objects` | Comparer les anciennes policies avant l'ajout |
| Nettoyage PDF | Extensions/config inconnues | Edge Function, deux RPC, Vault, `pg_cron`/`pg_net` | Ajouter seulement si extensions et configuration sont compatibles |

Les préfixes `nautia_` évitent les collisions directes avec les deux tables déjà
signalées. Ils ne prouvent pas qu'aucune table, fonction, policy ou bucket NautIA
n'existe déjà : la vérification des noms avant application reste obligatoire.

## Périmètre des données

Supabase ne doit recevoir que les données professionnelles propres aux chantiers :
tarifs, fournisseurs, informations de catalogue structurées, PDF de catalogue et
historique de prix. La proposition ne crée pas de copie de client ni de demande de
devis et n'ajoute aucune clé étrangère vers `client` ou `demande_devis`.

Le flux chatbot doit envoyer la demande à Resend côté serveur. Ne pas l'écrire dans
`demande_devis`, dans une nouvelle table, dans un journal SQL, ni dans les
métadonnées Storage. La clé Resend reste une variable secrète côté serveur ; elle
n'appartient pas au SQL, au dépôt ou au navigateur. Le flux e-mail et sa politique
de conservation ne sont pas implémentés par cette proposition.

Les catalogues PDF sont reliés à `nautia_suppliers` par une clé composite
`(chantier_id, supplier_id)`. Cela interdit de relier un fichier au fournisseur
d'un autre chantier. Les entrées normalisées de catalogue et d'historique utilisent
la même contrainte de chantier.

## Prévol en lecture seule

`00_preflight_readonly.sql` inventorie les noms et colonnes des tables concernées,
leurs contraintes et actions de cascade, l'état et les définitions sommaires des
policies RLS, les grants, les buckets professionnels et des estimations de volume.
Il ne sélectionne aucune ligne métier, donnée personnelle, PDF ou secret et ouvre
une transaction `READ ONLY`. Lancer avec un rôle DBA en lecture seule depuis un
poste sécurisé ; ne pas coller d'URL contenant un mot de passe dans un ticket ou
le dépôt. Ce rapport confirme l'état du schéma au moment du relevé uniquement.

```sh
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -f supabase/proposals/00_preflight_readonly.sql
```

Le rapport inclut les expressions des policies pour permettre leur comparaison ;
les consulter dans un terminal sécurisé et ne pas les publier avant d'avoir vérifié
qu'elles ne contiennent pas de valeur codée en dur. Le rôle doit pouvoir lire
`information_schema`, `pg_catalog`, `pg_policies`,
`storage.buckets` et les vues de statistiques. Si un résultat est inaccessible,
documenter ce manque ; ne pas élargir les droits de l'application pour faire passer
le prévol. Retirer ou masquer toute donnée sensible ajoutée manuellement au rapport.

## Comparaisons à terminer avec l'export

1. Vérifier que chacun des six noms `nautia_*`, les fonctions
   `nautia_private.*`, les policies `nautia_*`, le bucket et le nom de job cron ne
   sont pas déjà utilisés. En cas de collision, arrêter et concevoir une migration
   explicite ; ne pas contourner avec `DROP`, `CASCADE` ou `IF NOT EXISTS`.
2. Examiner les colonnes, contraintes uniques et références de `client` et
   `demande_devis`, sans extraire leur contenu. Confirmer que le nouveau schéma
   n'en dépend pas et qu'aucun trigger existant ne copie des soumissions du chatbot
   dans Supabase.
3. Examiner toutes les policies actuelles pour `storage.buckets` et
   `storage.objects`, y compris les policies permissives et restrictives, les
   grants aux rôles et le statut du bucket. Vérifier que les nouvelles policies
   restrictives sont compatibles avec les policies système Supabase et ne bloquent
   pas les autres buckets.
4. Vérifier la version PostgreSQL, `pg_cron`, `pg_net` et Vault, le schéma de
   chaque extension, et les paramètres d'invocation des Edge Functions avant
   d'utiliser `04_retention_schedule.sql`.
5. Confirmer la signification des données, unités, taxes, devises, métiers et
   règles de validité des tarifs avant tout import. Aucun tarif, fournisseur,
   catalogue ni prix courant ne peut être déduit des tables annoncées seules.

## Procédure d'intégration sans perte

Cette séquence est une préparation ; elle n'a pas été exécutée sur votre projet.

1. Produire un export de schéma sans données ni secrets et le comparer au rapport
   de prévol. Ne jamais joindre un dump de données ou une valeur de credential.
2. Faire une sauvegarde Supabase et confirmer une restauration exploitable avant
   tout DDL. Conserver les comptes de lignes et les définitions de contraintes,
   grants et policies de `client` et `demande_devis`.
3. Appliquer en environnement Supabase de test les fichiers `01_schema.sql` puis
   `02_storage.sql`, seulement si les noms sont libres et les policies examinées.
   Comparer après application que les deux tables existantes, leurs contraintes,
   grants, policies et nombres estimés de lignes n'ont pas changé.
4. Tester avec deux identités Auth et deux chantiers séparés : lecture, écriture,
   clés étrangères composites, téléchargements, upload, ancien accès anonyme,
   policies permissives existantes, liens signés et tentatives d'URL du mauvais
   chantier. Vérifier aussi que le client ne peut pas lire/écrire le bucket.
5. Vérifier le parcours chatbot en configuration de test : un message déclenche
   l'envoi via Resend et ne produit aucune insertion dans `demande_devis` ni dans
   les tables NautIA. Inspecter les journaux afin qu'ils ne retiennent pas le
   contenu complet du message ou d'adresses personnelles au-delà du besoin.
6. Après validation des extensions et des secrets en environnement de test,
   déployer la fonction et appliquer les RPC et le planning de purge. Simuler une
   échéance passée uniquement dans cette base jetable ; vérifier suppression du
   binaire, puis de ses métadonnées, et le réessai après panne.
7. Préparer la promotion séparément avec fenêtre de changement, sauvegarde fraîche,
   surveillance, critères d'arrêt et plan de retour. Les scripts sont additifs
   mais non idempotents et ne fournissent pas de rollback automatique.

Une comparaison exacte et une migration finale sans conflit restent bloquées
jusqu'à réception de l'export de schéma et du rapport de prévol. À ce stade, seuls
les fichiers de proposition et de vérification sont préparés ; aucune requête
n'a été envoyée à Supabase.
