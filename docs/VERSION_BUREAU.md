# Version bureau de TOT Stock (Windows, macOS, Linux)

Ce guide explique comment installer, configurer et utiliser l'application de bureau **TOT Stock** sur un poste PC ou Mac (au magasin ou au bureau), ainsi que la présentation **Bureau grand écran** active automatiquement à partir de **1024 px** de large (navigateur PC ou application Electron).

---

## 1. Présentation Bureau (≥ 1024 px) et raccourcis clavier

Dès que la fenêtre fait au moins **1024 px** de large, TOT Stock bascule automatiquement sur son **interface de bureau multi-colonnes** (en dessous de 1024 px, l'interface mobile reste strictement identique) :

- **Barre latérale gauche** (réductible via `Ctrl+B`) : Tableau de bord, Inventaire, Mouvements, Commandes, Préparation, Poste d'impression et Paramètres.
- **Barre supérieure** : sélecteur de dépôt actif, recherche rapide (`Ctrl+K`), bouton **« + Créer »**, indicateur de synchronisation et profil utilisateur.
- **Tableaux de données denses** : tri multi-colonnes, sélection multiple (`Maj+clic`), menu contextuel au clic droit et panneau de détail ancré à droite (sans recharger la liste).
- **Palette de commandes (`Ctrl+K` / `⌘K`)** : recherche instantanée d'un article (nom, SKU, code-barres), d'une commande ou d'une action.

### Principaux raccourcis clavier
| Raccourci | Action |
|---|---|
| `Ctrl+K` / `⌘K` | Ouvrir la palette de commandes |
| `/` ou `Ctrl+F` | Placer le curseur dans la recherche de la page |
| `N` ou `Ctrl+N` | Créer un nouvel article |
| `M` ou `Ctrl+M` | Enregistrer un nouveau mouvement de stock |
| `Ctrl+Maj+O` | Créer une nouvelle commande matériel |
| `Ctrl+E` | Exporter la vue courante en CSV |
| `Ctrl+P` | Imprimer les étiquettes de la sélection |
| `Ctrl+B` | Réduire ou étendre la barre latérale |
| `F2` / `F4` / `F8` | En mode Préparation : valider la ligne / signaler un manquant / finaliser |
| `?` ou `Ctrl+/` | Afficher la liste complète des raccourcis clavier |
| `Échap` | Fermer le tiroir ou le panneau de détail ouvert |

---

## 2. Installation sur Windows, macOS et Linux

Téléchargez le fichier correspondant à votre système depuis l'écran **Paramètres → À propos & Installeurs** ou depuis les publications GitHub (*Releases*) :

### Windows (64 bits — `.exe`)
1. Téléchargez **`TOT-Stock-5.5.0-win-x64.exe`**.
2. Double-cliquez sur le fichier pour lancer l'assistant d'installation.
3. Choisissez le dossier d'installation (par défaut dans votre dossier utilisateur, **sans besoin des droits administrateur**).

### macOS (Intel et Apple Silicon M1/M2/M3/M4 — `.dmg`)
1. Téléchargez **`TOT-Stock-5.5.0-mac-universal.dmg`**.
2. Ouvrez l'image disque `.dmg` et glissez l'icône **TOT Stock** dans le dossier **Applications**.

### Linux (64 bits — `.AppImage` ou `.deb`)
- **Format universel `.AppImage`** :
  ```bash
  chmod +x TOT-Stock-5.5.0-linux-x86_64.AppImage
  ./TOT-Stock-5.5.0-linux-x86_64.AppImage
  ```
- **Paquet Debian / Ubuntu `.deb`** :
  ```bash
  sudo apt install ./TOT-Stock-5.5.0-linux-amd64.deb
  ```

---

## 3. Activer le Poste d'impression et l'impression silencieuse

L'écran **Poste d'impression** (accessible directement depuis la barre latérale sur grand écran) permet d'imprimer les étiquettes envoyées par les téléphones en mode Scanner, **sans afficher la boîte de dialogue d'impression** :

1. Ouvrez **TOT Stock** sur le PC et allez dans **Poste d'impression** (menu latéral).
2. Activez le poste en lui donnant un nom clair (ex. `PC Magasin Central`) et le dépôt rattaché.
3. Choisissez le mode d'impression :
   - **Imprimante système (pilote Windows / CUPS)** avec **Impression silencieuse** cochée.
   - Ou **Zebra ZPL II direct (TCP port 9100 / USB brut)** pour les imprimantes thermiques Zebra (voir `docs/INTEGRATION_BUREAU.md`).
4. Cochez **« Impression automatique à réception »** pour imprimer immédiatement chaque étiquette demandée par un préparateur mobile.

---

## 4. Douchette code-barres USB (HID) sans clic préalable

Sur l'écran **Inventaire** et l'écran **Préparation**, l'interface bureau détecte automatiquement les rafales rapides d'une douchette USB/Bluetooth en mode clavier HID (caractères reçus en moins de **50 ms** suivis de `Entrée`), même si le curseur n'est pas dans un champ de saisie :
- Dans **Inventaire** : ouvre directement la fiche de l'article scanné.
- Dans **Préparation** : valide immédiatement une unité de la ligne correspondante (ou sélectionne la commande si vous scannez un QR `TOT-ORDER:<numéro>`).

---

## 5. Menus natifs, barre des tâches et multi-fenêtres

Dans l'application Electron, consultez **`docs/INTEGRATION_BUREAU.md`** pour :
- L'impression thermique directe **Zebra ZPL II** (TCP 9100 et USB brut),
- Le fonctionnement en arrière-plan dans la **zone de notification (tray)** et le lancement automatique à l'ouverture de session,
- Les **notifications système natives**,
- L'assistant d'**import CSV d'articles** en 3 étapes,
- Le mode **multi-fenêtres** (`Fenêtre → Nouvelle fenêtre`, `Ctrl+Maj+N`) pour afficher le Poste d'impression ou la Préparation sur un second écran.
