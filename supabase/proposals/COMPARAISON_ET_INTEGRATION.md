# Comparaison et intégration sans perte

## État connu et limites

Selon le rapport transmis par l'utilisateur, la base NautIA Demo contient
`public.client` et une table annoncée comme `public."Demande underscore devis"`,
environ une ligne de test dans chacune, RLS activé et aucune policy sur ces deux
tables. Le nom communiqué de la seconde table et de sa colonne cliente reste à
confirmer : « underscore » désigne-t-il le caractère `_` (`"Demande_devis"`,
`"Client_ID"`) ou fait-il littéralement partie du nom ? Le prévol recherche les
noms publics contenant `client` ou `devis`, sans tenir compte de la casse ; il
devrait retrouver ces variantes si le rôle SQL peut voir leurs métadonnées. Il
faut néanmoins confirmer les noms exacts et la colonne référencée pour comparer
précisément les contraintes.

La table `client` a une clé primaire `(nom, id)` et `UNIQUE (id)`. La seconde a
`PRIMARY KEY (id)` et une clé étrangère vers `client(id)`. Cette référence est
valide : une clé étrangère peut viser une contrainte UNIQUE même si `id` n'est pas
seul dans la clé primaire. Le schéma NautIA proposé ne crée aucun lien vers ces
deux tables ; il ne doit donc pas altérer ces clés ni leurs données.

Le rapport indique qu'il n'existe ni table `nautia_*` ni bucket `nautia-pdfs`.
`supabase_vault` est disponible. `pg_cron` et `pg_net` ne sont pas installés. Le
rapport ne donne pas les policies Storage existantes, la version PostgreSQL,
l'emplacement de `supabase_vault`, ni la disponibilité effective des extensions
sur le projet. Les estimations « environ une ligne » ne sont pas des décomptes
exacts.

| Élément | État rapporté | Proposition | Traitement prévu |
| --- | --- | --- | --- |
| `client` | Existe déjà ; détail inconnu | Aucune table `client` créée | Ne pas modifier, renommer, migrer, joindre ou supprimer |
| Table des demandes existante | Nom et casse à confirmer | Aucune table de demande créée | La conserver intacte ; aucune écriture chatbot dans Supabase, envoi par e-mail Resend |
| Tarifs horaires | État inconnu | `nautia_hourly_rates` | Nouveau stockage par chantier |
| Fournisseurs | État inconnu | `nautia_suppliers` | Nouveau stockage par chantier |
| Catalogues PDF | État inconnu | `nautia_pdfs` lié au fournisseur du même chantier | Bucket privé `nautia-pdfs`; rétention six mois |
| Articles et historique tarifaire | État inconnu | `nautia_catalog_items`, `nautia_price_history` | Nouveaux objets rattachés au chantier et au fournisseur/article |
| Sécurité Storage | Policies actuelles inconnues | Policies restrictives sur `storage.buckets` et `storage.objects` | Comparer les anciennes policies avant l'ajout |
| Nettoyage PDF | Extensions/config inconnues | Edge Function, deux RPC, Vault, `pg_cron`/`pg_net` | Ajouter seulement si extensions et configuration sont compatibles |

Les préfixes `nautia_` et le rapport fourni ne montrent pas de collision actuelle
avec les deux tables existantes. Ils ne prouvent pas qu'aucune fonction ou policy
de même nom existe. Le prévol indique aussi qu'aucune table ou bucket `nautia_*`
n'existe actuellement. Vérifier les noms de policies/fonctions avant application.

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

`00_preflight_readonly.sql` est une seule instruction `SELECT`. Dans SQL Editor,
elle produit une seule ligne contenant un rapport JSON avec les noms et colonnes
des tables concernées, leurs contraintes et actions de cascade, RLS et policies,
les grants, les buckets professionnels, extensions et estimations de volume.
Elle ne sélectionne aucune ligne métier, donnée personnelle ou PDF et ne change
aucun objet, donnée, rôle ou paramètre. Copier la valeur `preflight_report` depuis
le résultat. Ce rapport confirme l'état du schéma au moment du relevé uniquement.

```sh
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -f supabase/proposals/00_preflight_readonly.sql
```

Le rapport inclut les expressions des policies pour permettre leur comparaison ;
les consulter dans un terminal sécurisé et ne pas les publier avant d'avoir vérifié
qu'elles ne contiennent pas de valeur codée en dur. Le rôle doit pouvoir lire
`information_schema`, `pg_catalog`, `pg_policies`, `storage.buckets` et les vues
de statistiques. Si une source est inaccessible, le rapport peut échouer ; ne pas
élargir les droits de l'application pour faire passer le prévol.

## Compatibilité observée et vérifications restantes

Les éléments ci-dessous proviennent du rapport fourni ; ils ne constituent pas une
connexion directe au projet. Avant de tester :

1. Confirmer les noms exacts et la casse de la table des demandes et de sa colonne
   étrangère. `information_schema` retourne les noms exacts.
2. Vérifier que chacun des noms `nautia_*`, fonctions `nautia_private.*`, policies
   `nautia_*`, bucket `nautia-pdfs` et nom de job cron sont libres dans le projet
   de test. En cas de collision, arrêter et concevoir une migration explicite ;
   ne pas contourner avec `DROP`, `CASCADE` ou `IF NOT EXISTS`.
