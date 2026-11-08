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
