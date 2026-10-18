# NautIA / KERVENOA — démonstrateur Nippon Héritage

Le démonstrateur utilise une fonction serveur `api/chat.mjs` pour le chatbot OpenAI et
une fonction `api/contact.mjs` pour les demandes de contact envoyées par Resend.

## Fonctionnement du formulaire

Après la conversation, le visiteur renseigne son nom, sa localisation, son e-mail et
éventuellement son téléphone. Il doit cocher une case d'accord avant d'envoyer.

Le serveur valide les champs et le consentement, puis demande à Resend un envoi :
- destinataire principal : `frostyhem@gmail.com` (Nippon Héritage) ;
- copie invisible : `kervenoa@proton.me` (KERVENOA) ;
- adresse de réponse : e-mail du visiteur ;
- contenu : coordonnées et conversation.

Aucune adresse de destination ni clé secrète n'est acceptée depuis le navigateur.
Un e-mail n'est annoncé comme « accepté pour envoi » qu'après réponse positive de Resend.
Les adresses destinataires doivent être reconfirmées avant la mise en service réelle.

## Variables d'environnement Vercel

- `OPENAI_API_KEY` : clé OpenAI pour le chatbot ;
- `RESEND_API_KEY` : clé Resend, à conserver de type secret ;
- `RESEND_FROM` : adresse expéditrice sur un **domaine vérifié dans Resend**,
  par exemple `contact@kervenoa.fr` **uniquement après acquisition et vérification**.

`RESEND_FROM` est volontairement obligatoire. Sans cette variable ou si Resend
refuse l'expéditeur, l'API retourne une erreur explicite : elle ne simule pas l'envoi.
L'adresse provisoire `kervenoa@proton.me` peut recevoir les messages, mais ne
peut pas servir d'expéditeur Resend sans vérification d'un domaine possédé.

Les variables doivent être disponibles dans l'environnement Vercel testé et il faut
un **nouveau déploiement** pour prendre en compte les changements de configuration.
Au moment de la création de cette branche, `RESEND_API_KEY` n'était disponible
que pour Production, et aucun `RESEND_FROM` n'était configuré.

## Avant toute ouverture au public

- Acquérir et vérifier un domaine d'expédition dans Resend (DNS SPF/DKIM) ;
- ajouter `RESEND_FROM` à Vercel et configurer les variables en Preview si besoin ;
- tester avec de véritables boîtes de réception et vérifier les logs Resend ;
- activer une limitation de débit / protection anti-bot (ex. WAF ou CAPTCHA),
  et documenter la conservation des données personnelles selon le cadre applicable ;
- faire relire le code et fusionner la branche test seulement après validation.

Le code est proposé dans une branche séparée : aucune modification de Production
n'est réalisée par le simple ajout des fichiers.
