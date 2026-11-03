# Préparation et découverte automatique d'une licence client

Ce document explique comment l'éditeur prépare une licence dans la base maître afin que l'application TOT Stock installée sur le projet Supabase d'un client retrouve et active automatiquement sa licence sans saisie manuelle.

---

## Règles de sécurité (v31)

- **Aucune recherche par URL seule** : la fonction RPC `public.discover_client_license(TEXT)` est supprimée (`DROP FUNCTION IF EXISTS public.discover_client_license(TEXT);`) et aucun droit `GRANT` n'est accordé. L'URL d'un projet Supabase n'étant pas un secret, il est interdit d'interroger la base maître avec la seule URL du projet.
- **Découverte uniquement avec preuve de session** : la découverte de licence passe exclusivement par l'action `discover` de l'Edge Function maître **`APP_TOT-Stock_licenses`**, en fournissant `client_supabase_url`, `client_anon_key` et `client_access_token`. La fonction maître vérifie la session auprès de `GET {client_supabase_url}/auth/v1/user` avant toute recherche.
- **Aucune création automatique de licence « free » côté éditeur** : un projet sans licence payante enregistrée sur la base maître conserve sa formule gratuite locale (`TOT-STOCK-FREE-COMMUNITY`) sans créer de ligne dans `public."APP_TOT-Stock-licenses"`.

---

## Comment l'éditeur prépare une licence

1. **Renseigner `client_supabase_url` dans la base maître (recommandé — découverte automatique)**
   - Pour que l'application du client retrouve sa licence toute seule après l'installation des scripts SQL (`01` à `08`) et la première connexion d'un administrateur (rôle 0 ou 1, ou rôle disposant de la permission `perm_config_license`), l'éditeur doit renseigner la colonne **`client_supabase_url`** (ex. `https://xxxx.supabase.co`) dans la ligne correspondante de la table `public."APP_TOT-Stock-licenses"` de la base maître, avec `is_active = true` et une date `expires_at` valide.
   - Lors de la connexion de l'administrateur sur le projet client (ou lors d'un changement de téléphone lorsque la base client ne contient pas encore la licence), l'application appelle automatiquement l'action `discover` de la fonction maître `APP_TOT-Stock_licenses` en fournissant la preuve de session (`client_supabase_url`, `client_anon_key`, `client_access_token`). Sans session utilisateur active, aucune recherche n'est effectuée.
   - La fonction maître vérifie la preuve d'appartenance auprès de `GET {client_supabase_url}/auth/v1/user`, contrôle la correspondance stricte de l'URL, puis renvoie la licence accompagnée de son jeton signé Ed25519 (`signed_token`).
   - L'application vérifie la signature cryptographique et la correspondance d'URL du jeton (`verifySignedLicenseToken`), enregistre la licence localement et la synchronise dans la base du client (`app_settings` et `license_config`). Sur un nouveau téléphone, si la licence figure déjà dans `app_settings` ou `license_config`, elle est retrouvée directement sans appel `discover`.
   - Si aucune licence n'est trouvée lors de l'essai automatique, l'application mémorise l'horodatage dans `localStorage` (`tot_license_discover_ts`) et attend **24 heures** avant de refaire un essai automatique. L'administrateur peut à tout moment forcer la vérification via le bouton **« Rechercher ma licence automatiquement »** dans l'onglet **Licence**.

2. **Alternative sans URL pré-renseignée (saisie manuelle de la clé)**
   - Si `client_supabase_url` n'a pas été renseigné à l'avance par l'éditeur (et que `binding_allowed = true`), la licence n'est jamais retournée par l'action `discover`.
   - Dans ce cas, le client peut toujours saisir sa clé de licence manuellement (`TOT-STOCK-STA-...`, `TOT-STOCK-PRO-...`, `TOT-STOCK-ENT-...`) dans **Entreprise & Licence → Licence → Clé de licence client**.

---

## Paramètre `app_settings.master_license_function`

La fonction Edge déployée sur la base maître et appelée par l'application est **`APP_TOT-Stock_licenses`**.

Côté projet client, le gestionnaire partagé `supabase/functions/_shared/syncLicenseHandler.ts` (via `readRuntimeConfig` dans `supabase/functions/_shared/config.ts`) détermine le nom de la fonction maître à appeler selon l'ordre de priorité suivant :

1. La clé **`master_license_function`** dans la table `public.app_settings` du projet client (si renseignée).
2. La variable d'environnement `MASTER_LICENSE_FUNCTION` (si définie).
3. La valeur par défaut **`APP_TOT-Stock_licenses`**.

Aucune configuration supplémentaire n'est nécessaire dans le cas standard où la fonction maître porte le nom `APP_TOT-Stock_licenses`. Si l'éditeur déploie une fonction maître sous un nom personnalisé, il suffit d'insérer ou mettre à jour la clé dans `public.app_settings` :

```sql
INSERT INTO public.app_settings (key, value)
VALUES ('master_license_function', 'APP_TOT-Stock_licenses')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

