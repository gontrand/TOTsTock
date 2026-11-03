# Version bureau de TOT Stock (Windows, macOS, Linux)

Ce guide explique comment installer, configurer et utiliser l'application de bureau **TOT Stock** sur un poste PC ou Mac (au magasin ou au bureau), notamment pour faire fonctionner le **Poste d'impression** d'étiquettes **sans boîte de dialogue** sur une imprimante thermique ou A4.

---

## 1. Installation sur Windows, macOS et Linux

Téléchargez le fichier correspondant à votre système depuis les fichiers de publication (*Releases*) et vérifiez si besoin son empreinte dans `SHA256SUMS.txt` :

### Windows (64 bits — `.exe`)
1. Téléchargez **`TOT-Stock-5.5.0-win-x64.exe`**.
2. Double-cliquez sur le fichier pour lancer l'assistant d'installation.
3. Choisissez le dossier d'installation (par défaut dans votre dossier utilisateur, **sans besoin des droits administrateur**).
4. L'installateur crée un raccourci **TOT Stock** sur le Bureau et dans le menu Démarrer.

### macOS (Intel et Apple Silicon M1/M2/M3/M4 — `.dmg`)
1. Téléchargez **`TOT-Stock-5.5.0-mac-universal.dmg`**.
2. Ouvrez l'image disque `.dmg` et glissez l'icône **TOT Stock** dans le dossier **Applications**.
3. Éjectez l'image disque puis lancez **TOT Stock** depuis vos Applications.

### Linux (64 bits — `.AppImage` ou `.deb`)
- **Format universel `.AppImage`** :
  1. Téléchargez **`TOT-Stock-5.5.0-linux-x86_64.AppImage`**.
  2. Rendez le fichier exécutable :
     ```bash
     chmod +x TOT-Stock-5.5.0-linux-x86_64.AppImage
     ./TOT-Stock-5.5.0-linux-x86_64.AppImage
     ```
- **Paquet Debian / Ubuntu `.deb`** :
  ```bash
  sudo apt install ./TOT-Stock-5.5.0-linux-amd64.deb
  ```

---

## 2. Premier lancement si l'installateur n'est pas signé

Si l'installateur a été produit sans certificat commercial payant (Windows Authenticode ou Apple Developer ID), le système affiche un avertissement au premier lancement :

### Sur Windows (Microsoft Defender SmartScreen)
1. Une fenêtre bleue **« Windows a protégé votre ordinateur »** s'affiche.
2. Cliquez sur **« Informations complémentaires »** (*More info*).
3. Cliquez sur le bouton **« Exécuter quand même »** (*Run anyway*).

