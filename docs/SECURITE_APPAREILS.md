# Sécurité des appareils (perte, vol et session locale)

Ce document décrit les mécanismes de protection intégrés à TOT Stock sur les appareils mobiles et navigateurs, leurs limites techniques actuelles, les mesures recommandées côté client et la procédure à suivre en cas de perte ou de vol d'un téléphone.

---

## 1. Mécanismes de protection intégrés

### 1.1 Verrouillage automatique par inactivité (Auto-Lock)
- L'application surveille l'activité de l'utilisateur (`mousemove`, `mousedown`, `keydown`, `touchstart`, `scroll`).
- Par défaut, la session applicative est verrouillée après **5 minutes** d'inactivité (configurable dans **Mon Profil** : `1`, `3`, `5`, `10`, `15` minutes ou désactivé).
- La date de dernière activité est également enregistrée dans `localStorage` (`tot_last_activity_ts`) : si l'application a été mise en arrière-plan au-delà du délai configuré, la session est immédiatement verrouillée au retour au premier plan.

### 1.2 Compteur d'échecs de code PIN (verrouillage au 5e échec)
- Le compteur d'échecs consécutifs est stocké localement sur l'appareil (`tot_pin_failed_attempts`).
- Il est remis à `0` dès qu'une connexion par code PIN réussit.
- **Au 5e échec consécutif de code PIN** :
  1. L'application ferme la session Supabase (`supabase.auth.signOut()`).
  2. Le cache local de l'application (`localStorage` et `IndexedDB`) est intégralement effacé.
  3. L'utilisateur doit se ré-authentifier auprès du serveur.

### 1.3 Vérification du compte à chaque reprise de l'application
- À chaque retour de l'application au premier plan (`visibilitychange` vers `visible`, événement Capacitor `resume`, ou reprise de focus fenêtre) :
  - **En ligne** : l'application relit l'état du profil utilisateur sur Supabase (`users.is_blocked`) et vérifie la validité de la session. Si l'utilisateur est **bloqué** (`is_blocked = true`), **supprimé** ou **introuvable**, l'application appelle `signOut()` et efface immédiatement le cache local de l'appareil.
  - **Hors ligne** : l'application applique le verrouillage normal par inactivité.

### 1.4 Bouton « Se déconnecter et effacer les données de cet appareil »
Dans le menu **Mon Profil**, l'utilisateur dispose du bouton **« Se déconnecter et effacer les données de cet appareil »** (avec demande de confirmation). Cette action :
1. Appelle `supabase.auth.signOut()` pour révoquer la session locale.
2. Supprime toutes les clés `localStorage` commençant par `tot_`, `tqt_` et `sb-` (jetons de session Supabase).
3. Vide et supprime la base `IndexedDB` locale (`tot_stock_offline_db`).
4. Recharge l'application.

### 1.5 Durcissement RLS côté serveur et purge des règles anciennes
Lors de l'installation ou de la mise à jour des scripts SQL (`02_rls_hardening.sql`, `05_rpc_admin_users.sql`, `07_app_compat.sql`, `08_print_jobs.sql` ou `dist/install.sql`), toutes les politiques RLS existantes (`pg_policies`) sur chaque table protégée sont intégralement purgées avant la recréation des politiques attendues. **Après rejeu des scripts, aucune règle ancienne ne subsiste** (ni règle ouverte `USING (true)` pour `public`/`anon`, ni règle récursive sur `public.users`). Le contrôle `permissive_rls_policies` de `public.diagnostic_installation()` vérifie l'absence de toute règle permissive résiduelle.

---

## 2. Liste exacte des clés `localStorage` et bases `IndexedDB` effacées

