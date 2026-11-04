# TOT Stock — Application de Gestion de Stock & Dépôts (v23 / 5.5.0)

Application multi-plateforme (Web / PWA / Android Capacitor) reposant sur **React 19**, **Vite**, **Tailwind CSS**, **Supabase** (PostgreSQL + RLS + Edge Functions) et **Capacitor Android**.

---

## Générer une nouvelle clé de signature

> **AVERTISSEMENT DE SÉCURITÉ CRITIQUE** : La clé de signature Android historique (`totstock-release-key.keystore` / mots de passe par défaut précédemment présents dans les scripts de build) est **considérée comme compromise**. Elle ne doit plus jamais être utilisée pour signer un APK distribué en production. Aucun mot de passe par défaut ni fichier `.keystore` n'est accepté dans le dépôt.

### 1. Générer un nouveau keystore de production (hors du dépôt Git)

Exécutez la commande suivante avec `keytool` (fourni avec le JDK Java 17+) pour créer une nouvelle clé RSA 4096 bits stockée au format PKCS12 dans un répertoire sécurisé **en dehors** du dépôt :

```bash
mkdir -p ~/.keys/tot-stock
chmod 700 ~/.keys/tot-stock

keytool -genkeypair -v \
  -storetype PKCS12 \
  -keystore ~/.keys/tot-stock/totstock-prod-signing.keystore \
  -alias totstock_prod_key \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000 \
  -dname "CN=TOT Stock Production, OU=Mobile Security, O=TOT Stock, L=Paris, S=IDF, C=FR"
```

### 2. Configurer les variables d'environnement obligatoires pour le build Release

Le script `android/app/build.gradle` et `scripts/build-apk.sh` refusent toute compilation Release si l'une des 4 variables suivantes est absente :

```bash
export ANDROID_KEYSTORE_PATH="$HOME/.keys/tot-stock/totstock-prod-signing.keystore"
export ANDROID_KEYSTORE_PASSWORD="<VOTRE_MOT_DE_PASSE_KEYSTORE_ROBUSTE>"
export ANDROID_KEY_ALIAS="totstock_prod_key"
export ANDROID_KEY_PASSWORD="<VOTRE_MOT_DE_PASSE_CLE_ROBUSTE>"
```

### 3. Compiler l'APK Release signé

```bash
bash scripts/build-apk.sh
```

> **Note sur les paramètres de sécurité APK (`capacitor.config.ts`)** :
> Par défaut (production), `server.cleartext`, `android.allowMixedContent` et `android.webContentsDebuggingEnabled` sont forcés à `false`. Ils ne peuvent passer à `true` que si `TOT_DEV_BUILD=1` est explicitement défini lors du build de développement.

---

## Scripts de vérification, de build et d'installation

- `npm run check:version` : Vérifie que `package.json` et `src/appVersion.ts` (`APP_VERSION`) sont strictement alignés.
- `npm run build:sql` : Génère les migrations ordonnées `supabase/migrations/<horodatage>_<nom>.sql` et le script consolidé `dist/install.sql` à partir de `supabase-client/`.
- `npm run bundle:functions` : Génère les 3 fichiers autonomes `dist/functions/<nom>.single.ts` pour l'éditeur web Supabase Dashboard.
- `npm run install:tot` (`node scripts/tot-install.mjs`) : Installateur et outil de mise à jour en une seule commande (migrations SQL, Edge Functions sans secret manuel, désactivation des inscriptions publiques, création du premier Super Administrateur, liaison de licence et diagnostic final).
- `npm test` : Exécute la suite de tests unitaires Vitest (alignement de `plan_limits`, synchronisation des migrations générées, tests hors ligne de `tot-install` et non-divulgation des secrets).
- `npm run build` : Exécute `npm run check:version`, `npm run build:sql`, puis compile l'application web avec Vite.

## Installation et mise à jour de la base client Supabase

Consultez [`supabase-client/INSTALL.md`](./supabase-client/INSTALL.md) pour les 3 méthodes d'installation :
1. **Méthode A (recommandée)** : `npm run install:tot` (ou `npm run install:tot -- --update` pour une mise à jour).
2. **Méthode B** : CLI Supabase (`npx supabase db push` et `npx supabase functions deploy`).
3. **Méthode C** : Interface web Supabase avec `dist/install.sql` et `dist/functions/*.single.ts` (ou copie individuelle des scripts `01_auth_link.sql` à `08_print_jobs.sql` depuis l'assistant d'installation intégré : `01` → `08` puis `07` pour tout rejouer, ou seulement `08_print_jobs.sql` sur une base déjà en `1.0.0` pour passer le schéma à `1.1.0` et activer le Poste d'impression).


## Formules de licence (`plan_limits`)

| Code canonique | Libellé UI (`PLAN_LABELS`) | Références max (`max_references`) | Dépôts max (`max_depots`) | Utilisateurs max (`max_users`) | Modules inclus | Format de clé générée |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `free` | **Free** | 50 | 1 | Illimités (`99999`) | `['stock']` | `TOT-STOCK-FREE-XXXX-XXXX` |
| `sta` | **STA** | 300 | 3 | Illimités (`99999`) | `['stock']` | `TOT-STOCK-STA-XXXX-XXXX` |
| `pro` | **PRO** | 1 000 | 10 | Illimités (`99999`) | `['stock', 'outils', 'rapports']` | `TOT-STOCK-PRO-XXXX-XXXX` |
| `ent` | **ENT** | Illimités (`99999`) | Illimités (`99999`) | Illimités (`99999`) | `['stock', 'outils', 'formation', 'rapports']` | `TOT-STOCK-ENT-XXXX-XXXX` |

### Anciens codes (alias acceptés en lecture seulement)

Pour garantir la rétrocompatibilité avec les jetons et licences déjà émis (notamment en v24), les alias suivants sont reconnus **en lecture uniquement** et normalisés vers le code canonique après vérification de la signature Ed25519 :
- `artisan`, `starter`, `standard` $\rightarrow$ **`sta`**
- `pme`, `professionnel` $\rightarrow$ **`pro`**
- `enterprise`, `entreprise` $\rightarrow$ **`ent`**

Ces alias ne sont jamais écrits dans la base de données ni dans un jeton nouvellement émis.

## Déploiement automatisé par GitHub Actions (modèle)

Un modèle de workflow CI/CD est fourni dans [`.github/workflows/tot-deploy.yml.example`](./.github/workflows/tot-deploy.yml.example).
Pour l'activer :
1. Copiez `.github/workflows/tot-deploy.yml.example` vers `.github/workflows/tot-deploy.yml`.
2. Configurez les 3 secrets dans votre dépôt GitHub (*Settings > Secrets and variables > Actions*) :
   - `SUPABASE_ACCESS_TOKEN` (jeton personnel Supabase)
   - `SUPABASE_PROJECT_REF` (référence du projet Supabase)
   - `SUPABASE_DB_PASSWORD` (mot de passe PostgreSQL de la base)
3. Lancez manuellement le workflow depuis l'onglet **Actions** (`workflow_dispatch`), qui exécute `node scripts/tot-install.mjs --update --yes`.


