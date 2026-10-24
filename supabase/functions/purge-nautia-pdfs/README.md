# Worker de purge des PDF NautIA

Cette Edge Function supprime physiquement les PDF expirés du bucket privé, puis
efface leurs métadonnées. Elle utilise `service_role` uniquement à l'intérieur du
runtime Supabase et n'expose jamais cette clé au planificateur.

Le point d'entrée HTTP n'accepte que `POST` avec un secret dédié d'au moins
32 caractères dans l'en-tête `X-Nautia-Retention-Secret`. Déployer la fonction
avec la vérification JWT désactivée, puisque l'authentification repose sur ce
secret indépendant :

```sh
supabase secrets set NAUTIA_RETENTION_SECRET='<valeur aléatoire forte>'
supabase functions deploy purge-nautia-pdfs --no-verify-jwt
```

Ne jamais enregistrer la valeur dans Git. Les variables `SUPABASE_URL` et
`SUPABASE_SERVICE_ROLE_KEY` sont fournies automatiquement aux Edge Functions.
Créer dans Supabase Vault `nautia_retention_url` avec l'URL HTTPS complète de la
fonction, puis `nautia_retention_secret` avec exactement la même valeur que le
secret de l'Edge Function. Appliquer ensuite `04_retention_schedule.sql`.

Chaque exécution traite au maximum 100 documents. Une suppression Storage en
échec laisse le document réservé pendant quinze minutes, puis il redevient
éligible. La suppression des métadonnées n'a lieu qu'après confirmation de
suppression du fichier et uniquement lorsque les six mois sont écoulés.
