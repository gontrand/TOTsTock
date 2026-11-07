# Épinglage de certificat Android (Certificate Pinning) — Optionnel

Ce document explique le fonctionnement du fichier `android/app/src/main/res/xml/network_security_config.xml` dans TOT Stock et la marche à suivre si un client souhaite activer l'épinglage de certificat TLS (*Certificate Pinning*).

---

## 1. Protection active par défaut (sans épinglage)

Sur Android (ici `targetSdkVersion = 36`, bien au-dessus de Android 7 / API 24), l'application applique déjà les règles suivantes via `network_security_config.xml` :
- **Aucun trafic en clair (`cleartextTrafficPermitted="false"`)** : toutes les connexions HTTP non chiffrées sont rejetées par le système.
- **Autorités système uniquement (`<certificates src="system" />`)** : l'application refuse les certificats racines installés manuellement par l'utilisateur ou par un proxy d'inspection sur le téléphone.
- **Aucun `pin-set` par défaut** : l'installation standard fonctionne avec n'importe quel projet Supabase (`*.supabase.co` ou domaine personnalisé HTTPS) sans risque de coupure lors du renouvellement automatique des certificats TLS.

---

## 2. Quand activer l'épinglage de certificat (`pin-set`) ?

L'épinglage de certificat **ne doit pas** être activé pour une diffusion générale ou multi-clients.

Activez-le **uniquement** dans le cas suivant :
- Un client grand compte ou soumis à des exigences de sécurité strictes dispose d'une instance dédiée (et d'une APK dédiée compilée pour lui) et exige contractuellement l'épinglage TLS.

---

## 3. Comment obtenir les empreintes SHA-256 (certificat intermédiaire + clé de secours)

> **Règle essentielle : n'épinglez jamais uniquement le certificat feuille (leaf certificate) du serveur.**
> Les certificats feuille de Supabase / Let's Encrypt / Cloudflare sont renouvelés automatiquement tous les 60 à 90 jours. Épingler la clé de l'autorité de certification **intermédiaire** (CA intermédiaire) assortie d'une **seconde autorité de secours (backup)** évite de bloquer l'application à chaque renouvellement trimestriel.

### A. Récupérer la chaîne de certificats du serveur et calculer l'empreinte SHA-256 de l'intermédiaire

Remplacez `abcd1234.supabase.co` par le domaine réel du client :

```bash
# Afficher la chaîne complète de certificats (0 = feuille, 1 = intermédiaire, 2 = racine)
openssl s_client -showcerts -servername abcd1234.supabase.co -connect abcd1234.supabase.co:443 </dev/null
```

1. Copiez le **deuxième bloc** `-----BEGIN CERTIFICATE----- ... -----END CERTIFICATE-----` (le certificat intermédiaire, niveau `1`) dans un fichier `intermediate.pem`.
2. Calculez l'empreinte SHA-256 en Base64 de sa clé publique (SPKI) :

```bash
openssl x509 -in intermediate.pem -pubkey -noout \
  | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 -binary \
  | openssl enc -base64
```

### B. Prévoir une deuxième épingle de secours (Backup Pin)

Récupérez de la même manière l'empreinte SHA-256 :
- soit du certificat racine (`level 2`) ou de la seconde autorité intermédiaire de secours de l'hébergeur (par exemple Let's Encrypt E5 / E6 / R10 / R11 ou Cloudflare Backup CA),
- soit d'une clé privée de secours conservée hors ligne si vous gérez votre propre serveur reverse-proxy.

---

## 4. Exemple de configuration `pin-set` avec date d'expiration

Dans `android/app/src/main/res/xml/network_security_config.xml`, ajoutez un bloc `<domain-config>` **toujours accompagné d'un attribut `expiration="AAAA-MM-JJ"`** (après cette date, Android revient à la validation système normale au lieu de bloquer définitivement l'application) :

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>

    <!-- Exemple optionnel pour un client dédié -->
    <domain-config cleartextTrafficPermitted="false">
        <domain includeSubdomains="true">abcd1234.supabase.co</domain>
        <pin-set expiration="2027-06-01">
            <!-- Épingle 1 : Clé publique du certificat intermédiaire actuel -->
            <pin digest="SHA-256">AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=</pin>
            <!-- Épingle 2 (obligatoire) : Clé publique de secours (Backup CA) -->
            <pin digest="SHA-256">BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=</pin>
        </pin-set>
    </domain-config>
</network-security-config>
```

---

## 5. Risques et prérequis techniques (`CapacitorHttp`)

### Risque de blocage (brikage réseau)
Si le fournisseur cloud change d'autorité de certification et qu'**aucune** des épingles configurées dans `<pin-set>` ne correspond plus à la chaîne présentée par le serveur, **l'application ne pourra plus du tout joindre le serveur** tant qu'une nouvelle APK n'aura pas été compilée, signée et installée sur chaque téléphone.
- **Recommandation** : n'activez jamais `pin-set` sans au moins **deux épingles** (intermédiaire + secours), définissez toujours une date `expiration="AAAA-MM-JJ"` raisonnable, et testez sur un appareil réel avant toute diffusion.

### Condition d'application : pile réseau native et `CapacitorHttp`
Sur Android, la directive `<pin-set>` de `network_security_config.xml` s'applique aux requêtes passant par la **pile réseau native Android** (`HttpsURLConnection` / `OkHttp`), ainsi qu'à la WebView selon l'implémentation Chromium du système.

Dans la configuration actuelle de TOT Stock (`capacitor.config.ts`), le plugin **`CapacitorHttp` n'est pas activé** : les appels `fetch()` du client JavaScript Supabase passent directement par la WebView.
Si vous souhaitez garantir l'application stricte du `pin-set` par la pile native Android :
1. Activez `CapacitorHttp` dans `capacitor.config.ts` (`plugins: { CapacitorHttp: { enabled: true } }`).
2. **Testez intégralement l'application sur un vrai téléphone** avant mise en production :
   - connexion et rafraîchissement de session Supabase,
   - synchronisation du catalogue, des mouvements et des commandes,
   - scan code-barres / QR code,
   - appel des Edge Functions (`APP_TOT-Stock_admin-users`, `APP_TOT-Stock_licenses_sync-license`, `APP_TOT-Stock_send-report-email`).