### Sur macOS (Gatekeeper)
1. N'ouvrez pas l'application par simple double-clic la première fois : faites un **clic droit** (ou `Ctrl + clic`) sur **TOT Stock** dans le dossier **Applications**, puis cliquez sur **« Ouvrir »**.
2. Dans la boîte de dialogue qui apparaît, cliquez de nouveau sur **« Ouvrir »** (ou autorisez l'application dans *Réglages Système → Confidentialité et sécurité → Ouvrir quand même*).

---

## 3. Activer le Poste d'impression et l'impression silencieuse

L'avantage principal de la version bureau est de pouvoir imprimer directement les étiquettes envoyées par les téléphones en mode Scanner, **sans afficher la fenêtre d'impression**.

1. Ouvrez **TOT Stock** sur le PC et connectez-vous avec un compte disposant du droit d'impression d'étiquettes (`perm_menu_print_labels`).
2. Allez dans l'onglet **Plus** → **Poste d'impression**.
3. Dans le bloc **Configuration du poste** :
   - Donnez un nom clair au poste (ex. `PC Magasin Central`).
   - Sélectionnez le dépôt rattaché (ou *Tous les dépôts autorisés*).
   - Cliquez sur **« Activer ce poste »**.
4. Dans le bloc orange **Imprimante du poste (Version Bureau)** :
   - Choisissez votre **Imprimante cible** (imprimante thermique Zebra/Dymo/Brother ou imprimante A4) dans la liste déroulante.
   - Cochez **« Impression silencieuse (sans boîte de dialogue) »**.
5. Si vous souhaitez que les étiquettes envoyées depuis les téléphones s'impriment toutes seules dès leur arrivée :
   - Cochez **« Impression automatique à réception »**.

> **Bon à savoir :** Ce même sélecteur d'imprimante et la case « Impression silencieuse » sont également disponibles dans l'écran **Planches d'Étiquettes & QR Codes** (`Plus → Planches d'Étiquettes & QR Codes`). Votre choix d'imprimante est mémorisé automatiquement sur le PC.

---

## 4. Réglage du format 50 × 30 mm dans le pilote d'imprimante thermique

Lorsqu'un travail utilise le format **Thermique 50×30 mm**, l'application envoie automatiquement au pilote d'impression une taille de page de **50 mm × 30 mm** (`50 000 × 30 000 microns`) sans marges. Pour éviter tout décalage sur le rouleau :

### Sous Windows
1. Ouvrez **Paramètres → Bluetooth et appareils → Imprimantes et scanners**.
2. Cliquez sur votre imprimante thermique (ex. Zebra, Brother, Dymo, TSC) puis sur **Préférences d'impression**.
3. Dans l'onglet **Mise en page / Options de page**, vérifiez que les dimensions du rouleau sont bien réglées sur **Largeur : 50 mm** et **Hauteur : 30 mm** (Orientation : Portrait), avec des marges à **0 mm**.
4. Validez par **Appliquer**.

### Sous macOS / Linux (CUPS)
1. Ouvrez l'interface CUPS (`http://localhost:631/printers`) ou les réglages d'imprimantes du système.
2. Sélectionnez l'imprimante thermique → **Set Default Options**.
3. Choisissez le format de média **50x30mm** (ou *Custom 50x30mm*) et enregistrez.

---

## 5. Utilisation d'une douchette USB ou d'une webcam sur le poste

- **Douchette code-barres / QR USB ou Bluetooth (mode clavier HID)** :
  Aucune configuration n'est nécessaire. Branchez la douchette sur le PC : elle fonctionne immédiatement dans la barre de recherche, le comptage d'inventaire, le mode Scanner et la saisie manuelle.
- **Webcam du PC / Mac** :
  La permission caméra (`media`) est autorisée uniquement pour l'interface interne de TOT Stock (`app://tot`). Sur macOS, le système vous demandera une seule fois d'autoriser l'accès à la caméra au premier scan. Si le poste n'a pas de webcam, le champ de saisie manuelle reste toujours disponible.

---

## 6. Emplacement des fichiers de configuration et réinitialisation

L'application enregistre localement la taille de la fenêtre (`window-state.json`), les réglages d'imprimante (`print-settings.json`) et le stockage local dans le dossier utilisateur du système :

- **Windows** : `%APPDATA%\tot-stock-desktop\` (ex. `C:\Users\<Nom>\AppData\Roaming\tot-stock-desktop\`)
- **macOS** : `~/Library/Application Support/tot-stock-desktop/`
- **Linux** : `~/.config/tot-stock-desktop/`

### Comment réinitialiser complètement l'application sur le PC
1. Depuis l'application : ouvrez votre **Profil** (icône en haut) et cliquez sur **« Se déconnecter et effacer les données de cet appareil »**.
2. Ou manuellement : fermez **TOT Stock**, puis supprimez le dossier `tot-stock-desktop` indiqué ci-dessus.

---

## 7. Procédure pour les développeurs (Compilation locale & Publication GitHub)

### Tester et compiler en local
Depuis la racine du projet :

```bash
# 1. Installer les dépendances web et bureau
npm ci
cd desktop && npm ci && cd ..

# 2. Lancer en mode développement (compile dist/ puis ouvre Electron avec DevTools)
npm run desktop:dev

# 3. Créer un dossier d'application non empaqueté (test rapide)
npm run desktop:pack

# 4. Construire l'installateur pour le système courant + SHA256SUMS.txt dans desktop/release/
npm run desktop:build
```

### Publier une nouvelle version multi-plateforme (Windows, macOS, Linux) sur GitHub
1. Assurez-vous que `APP_VERSION` dans `src/appVersion.ts`, `version` dans `package.json` et `version` dans `desktop/package.json` sont identiques (vérifié automatiquement par `npm run check:version`).
2. Créez et poussez un tag Git commençant par `desktop-v` :
   ```bash
   git tag desktop-v5.5.0
   git push origin desktop-v5.5.0
   ```
3. Le workflow GitHub Actions **`.github/workflows/desktop-build.yml`** se déclenche automatiquement :
   - Il exécute `npm run check:version`, `npm test` et `npm run build`.
   - Il compile en parallèle les installateurs **Windows (`.exe`)**, **macOS universel (`.dmg`)** et **Linux (`.AppImage` et `.deb`)**.
   - Il calcule les empreintes **`SHA256SUMS.txt`** et prépare une **Release GitHub en brouillon (*Draft*)** prête à être publiée.
4. Vous pouvez aussi lancer ce workflow à la demande depuis l'onglet **Actions → Build Desktop Installers → Run workflow** sur GitHub.
