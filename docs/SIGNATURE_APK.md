# Signature de l'APK Android (Keystore de production)

Ce guide explique, étape par étape et sans jargon inutile, comment créer, protéger et utiliser votre clé de signature Android pour TOT Stock.

---

## 1. Règle d'or : ne jamais mettre la clé dans le dépôt Git

> 🛑 **Alerte de sécurité — Ancienne clé `android/keystore/` révoquée :**
> L'ancienne clé qui figurait autrefois dans le dossier `android/keystore/` (`tot-release-key.pem`, `tot-release-cert.pem`, `tot-release-cert.der`) a été supprimée du dépôt. Ayant été exposée dans l'historique du projet, **cette ancienne clé est à considérer comme compromise et ne doit plus jamais servir** pour signer une APK de production ou de test. Vous devez utiliser exclusivement un nouveau keystore créé hors du dépôt.

- Le fichier de clé (`.jks`, `.keystore`, `.p12`, `.pem`, `.der`) et ses mots de passe doivent être créés et conservés **uniquement sur l'ordinateur du propriétaire** (et sur vos supports de sauvegarde privés).
- **Ne copiez jamais** ce fichier dans le dossier du projet et **n'écrivez jamais** son mot de passe dans un fichier du projet.
- Le fichier `.gitignore` et le script `scripts/check-version.mjs` bloquent les fichiers `*.keystore`, `*.jks`, `*.p12`, `*.pem`, `*.der`, le dossier `android/keystore/` ainsi que toute clé privée (`PRIVATE KEY`) ou tout fichier `*.apk` dans le dépôt.

> ⚠️ **Attention — Risque critique en cas de perte de la clé :**
> Android vérifie que toute mise à jour d'une application est signée avec **exactement la même clé** que la version déjà installée sur le téléphone.
> **Si vous perdez ce fichier keystore ou son mot de passe, il sera impossible de mettre à jour l'APK sur les téléphones déjà installés** (il faudra désinstaller puis réinstaller l'application sur chaque téléphone).
>
> **Obligation :** Sauvegardez immédiatement le fichier `.jks` et son mot de passe dans **deux endroits sûrs et distincts** hors du dépôt (par exemple : un gestionnaire de mots de passe chiffré + une clé USB conservée au coffre).

---

## 2. Créer le keystore de production (une seule fois)

Ouvrez un terminal sur **votre ordinateur** (dans un dossier personnel hors du projet, par exemple `~/secrets-tot-stock/`) et exécutez la commande suivante (RSA 4096 bits, validité 25 ans soit 9 125 jours) :

```bash
mkdir -p ~/secrets-tot-stock
keytool -genkeypair \
  -v \
  -keystore ~/secrets-tot-stock/tot-stock-release.jks \
  -storetype PKCS12 \
  -keyalg RSA \
  -keysize 4096 \
  -validity 9125 \
  -alias totstock
```

L'outil `keytool` (fourni avec Java JDK / Android Studio) vous posera quelques questions :
1. **Mot de passe du fichier keystore** : choisissez un mot de passe long et robuste (au moins 16 caractères).
2. **Nom et prénom / Unité / Organisation / Ville / Pays** : indiquez le nom de votre société (ex. `TOT Stock`, `BE` ou `FR`).

Une fois terminé, le fichier `~/secrets-tot-stock/tot-stock-release.jks` est créé. **Faites vos deux sauvegardes immédiatement.**

---

## 3. Afficher l'empreinte SHA-256 du certificat de signature

Pour vérifier votre clé ou communiquer l'empreinte officielle du certificat de signature de votre APK à un client grand compte :

```bash
keytool -list -v \
  -keystore ~/secrets-tot-stock/tot-stock-release.jks \
  -alias totstock
```

Après saisie du mot de passe, repérez la ligne **`SHA256:`** sous **`Empreintes du certificat (Certificate fingerprints)`** :
```text
Certificate fingerprints:
     SHA1: ...
     SHA256: AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99
```

---

## 4. Fournir la clé à Gradle lors de la compilation (sans rien écrire dans le projet)

Le fichier `android/app/build.gradle` lit la clé exclusivement via 4 variables d'environnement au moment de compiler l'APK Release :

```bash
export ANDROID_KEYSTORE_PATH="$HOME/secrets-tot-stock/tot-stock-release.jks"
export ANDROID_KEYSTORE_PASSWORD="VOTRE_MOT_DE_PASSE_KEYSTORE"
export ANDROID_KEY_ALIAS="totstock"
export ANDROID_KEY_PASSWORD="VOTRE_MOT_DE_PASSE_KEYSTORE"
```

Si l'une de ces 4 variables est absente, Gradle refuse de compiler l'APK Release avec un message explicite.
