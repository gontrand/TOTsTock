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
  {
    version: '5.6.0',
    schemaVersion: '2.1.0',
    date: '2026-10-05',
    title: {
      fr: 'Tables de la suite TOT, catégories & stockage partagé tot-files',
      en: 'TOT Suite tables, categories & shared tot-files storage',
      nl: 'TOT Suite-tabellen, categorieën & gedeelde tot-files opslag',
    },
    highlights: {
      fr: [
        'Journal de préparation de commande enregistré (stk_order_preparations_log) et catégories de produits (stk_categories).',
        'Service de fichiers partagés (core_files & bucket privé tot-files) pour la suite TOT.',
        'Fonctions Edge livrées sous forme de bundles autonomes prêts à copier-coller.',
      ],
      en: [
        'Recorded order preparation log (stk_order_preparations_log) and product categories (stk_categories).',
        'Shared file service (core_files & private tot-files bucket) for the TOT suite.',
        'Edge Functions delivered as self-contained copy-paste bundles.',
      ],
      nl: [
        'Geregistreerd orderpicklogboek (stk_order_preparations_log) en productcategorieën (stk_categories).',
        'Gedeelde bestandsservice (core_files & privébucket tot-files) voor de TOT-suite.',
        'Edge Functions geleverd als zelfstandige kopieer-en-plak-bundels.',
      ],
    },
  },
  {
    version: '5.5.0',
    schemaVersion: '2.0.0',
    date: '2026-09-25',
    title: {
      fr: 'Architecture multi-applications (core_* / stk_*) & impression à distance',
      en: 'Multi-application architecture (core_* / stk_*) & remote label printing',
      nl: 'Multi-applicatie-architectuur (core_* / stk_*) & afdrukken op afstand',
    },
    highlights: {
      fr: [
        'Préfixage unifié core_* et stk_* pour partager une même base Supabase au sein de la suite TOT.',
        'Postes d’impression et file de travaux d’étiquettes à distance (stk_print_stations, stk_print_jobs).',
        'Générateur de planches d’étiquettes A4 Avery et rouleaux thermiques 50×30 mm.',
      ],
      en: [
        'Unified core_* and stk_* table prefixes to share a single Supabase database across the TOT suite.',
        'Remote print stations and label job queue (stk_print_stations, stk_print_jobs).',
        'A4 Avery label sheet generator and 50×30 mm thermal roll support.',
      ],
      nl: [
        'Uniforme core_*- en stk_*-tabelvoorvoegsels om één Supabase-database te delen binnen de TOT-suite.',
        'Externe afdrukstations en labelwachtrij (stk_print_stations, stk_print_jobs).',
        'Generator voor A4 Avery-etikettenvellen en thermische rollen van 50×30 mm.',
      ],
    },
  },
] as const;
