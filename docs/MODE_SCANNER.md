# Mode Scanner — Préparation de commande mobile (v29)

Ce document décrit le **Mode Scanner** plein écran conçu pour les préparateurs (magasiniers) sur téléphone, son flux de picking ligne par ligne, son fonctionnement hors ligne en entrepôt et la gestion des conflits de synchronisation.

---

## 1. Accès et droits

- **Utilisateurs autorisés** : Le Mode Scanner est proposé uniquement aux utilisateurs pour lesquels `isPreparer` est vrai (ou rôles `0` / `1` Super-Admin / Admin) et qui disposent de la permission `perm_menu_order_prep`.
- **Cloisonnement par dépôt** : Un préparateur ne voit que les commandes des dépôts figurant dans son `allowed_depots` (sauf rôles `0`/`1` ou `perm_orders_manage`).
- **Points d'entrée** :
  1. Menu **Plus** → section **Commandes Matériel & Préparations** → bouton **« Mode Scanner »**.
  2. Fenêtre **Préparation des Commandes Magasin** (`OrdersPreparationModal`) → bouton **« Mode Scanner »** dans l'en-tête principal et dans la barre du Mode Focus.
- **Écran maintenu allumé (Wake Lock)** : Tant que le Mode Scanner est ouvert, l'application active l'API `navigator.wakeLock.request('screen')` (si supportée par l'appareil) afin d'éviter l'extinction de l'écran pendant le tour de magasin.

---

## 2. Les 3 écrans du Mode Scanner

### Écran 1 — Commandes à préparer
- Affiche les commandes à traiter sous forme de cartes lisibles à une main : numéro de commande, chantier, demandeur, nombre de lignes traitées / total, heure de création, dépôt et état (**À préparer**, **En cours par moi**, **Prise par un autre**).
- **Ordre de tri** :
  1. Commandes déjà **En cours par moi** (`PREPARING` assignées au préparateur connecté) en tête.
  2. Puis les commandes **les plus anciennes d'abord** (`created_at` croissant, FIFO).
- **Recherche et filtre** : Recherche instantanée (numéro, chantier, demandeur, référence) et filtre par dépôt lorsque le préparateur a accès à plusieurs dépôts.
- **Scan direct d'un bon de commande** : Scanner un QR code `TOT-ORDER:<numéro>` ouvre immédiatement la commande correspondante.
- **Prise en charge** : Le bouton **« Prendre en charge »** appelle `assignOrderToMe`. Si la commande vient d'être prise par un autre magasinier, un message explicite s'affiche et la liste est rafraîchie.

### Écran 2 — Picking (une seule ligne à la fois)
- **Tournée optimisée par emplacement** : Les lignes non traitées sont présentées une par une par ordre naturel croissant d'emplacement (`rack_location` : `A2` avant `A10`), puis par désignation. Les articles sans emplacement sont placés à la fin.
- **Affichage haute visibilité** : Emplacement (`rack_location`), dépôt, référence, désignation, marque et **quantité demandée en très grand format** avec son unité, ainsi qu'une barre de progression `X / Y`.
- **Caméra ouverte en continu** en bas d'écran avec protection **anti-doublon de 1,5 seconde** (deux lectures identiques à moins de 1500 ms sont ignorées).
- **Réactions au scan** :
  - **Bon article (`EXPECTED_ITEM`)** : Flash vert, bip aigu et vibration courte.
    - Si quantité demandée = `1` : validation immédiate et passage automatique à la ligne suivante.
    - Si quantité demandée > `1` : affichage du sélecteur de quantité pré-rempli à la quantité demandée (boutons `-` / `+`, saisie directe, bouton **Valider**).
    - Si quantité encodée < quantité demandée : demande de confirmation *« Quantité partielle : X sur Y. Le reste sera marqué manquant. Confirmer ? »*.
  - **Autre ligne de la même commande (`OTHER_ORDER_ITEM`)** : Flash orange, message *« Cet article est sur une autre ligne de la commande »* et bouton **« Traiter cette ligne maintenant »**.
  - **Article du catalogue hors commande (`CATALOG_SUBSTITUTE_CANDIDATE`)** : Flash rouge, double bip grave, vibration longue, message *« Mauvais article : [nom] »* et bouton **« Utiliser comme remplaçant »**.
  - **Code inconnu (`UNKNOWN_CODE`)** : Flash rouge, double bip grave et message *« Code inconnu : [code] »*.
- **Actions rapides sur la ligne** :
  - **Manquant** : marque la ligne indisponible (`updateOrderItemAvailability`) avec motif optionnel.
  - **Remplacer** : permet de scanner ou rechercher un article de substitution (`substituteOrderItem`).
  - **Passer** : reporte la ligne à la fin de la tournée de picking.
  - **Lampe** : active/désactive la torche de la caméra si supportée.
  - **Saisie manuelle** : permet de taper la référence si l'étiquette est abîmée.
  - **Annuler la dernière prise** : annule le dernier pointage (`unpickOrderItem`) en cas d'erreur.
- **Tiroir « Voir toutes les lignes »** : volet repliable permettant de visualiser l'ensemble des lignes de la commande et leur statut.

### Écran 3 — Fin de commande
- Récapitulatif : nombre de lignes **prises**, **manquantes** et **remplacées**.
- Choix de la **zone de retrait** (`pickup_zone`) avec puces rapides (*Étagère A1*, *Palette Zone Retrait*, *Comptoir Magasin*).
- Bouton **« Commande prête »** (`markOrderReady`) : disponible uniquement lorsque toutes les lignes sont traitées (`canFinishOrder(order) === true`) et que l'appareil est connecté.
- Affichage du **QR code de retrait** (`TOT-ORDER:<numéro>`) et bouton **« Commande suivante »**.

---

## 3. Fonctionnement hors ligne (entrepôt sans réseau)

### 3.1 Ce qui fonctionne hors ligne vs ce qui exige du réseau
- **En ligne obligatoire** :
  - **Prendre en charge** une nouvelle commande (`assignOrderToMe`), afin d'éviter que deux préparateurs prennent la même commande hors ligne.
  - **Marquer « Commande prête »** (`markOrderReady`), car cette étape notifie le demandeur et génère le bon de retrait définitif.
- **Autorisé hors ligne** (pour une commande déjà assignée au préparateur connecté) :
  - Pointer un article scanné (`PICK_ITEM`),
  - Marquer une ligne manquante (`MARK_UNAVAILABLE`),
  - Remplacer un article (`SUBSTITUTE_ITEM`),
  - Annuler une prise (`UNPICK_ITEM`).

### 3.2 File d'attente persistante et idempotence
- Chaque action effectuée hors ligne possède un identifiant unique (`id`), un `order_id`, un `type`, une charge utile et un horodatage `created_at`.
- La file est persistée dans `IndexedDB` (`tot_stock_offline_db` → `sync_metadata` clé `scanner_offline_queue_v1`) avec miroir de secours dans `localStorage` (`tot_scanner_offline_queue_v1`) : elle survit à la fermeture ou au rechargement de l'application.
- Un bandeau permanent indique **« Hors ligne — X actions en attente »** puis **« Synchronisé »** une fois la file vidée.
- **Idempotence** : rejouer deux fois la même action `PICK_ITEM`, `MARK_UNAVAILABLE`, `SUBSTITUTE_ITEM` ou `UNPICK_ITEM` applique l'état cible exact de la ligne et **ne double jamais la quantité pointée**.

### 3.3 Gestion des conflits au retour du réseau
Au retour de la connexion, les actions en attente sont rejouées dans l'ordre chronologique. Avant d'appliquer les actions d'une commande, l'application vérifie l'état serveur de la commande :
1. **Commande annulée ou supprimée** (`ORDER_CANCELLED`),
2. **Commande réassignée à un autre préparateur** (`TAKEN_BY_OTHER`),
3. **Commande déjà marquée prête ou retirée** (`ALREADY_COMPLETED`).

En cas de conflit :
- L'application **n'écrase jamais** l'état du serveur.
- Les actions locales en conflit sont conservées de côté et un bandeau d'alerte explicite **« Conflit sur la commande X »** propose deux choix au préparateur :
  - **« Abandonner mes actions »** (supprime les actions locales en conflit pour cette commande),
  - **« Voir la commande »** (ouvre la commande pour inspecter son état).

### 3.4 Nettoyage de sécurité
Lors d'une déconnexion complète avec effacement de l'appareil ou au 5e échec consécutif de code PIN (`wipeDeviceLocalData`), la file d'attente du Mode Scanner est intégralement purgée via `clearScannerOfflineQueue()`.
