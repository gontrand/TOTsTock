# Intégration système Bureau — Zebra ZPL II, Barre des tâches, Notifications, Import CSV et Multi-fenêtres

Ce guide détaille les fonctionnalités d'intégration système disponibles dans l'interface **Bureau** de **TOT Stock** (version `5.5.0`).

---

## 1. Impression thermique directe Zebra ZPL II (sans pilote graphique)

Sur un poste de magasin équipé d'une imprimante thermique **Zebra** (GK420d,GK420t, ZD220, ZD420, ZD421, ZD621, ZT230…) ou compatible **ZPL II**, TOT Stock peut envoyer directement des commandes **ZPL II (`^XA ... ^XZ`)** sans passer par le rendu graphique du navigateur. Cela élimine tout décalage de marges et imprime instantanément.

### A. Mode Réseau local TCP (Port 9100 — JetDirect / RAW)
1. Assurez-vous que l'imprimante Zebra est connectée au réseau local de l'entreprise avec une adresse IP fixe privée (`10.x.x.x`, `172.16-31.x.x` ou `192.168.x.x`).
2. Dans **Poste d'impression** (ou **Paramètres → Poste d'impression**), activez **« Impression thermique directe Zebra (ZPL II) »**.
3. Choisissez le mode **Réseau TCP (Port 9100)** :
   - **Adresse IP** : saisissez l'adresse IP locale de l'imprimante (ex. `192.168.1.200`).
   - **Port TCP** : `9100` (ports autorisés : `9100`, `9101` ou `9102`).
   - **Résolution** : `203 dpi` (8 points/mm, standard GK420/ZD220/ZD420) ou `300 dpi` (12 points/mm).
4. Cliquez sur **« Imprimer une étiquette de test ZPL »** pour vérifier la liaison.

> **Sécurité réseau (protection anti-SSRF stricte) :** Le processus principal Electron (`isValidZplPrinterTarget` dans `desktop/security.mjs`) et l'interface (`validateZplPrinterAddress` dans `src/services/zplLabel.ts`) n'acceptent **que les adresses IPv4 privées RFC 1918** (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) sur les ports `9100`, `9101` ou `9102`. Les adresses link-local (`169.254.x.x`), `localhost` / `127.0.0.1`, les adresses IP publiques et **tous les noms d'hôtes** (ex. `monserveur`, `imprimante.local`) sont refusés afin d'éliminer tout risque de contournement SSRF par résolution DNS. Une seule connexion TCP (délai maximal 5 secondes) est ouverte à la fois par imprimante.

### B. Mode File d'attente système brute (CUPS / Linux / macOS)
1. Configurez l'imprimante USB dans CUPS en file brute (*Raw Queue*).
2. Choisissez le mode **Imprimante brute système (USB / CUPS)** et sélectionnez le nom de l'imprimante dans la liste issue de `listPrinters()`.

---

## 2. Barre des tâches (System Tray) et démarrage automatique

Pour qu'un PC dédié au **Poste d'impression** reste actif toute la journée sans être fermé par erreur :

1. Ouvrez **Paramètres → Poste d'impression** dans l'application Bureau Electron.
2. Activez **« Garder TOT Stock actif dans la barre des tâches à la fermeture de la fenêtre »** :
   - Cliquer sur la croix `×` de la fenêtre masque l'application dans la zone de notification (près de l'horloge) au lieu de l'arrêter.
   - Le Poste d'impression continue de recevoir et d'imprimer les étiquettes envoyées par les téléphones.
   - Un clic droit sur l'icône de la barre des tâches permet de voir le nombre d'étiquettes en attente, d'ouvrir le Poste d'impression, de mettre en pause l'impression automatique ou de quitter réellement via **« Quitter TOT Stock »** (`Ctrl+Q`).
3. Activez **« Lancer automatiquement à l'ouverture de session »** (désactivé par défaut) si vous souhaitez que TOT Stock démarre dès l'allumage du PC.

---

## 3. Notifications système natives

Dans l'application Bureau, des notifications natives Windows / macOS / Linux peuvent être affichées pour :
- Une **nouvelle commande urgente** à valider,
- Un **travail d'impression en échec** sur le Poste d'impression,
- Une **nouvelle alerte de rupture de stock critique**.

### Règles de confidentialité et anti-spam
- Aucune donnée personnelle ni prix d'achat n'est affiché dans les notifications.
- Le limiteur intégré plafonne les notifications à **1 par événement** et **5 par minute** au total.
- Cliquer sur la notification ramène la fenêtre TOT Stock au premier plan et émet la commande de navigation correspondante (`nav-*`) sur le canal IPC unique `tot:menu-command`.

---

## 4. Assistant d'import CSV d'articles en 3 étapes

Depuis la page **Inventaire** (bouton **« Importer CSV »**, réservé aux utilisateurs disposant de `perm_Add_Item`) :

1. **Étape 1 — Fichier & séparateur** :
   - Glissez-déposez un fichier `.csv` ou `.txt` (encodage **UTF-8** ou **Windows-1252** détecté automatiquement, séparateur `;` ou `,`).
   - Un bouton permet de télécharger un **modèle CSV pré-rempli**.
2. **Étape 2 — Correspondance des colonnes** :
   - Associez chaque colonne de votre fichier aux champs TOT Stock (`SKU / Référence`, `Nom`, `Code-barres`, `Catégorie`, `Sous-catégorie`, `Unité`, `Seuil d'alerte`, `Prix unitaire`, `Emplacement`, `Quantité initiale`, `Dépôt`).
