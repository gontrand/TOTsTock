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

> **Sécurité réseau (protection SSRF) :** Le processus principal Electron vérifie strictement que l'adresse IP appartient à une plage privée locale RFC 1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) et que le port est compris entre `9100` et `9102`. Les adresses publiques, `localhost` / `127.0.0.1` et les noms d'hôtes arbitraires sont refusés. Une seule connexion TCP (délai maximal 5 secondes) est ouverte à la fois par imprimante.

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
   - Un clic droit sur l'icône de la barre des tâches permet de voir le nombre d'étiquettes en attente, de mettre en pause l'impression automatique ou de quitter réellement via **« Quitter TOT Stock »** (`Ctrl+Q`).
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
- Cliquer sur la notification ramène la fenêtre TOT Stock au premier plan et ouvre directement la section interne concernée (`Commandes`, `Poste d'impression` ou `Inventaire`).

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
