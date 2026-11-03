# Construire l'APK Android dans le cloud (GitHub Actions)

Cette méthode ne demande **ni Android Studio, ni Java** sur votre ordinateur. GitHub construit l'APK sur ses machines, et vous téléchargez le fichier.

## 1. Mettre le projet sur GitHub (une seule fois)
1. Créez un compte gratuit sur github.com, puis un **nouveau dépôt privé** (« Private ») nommé par exemple `tot-stock`. Ne le rendez jamais public : le projet contient la configuration de vos serveurs.
2. Copiez le fichier `.github/workflows/android-apk.yml` de ce dossier dans votre projet, au **même chemin** : `<projet>/.github/workflows/android-apk.yml`. Copiez aussi `docs/APK_CLOUD.md` dans `<projet>/docs/`.
3. Envoyez le projet sur GitHub. Le plus simple pour un débutant : installer **GitHub Desktop** (desktop.github.com), faire *File → Add local repository* sur le dossier du projet (ou *Create new repository* sur ce dossier), puis **Commit** et **Publish repository** en cochant « Keep this code private ».
   - Le glisser-déposer sur le site de GitHub est limité à 100 fichiers : il ne convient pas à ce projet.
   - Le dossier `node_modules` ne doit pas être envoyé (le `.gitignore` du projet l'exclut déjà).

## 2. Lancer la construction de test (sans aucune clé)
1. Sur la page du dépôt : onglet **Actions**.
2. À gauche : **TOT Stock — APK Android**. Si GitHub demande d'activer les workflows, cliquez sur le bouton vert.
3. À droite : **Run workflow**, laissez **test**, puis **Run workflow**.
4. Attendez 10 à 20 minutes (la première fois est plus longue). Une coche verte indique la réussite.
5. Ouvrez l'exécution terminée. En bas, dans **Artifacts**, téléchargez `tot-stock-vX.Y.Z-TEST.apk` : c'est un zip qui contient l'APK, `SHA256SUMS.txt` et `signature-info.txt`.

Le travail **échoue exprès** si le fichier est trop petit, n'est pas une vraie APK ou n'a pas de signature moderne : plus de page web enregistrée sous un nom `.apk`.

## 3. Installer l'APK de test sur le téléphone
1. Dézippez, puis copiez l'APK sur le téléphone par câble USB ou par Drive.
2. Ouvrez-la **depuis l'application Fichiers** (dossier Téléchargements), pas avec l'aperçu de Drive.
3. Autorisez l'installation depuis cette source si Android le demande (Réglages → Applications → Installer des applis inconnues), puis « Installer quand même » si Play Protect s'affiche.
4. Une APK de test **ne remplace pas** une ancienne version signée avec une autre clé : désinstallez d'abord toute ancienne version de TOT Stock.
5. Contrôle : une vraie APK pèse environ 7 à 9 Mo.

⚠️ L'APK de test est signée par une clé de test et déclarée « debug ». Ne la donnez pas à des clients.

## 4. Mode publication (APK signée avec votre clé)
À faire quand les essais sont concluants.

1. **Créer votre clé de signature** sur votre ordinateur (une seule fois, jamais dans le projet) :
   ```
   keytool -genkeypair -v -keystore tot-stock-release.jks -alias totstock -keyalg RSA -keysize 4096 -validity 9125
   ```
   Notez le mot de passe. **Faites deux copies du fichier `.jks`** hors du projet : si vous le perdez, aucun téléphone ne pourra plus être mis à jour sans désinstaller l'application. L'ancienne clé qui était dans l'ancien projet est compromise : ne l'utilisez plus.
2. **Convertir le fichier en texte** :
   - Windows (PowerShell) : `[Convert]::ToBase64String([IO.File]::ReadAllBytes("tot-stock-release.jks"))`
   - Mac / Linux : `base64 -w0 tot-stock-release.jks` (sur Mac : `base64 -i tot-stock-release.jks`)
3. Sur GitHub : **Settings → Secrets and variables → Actions → New repository secret**, créez ces 4 secrets :
   | Nom | Valeur |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | le texte obtenu à l'étape 2 |
   | `ANDROID_KEYSTORE_PASSWORD` | le mot de passe du fichier de clé |
   | `ANDROID_KEY_ALIAS` | `totstock` |
   | `ANDROID_KEY_PASSWORD` | le mot de passe de la clé (souvent le même) |
4. **Actions → Run workflow → publication**. L'artefact contient `tot-stock-vX.Y.Z.apk`, son empreinte `SHA256SUMS.txt` et `signature-info.txt`.
5. Publiez l'APK sur votre site ou sur GitHub Releases, **avec son empreinte SHA-256**, puis renseignez `app_compat.update_url` côté client (voir `docs/PUBLIER_APK.md`).
6. Avant la première diffusion, **désinstallez la version de test** sur vos téléphones : sa signature est différente.

## 5. Avant chaque nouvelle version
- Vérifiez que `package.json`, `src/appVersion.ts` et `android/app/build.gradle` portent la même version, et augmentez `versionCode` de 1 (`npm run check:version` le contrôle).

## 6. Si la construction échoue
| Message dans les journaux | Que faire |
|---|---|
| `Secrets manquants` | Mode publication : créez les 4 secrets de l'étape 4. |
| `npm run check:version` en erreur | Alignez les numéros de version (étape 5), ou retirez le fichier signalé (APK ou clé dans le projet). |
| `Fichier trop petit` ou `pas une archive APK valide` | Envoyez-moi le journal de l'étape « Construire l'APK ». |
| `Signature moderne (v2/v3) absente` | Idem : envoyez les journaux de l'étape « Vérifier et nommer l'APK ». |
| `The workflow is not enabled` | Onglet Actions : cliquez sur le bouton vert d'activation. |

Le mode publication active la réduction de code (R8). Si l'APK de publication s'installe mais plante au lancement alors que l'APK de test fonctionne, c'est la première chose à examiner : envoyez-moi le résultat d'un essai.
