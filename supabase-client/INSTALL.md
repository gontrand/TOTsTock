# Guide d'Installation et de Mise à Jour — Base Client Supabase TOT Stock (v24 / 5.5.0)

Ce document décrit les **trois méthodes officielles** pour installer ou mettre à jour un projet Supabase client TOT Stock en moins de 15 minutes, sans saisir de secret manuellement dans les Edge Functions.

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

L'installateur interactif `scripts/tot-install.mjs` enchaîne automatiquement les 7 étapes : vérification des prérequis, application des migrations SQL (`supabase/migrations/`), déploiement des 3 Edge Functions (`admin-users`, `sync-license`, `send-report-email`) sans secret manuel, désactivation des inscriptions publiques, création du premier Super Administrateur (rôle 0), liaison optionnelle de la licence et exécution du diagnostic final `public.diagnostic_installation()`.

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
2. `20261005010000_01_auth_link.sql` (`01_auth_link.sql`)
3. `20261005013000_01b_migrate_users_id_to_text.sql` (`01b_migrate_users_id_to_text.sql`)
4. `20261005020000_02_rls_hardening.sql` (`02_rls_hardening.sql`)
5. `20261005030000_03_rpc_stock_and_orders.sql` (`03_rpc_stock_and_orders.sql`)
6. `20261005040000_04_mouvements_et_depots_vehicules.sql` (`04_mouvements_et_depots_vehicules.sql`)
7. `20261005050000_05_rpc_admin_users.sql` (`05_rpc_admin_users.sql`)
8. `20261005060000_06_install_additional_roles.sql` (`06_install_additional_roles.sql`)
9. `20261005070000_07_app_compat.sql` (`07_app_compat.sql`)
10. `20261005080000_08_print_jobs.sql` (`08_print_jobs.sql`)

### 2. Lier le projet et pousser les migrations SQL

```bash
npx supabase login
npx supabase link --project-ref <VOTRE_PROJECT_REF>
npx supabase db push
```

### 3. Déployer les 3 Edge Functions

Les fonctions lisent automatiquement `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` injectés par Supabase, la clé publique de licence et l'URL maître dans `public.app_settings` (avec repli sur les valeurs embarquées), et le secret e-mail éventuel via `public.get_email_secret()` (Supabase Vault). Aucun `supabase secrets set` n'est requis :

```bash
npx supabase functions deploy admin-users --project-ref <VOTRE_PROJECT_REF>
npx supabase functions deploy sync-license --project-ref <VOTRE_PROJECT_REF>
npx supabase functions deploy send-report-email --project-ref <VOTRE_PROJECT_REF>
```

### 4. Désactiver les inscriptions publiques et créer le premier Super Administrateur

1. Dans **Supabase Dashboard > Authentication > User Signups**, décochez **Allow new users to sign up**.
2. Dans **Authentication > Users > Add user > Create new user**, créez l'utilisateur administrateur (cochez *Auto Confirm User*), puis liez son UUID au profil `role_id = 0` dans `public.users`.

---

## Méthode C — Par l'interface web Supabase (sans CLI)

**Durée estimée : 15 minutes.**

Utilisez cette méthode si le poste de travail ne dispose pas d'accès réseau sortant pour la CLI.

### 1. Générer les fichiers consolidés

```bash
npm run build:sql
npm run bundle:functions
```

Cela produit :
- **`dist/install.sql`** : fichier SQL unique contenant l'intégralité du schéma et des scripts `00` à `08` (avec `07_app_compat.sql` exécuté en dernier pour le durcissement final) et un `RAISE NOTICE` à chaque étape.
- **`dist/functions/admin-users.single.ts`**, **`dist/functions/sync-license.single.ts`**, **`dist/functions/send-report-email.single.ts`** : fichiers autonomes prêts à coller dans l'éditeur web Supabase.

### 2. Exécuter `dist/install.sql` dans le SQL Editor

1. Ouvrez **Supabase Dashboard > SQL Editor > New query**.
2. Copiez-collez l'intégralité du fichier **`dist/install.sql`** et cliquez sur **Run**.
3. Vérifiez dans l'onglet *Messages* que les étapes `00` à `08` + `07` affichent `NOTICE: === [TOT STOCK ...] Étape ...`.

### 3. Déployer les 3 Edge Functions depuis le Dashboard