### 2.1 Clés `localStorage` supprimées
Toutes les clés portant les préfixes **`tot_`**, **`tqt_`** ou **`sb-`** sont supprimées, notamment :
- `tot_session_user` : profil de l'utilisateur connecté en session
- `tot_auto_logout_min` : délai de verrouillage automatique
- `tot_last_activity_ts` : horodatage de la dernière activité
- `tot_pin_failed_attempts` : compteur d'échecs consécutifs de code PIN
- `tot_local_device_pin_<userId>` : empreinte PBKDF2-SHA256 du code PIN local de l'appareil
- `tot_cached_users`, `tot_cached_roles`, `tot_cached_depots`, `tot_cached_products`, `tot_cached_departments`, `tot_cached_projects`, `tot_cached_sub_categories`, `tot_cached_orders`, `tot_cached_movements` : caches métier hors ligne
- `tot_order_baskets_v1_<userId>`, `tot_active_order_basket_v1_<userId>` : paniers de commandes en cours
- `tot_stored_activities` : journal d'activité local
- `tot_client_supabase_url`, `tot_client_supabase_anon_key` : configuration du serveur d'entreprise (lors d'une réinitialisation complète)
- `tot_license_token`, `tot_company_settings` : cache de licence et paramètres
- `tot_haptics_enabled`, `tot_haptic_intensity`, `tot_sound_enabled`, `tot_scanner_sound_enabled`, `tot_scanner_vibration_enabled`, `tot_theme`, `tot_lang` : préférences locales de l'appareil
- `tot_scanner_offline_queue_v1` : file d'attente locale des actions du Mode Scanner hors ligne (intégralement purgée à la déconnexion complète ou au 5e échec de PIN via `clearScannerOfflineQueue()`)
- `tqt_*` : clés héritées d'anciennes versions
- `sb-<project-ref>-auth-token` : jeton de session Supabase Auth stocké par le SDK

### 2.2 Base `IndexedDB` supprimée
Base de données **`tot_stock_offline_db`** et l'intégralité de ses **11 magasins d'objets (object stores)** :
1. `products` (catalogue d'articles en cache)
2. `stock_movements` (historique des mouvements en cache)
3. `material_orders` (commandes matériel en cache)
4. `depots` (dépôts et véhicules en cache)
5. `users` (liste des profils utilisateurs en cache)
6. `roles` (rôles et permissions en cache)
7. `departments` (départements en cache)
8. `projects` (chantiers/projets en cache)
9. `sub_categories` (sous-catégories en cache)
10. `sync_queue` (file d'attente des opérations hors ligne non synchronisées)
11. `sync_metadata` (métadonnées de synchronisation et file d'attente persistante `scanner_offline_queue_v1` du Mode Scanner)

---

## 3. Limites techniques actuelles et mesures recommandées côté client

### Limites actuelles
- **Cache hors ligne non chiffré au niveau applicatif** : les données mises en cache dans `localStorage` et `IndexedDB` (`tot_stock_offline_db`) sont stockées en clair dans l'espace privé de l'application (sandbox WebView / navigateur).
- **Jeton de session dans `localStorage`** : le SDK Supabase conserve le jeton de session (`sb-*-auth-token`) dans `localStorage` pour permettre le fonctionnement hors ligne et la reprise de session.

### Mesures recommandées côté client
1. **Verrouillage d'écran obligatoire** : imposer un code PIN système, un schéma ou la biométrie sur chaque téléphone professionnel ou BYOD.
2. **Chiffrement de l'appareil** : s'assurer que le chiffrement matériel du stockage (activé par défaut sur Android moderne via File-Based Encryption) est actif et que le téléphone n'est pas « rooté ».
3. **Délai d'inactivité court** : régler le verrouillage automatique de TOT Stock sur **1 à 5 minutes** pour les appareils utilisés sur chantier.
4. **Appareils partagés** : utiliser le bouton **« Se déconnecter et effacer les données de cet appareil »** lorsqu'un opérateur rend un terminal partagé.

---

## 4. Procédure en cas de perte ou de vol d'un téléphone

Si un collaborateur signale la perte ou le vol de son téléphone :

1. **Bloquer immédiatement l'utilisateur dans l'administration TOT Stock** :
   - Ouvrir **Utilisateurs & Rôles** avec un compte Administrateur.
   - Sélectionner l'utilisateur concerné et activer l'option **Bloquer le compte** (`is_blocked = true`).
   - Effet immédiat côté serveur : les politiques RLS et les RPC refusent toute écriture ou lecture sensible de cet utilisateur.
   - Effet sur l'appareil perdu : dès que l'application repasse au premier plan avec une connexion réseau, elle détecte le statut bloqué, ferme la session Supabase et efface intégralement le cache local (`localStorage` + `IndexedDB`).
2. **Réinitialiser le code PIN et le mot de passe de l'utilisateur** :
   - Depuis **Utilisateurs & Rôles**, modifier le code PIN (et le mot de passe Auth si applicable) afin que l'ancien code PIN ne puisse plus être utilisé.
3. **Effacement à distance Android (Find My Device / MDM)** :
   - Si le téléphone est géré par une flotte MDM ou associé à un compte Google professionnel, déclencher l'effacement à distance de l'appareil Android.
