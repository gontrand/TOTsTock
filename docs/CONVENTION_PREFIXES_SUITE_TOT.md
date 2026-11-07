# Convention des Préfixes de Tables — Suite TOT (Schéma 2.0.0)

Les applications de la suite **TOT** (**TOT Stock**, **TOT Habilitation**, **TOT Report**, etc.) partagent **une seule base PostgreSQL / Supabase** par entreprise cliente afin d'unifier l'authentification, les rôles, les départements, les chantiers et la piste d'audit.

---

## 1. Préfixes par domaine applicatif

| Préfixe | Domaine | Usage |
| :--- | :--- | :--- |
| **`core_`** | Socle commun Suite TOT | Tables partagées entre toutes les applications de la suite TOT (utilisateurs, rôles, départements, chantiers, paramètres, licence, compatibilité, audit, opérations idempotentes, fichiers). |
| **`stk_`** | **TOT Stock** | Tables propres à la gestion de stock, aux dépôts/véhicules/conteneurs, aux mouvements, aux commandes matériel, aux inventaires et au poste d'impression d'étiquettes. |
| **`hab_`** | **TOT Habilitation** | Convention réservée pour les tables propres aux habilitations, formations et titres d'habilitation du personnel (aucune table créée par TOT Stock). |
| **`rpt_`** | **TOT Report** | Convention réservée pour les tables propres aux rapports de chantier, pointages et formulaires terrain (aucune table créée par TOT Stock). |

---

## 2. Correspondance complète des tables (Schéma 1.x $\rightarrow$ Schéma 2.0.0)

### 2.1 Tables partagées (`core_`)

| Clé dans `TABLES` (`src/constants/tables.ts`) | Nom de table SQL (`2.0.0`) | Ancien nom (`1.x`) | Notes |
| :--- | :--- | :--- | :--- |
| `TABLES.users` | `public.core_users` | `public.users` | Profils utilisateurs liés à `auth.users` |
| `TABLES.roles` | `public.core_roles` | `public.roles` | Rôles métier `0` à `10` et tableau `permissions` |
| `TABLES.departments` | `public.core_departments` | `public.departments` | Départements / agences |
| `TABLES.projects` | `public.core_projects` | `public.projects` | Chantiers / projets |
| `TABLES.companySettings` | `public.core_company_settings` | `public.company_settings` | Paramètres société |
| `TABLES.appSettings` | `public.core_app_settings` | `public.app_settings` | Paramètres clé/valeur de l'instance |
| `TABLES.licenseConfig` | `public.core_license_config` | `public.license_config` | Licence signée Ed25519 et quotas |
| `TABLES.appCompat` | `public.core_app_compat` | `public.app_compat` | Singleton (`id = 1`) de version de schéma (`schema_version = '2.0.0'`, `min_schema_version = '1.0.0'`) |
| `TABLES.auditLogs` | `public.core_audit_logs` | `public.audit_logs` | Journal d'audit immuable avec colonne **`app TEXT DEFAULT 'stock'`** |
| `TABLES.loginLogs` | `public.core_login_logs` | `public.login_logs` | Journal des connexions |
| `TABLES.processedOperations` | `public.core_processed_operations` | `public.processed_operations` | Registre d'idempotence RPC avec colonne **`app TEXT DEFAULT 'stock'`** |
| `TABLES.files` | `public.core_files` | `public.files` | Réservé (renommé uniquement si présent ; non créé par défaut) |

### 2.2 Tables TOT Stock (`stk_`)