Dans **Supabase Dashboard > Edge Functions**, créez (ou mettez à jour) les 3 fonctions en conservant **exactement** leurs noms :
1. **`admin-users`** : collez le contenu de `dist/functions/admin-users.single.ts`.
2. **`sync-license`** : collez le contenu de `dist/functions/sync-license.single.ts`.
3. **`send-report-email`** : collez le contenu de `dist/functions/send-report-email.single.ts`.

---

## Vérifications après installation

Exécutez dans le **SQL Editor** (ou depuis l'écran *Plus > Diagnostic d'installation* de l'application connecté en rôle 0, 1 ou 5) :

```sql
SELECT * FROM public.diagnostic_installation();
```

Les 10 contrôles retournés doivent être à **`OK`** (ou `ATTENTION` uniquement si vous n'avez pas encore lié de licence commerciale) :
1. `tables_rls` : 16/16 tables attendues présentes avec RLS activé (dont `print_stations` et `print_jobs`).
2. `anon_privileges` : aucun privilège accordé à `anon` sur `users`, `license_config`, `movements`, `products`, `print_stations`, `print_jobs`.
3. `super_admin_linked` : au moins un Super Administrateur (`role_id = 0`) lié à `auth.users`.
4. `no_plaintext_pin` : aucun code PIN en clair dans `public.users`.
5. `app_compat` : ligne singleton `id = 1` présente dans `public.app_compat` (`schema_version = 1.1.0`, `min_schema_version = 1.0.0`).
6. `license_status` : formule de licence et quota de dépôts actifs conformes.
7. `sensitive_functions` : toutes les fonctions sensibles (dont les RPC d'impression à distance) sont interdites à `anon`.
8. `edge_functions_deployed` : les 3 fonctions (`admin-users`, `sync-license`, `send-report-email`) sont déployées.
9. `print_jobs_module` : tables `print_stations` & `print_jobs` et les 7 fonctions RPC d'impression à distance présentes.
10. `permissive_rls_policies` : aucune règle RLS permissive (`public` / `anon` avec `USING (true)` ou `WITH CHECK (true)`) ne subsiste sur les tables du schéma `public` (hors lecture seule `SELECT` explicitement publique sur `app_compat`).

---

## Mettre à jour un projet existant

Pour mettre à jour un projet Supabase existant vers une nouvelle version de TOT Stock :

```bash
npm run install:tot -- --update
```

*(Ou avec activation temporaire de la bannière de maintenance : `npm run install:tot -- --update --maintenance`)*

Ce que fait `--update` :
1. Lit `public.app_compat` en base et **refuse automatiquement** l'opération si la version cible du schéma (`EXPECTED_SCHEMA_VERSION = 1.1.0`) est plus ancienne que `schema_version` en base.
2. Active `maintenance = true` si `--maintenance` est demandé (et garantit le retour à `maintenance = false` dans un bloc `finally` même en cas d'erreur).
3. Applique les nouvelles migrations SQL (`npx supabase db push`) de manière 100 % additive (`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`).
4. Redéploie les 3 Edge Functions (`admin-users`, `sync-license`, `send-report-email`).
5. Met à jour `schema_version = EXPECTED_SCHEMA_VERSION` (`1.1.0`) et `latest_version = APP_VERSION` dans `public.app_compat` sans modifier `min_app_version` ni `min_schema_version` (`1.0.0`), préservant la compatibilité avec les applications mobiles N-1 et N-2.

---

## Rejouer les scripts

Lors d'une ré-exécution manuelle ou corrective des scripts SQL, **il faut toujours rejouer toute la chaîne dans l'ordre en terminant par `07_app_compat.sql`** (ou exécuter le fichier consolidé `dist/install.sql` qui les enchaîne dans cet ordre exact) :

1. `01_auth_link.sql` (puis optionnellement `01b_migrate_users_id_to_text.sql`)
2. `02_rls_hardening.sql`
3. `03_rpc_stock_and_orders.sql`
4. `04_mouvements_et_depots_vehicules.sql`
5. `05_rpc_admin_users.sql`
6. `06_install_additional_roles.sql`
7. `08_print_jobs.sql` (postes et file d'impression d'étiquettes à distance)
8. `07_app_compat.sql` (table `app_compat`, `diagnostic_installation()` et durcissement final des fonctions `SECURITY DEFINER`)

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
| **Envoi d'e-mails** | Réponse `"non configuré"` de `send-report-email` | L'envoi d'e-mails est facultatif. Pour l'activer, enregistrez votre clé Brevo ou SMTP dans Supabase Vault (`email_api_key` ou `smtp_password`). |

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

