# Guide d'utilisation — Poste d'impression à distance (PC / Magasin)

Ce guide explique comment recevoir et imprimer sur un PC (au bureau ou au magasin) les étiquettes envoyées depuis un téléphone en **Mode Scanner**.

---

## 1. À quoi sert le Poste d'impression ?

Lorsque le magasinier prépare une commande sur son téléphone en **Mode Scanner**, il n'a pas besoin d'imprimante connectée au téléphone. Il peut demander à distance :
1. **Une étiquette produit** (si l'étiquette d'un article ou d'un bac en rayon est abîmée ou absente) ;
2. **Une étiquette de commande prête** (avec le numéro de commande, le chantier, le demandeur, l'emplacement de retrait et le code QR `TOT-ORDER:<numéro>`).

Le téléphone envoie la demande à la base Supabase de l'entreprise. Le PC du magasin, ouvert sur l'écran **Poste d'impression**, reçoit la demande en temps réel et lance l'impression avec le même rendu que les planches d'étiquettes habituelles.

---

## 2. Ouvrir et activer le Poste d'impression sur le PC

1. Sur le PC relié à l'imprimante (A4 ou étiqueteuse thermique), ouvrez **TOT Stock** et connectez-vous avec un compte disposant du droit **Impression d'étiquettes** (`perm_menu_print_labels`).
2. Allez dans l'onglet **Plus (•••)** puis cliquez sur **Poste d'impression**.
3. Renseignez :
   - **Nom du poste** (par exemple : `Imprimante Magasin Principal` ou `Bureau Logistique`) ;
   - **Dépôt rattaché** (ou *Tous les dépôts autorisés*).
4. Cliquez sur **Activer ce poste d'impression**.
5. Un point vert **En ligne** s'affiche. **Laissez cet onglet ouvert** sur le PC : tant qu'il est ouvert, le poste signale sa présence toutes les 30 secondes et reçoit les demandes des téléphones.

---

## 3. Deux modes d'impression sur le PC

### Mode par défaut (recommandé sans réglage particulier)
- Quand un téléphone envoie une étiquette, le PC émet un **bip sonore**, fait clignoter le titre de l'onglet et affiche **« X étiquette(s) en attente »**.
- Cliquez sur le bouton **Imprimer maintenant** : la fenêtre d'impression du navigateur s'ouvre, prête à imprimer.
- Cliquez ensuite sur **Confirmer : Imprimé OK** (ou **Signaler un échec** si l'imprimante manquait de papier).

### Mode automatique (impression directe dès réception)
Par sécurité, un navigateur web standard affiche toujours une boîte de dialogue avant d'imprimer.
Pour que le PC imprime **tout seul sans cliquer** dans la boîte de dialogue système, il faut lancer Google Chrome ou Microsoft Edge avec l'option `--kiosk-printing`.

#### Procédure Windows pas à pas :
1. **Choisir l'imprimante par défaut dans Windows** :
   - Ouvrez **Paramètres Windows** → **Bluetooth et appareils** → **Imprimantes et scanners**.
   - Sélectionnez l'imprimante voulue (votre imprimante A4 ou votre imprimante thermique d'étiquettes) et cliquez sur **Définir par défaut**.
   - *(Pensez à décocher « Laisser Windows gérer mon imprimante par défaut » si cette option est activée).*
2. **Créer un raccourci Chrome dédié sur le Bureau** :
   - Faites un clic droit sur le Bureau Windows → **Nouveau** → **Raccourci**.
   - Dans l'emplacement de l'élément, collez la ligne suivante (avec les guillemets) :
     ```text
     "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --user-data-dir="C:\TOTStockPrintProfile" https://votre-adresse-tot-stock
     ```
   - Nommez le raccourci **TOT Stock — Poste d'impression**.
3. **Activer l'option dans l'application** :
   - Ouvrez TOT Stock via ce raccourci, allez dans **Plus → Poste d'impression**, activez le poste et cochez **« Imprimer automatiquement à réception »**.
   - Dès qu'un magasinier envoie une étiquette depuis son téléphone, elle sortira directement sur l'imprimante par défaut.

---

## 4. Que se passe-t-il si le PC est éteint ou fermé ?

- **Le poste doit rester ouvert** dans le navigateur du PC pour recevoir et imprimer les étiquettes.
- Si le PC est éteint ou si l'onglet est fermé, le téléphone voit le poste avec un point gris (**Hors ligne**).
- Les demandes envoyées restent en attente (`PENDING`) pendant **24 heures**. Si le PC est rallumé dans les 24 heures, il récupère les demandes en attente. Au-delà de 24 heures, les demandes non traitées expirent automatiquement pour éviter d'imprimer de vieilles étiquettes par surprise.
- Si le téléphone est **hors ligne** (sans réseau), l'impression à distance est refusée immédiatement (« Impression indisponible hors ligne ») : aucune étiquette n'est stockée en cache local sur le téléphone afin d'éviter des impressions surprises dix minutes plus tard.

---

## 5. Dépannage courant

| Problème constaté | Cause probable | Solution |
| :--- | :--- | :--- |
| Le téléphone affiche **« Aucun poste d'impression »** | Aucun PC n'a encore été enregistré ou le poste est rattaché à un autre dépôt. | Ouvrez **Plus → Poste d'impression** sur le PC, choisissez le bon dépôt et cliquez sur **Activer ce poste**. |
| Le poste apparaît **Hors ligne (point gris)** sur le téléphone | L'onglet Chrome du PC a été fermé, le PC est en veille, ou la connexion Internet du PC est coupée. | Rouvrez **Poste d'impression** sur le PC et désactivez la mise en veille automatique de Windows. |
| La boîte de dialogue d'impression s'affiche encore en mode automatique | Chrome n'a pas été lancé avec `--kiosk-printing` ou une fenêtre Chrome normale était déjà ouverte sur le même profil. | Utilisez le raccourci incluant `--kiosk-printing --user-data-dir="C:\TOTStockPrintProfile"` pour isoler la session d'impression. |
| L'étiquette sort sur la mauvaise imprimante en mode automatique | En mode `--kiosk-printing`, Chrome utilise toujours l'imprimante par défaut de Windows. | Définissez la bonne imprimante par défaut dans les paramètres Windows. |
| Les étiquettes sont coupées ou décalées sur planche Avery A4 | Les marges ou l'échelle d'impression du navigateur ont été modifiées. | Dans les paramètres d'impression du navigateur, réglez **Marges : Aucune (ou Par défaut)** et **Échelle : 100 %**. |
