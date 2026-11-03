# Compiler et publier une nouvelle version de l'APK TOT Stock

Ce guide décrit la procédure complète pour construire une nouvelle version de l'APK Android signé, publier son empreinte d'intégrité SHA-256 et déclencher la mise à jour auprès des utilisateurs via Supabase.

---

## Étape 1 — Vérifier et aligner les numéros de version

Avant de compiler une nouvelle version (par exemple `5.5.0`), vérifiez que les 4 fichiers suivants sont alignés :
1. `package.json` : `"version": "5.5.0"`
2. `src/appVersion.ts` : `export const APP_VERSION = '5.5.0';`
3. `android/app/build.gradle` :
   - `versionCode 3` (doit être augmenté de +1 à chaque nouvelle publication d'APK)
   - `versionName "5.5.0"`
4. `android/version-code.json` : `{ "versionCode": 3 }`

Lancez le garde-fou automatique :
```bash
npm run check:version
```

---

## Étape 2 — Compiler l'application Web et synchroniser Capacitor Android

À la racine du projet :
```bash
npm run build:android
```
Cette commande vérifie les versions (`check:version`), compile l'application React/Vite dans `dist/` et copie les ressources web dans `android/app/src/main/assets/public` via `npx cap sync android`.

---

## Étape 3 — Compiler et signer l'APK Release avec Gradle

1. Définissez les variables d'environnement de votre keystore (voir `docs/SIGNATURE_APK.md`) dans votre terminal :
   ```bash
   export ANDROID_KEYSTORE_PATH="$HOME/secrets-tot-stock/tot-stock-release.jks"
   export ANDROID_KEYSTORE_PASSWORD="VOTRE_MOT_DE_PASSE_KEYSTORE"
   export ANDROID_KEY_ALIAS="totstock"
   export ANDROID_KEY_PASSWORD="VOTRE_MOT_DE_PASSE_KEYSTORE"
   ```
2. Compilez l'APK Release :
   ```bash
   cd android
   ./gradlew assembleRelease
   cd ..
   ```
3. L'APK signé est généré à l'emplacement suivant :
   ```text
   android/app/build/outputs/apk/release/app-release.apk
   ```
   Renommez-le proprement pour la publication (hors du dossier du projet) :
   ```bash
   cp android/app/build/outputs/apk/release/app-release.apk ~/publications/tot-stock.apk
   ```

> **Règle importante :** Ne placez **jamais** `tot-stock.apk` à la racine du dépôt ni dans `public/` avant `npm run build:android`, sinon l'APK serait embarqué à l'intérieur de lui-même (doublant inutilement sa taille).

---

## Étape 4 — Calculer l'empreinte SHA-256 de l'APK

Calculez l'empreinte SHA-256 du fichier `tot-stock.apk` et enregistrez-la dans un fichier texte `tot-stock.apk.sha256` :

- **Sous Linux :**
  ```bash
  sha256sum ~/publications/tot-stock.apk | awk '{print $1}' > ~/publications/tot-stock.apk.sha256
  ```
- **Sous macOS :**
  ```bash
  shasum -a 256 ~/publications/tot-stock.apk | awk '{print $1}' > ~/publications/tot-stock.apk.sha256
  ```
- **Sous Windows (PowerShell) :**
  ```powershell
  (Get-FileHash .\tot-stock.apk -Algorithm SHA256).Hash.ToLower() | Out-File -NoNewline -Encoding ascii .\tot-stock.apk.sha256
  ```

Vérifiez le contenu du fichier (`64` caractères hexadécimaux) :
```bash
cat ~/publications/tot-stock.apk.sha256
```

---

## Étape 5 — Héberger l'APK et son fichier `.sha256` en HTTPS

Déposez les deux fichiers sur votre serveur d'hébergement HTTPS (bucket Supabase Storage public, CDN, serveur web d'entreprise ou GitHub Releases) :
- `https://votre-domaine.com/tot-stock.apk`
- `https://votre-domaine.com/tot-stock.apk.sha256` (ou à la racine `/tot-stock.apk.sha256` du serveur web de l'application)

Lorsque `/tot-stock.apk.sha256` est présent sur le serveur web, l'application TOT Stock affiche automatiquement dans la fenêtre d'information et de téléchargement :
*« Empreinte SHA-256 de l'APK : … »* avec un bouton **Copier**.

---

## Étape 6 — Mettre à jour la table `public.app_compat` dans Supabase

Ouvrez le **SQL Editor** du projet Supabase du client et exécutez :

```sql
UPDATE public.app_compat
SET
  update_url         = 'https://votre-domaine.com/tot-stock.apk',
  latest_version     = '5.5.0',
  min_app_version    = '5.5.0',   -- Mettre '5.5.0' pour forcer la mise à jour, ou laisser l'ancienne version minimale pour une mise à jour conseillée non bloquante
  schema_version     = '1.0.0',
  min_schema_version = '1.0.0',
  maintenance        = false,
  updated_at         = now()
WHERE id = 1;
```

- Si `update_url` est renseigné, tous les écrans de téléchargement et le bandeau de mise à jour de l'application utilisent ce lien.
- Si `update_url` est vide (`NULL` ou `''`), l'application affiche : *« Demandez le lien de téléchargement à votre administrateur »*.

---

## Étape 7 — Tester sur un vrai téléphone Android

1. **Important (changement de clé de signature) :** Si le téléphone de test possède déjà une ancienne version de TOT Stock signée avec une ancienne clé de test ou une clé différente, **désinstallez d'abord l'ancienne application** du téléphone (Android refuse d'écraser une application si la clé de signature a changé, en affichant *« L'application n'a pas été installée car le package semble non valide / conflit de signature »*).
2. Téléchargez l'APK depuis le lien HTTPS configuré et installez-le.
3. Ouvrez l'application, connectez la base Supabase de test et vérifiez :
   - l'ouverture de session par code PIN ;
   - le scan caméra (QR code / code-barres) ;
   - le statut **Compatible** dans la fenêtre **À propos / Informations** (`app_compat`).