| Clé dans `TABLES` (`src/constants/tables.ts`) | Nom de table SQL (`2.0.0`) | Ancien nom (`1.x`) | Notes |
| :--- | :--- | :--- | :--- |
| `TABLES.products` | `public.stk_products` | `public.products` | Catalogue articles et quantité totale consolidée |
| `TABLES.categories` | `public.stk_categories` | `public.categories` | Réservé (renommé uniquement si présent) |
| `TABLES.subCategories` | `public.stk_sub_categories` | `public.sub_categories` | Sous-catégories et seuils |
| `TABLES.stockLevels` | `public.stk_stock_levels` | `public.stock_levels` | Quantités exactes par dépôt (`product_id`, `depot_name`) |
| `TABLES.depots` | `public.stk_depots` | `public.depots` | Dépôts fixes (`FIXED`), véhicules (`VEHICLE`) et conteneurs (`CONTAINER`) |
| `TABLES.movements` | `public.stk_movements` | `public.stock_movements` / `public.movements` | Historique unifié des mouvements de stock |
| `TABLES.materialOrders` | `public.stk_material_orders` | `public.material_orders` | Commandes de matériel |
| `TABLES.materialOrderItems` | `public.stk_material_order_items` | `public.material_order_items` | Lignes de commandes de matériel |
| `TABLES.printJobs` | `public.stk_print_jobs` | `public.print_jobs` | File de travaux d'impression d'étiquettes |
| `TABLES.printStations` | `public.stk_print_stations` | `public.print_stations` | Postes d'impression enregistrés |
| `TABLES.inventoryAudits` | `public.stk_inventory_audits` | `public.inventory_audits` | Sessions d'audit d'inventaire |
| `TABLES.inventoryAuditItems` | `public.stk_inventory_audit_items` | `public.inventory_audit_items` | Lignes de comptage d'inventaire |
| `TABLES.orderPreparationsLog` | `public.stk_order_preparations_log` | `public.order_preparations_log` | Journal de préparation de commandes |

---

## 3. Traçabilité multi-applications (`app text`)

Les tables partagées **`public.core_audit_logs`** et **`public.core_processed_operations`** comportent une colonne :

```sql
ALTER TABLE public.core_audit_logs ADD COLUMN IF NOT EXISTS app TEXT DEFAULT 'stock';
ALTER TABLE public.core_processed_operations ADD COLUMN IF NOT EXISTS app TEXT DEFAULT 'stock';
```

- **TOT Stock** renseigne `'stock'` (ou laisse la valeur par défaut `'stock'`).
- **TOT Habilitation** renseignera `'habilitation'`.
- **TOT Report** renseignera `'report'`.

---

## 4. Migration d'une base existante et vues de compatibilité (`09` & `10`)

1. **Migration (`supabase-client/09_core_prefixes.sql`)** :
   - Sur une **base existante (1.x)** contenant les anciens noms de tables physiques (`relkind = 'r'`), le script `09_core_prefixes.sql` purge les anciennes politiques RLS et déclencheurs hérités, convertit les identifiants numériques en `TEXT`, renomme chaque table vers son nom préfixé (`core_*` ou `stk_*`), fusionne `movements` et `stock_movements` dans `stk_movements`, puis crée des **vues de compatibilité** `WITH (security_invoker = true)` portant les anciens noms (`users`, `products`, `stock_movements`, `movements`, etc.) avec `REVOKE ALL FROM PUBLIC, anon` et `GRANT SELECT, INSERT, UPDATE, DELETE TO authenticated, service_role`.
   - Sur une **base neuve (2.0.0)**, seules les tables `core_*` et `stk_*` sont créées ; aucune vue de compatibilité inutile n'est créée.
2. **Fin de transition (`supabase-client/10_drop_compat_views.sql`)** :
   - Tant que les vues de compatibilité sont présentes sur une base migrée, `public.diagnostic_installation()` retourne le contrôle `compat_views_present` au statut **`ATTENTION`**.
   - Une fois que toutes les applications clientes (Web, Bureau, APK mobile) ont été mises à jour, l'administrateur exécute manuellement **`supabase-client/10_drop_compat_views.sql`** pour supprimer les vues de compatibilité (`DROP VIEW IF EXISTS ...`, sans jamais toucher aux tables physiques `relkind = 'r'`). Le contrôle `compat_views_present` passe alors à **`OK`**.