3. Les deux anciennes tables n'ont pas de policy RLS. RLS activé sans policy
   signifie que les rôles applicatifs n'ont pas de lignes autorisées par RLS ;
   leurs grants restent aussi à contrôler. Garder cet état pendant le test, car
   les demandes doivent partir par Resend et ne pas être enregistrées dans
   Supabase.
4. Examiner toutes les policies actuelles pour `storage.buckets` et
   `storage.objects`, y compris les policies permissives et restrictives, les
   grants aux rôles et le statut du bucket. Vérifier que les nouvelles policies
   restrictives sont compatibles avec les policies système Supabase et ne bloquent
   pas les autres buckets.
5. `supabase_vault` est présent, mais vérifier que le schéma `vault` et
   `vault.decrypted_secrets` sont accessibles au propriétaire SQL du déploiement.
   `pg_cron` et `pg_net` manquent : le planning ne peut pas fonctionner avant que
   le projet de test permette leur installation/activation et confirme leurs
   schémas (`pg_catalog` pour `pg_cron`, généralement `extensions` pour `pg_net`).
   Ne pas appliquer le fichier `04_retention_schedule.sql` tant que ces prérequis
   ne sont pas vérifiés. Si le plan Supabase ne permet pas ces extensions, prévoir
   un ordonnanceur externe sécurisé, sans clé service_role dans sa configuration.
6. Vérifier la version PostgreSQL et les paramètres d'invocation des Edge
   Functions avant tout déploiement.
7. Confirmer la signification des données, unités, taxes, devises, métiers et
   règles de validité des tarifs avant tout import. Aucun tarif, fournisseur,
   catalogue ni prix courant ne peut être déduit des tables annoncées seules.

## Procédure d'intégration sans perte

Cette séquence est une préparation ; elle n'a pas été exécutée sur votre projet
NautIA Demo. Utiliser un projet Supabase de test distinct, jamais celui de Demo.

1. Créer ou choisir un projet Supabase de test isolé. Ne pas exécuter ces étapes sur
   NautIA Demo. Relever son nom/projet et vérifier que l'URL cible est bien celle
   du projet de test avant chaque opération DDL.
2. Faire une sauvegarde du projet de test et vérifier sa restauration exploitable.
   Noter que les tables de Demo ne seront pas copiées automatiquement si le projet
   de test est neuf ; il n'est pas nécessaire d'y copier des données personnelles.
3. Confirmer la casse exacte de la table de demandes; si un jeu de test est requis,
   créer seulement des fixtures synthétiques dans le projet jetable.
4. Appliquer `01_schema.sql` dans le projet de test. Vérifier tables, clés,
   fonctions, grants et policies avant de continuer.
5. Appliquer `02_storage.sql` seulement après revue des policies/grants actuels
   de `storage.buckets` et `storage.objects`. Vérifier que `nautia-pdfs` est privé
   et que les autres buckets conservent leurs règles. Les scripts sont
   transactionnels séparément et ne sont pas idempotents.
6. Confirmer que `public.client` et la table des demandes, leurs
   contraintes, policies et grants du projet de test n'ont pas été modifiés ;
   comparer aussi leurs comptes de lignes exacts avant/après si des fixtures ont
   été utilisées. Le rapport ne doit montrer aucune dépendance NautIA vers eux.
7. Tester avec deux identités Auth et deux chantiers séparés : lecture, écriture,
   clés étrangères composites, téléchargements, upload, ancien accès anonyme,
   policies permissives existantes, liens signés et tentatives d'URL du mauvais
   chantier. Vérifier aussi que le client ne peut pas lire/écrire le bucket.
8. Exécuter `03_retention.sql` dans le projet de test, puis déployer
   `purge-nautia-pdfs` avec `NAUTIA_RETENTION_SECRET` configuré uniquement comme
   secret runtime. Créer `nautia_retention_url` et `nautia_retention_secret` dans
   Vault avec la même valeur secrète. Confirmer les versions, schémas et
   disponibilité de `pg_cron` et `pg_net`; s'ils sont pris en charge, appliquer
   `04_retention_schedule.sql` et vérifier une invocation réussie. Sinon, ne pas
   appliquer ce fichier et évaluer un ordonnanceur externe sécurisé.
9. Vérifier le parcours chatbot en configuration de test : un message déclenche
   l'envoi via Resend et ne produit aucune insertion dans `demande_devis` ni dans
   les tables NautIA. Inspecter les journaux afin qu'ils ne retiennent pas le
   contenu complet du message ou d'adresses personnelles au-delà du besoin.
10. Simuler une échéance passée uniquement dans la base jetable ; vérifier
    suppression du binaire, puis de ses métadonnées, et le réessai après panne.
11. Préparer la promotion séparément avec fenêtre de changement, sauvegarde fraîche,
   surveillance, critères d'arrêt et plan de retour. Les scripts sont additifs
   mais non idempotents et ne fournissent pas de rollback automatique.

L'installation en test est bloquée tant qu'un projet de test dédié n'est pas
disponible, que la casse des objets n'est pas confirmée et que `pg_cron`/`pg_net`
ne sont pas activés (ou qu'un ordonnanceur externe n'est pas retenu). La procédure
est préparée, pas exécutée ; aucune requête n'a été envoyée à Supabase.
