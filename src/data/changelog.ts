export interface ChangelogEntry {
  version: string;
  schemaVersion: string;
  date: string;
  title: {
    fr: string;
    en: string;
    nl: string;
  };
  highlights: {
    fr: string[];
    en: string[];
    nl: string[];
  };
}

/**
 * Nouveautés des 5 dernières versions de TOT Stock (affichées dans la page « À propos »).
 */
export const RECENT_CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: '5.16.1',
    schemaVersion: '2.10.0',
    date: '2026-11-10',
    title: {
      fr: 'Validation des commandes par permission, duplication de rôle, cadre de fenêtre moderne & poste d’impression permanent',
      en: 'Permission-based order approval, role duplication, modern window frame & always-on print station',
      nl: 'Bestelgoedkeuring op basis van rechten, rol dupliceren, modern venster & permanent afdrukstation',
    },
    highlights: {
      fr: [
        'La validation des commandes ne dépend plus d’un numéro de rôle : seules la permission « Valider ou Refuser une Commande » (et les responsables de département ou de chantier) comptent, avec contrôle du seuil côté serveur.',
        'Bouton « Dupliquer » pour créer un rôle à partir d’un rôle existant sans repartir de zéro.',
        'Cadre de fenêtre desktop moderne (barre de titre intégrée, menu ☰), panneau latéral de l’inventaire sans fiche modale superposée et poste d’impression actif en arrière-plan.',
      ],
      en: [
        'Order approval no longer depends on a role number: only the "Approve or reject an order" permission (and department or project managers) counts, with server-side threshold enforcement.',
        '"Duplicate" button to create a role from an existing one without starting from scratch.',
        'Modern desktop window frame (integrated title bar, ☰ menu), inventory side panel without a stacked modal, and print station running in the background.',
      ],
      nl: [
        'Bestelgoedkeuring hangt niet meer af van een rolnummer: alleen het recht "Bestelling goedkeuren of weigeren" (en afdelings- of projectverantwoordelijken) telt, met drempelcontrole aan serverzijde.',
        'Knop "Dupliceren" om een rol te maken op basis van een bestaande rol.',
        'Modern desktopvenster (geïntegreerde titelbalk, ☰-menu), zijpaneel van de voorraad zonder gestapelde modal en afdrukstation dat op de achtergrond actief blijft.',
      ],
    },
  },
  {
    version: '5.16.0',
    schemaVersion: '2.10.0',
    date: '2026-11-14',
    title: {
      fr: 'Notifications lues par utilisateur, cartes commandes annulées/refusées & préparateurs limités à leurs dépôts',
      en: 'Per-user read notifications, cancelled/rejected order cards & preparers restricted to their depots',
      nl: 'Gelezen meldingen per gebruiker, kaarten voor geannuleerde/geweigerde bestellingen & orderpickers beperkt tot hun depots',
    },
    highlights: {
      fr: [
        'Notifications « lues » synchronisées par utilisateur (table core_notification_dismissals, RPC dismiss_notifications et clear_my_dismissals) avec repli hors-ligne local par compte et réapparition automatique si le statut de la commande évolue.',
        'Bouton « ✕ Marquer comme lue » sur chaque carte, « Tout marquer comme lu » dans l’en-tête et « Réinitialiser ma cloche » en pied de panneau.',
        'Cartes distinctes par type de notification (icône XCircle rose/ambre, numéro, motif et auteur pour les commandes annulées ou refusées, avec expiration automatique au-delà de 7 jours).',
        'Règle stricte des dépôts d’un préparateur (union allowed_depots ∪ stk_depot_holders, aucun dépôt si vide hors rôles 0/1) et alerte orange « Aucun dépôt attribué » sur la fiche utilisateur.',
      ],
      en: [
        'Per-user synchronized read notifications (core_notification_dismissals table, dismiss_notifications and clear_my_dismissals RPCs) with per-user offline fallback and automatic reappearance when order status changes.',
        '"✕ Mark as read" button on every card, "Mark all as read" in the header, and "Reset my bell" in the footer.',
        'Distinct cards per notification type (rose/amber XCircle icon, order number, reason, and author for cancelled or rejected orders, with automatic 7-day expiry).',
        'Strict preparer depot rule (union allowed_depots ∪ stk_depot_holders, no depots when empty for non-admin roles) and orange "No depot assigned" warning on user profiles.',
      ],
      nl: [
        'Per gebruiker gesynchroniseerde gelezen meldingen (tabel core_notification_dismissals, RPC’s dismiss_notifications en clear_my_dismissals) met lokale offline terugval per account en automatische terugkeer bij statuswijziging.',
        'Knop "✕ Markeren als gelezen" op elke kaart, "Alles markeren als gelezen" in de koptekst en "Mijn bel herstellen" in de voettekst.',
        'Onderscheidende kaarten per meldingstype (roze/amber XCircle-icoon, bestelnummer, reden en auteur voor geannuleerde of geweigerde bestellingen, met automatische vervaldatum na 7 dagen).',
        'Strikte depotregel voor orderpickers (vereniging allowed_depots ∪ stk_depot_holders, geen depots indien leeg voor niet-beheerders) en oranje waarschuwing "Geen depot toegewezen" op het gebruikersprofiel.',
      ],
    },
  },
  {
    version: '5.15.0',
    schemaVersion: '2.9.0',
    date: '2026-11-13',
    title: {
      fr: 'Sécurité clé Supabase, déconnexion automatique garantie, notifications ciblées & traçabilité des commandes',
      en: 'Supabase key security, guaranteed auto-logout, targeted notifications & order traceability',
      nl: 'Supabase-sleutelbeveiliging, gegarandeerde auto-uitlog, gerichte meldingen & besteltraceerbaarheid',
    },
    highlights: {
      fr: [
        'Lien « Mot de passe oublié ? » repositionné sous le champ mot de passe (zone tactile ≥ 44 px) et masquage définitif de la clé anon/publishable une fois la base connectée (remplacement protégé par PIN/mot de passe, rôle 0/1 et QR auto-masqué après 60 s).',
        'Déconnexion automatique obligatoire par horodatage (plafond société security_max_idle_minutes, immunisée contre la mise en veille, la caméra QR et le WakeLock, avec arrêt automatique des flux caméra).',
        'Notifications ciblées par identifiant utilisateur (préparateurs du dépôt, demandeur, enleveur désigné, destinataires de transfert) et préférences individuelles par type.',
        'Traçabilité complète du cycle de vie des commandes (création, prise en charge, lignes préparées, retrait, délégation/transfert d’enlèvement, annulation) dans les fiches commandes, le journal d’audit et les rapports.',
      ],
      en: [
        '"Forgot password?" link moved below the password field (≥ 44 px touch target) and permanent masking of the anon/publishable key once connected (replacement gated by PIN/password, role 0/1, and 60s auto-hidden config QR).',
        'Mandatory timestamp-based inactivity auto-logout (company ceiling security_max_idle_minutes, immune to sleep/background tabs, QR camera, and WakeLock, with automatic camera stream shutdown).',
        'Targeted notifications by user ID (depot preparers, requester, designated collector, transfer recipients) and per-type user preferences.',
        'Full order lifecycle traceability (creation, claim, prepared lines, pickup, pickup delegation/transfer, cancellation) across order details, audit log, and reports.',
      ],
      nl: [
        'Link "Wachtwoord vergeten?" verplaatst onder het wachtwoordveld (aanraakzone ≥ 44 px) en permanente maskering van de anon/publishable-sleutel na verbinding (vervanging beveiligd met PIN/wachtwoord, rol 0/1 en QR automatisch verborgen na 60 s).',
        'Verplichte automatische uitlog op basis van tijdstempel (bedrijfsplafond security_max_idle_minutes, ongevoelig voor slaapstand, QR-camera en WakeLock, met automatische uitschakeling van camerastreams).',
        'Gerichte meldingen op gebruikers-ID (depotvoorbereiders, aanvrager, aangewezen afhaler, overdrachtontvangers) en individuele voorkeuren per type.',
        'Volledige traceerbaarheid van de bestelcyclus (aanmaak, toewijzing, gepickte regels, afhaling, overdracht van afhaling, annulering) in bestelfiches, auditlogboek en rapporten.',
      ],
    },
  },
  {
    version: '5.14.0',
    schemaVersion: '2.8.0',
    date: '2026-11-12',
    title: {
      fr: 'Réinitialisation du mot de passe par code à 6 chiffres & correctifs Desktop / Licence',
      en: '6-digit code password reset & Desktop / License fixes',
      nl: 'Wachtwoordherstel via 6-cijferige code & Desktop / Licentie-correcties',
    },
    highlights: {
      fr: [
        'Fonction Edge dédiée APP_TOT-Stock_password-reset avec code à usage unique à 6 chiffres (valable 15 min, anti-bruteforce, révocation des sessions actives et journal d’audit immuable).',
        'Envoi d’un code de réinitialisation par e-mail depuis l’écran Utilisateurs & Rôles (rôles 0/1 ou perm_manage_users).',
        'Pont IPC presse-papiers Desktop (clipboard-sanitized-write) et utilitaire unifié copyToClipboard avec repli automatique.',
        'Validation stricte de la saisie de clé de licence et préservation des quotas signés en cas d’indisponibilité réseau du serveur de synchronisation.',
      ],
      en: [
        'Dedicated APP_TOT-Stock_password-reset Edge Function with 6-digit one-time code (15-min validity, anti-bruteforce, active session revocation, and immutable audit trail).',
        'Admin-initiated password reset code email from Users & Roles (roles 0/1 or perm_manage_users).',
        'Desktop clipboard IPC bridge (clipboard-sanitized-write) and unified copyToClipboard helper with automatic fallback.',
        'Strict license key input validation and preservation of signed license quotas when synchronization is temporarily unreachable.',
      ],
      nl: [
        'Speciale APP_TOT-Stock_password-reset Edge-functie met 6-cijferige eenmalige code (15 min geldig, anti-bruteforce, intrekken van actieve sessies en onveranderlijk auditlogboek).',
        'Verzenden van een herstelcode per e-mail door beheerders vanuit Gebruikers & Rollen (rollen 0/1 of perm_manage_users).',
        'Desktop klembord IPC-brug (clipboard-sanitized-write) en uniforme copyToClipboard-hulpfunctie met automatische terugval.',
        'Strikte validatie van licentiesleutelinvoer en behoud van ondertekende licentiequota bij tijdelijke onbereikbaarheid van de synchronisatieserver.',
      ],
    },
  },
  {
    version: '5.13.0',
    schemaVersion: '2.7.0',
    date: '2026-11-11',
    title: {
      fr: 'Listes déroulantes avec recherche instantanée (SearchableSelect) & correctifs v54b',
      en: 'Searchable Dropdowns (SearchableSelect) & v54b Fixes',
      nl: 'Keuzelijsten met directe zoekfunctie (SearchableSelect) & v54b-correcties',
    },
    highlights: {
      fr: [
        'Composant unique SearchableSelect remplaçant toutes les listes déroulantes de l’application (Desktop & Mobile) avec filtrage instantané insensible à la casse et aux accents, multi-mots, navigation clavier (↑/↓, Entrée, Échap) et mémorisation des 3 derniers dépôts.',
        'Correction de l’affichage de la licence dans « À propos » via getSavedLicense() et enforceSignedLicenseQuotasSync() (suppression de tot_stock_license_status_v1).',
        'Message explicite « Script SQL non à jour — exécutez install_v54.sql » lorsque search_login_logs est absent du cache de schéma.',
        'Normalisation systématique String(depot.id) entre stk_depots.id (bigint) et stk_depot_holders / stk_transfers.',
      ],
      en: [
        'Unified SearchableSelect component replacing all dropdowns across Desktop & Mobile with instant case- and accent-insensitive multi-word filtering, keyboard navigation (↑/↓, Enter, Escape), and 3-recent-depots memory.',
        'Fixed license display in the "About" panel using getSavedLicense() and enforceSignedLicenseQuotasSync() (removed tot_stock_license_status_v1).',
        'Clear message "SQL script outdated — run install_v54.sql" when search_login_logs is missing from schema cache.',
        'Consistent String(depot.id) normalization between stk_depots.id (bigint) and stk_depot_holders / stk_transfers.',
      ],
      nl: [
        'Uniform SearchableSelect-component dat alle keuzelijsten op Desktop & Mobiel vervangt met directe hoofdletter- en accentongevoelige zoekfunctie, toetsenbordnavigatie en onthouden van de 3 laatst gebruikte depots.',
        'Correcte weergave van de licentie in "Over" via getSavedLicense() en enforceSignedLicenseQuotasSync() (tot_stock_license_status_v1 verwijderd).',
        'Duidelijke melding "SQL-script verouderd — voer install_v54.sql uit" wanneer search_login_logs ontbreekt in de schemacache.',
        'Consistente String(depot.id)-normalisatie tussen stk_depots.id (bigint) en stk_depot_holders / stk_transfers.',
      ],
    },
  },
  {
    version: '5.12.0',
    schemaVersion: '2.7.0',
    date: '2026-11-10',
    title: {
      fr: 'Transferts validés à la réception, responsables de dépôt & droits fins',
      en: 'Validated Stock Transfers on Receipt, Depot Holders & Granular Permissions',
      nl: 'Gevalideerde overdrachten bij ontvangst, depotverantwoordelijken & fijne rechten',
    },
    highlights: {
      fr: [
        'Responsables multiples par dépôt (stk_depot_holders : envoi can_send et réception can_receive séparés) configurables dans la fiche dépôt.',
        'Workflow de transfert en 2 étapes avec séparation des tâches : send_stock_transfer (IN_TRANSIT), receive_stock_transfer ligne par ligne (RECEIVED, PARTIALLY_RECEIVED, REJECTED, AWAITING_SENDER), confirmation/contestation expéditeur et arbitrage des litiges (DISPUTED).',
        'Suivi « En transit : N » sur la fiche article, alerte visuelle > 48 h (list_overdue_transfers) et badge temps réel.',
        '3 nouvelles permissions fines (perm_stock_transfer_store, perm_stock_receive_all, perm_report_stock_levels) et RPC get_stock_levels_report.',
      ],
      en: [
        'Multiple holders per depot (stk_depot_holders: separate can_send and can_receive rights) configurable in the depot form.',
        'Two-step transfer workflow with segregation of duties: send_stock_transfer (IN_TRANSIT), line-by-line receive_stock_transfer (RECEIVED, PARTIALLY_RECEIVED, REJECTED, AWAITING_SENDER), sender confirmation/dispute, and dispute resolution (DISPUTED).',
        '"In transit: N" indicator on product details, > 48h overdue highlight (list_overdue_transfers), and real-time badge.',
        '3 new granular permissions (perm_stock_transfer_store, perm_stock_receive_all, perm_report_stock_levels) and get_stock_levels_report RPC.',
      ],
      nl: [
        'Meerdere verantwoordelijken per depot (stk_depot_holders: gescheiden verzend- en ontvangstrechten) instelbaar in het depotformulier.',
        'Overdrachtsworkflow in 2 stappen met functiescheiding: send_stock_transfer (IN_TRANSIT), regel-voor-regel receive_stock_transfer (RECEIVED, PARTIALLY_RECEIVED, REJECTED, AWAITING_SENDER), bevestiging/betwisting door verzender en geschillenbeslechting (DISPUTED).',
        '"In transit: N"-indicator op de productfiche, > 48u vertragingsmarkering (list_overdue_transfers) en realtime badge.',
        '3 nieuwe fijne machtigingen (perm_stock_transfer_store, perm_stock_receive_all, perm_report_stock_levels) en get_stock_levels_report RPC.',
      ],
    },
  },
  {
    version: '5.11.0',
    schemaVersion: '2.6.0',
    date: '2026-11-09',
    title: {
      fr: 'Journal d’audit serveur complet, immuabilité & suivi des connexions',
      en: 'Complete Server Audit Trail, Immutability & Login Monitoring',
      nl: 'Volledig Serverauditlogboek, Onveranderlijkheid & Aanmeldingsbewaking',
    },
    highlights: {
      fr: [
        'Triggers PostgreSQL automatiques sur 13 tables sensibles (diff ancienne -> nouvelle valeur dans meta.changes et masquage systématique des secrets en ***).',
        'Immuabilité stricte côté serveur (UPDATE et DELETE directs bloqués sur core_audit_logs et core_login_logs ; purge >= 90 jours réservée au Super Administrateur rôle 0).',
        'Suivi complet des connexions (LOGIN_SUCCESS, LOGOUT, SESSION_RESTORED limité à 1/h par appareil, LOGIN_FAILED sans secret) et alerte sur échecs répétés (>= 5).',
        'Nouvel écran « Journal d’audit » (Desktop + Mobile) avec filtres, panneau de différences avant/après, export CSV journalisé et double confirmation de purge.',
      ],
      en: [
        'Automatic PostgreSQL triggers on 13 sensitive tables (old -> new value diff in meta.changes and automatic secret masking as ***).',
        'Strict server-side immutability (direct UPDATE and DELETE blocked on core_audit_logs and core_login_logs; >= 90-day purge restricted to Super Admin role 0).',
        'Comprehensive login tracking (LOGIN_SUCCESS, LOGOUT, SESSION_RESTORED throttled to 1/hr per device, secret-free LOGIN_FAILED) and repeated failure alerts (>= 5).',
        'New "Audit Log" screen (Desktop + Mobile) with filters, before/after diff panel, audited CSV export, and double-confirmation purge.',
      ],
      nl: [
        'Automatische PostgreSQL-triggers op 13 gevoelige tabellen (oud -> nieuw verschil in meta.changes en automatische geheimmaskering als ***).',
        'Strikte server-side onveranderlijkheid (directe UPDATE en DELETE geblokkeerd op core_audit_logs en core_login_logs; >= 90 dagen wissen alleen voor Super Admin rol 0).',
        'Volledige aanmeldingsregistratie (LOGIN_SUCCESS, LOGOUT, SESSION_RESTORED max 1/uur per apparaat, LOGIN_FAILED zonder geheim) en melding bij herhaalde fouten (>= 5).',
        'Nieuw scherm "Auditlogboek" (Desktop + Mobiel) met filters, voor/na-verschilpaneel, gelogde CSV-export en dubbele bevestiging voor wissen.',
      ],
    },
  },
  {
    version: '5.10.0',
    schemaVersion: '2.5.0',
    date: '2026-11-08',
    title: {
      fr: 'Rapports Desktop (CSV / PDF / E-mail) & Recherche serveur Commandes / Mouvements',
      en: 'Desktop Reports (CSV / PDF / Email) & Server Search for Orders / Movements',
      nl: 'Desktop Rapporten (CSV / PDF / E-mail) & Serverzoekopdracht Bestellingen / Bewegingen',
    },
    highlights: {
      fr: [
        'Fenêtre locale par défaut de 7 jours (+ commandes actives) et recherche serveur paginée sur toute la base (search_material_orders & search_stock_movements).',
        'Nouvelle page Desktop « Rapports » avec générateurs partagés, Rapport Commandes et Rapport Mouvements.',
        'Exports CSV (UTF-8 avec BOM, séparateur ;) et PDF client (jsPDF + autoTable) avec en-tête société, filtres et totaux.',
        'Envoi de rapports par e-mail avec pièces jointes CSV/PDF en base64 (application rpt, validation serveur stricte et limite 3 Mo).',
      ],
      en: [
        'Default 7-day local window (+ active orders) and paginated full-database server search (search_material_orders & search_stock_movements).',
        'New Desktop "Reports" page with shared generators, Orders Report, and Movements Report.',
        'CSV (UTF-8 with BOM, ; separator) and client-side PDF (jsPDF + autoTable) exports with company header, filters, and totals.',
        'Email report dispatch with base64 CSV/PDF attachments (app rpt, strict server validation, and 3 MB limit).',
      ],
      nl: [
        'Standaard lokaal venster van 7 dagen (+ actieve bestellingen) en gepagineerde serverzoekopdracht (search_material_orders & search_stock_movements).',
        'Nieuwe Desktop-pagina "Rapporten" met gedeelde generatoren, Bestellingenrapport en Bewegingenrapport.',
        'CSV- (UTF-8 met BOM, ;-scheidingsteken) en client-side PDF-exports (jsPDF + autoTable) met bedrijfsnaam, filters en totalen.',
        'Rapportverzending per e-mail met base64 CSV/PDF-bijlagen (app rpt, strikte servervalidatie en 3 MB limiet).',
      ],
    },
  },
  {
    version: '5.9.1',
    schemaVersion: '2.4.1',
    date: '2026-11-07',
    title: {
      fr: 'Fournisseur Microsoft 365 (Graph OAuth2), mailing multi-fournisseurs & À propos complet',
      en: 'Microsoft 365 (Graph OAuth2) provider, multi-provider mailing & complete About page',
      nl: 'Microsoft 365 (Graph OAuth2) provider, multi-provider e-mail & volledige Over-pagina',
    },
    highlights: {
      fr: [
        'Nouveau fournisseur « Microsoft 365 (Graph) — recommandé pour Outlook » (OAuth2 client_credentials, Mail.Send, alerte d’expiration du secret 30 j avant).',
        'Comptes d’envoi multi-fournisseurs (Brevo, Resend, SendGrid, Mailgun, Postmark, Mailjet, Microsoft 365 Graph et SMTP) et expéditeur dédié par application (stk, hab, rpt, tools).',
        'Journal des envois (core_mail_log) fiabilisé (sender_email, user_id, limite 30/h), Vault obligatoire sans table en clair et erreurs Edge détaillées avec code HTTP.',
        'Page « À propos » complète (versions app/schéma attendu/réel, licence, fonctions Edge, chiffrement local, diagnostic copiable sans secret).',
      ],
      en: [
        'New "Microsoft 365 (Graph) — recommended for Outlook" provider (OAuth2 client_credentials, Mail.Send, 30-day secret expiration warning).',
        'Multi-provider mail accounts (Brevo, Resend, SendGrid, Mailgun, Postmark, Mailjet, Microsoft 365 Graph, and SMTP) and per-app sender (stk, hab, rpt, tools).',
        'Reliable mail dispatch log (core_mail_log: sender_email, user_id, 30/hr rate limit), mandatory Vault encryption, and detailed Edge errors with HTTP status.',
        'Complete "About" page (app/expected/actual schema versions, license, Edge functions, local encryption, secret-free diagnostic copy).',
      ],
      nl: [
        'Nieuwe provider "Microsoft 365 (Graph) — aanbevolen voor Outlook" (OAuth2 client_credentials, Mail.Send, waarschuwing 30 dagen vóór vervaldatum geheim).',
        'Multi-provider verzendaccounts (Brevo, Resend, SendGrid, Mailgun, Postmark, Mailjet, Microsoft 365 Graph en SMTP) en afzender per applicatie (stk, hab, rpt, tools).',
        'Betrouwbaar verzendlogboek (core_mail_log: sender_email, user_id, 30/uur limiet), verplichte Vault-versleuteling en gedetailleerde Edge-foutmeldingen met HTTP-code.',
        'Volledige pagina "Over" (app-/verwachte/werkelijke schemaversies, licentie, Edge-functies, lokale versleuteling, diagnostiek zonder geheimen).',
      ],
    },
  },
  {
    version: '5.8.0',
    schemaVersion: '2.3.0',
    date: '2026-11-06',
    title: {
      fr: 'Transfert de matériel entre dépôts par lot (multi-articles)',
      en: 'Multi-item batch stock transfer between depots',
      nl: 'Batch-materiaaloverdracht tussen depots (meerdere artikelen)',
    },
    highlights: {
      fr: [
        'RPC transactionnelle tout-ou-rien transfer_stock_batch (1 à 200 lignes, idempotente sur batch_id).',
        'Fenêtre de transfert multi-articles avec échange rapide ⇄, scan code-barres et import depuis le panier.',
        'File d’attente hors-ligne RPC_STOCK_TRANSFER_BATCH et regroupement visuel des lots dans les mouvements.',
      ],
      en: [
        'All-or-nothing transactional RPC transfer_stock_batch (1 to 200 lines, idempotent on batch_id).',
        'Multi-item transfer modal with quick depot swap ⇄, barcode scan, and cart import.',
        'Offline queue RPC_STOCK_TRANSFER_BATCH and visual batch grouping in movement history.',
      ],
      nl: [
        'Transactionele alles-of-niets RPC transfer_stock_batch (1 tot 200 regels, idempotent op batch_id).',
        'Overdrachtsvenster voor meerdere artikelen met snelle depotwissel ⇄, barcodescan en winkelwagenimport.',
        'Offline wachtrij RPC_STOCK_TRANSFER_BATCH en visuele groepering van batches in bewegingen.',
      ],
    },
  },
  {
    version: '5.7.0',
    schemaVersion: '2.2.0',
    date: '2026-11-06',
    title: {
      fr: 'Préférences utilisateur en base & sécurité des données locales',
      en: 'Database user preferences & local data security',
      nl: 'Gebruikersvoorkeuren in database & lokale gegevensbeveiliging',
    },
    highlights: {
      fr: [
        'Synchronisation des préférences d’interface entre appareils via core_user_preferences.',
        'Chiffrement local AES-GCM 256 (WebCrypto PBKDF2 / coffre natif) des données hors-ligne sensibles.',
        'Rejet strict des clés secrètes service_role côté navigateur et durcissement CSP.',
      ],
      en: [
        'Cross-device UI preferences synchronization via core_user_preferences.',
        'AES-GCM 256 local encryption (WebCrypto PBKDF2 / native vault) for sensitive offline data.',
        'Strict browser-side rejection of service_role secret keys and CSP hardening.',
      ],
      nl: [
        'Synchronisatie van UI-voorkeuren tussen apparaten via core_user_preferences.',
        'Lokale AES-GCM 256-versleuteling (WebCrypto PBKDF2 / native kluis) voor gevoelige offline gegevens.',
        'Strikte weigering van service_role-geheime sleutels in de browser en CSP-versterking.',
      ],
    },
  },
] as const;