3. **Étape 3 — Aperçu & contrôle avant import** :
   - Visualisez le nombre de **créations**, de **mises à jour** (si le SKU ou code-barres existe déjà), de **doublons** et d'**erreurs** ligne par ligne.
   - Vérification automatique du **quota de références de la licence** (`max_references`) avant l'écriture.
   - Neutralisation automatique des formules tableur dangereuses (`=`, `+`, `-`, `@` en début de texte) à l'import comme à l'export.
   - Téléchargement d'un **rapport d'import CSV** détaillé à la fin de l'opération.

---

## 5. Multi-fenêtres (second écran)

Depuis le menu natif **Fenêtre → Nouvelle fenêtre** (`Ctrl+Maj+N`) ou le bouton **« Ouvrir dans une fenêtre dédiée »** du Poste d'impression :
- Vous pouvez ouvrir jusqu'à **3 fenêtres** simultanées (ex. **Inventaire** sur l'écran principal et **Poste d'impression** ou **Préparation** sur un second écran).
- Les fenêtres partagent la même session et synchronisent le dépôt actif via `BroadcastChannel`.
- L'élection de chef de file via l'API **Web Locks** (`navigator.locks`) garantit qu'une seule fenêtre réclame et imprime chaque travail du Poste d'impression, sans jamais imprimer en double.

---

## 6. Architecture des canaux IPC, commandes et routes internes (v34)

Un **seul canal IPC par usage** est utilisé entre le processus principal (`desktop/main.mjs`), le script de préchargement (`desktop/preload.cjs`) et le pont frontend (`src/services/desktopBridge.ts`) :

| Usage | Canal IPC | Direction | Pont (`window.totDesktop`) | Validation (`desktop/security.mjs`) |
| :--- | :--- | :--- | :--- | :--- |
| Commandes d'interface (menu natif, barre des tâches / tray, clic sur notification) | `tot:menu-command` | Main → Renderer | `onMenuCommand(cb)` / `subscribeDesktopMenuCommand` | `isAllowedDesktopCommand(cmd)` (`ALLOWED_DESKTOP_COMMANDS`) |
| Ouverture d'une fenêtre secondaire | `tot:open-secondary-window` | Renderer → Main | `openSecondaryWindow(route)` | `sanitizeInternalRoute(route, 'inventory')` (`ALLOWED_INTERNAL_ROUTES`) |
| Affichage d'une notification native | `tot:show-notification` | Renderer → Main | `showNotification(payload)` | `sanitizeNotificationPayload(payload)` + `routeToDesktopCommand(route)` au clic |
| Mise à jour du statut de la barre des tâches | `tot:update-tray-status` | Renderer → Main | `updateTrayStatus(status)` | Nombre d'étiquettes en attente + état de pause |
| Changement de langue du menu natif | `tot:set-menu-locale` | Renderer → Main | `setMenuLocale(locale)` | `'fr' \| 'en' \| 'nl'` |

### Liste canonique des routes internes (`ALLOWED_INTERNAL_ROUTES`)
Définie dans `desktop/security.mjs` et partagée avec `src/services/desktopBridge.ts` et `src/desktop/DesktopShell.tsx` :
- `dashboard`
- `inventory`
- `movements`
- `orders`
- `preparation`
- `print_station`
- `settings`

### Liste canonique des commandes IPC (`ALLOWED_DESKTOP_COMMANDS`)
Chaque commande émise par `desktop/main.mjs` (menu natif, menu tray ou clic sur notification) appartient à cette liste unique et est prise en charge dans `src/desktop/DesktopShell.tsx` :
- `new-product` (`CmdOrCtrl+N`) : Nouvel article
- `new-movement` (`CmdOrCtrl+M`) : Nouveau mouvement de stock
- `new-order` (`CmdOrCtrl+Shift+O`) : Nouvelle commande matériel
- `import-csv` (`CmdOrCtrl+I`) : Assistant d'import CSV d'inventaire
- `export-csv` (`CmdOrCtrl+E`) : Export CSV immédiat de l'inventaire
- `print-labels` (`CmdOrCtrl+P`) : Fenêtre d'impression d'étiquettes
- `focus-search` (`CmdOrCtrl+F`) : Focus sur la recherche d'inventaire
- `command-palette` (`CmdOrCtrl+K`) : Palette de commandes rapides
- `refresh-data` (`CmdOrCtrl+R`) : Synchronisation des données avec Supabase
- `toggle-sidebar` (`CmdOrCtrl+B`) : Réduire / étendre la barre latérale
- `toggle-print-pause` (Menu Tray) : Mettre en pause / reprendre le Poste d'impression
- `open-shortcuts` (`CmdOrCtrl+/`) : Aide des raccourcis clavier
- `open-docs` (Menu Aide) : Ouvrir `Paramètres → Documentation`
- `open-about` (Menu Aide) : Ouvrir `Paramètres → À propos & Installeurs`
- `nav-dashboard` (`Alt+1` / clic notification `dashboard`) : Ouvrir le Tableau de bord
- `nav-inventory` (`Alt+2` / clic notification `inventory`) : Ouvrir l'Inventaire
- `nav-movements` (`Alt+3` / clic notification `movements`) : Ouvrir les Mouvements
- `nav-orders` (`Alt+4` / clic notification `orders`) : Ouvrir les Commandes
- `nav-preparation` (`Alt+5` / clic notification `preparation`) : Ouvrir la Préparation
- `nav-print-station` (`Alt+6` / Menu Fenêtre / Menu Tray / clic notification `print_station`) : Ouvrir le Poste d'impression
- `nav-settings` (`Alt+7` / clic notification `settings`) : Ouvrir les Paramètres

