# Guide d'Installation et de Mise à Jour — Base Client Supabase TOT Stock (v51 / App 5.9.1 — Schéma 2.4.1)

Ce document décrit les **trois méthodes officielles** pour installer ou mettre à jour un projet Supabase client TOT Stock en moins de 15 minutes, selon l'ordre **Scripts SQL (`00` à `14`, avec `07` en dernier) → Fonctions Edge → Synchronisation de licence**, sans saisir de secret manuellement dans les Edge Functions.

---

## Prérequis communs

1. **Un projet Supabase créé** sur [https://supabase.com/dashboard](https://supabase.com/dashboard) (région recommandée : Europe de l'Ouest `eu-west`).
2. **Pour les méthodes A et B (recommandées)** :
   - **Node.js 20+** installé sur le poste de l'informaticien (`node -v`). Aucune installation globale de la CLI Supabase n'est nécessaire (`npx supabase` est utilisé automatiquement).
   - **Référence du projet (`SUPABASE_PROJECT_REF`)** : visible dans *Project Settings > General > Reference ID* (20 caractères, ex. `abcdefghijklmnopqrst`).
   - **Jeton d'accès personnel (`SUPABASE_ACCESS_TOKEN`)** : à générer sur [https://supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens).
   - **Mot de passe de la base PostgreSQL (`SUPABASE_DB_PASSWORD`)** : défini lors de la création du projet Supabase (ou réinitialisable dans *Project Settings > Database > Database password*).

---

## Méthode A (Recommandée) — Installation automatique en une seule commande (`npm run install:tot`)

**Durée estimée : 5 à 10 minutes.**

L'installateur interactif `scripts/tot-install.mjs` enchaîne automatiquement les 7 étapes : vérification des prérequis, application des migrations SQL (`supabase/migrations/`), déploiement des 3 Edge Functions (`APP_TOT-Stock_admin-users`, `APP_TOT-Stock_licenses_sync-license`, `APP_TOT-Stock_send-report-email`) sans secret manuel, désactivation des inscriptions publiques, création du premier Super Administrateur (rôle 0), liaison optionnelle de la licence et exécution du diagnostic final `public.diagnostic_installation()`.

### 1. Lancer l'installateur

Depuis la racine du dépôt :

```bash
npm install
npm run install:tot
```

*(Alias équivalent : `node scripts/tot-install.mjs`)*

Si les variables d'environnement `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN` et `SUPABASE_DB_PASSWORD` ne sont pas définies dans le terminal, l'installateur les demande au clavier en masquant la saisie des secrets. Aucun secret n'est écrit sur le disque ni dans le rapport final `tot-install-report.txt`.

### 2. Options disponibles en ligne de commande

| Option | Description |
| :--- | :--- |
| `--update` | Exécute uniquement les étapes 2 (migrations SQL), 3 (Edge Functions) et 7 (diagnostic + mise à jour de `app_compat`). |
| `--dry-run` | Affiche et vérifie toutes les étapes sans modifier le projet Supabase. |
| `--yes` | Mode non interactif (CI/CD) : utilise exclusivement les variables d'environnement sans question au clavier. |
| `--no-functions` | Saute le déploiement des Edge Functions (étape 3). |
| `--no-admin` | Saute la création du premier Super Administrateur (étape 5). |
| `--maintenance` | Passe `app_compat.maintenance = true` avant `db push` et le remet systématiquement à `false` à la fin (`finally`), même en cas d'erreur. |
| `--set-min-app-version <x>` | Met à jour `min_app_version` dans `app_compat` lors d'un `--update`. |

---

## Méthode B — En ligne de commande avec la CLI Supabase (sans l'installateur)

**Durée estimée : 10 à 15 minutes.**

Utilisez cette méthode si vous souhaitez exécuter manuellement chaque commande `supabase` étape par étape.

### 1. Générer les fichiers de migration synchronisés

```bash
npm run build:sql
```

Cette commande génère dans `supabase/migrations/` la séquence complète ordonnée à partir des scripts sources `supabase-client/` :
1. `20261003_complete_tot_stock_schema.sql` (`00_complete_tot_stock_schema.sql`)
2. `20261004000000_09_core_prefixes.sql` (`09_core_prefixes.sql` — volontairement juste après 00)
3. `20261005010000_01_auth_link.sql` (`01_auth_link.sql`)
4. `20261005013000_01b_migrate_users_id_to_text.sql` (`01b_migrate_users_id_to_text.sql`)
5. `20261005020000_02_rls_hardening.sql` (`02_rls_hardening.sql`)
6. `20261005030000_03_rpc_stock_and_orders.sql` (`03_rpc_stock_and_orders.sql`)
7. `20261005040000_04_mouvements_et_depots_vehicules.sql` (`04_mouvements_et_depots_vehicules.sql`)
8. `20261005050000_05_rpc_admin_users.sql` (`05_rpc_admin_users.sql`)
9. `20261005060000_06_install_additional_roles.sql` (`06_install_additional_roles.sql`)
10. `20261005065000_08_print_jobs.sql` (`08_print_jobs.sql`)
11. `20261005068000_11_suite_tables.sql` (`11_suite_tables.sql`)
12. `20261005069000_12_user_preferences.sql` (`12_user_preferences.sql`)
13. `20261005069500_13_transfer_stock_batch.sql` (`13_transfer_stock_batch.sql`)
14. `20261005069800_14_mailing.sql` (`14_mailing.sql`)
15. `20261005070000_07_app_compat.sql` (`07_app_compat.sql` — toujours en dernier)

### 2. Lier le projet et pousser les migrations SQL

```bash
npx supabase login
npx supabase link --project-ref <VOTRE_PROJECT_REF>
npx supabase db push
```

### 3. Déployer les 3 Edge Functions

Les fonctions lisent automatiquement `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` injectés par Supabase, la clé publique de licence et l'URL maître dans `public.core_app_settings` (avec repli sur les valeurs embarquées), et le secret e-mail éventuel via `public.get_email_secret()` (Supabase Vault). Aucun `supabase secrets set` n'est requis :

```bash
npx supabase functions deploy APP_TOT-Stock_admin-users --project-ref <VOTRE_PROJECT_REF>
npx supabase functions deploy APP_TOT-Stock_licenses_sync-license --project-ref <VOTRE_PROJECT_REF>
npx supabase functions deploy APP_TOT-Stock_send-report-email --project-ref <VOTRE_PROJECT_REF>
```

### 4. Synchronisation de la licence & Création du premier Super Administrateur

1. Dans **Supabase Dashboard > Authentication > User Signups**, décochez **Allow new users to sign up**.
2. Dans **Authentication > Users > Add user > Create new user**, créez l'utilisateur administrateur (cochez *Auto Confirm User*), puis liez son UUID au profil `role_id = 0` dans `public.core_users`.
3. Connectez-vous à l'application TOT Stock (ou ouvrez *Paramètres > Licence & Base SQL > 1. Licence & Abonnement*) et cliquez sur **« Synchroniser la licence dans la base »** (ou **« Découvrir la licence du projet »**) afin que la fonction Edge `APP_TOT-Stock_licenses_sync-license` écrive le jeton Ed25519 signé dans `public.core_license_config`.

---

## Méthode C — Par l'interface web Supabase (sans CLI)

**Durée estimée : 15 minutes.**

Utilisez cette méthode si le poste de travail ne dispose pas d'accès réseau sortant pour la CLI.

### 1. Générer les fichiers consolidés

```bash
npm run build:sql
```

Cela produit :
- **`dist/install.sql`** : fichier SQL unique contenant l'intégralité du schéma et des scripts `00` à `14` (avec `07_app_compat.sql` exécuté en dernier pour le durcissement final) et un `RAISE NOTICE` à chaque étape.
- **`supabase-client/generated/edge-functions/APP_TOT-Stock_admin-users/index.ts`**, **`supabase-client/generated/edge-functions/APP_TOT-Stock_licenses_sync-license/index.ts`**, **`supabase-client/generated/edge-functions/APP_TOT-Stock_send-report-email/index.ts`** (et **`supabase-client/generated/edge-functions-master/APP_TOT-Stock_licenses/index.ts`** pour l'éditeur maître) : fichiers autonomes suivis par git et prêts à coller dans l'éditeur web Supabase (également disponibles directement dans l'onglet *4. Fonctions Edge* de l'application).

### 2. Exécuter `dist/install.sql` dans le SQL Editor

1. Ouvrez **Supabase Dashboard > SQL Editor > New query**.
2. Copiez-collez l'intégralité du fichier **`dist/install.sql`** et cliquez sur **Run**.
3. Vérifiez dans l'onglet *Messages* que les étapes `00` à `14` + `07` affichent `NOTICE: === [TOT STOCK ...] Étape ...`.

### 3. Déployer les 3 Edge Functions depuis le Dashboard

Dans **Supabase Dashboard > Edge Functions**, créez (ou mettez à jour) les 3 fonctions en conservant **exactement** leurs noms :
1. **`APP_TOT-Stock_admin-users`** : collez le contenu de `supabase-client/generated/edge-functions/APP_TOT-Stock_admin-users/index.ts`.
2. **`APP_TOT-Stock_licenses_sync-license`** : collez le contenu de `supabase-client/generated/edge-functions/APP_TOT-Stock_licenses_sync-license/index.ts`.
3. **`APP_TOT-Stock_send-report-email`** : collez le contenu de `supabase-client/generated/edge-functions/APP_TOT-Stock_send-report-email/index.ts`.

### 4. Synchroniser la licence dans la base cliente

Dans l'application TOT Stock (*Paramètres > Licence & Base SQL*), cliquez sur **« Synchroniser la licence dans la base »** pour que `APP_TOT-Stock_licenses_sync-license` écrive le jeton signé dans `public.core_license_config`.

---

## Vérifications après installation

Exécutez dans le **SQL Editor** (ou depuis l'écran *Plus > Diagnostic d'installation* de l'application connecté en rôle 0, 1 ou 5) :

```sql
SELECT * FROM public.diagnostic_installation();
```

Les contrôles retournés doivent être à **`OK`** (ou `ATTENTION` uniquement si vous n'avez pas encore lié de licence commerciale) :
1. `tables_rls` : tables attendues présentes avec RLS activé (dont `core_user_preferences`, `core_files`, `stk_print_stations` et `stk_print_jobs`).
2. `anon_privileges` : aucun privilège accordé à `anon` sur `core_users`, `core_user_preferences`, `core_license_config`, `stk_movements`, `stk_products`, `stk_print_stations`, `stk_print_jobs`.
3. `super_admin_linked` : au moins un Super Administrateur (`role_id = 0`) lié à `auth.users`.
4. `no_plaintext_pin` : aucun code PIN en clair dans `public.core_users`.
5. `app_compat` : ligne singleton `id = 1` présente dans `public.core_app_compat` (`schema_version = 2.4.1`, `min_schema_version = 1.0.0`, `latest_version = 5.9.1`).
6. `license_status` : formule de licence et quota de dépôts actifs conformes.
7. `sensitive_functions` : toutes les fonctions sensibles (dont les RPC d'impression à distance, `transfer_stock_batch` et les RPC mailing) sont interdites à `anon`.
8. `edge_functions_deployed` : les 3 fonctions (`APP_TOT-Stock_admin-users`, `APP_TOT-Stock_licenses_sync-license`, `APP_TOT-Stock_send-report-email`) sont déployées et répondent à `{ action: 'ping' }`.
9. `print_jobs_module` : tables `stk_print_stations` & `stk_print_jobs` et les 7 fonctions RPC d'impression à distance présentes.
10. `permissive_rls_policies` : aucune règle RLS permissive (`public` / `anon` avec `USING (true)` ou `WITH CHECK (true)`) ne subsiste sur les tables du schéma `public` (hors lecture seule `SELECT` explicitement publique sur `core_app_compat`).
11. `stock_movements_rpc` : présence de `public.process_stock_movement` (signature 12 paramètres) et `public.stk_stock_levels`.
12. `unknown_stock_triggers` : aucun déclencheur inconnu ou hérité (`trg_process_stock_movement`, etc.) sur `stk_movements`, `stk_stock_levels` ou `stk_products`.
13. `stock_consistency` : cohérence entre `stk_products.quantity` et la somme des lignes de `stk_stock_levels` par produit.
14. `prefixed_tables` : toutes les tables physiques utilisent les préfixes `core_*` et `stk_*` (schéma `2.4.1`) et aucun ancien nom n'est resté sous forme de table physique (`relkind = 'r'`).
15. `compat_views_present` : signale en `ATTENTION` la présence éventuelle de vues de compatibilité héritées d'une base 1.x (à supprimer via `supabase-client/10_drop_compat_views.sql` une fois tous les clients mis à jour).
16. `suite_tables_and_storage` : présence des tables `stk_order_preparations_log`, `stk_categories`, `stk_material_order_items`, `core_files` et du bucket privé `tot-files`.
17. `user_preferences_rls` : présence de `public.core_user_preferences`, RLS activé et ses 4 politiques (`user_preferences_select_own`, `user_preferences_insert_own`, `user_preferences_update_own`, `user_preferences_delete_own`).
18. `transfer_stock_batch_rpc` : présence de la RPC transactionnelle `public.transfer_stock_batch` (5 paramètres) et patch de `perm_stock_transfer` sur `process_stock_movement`.
19. `mailing_module` : présence des tables `core_mail_accounts` (avec support `msgraph`), `core_mail_senders`, `core_mail_log` (RLS activé) et des 4 RPC `set_mail_account_secret`, `mail_account_has_secret`, `get_mail_config` (`service_role` uniquement) et `purge_mail_log`.

---

## Base ancienne : que fait l'installation automatiquement

Lorsqu'on exécute **`dist/install.sql`** (ou la séquence complète des scripts incluant `09_core_prefixes.sql`, `11_suite_tables.sql`, `12_user_preferences.sql` et terminant par `07_app_compat.sql`) sur une base de données issue d'une version antérieure de TOT Stock, cinq opérations structurelles s'appliquent automatiquement et sans perte de données :

1. **Purge intégrale des règles RLS héritées (`09`, `02` à `12`)** : chaque script interroge `pg_policies` et supprime toutes les politiques existantes sur les tables du schéma `public` (y compris les anciennes règles ouvertes `USING (true)` pour `public`/`anon` ou les règles récursives sur `users`) avant de recréer uniquement les règles strictes attendues.
2. **Conversion des identifiants numériques en texte (`09_core_prefixes.sql` & `03_rpc_stock_and_orders.sql`)** : si `id` sur `stock_movements`, `movements`, `audit_logs` ou `stock_levels` est encore de type numérique (`bigint` ou `GENERATED ... AS IDENTITY`), le script crée une sauvegarde `<table>_backup_ids` protégée par RLS, supprime l'attribut `IDENTITY`, convertit `id` en `TEXT` en conservant toutes les lignes existantes (`'1'`, `'2'`, etc.), puis applique `DEFAULT gen_random_uuid()::text`.
3. **Renommage vers les préfixes de la suite TOT (`09_core_prefixes.sql` & `11_suite_tables.sql`)** : renomme de façon idempotente les tables existantes vers `core_*` et `stk_*`, ajoute les tables partagées (`core_files`, `core_user_preferences`), et crée des vues de compatibilité `WITH (security_invoker = true)` pour les anciens noms afin que les clients N-1 continuent de fonctionner pendant la transition.
4. **Alignement automatique des colonnes manquantes (`02_rls_hardening.sql`)** : généré automatiquement par `scripts/build-sql.mjs` à partir de toutes les définitions `CREATE TABLE IF NOT EXISTS`, un bloc `ALTER TABLE IF EXISTS public.<table> ADD COLUMN IF NOT EXISTS <colonne> <type> [DEFAULT ...]` ajoute toutes les colonnes apparues au fil des versions sur les tables qui existaient déjà, puis rafraîchit les vues de compatibilité.
5. **Purge des déclencheurs hérités qui comptaient les mouvements en double (`09_core_prefixes.sql` & `03_rpc_stock_and_orders.sql`)** : supprime explicitement l'ancien déclencheur `trg_process_stock_movement` et la fonction sans argument `public.process_stock_movement()`, ainsi que tout déclencheur non interne sur les tables de stock qui ne figure pas dans la liste blanche officielle.

### Procédure recommandée sur une base ancienne (4 étapes)

1. **Sauvegarde** : effectuez une sauvegarde ou vérifiez le dernier point de restauration dans *Supabase Dashboard > Database > Backups*.
2. **Exécuter `dist/install.sql`** : collez et exécutez l'intégralité de `dist/install.sql` dans *Supabase Dashboard > SQL Editor* (ou lancez `npm run install:tot -- --update`).
3. **Vérifier le diagnostic** : exécutez `SELECT * FROM public.diagnostic_installation();` (ou ouvrez *Diagnostic d'installation* dans l'application) et vérifiez que `prefixed_tables`, `user_preferences_rls`, `suite_tables_and_storage`, `unknown_stock_triggers`, `stock_consistency`, `stock_movements_rpc` et `permissive_rls_policies` sont à **`OK`**.
4. **Supprimer les vues de compatibilité après mise à jour de tous les clients (optionnel)** : une fois toutes les applications clientes passées en v5.5.0+ (schéma 2.0.0+), exécutez `supabase-client/10_drop_compat_views.sql` pour supprimer les vues d'anciens noms et passer `compat_views_present` de `ATTENTION` à `OK`.

---

## Mettre à jour un projet existant

Pour mettre à jour un projet Supabase existant vers une nouvelle version de TOT Stock :

```bash
npm run install:tot -- --update
```

*(Ou avec activation temporaire de la bannière de maintenance : `npm run install:tot -- --update --maintenance`)*

Ce que fait `--update` :
1. Lit `public.core_app_compat` en base et **refuse automatiquement** l'opération si la version cible du schéma (`EXPECTED_SCHEMA_VERSION = 2.2.0`) est plus ancienne que `schema_version` en base.
2. Active `maintenance = true` si `--maintenance` est demandé (et garantit le retour à `maintenance = false` dans un bloc `finally` même en cas d'erreur).
3. Applique les nouvelles migrations SQL (`npx supabase db push`) de manière 100 % additive (`09_core_prefixes.sql`, `11_suite_tables.sql`, `12_user_preferences.sql`, `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`).
4. Redéploie les 3 Edge Functions (`APP_TOT-Stock_admin-users`, `APP_TOT-Stock_licenses_sync-license`, `APP_TOT-Stock_send-report-email`).
5. Met à jour `schema_version = EXPECTED_SCHEMA_VERSION` (`2.2.0`) et `latest_version = APP_VERSION` (`5.7.0`) dans `public.core_app_compat` sans modifier `min_app_version` ni `min_schema_version` (`1.0.0`), préservant la compatibilité avec les applications mobiles N-1 et N-2.

---

## Rejouer les scripts

Lors d'une ré-exécution manuelle ou corrective des scripts SQL, **il faut toujours rejouer toute la chaîne dans l'ordre en terminant par `07_app_compat.sql`** (ou exécuter le fichier consolidé `dist/install.sql` qui les enchaîne dans cet ordre exact) :

1. `01_auth_link.sql` (puis optionnellement `01b_migrate_users_id_to_text.sql`)
2. `09_core_prefixes.sql` (renommage idempotent des tables vers `core_*` et `stk_*` + vues de compatibilité)
3. `02_rls_hardening.sql`
4. `03_rpc_stock_and_orders.sql`
5. `04_mouvements_et_depots_vehicules.sql`
6. `05_rpc_admin_users.sql`
7. `06_install_additional_roles.sql`
8. `08_print_jobs.sql` (postes et file d'impression d'étiquettes à distance)
9. `11_suite_tables.sql` (journal de préparation, catégories, lignes de commande et fichiers `core_files` / `tot-files`)
10. `12_user_preferences.sql` (préférences utilisateur `core_user_preferences` et ses 4 politiques RLS)
11. `13_transfer_stock_batch.sql` (transfert multi-articles atomique `transfer_stock_batch` et permission `perm_stock_transfer`)
12. `14_mailing.sql` (mailing multi-fournisseurs `core_mail_accounts`, expéditeurs par application `core_mail_senders`, journal `core_mail_log` et RPC Vault)
13. `07_app_compat.sql` (table `core_app_compat`, `diagnostic_installation()` et durcissement final des fonctions `SECURITY DEFINER`)
14. *(Optionnel, une fois tous les clients à jour)* `10_drop_compat_views.sql` (suppression des vues de compatibilité d'anciens noms)

> **Purge intégrale des règles RLS anciennes** : Les scripts `02_rls_hardening.sql`, `03_rpc_stock_and_orders.sql`, `04_mouvements_et_depots_vehicules.sql`, `05_rpc_admin_users.sql`, `07_app_compat.sql` et `08_print_jobs.sql` interrogent `pg_policies` et suppriment **toutes** les règles RLS existantes sur chaque table protégée (quel que soit leur nom historique ou personnalisé) avant de recréer immédiatement les règles attendues dans le même script. **Après rejeu, aucune règle ancienne ne subsiste** (ni règle ouverte `USING (true)` héritée d'une installation initiale, ni règle récursive sur `public.users`).
>
> **Attention** : Ne rejouez **jamais** `02_rls_hardening.sql` seul sur une base en exploitation sans rejouer immédiatement la suite derrière. Tant `07_app_compat.sql` que `08_print_jobs.sql` exécutent en fin de script le bloc de révocation automatique `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon` sur toutes les fonctions `SECURITY DEFINER`, ce qui garantit que `anon` n'a aucun droit qu'il s'agisse d'une installation complète (`08` puis `07`) ou d'une mise à niveau incrémentale (`07` puis `08`).

---

## Retour en arrière (Rollback)

Toutes les migrations SQL de TOT Stock étant **strictement additives** (aucune suppression de table ni de colonne contenant des données), une base de données mise à jour reste compatible avec les versions N-1 et N-2 de l'application cliente :

1. **Application Web / Mobile** : redéployez la version précédente du front-end ou distribuez l'APK précédent. Tant que `min_app_version` dans `public.app_compat` n'a pas été relevé au-dessus de la version de l'application, les clients précédents continuent de fonctionner normalement.
2. **Désactiver un blocage de version minimale** : si vous aviez relevé `min_app_version` par erreur avec `--set-min-app-version`, abaissez-le dans le SQL Editor :
   ```sql
   UPDATE public.app_compat
   SET min_app_version = '5.4.0', maintenance = false, updated_at = NOW()
   WHERE id = 1;
   ```
3. **Restauration complète (PITR / Sauvegarde)** : en cas d'incident majeur, restaurez la sauvegarde automatique quotidienne Supabase (*Database > Backups*).

---

## Dépannage par étape

| Étape | Symptôme | Cause probable & Résolution |
| :--- | :--- | :--- |
| **Étape 1 (Prérequis)** | `HTTP 401` ou `HTTP 403` sur `/v1/projects/{ref}` | Le jeton `SUPABASE_ACCESS_TOKEN` est expiré ou n'appartient pas à un membre administrateur de l'organisation Supabase. Générez un nouveau jeton sur `supabase.com/dashboard/account/tokens`. |
| **Étape 2 (`db push`)** | `password authentication failed for user postgres` | Le mot de passe `SUPABASE_DB_PASSWORD` est incorrect. Réinitialisez-le dans *Project Settings > Database > Database password*. |
| **Étape 3 (Edge Functions)** | Échec de déploiement d'une fonction | Vérifiez votre connexion réseau ou déployez les fichiers `dist/functions/*.single.ts` via l'interface web (Méthode C). |
| **Étape 4 (Inscriptions)** | Statut `ATTENTION` sur la désactivation des signups | Désactivez manuellement *Allow new users to sign up* dans *Authentication > User Signups*. |
| **Étape 5 (Super Admin)** | Mot de passe refusé | Le mot de passe doit comporter au moins 10 caractères, une majuscule, une minuscule et un chiffre. |
| **Envoi d'e-mails** | Réponse `"non configuré"` de `APP_TOT-Stock_send-report-email` | L'envoi d'e-mails est facultatif. Pour l'activer, enregistrez votre clé Brevo ou SMTP dans Supabase Vault (`email_api_key` ou `smtp_password`). |

---

## Formules de licence (`plan_limits`) et compatibilité des jetons

| Code canonique | Libellé (`PLAN_LABELS`) | Références max (`max_references`) | Dépôts max (`max_depots`) | Utilisateurs max (`max_users`) | Modules | Format de clé |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `free` | **Free** | 50 | 1 | Illimités (`99999`) | `['stock']` | `TOT-STOCK-FREE-XXXX-XXXX` |
| `sta` | **STA** | 300 | 3 | Illimités (`99999`) | `['stock']` | `TOT-STOCK-STA-XXXX-XXXX` |
| `pro` | **PRO** | 1 000 | 10 | Illimités (`99999`) | `['stock', 'outils', 'rapports']` | `TOT-STOCK-PRO-XXXX-XXXX` |
| `ent` | **ENT** | Illimités (`99999`) | Illimités (`99999`) | Illimités (`99999`) | `['stock', 'outils', 'formation', 'rapports']` | `TOT-STOCK-ENT-XXXX-XXXX` |

### Anciens codes (alias acceptés en lecture seulement)

Les alias historiques ou issus de la v24 sont acceptés **en lecture seulement** (vérification de jetons signés existants, clés existantes `-ARTISAN-`, `-PME-`, `-ENTERPRISE-`, et migration automatique de `public.license_config`) puis normalisés vers le code canonique :
- `artisan`, `starter`, `standard` $\rightarrow$ **`sta`**
- `pme`, `professionnel` $\rightarrow$ **`pro`**
- `enterprise`, `entreprise` $\rightarrow$ **`ent`**

