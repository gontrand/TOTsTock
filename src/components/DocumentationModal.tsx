import React, { useState, useEffect } from 'react';
import { tr } from '../i18n/dutchTranslator';
import DOMPurify from 'dompurify';
import { useApp } from '../context/AppContext';
import {
  X,
  BookOpen,
  Smartphone,
  Globe,
  Database,
  Printer,
  Copy,
  Check,
  Download,
  Terminal,
  ShieldCheck,
  QrCode,
  Layers,
  ArrowRight,
  ExternalLink,
  ChevronRight,
  Users,
  Lock,
  KeyRound,
  Barcode,
  Camera,
  Package,
  ShoppingCart,
  Warehouse,
  Shield,
  Search,
  Building,
  Building2,
  Coins,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Sliders,
  Plus,
  Minus,
  Info,
  Calendar,
  Clock,
  ClipboardCheck,
  ArrowDownCircle,
  ArrowUpCircle,
  User as UserIcon,
  Wifi,
  Battery,
  Sparkles,
  FileSpreadsheet,
} from 'lucide-react';
import { SUPPORTED_CURRENCIES } from '../utils/crypto';
import { APP_VERSION } from '../appVersion';
import { buildApkDownloadUrl, fetchApkSha256 } from '../utils/apkDownload';

const UiScreenshotCard: React.FC<{
  title: string;
  badge?: string;
  caption: string;
  children: React.ReactNode;
}> = ({ title, badge, caption, children }) => (
  <div className="ui-mockup-frame my-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden text-slate-800 dark:text-slate-100">
    {/* Device Top Bar Mockup */}
    <div className="bg-slate-900 text-slate-300 px-3 py-1.5 flex items-center justify-between text-[10px] font-mono border-b border-slate-800 select-none">
      <div className="flex items-center gap-2">
        <span className="font-bold text-white">09:41</span>
        <span className="text-slate-400 font-sans text-[9px] hidden sm:inline">TOT Stock Pro • Mobile</span>
      </div>
      <div className="flex items-center gap-2">
        <Wifi className="w-3 h-3 text-slate-300" />
        <span className="text-[9px] font-bold text-emerald-400">4G LTE</span>
        <Battery className="w-3.5 h-3.5 text-slate-300" />
      </div>
    </div>
    {/* Screen Header */}
    <div className="px-3.5 py-2 bg-slate-100 dark:bg-slate-800/90 border-b border-slate-200 dark:border-slate-700/80 flex items-center justify-between">
      <span className="font-black text-[11px] text-slate-900 dark:text-white flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse inline-block" />
        {title}
      </span>
      {badge && (
        <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800/60">
          {badge}
        </span>
      )}
    </div>
    {/* Screen Body */}
    <div className="p-3.5 bg-slate-50/70 dark:bg-slate-900/70 text-xs">
      {children}
    </div>
    {/* Screen Caption Footer */}
    <div className="px-3.5 py-2 bg-slate-100/90 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-700/60 text-[10px] text-slate-600 dark:text-slate-400 flex items-center gap-2 font-medium">
      <Camera className="w-3.5 h-3.5 text-orange-600 shrink-0" />
      <span><strong>Capture :</strong> {caption}</span>
    </div>
  </div>
);

export const DocumentationModal: React.FC = () => {
  const {
    documentationModalOpen,
    setDocumentationModalOpen,
    appCompat,
    language,
    currency,
    t,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'manual' | 'android' | 'marketing' | 'supabase'>(
    documentationModalOpen.tab || 'manual'
  );

  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedCli, setCopiedCli] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [printNotice, setPrintNotice] = useState<string | null>(null);
  const [apkSha256, setApkSha256] = useState<string | null>(null);
  const [copiedSha, setCopiedSha] = useState(false);
  const apkDownloadUrl = buildApkDownloadUrl(appCompat.updateUrl, APP_VERSION);

  useEffect(() => {
    if (documentationModalOpen.open) {
      fetchApkSha256().then((hash) => setApkSha256(hash)).catch(() => setApkSha256(null));
    }
  }, [documentationModalOpen.open]);

  // Keyboard shortcut: close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && documentationModalOpen.open) {
        setDocumentationModalOpen({ open: false, tab: 'manual' });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [documentationModalOpen.open, setDocumentationModalOpen]);

  if (!documentationModalOpen.open) return null;

  const handlePrint = () => {
    setPrintNotice('Lancement de l\'impression PDF...');
    if (activeTab !== 'manual') {
      setActiveTab('manual');
    }

    setTimeout(() => {
      try {
        const printArea = document.getElementById('printable-manual-root');
        if (printArea) {
          let printIframe = document.getElementById('tot-print-iframe') as HTMLIFrameElement;
          if (!printIframe) {
            printIframe = document.createElement('iframe');
            printIframe.id = 'tot-print-iframe';
            printIframe.style.position = 'fixed';
            printIframe.style.right = '0';
            printIframe.style.bottom = '0';
            printIframe.style.width = '0';
            printIframe.style.height = '0';
            printIframe.style.border = '0';
            document.body.appendChild(printIframe);
          }

          const doc = printIframe.contentWindow?.document;
          if (doc) {
            doc.open();
            doc.write(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>Manuel d'Utilisation Officiel - TOT Stock PRO v5.4</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @page { size: A4 portrait; margin: 12mm 10mm 12mm 10mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fff; color: #0f172a; padding: 10px; font-size: 11px; line-height: 1.5; }
    .ui-mockup-frame { border: 1px solid #cbd5e1; border-radius: 12px; margin: 12px 0; break-inside: avoid; page-break-inside: avoid; }
    .manual-chapter { break-inside: avoid; page-break-inside: avoid; margin-bottom: 24px; padding-top: 8px; }
    .no-print, button { display: none !important; }
  </style>
</head>
<body>
  \${DOMPurify.sanitize(printArea.innerHTML)}
</body>
</html>`);
            doc.close();

            setTimeout(() => {
              try {
                printIframe.contentWindow?.focus();
                printIframe.contentWindow?.print();
              } catch (e) {
                console.warn('Iframe print error, falling back to window.print():', e);
                window.focus();
                window.print();
              }
            }, 450);
          } else {
            window.focus();
            window.print();
          }
        } else {
          window.focus();
          window.print();
        }
      } catch (err) {
        console.warn('Print trigger error:', err);
        window.focus();
        window.print();
      }
      setTimeout(() => setPrintNotice(null), 5000);
    }, 150);
  };

  const currObj = SUPPORTED_CURRENCIES.find((c) => c.code === currency) || SUPPORTED_CURRENCIES[0];

  const MARKETING_HTML_CODE = `<!DOCTYPE html>
<html lang="fr" class="scroll-smooth">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TOT Stock - Gestion de Stock, Chantiers & Matériel BTP</title>
  <meta name="description" content="Solution professionnelle de gestion de stock, traçabilité par QR codes & codes-barres fabricants, affectation chantiers et multi-dépôts pour entreprises et artisans." />
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            brand: {
              50: '#f7ecdf',
              500: '#f97316',
              600: '#ea580c',
              700: '#c2410c',
            }
          }
        }
      }
    }
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
  </style>
</head>
<body class="bg-slate-50 text-slate-800 antialiased selection:bg-orange-500 selection:text-white">

  <!-- En-tête Navigation -->
  <header class="sticky top-0 z-50 backdrop-blur-md bg-white/90 border-b border-slate-200">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-orange-600 text-white font-black text-lg flex items-center justify-center shadow-md shadow-orange-500/30">
          TOT
        </div>
        <div>
          <span class="text-lg font-black text-slate-900 tracking-tight">TOT Stock</span>
          <span class="hidden sm:inline-block ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-700">PRO v5.4</span>
        </div>
      </div>

      <nav class="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-600">
        <a href="#features" class="hover:text-orange-600 transition">Fonctionnalités</a>
        <a href="#mobile" class="hover:text-orange-600 transition">Application Mobile</a>
        <a href="#security" class="hover:text-orange-600 transition">Sécurité &amp; Rôles</a>
        <a href="#depots" class="hover:text-orange-600 transition">Multi-Dépôts</a>
        <a href="#contact" class="hover:text-orange-600 transition">Contact</a>
      </nav>

      <div class="flex items-center gap-3">
        <a href="#demo" class="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition">Démo</a>
        <a href="#contact" class="px-4 py-2 rounded-xl text-xs font-extrabold text-white bg-orange-600 hover:bg-orange-700 shadow-md shadow-orange-600/20 transition">Essayer Gratuitement</a>
      </div>
    </div>
  </header>

  <!-- Hero Section -->
  <section class="relative overflow-hidden pt-16 pb-20 lg:pt-24 lg:pb-28 bg-gradient-to-b from-orange-50/50 via-white to-slate-50">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
      <div class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-orange-100/80 border border-orange-200 text-orange-700 text-xs font-bold mb-6">
        <span>⚡</span>
        <span>Gestion de Stock &amp; Traçabilité Chantiers Haute Précision</span>
      </div>

      <h1 class="text-4xl sm:text-5xl lg:text-6xl font-black text-slate-900 tracking-tight max-w-4xl mx-auto leading-tight">
        Zéro rupture. Zéro perte.<br />
        <span class="text-orange-600">Votre stock maîtrisé</span> du dépôt au chantier.
      </h1>

      <p class="mt-6 text-lg sm:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
        L'application tout-en-un pour les entreprises du bâtiment, installateurs et ateliers : scan ultra-rapide des QR codes &amp; codes-barres fabricants, gestion multi-dépôts, affectation par conducteur de travaux et alertes automatiques.
      </p>

      <div class="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
        <a href="#demo" class="w-full sm:w-auto px-6 py-3.5 rounded-2xl bg-orange-600 hover:bg-orange-700 text-white font-extrabold text-sm shadow-xl shadow-orange-600/25 transition active:scale-95 flex items-center justify-center gap-2">
          <span>🚀 Lancer l'application web</span>
        </a>
        <a href="#android" class="w-full sm:w-auto px-6 py-3.5 rounded-2xl bg-white hover:bg-slate-100 text-slate-800 font-extrabold text-sm border border-slate-300 shadow-sm transition active:scale-95 flex items-center justify-center gap-2">
          <span>📱 Télécharger sur Android</span>
        </a>
      </div>

      <!-- Métriques clés -->
      <div class="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
        <div class="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <div class="text-2xl sm:text-3xl font-black text-orange-600">&lt; 0.2s</div>
          <div class="text-xs font-bold text-slate-500 mt-1">Vitesse de scan caméra</div>
        </div>
        <div class="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <div class="text-2xl sm:text-3xl font-black text-slate-900">100%</div>
          <div class="text-xs font-bold text-slate-500 mt-1">Traçabilité des sorties</div>
        </div>
        <div class="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <div class="text-2xl sm:text-3xl font-black text-orange-600">Multi-Postes</div>
          <div class="text-xs font-bold text-slate-500 mt-1">Smartphones &amp; PC synchronisés</div>
        </div>
        <div class="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <div class="text-2xl sm:text-3xl font-black text-slate-900">1D + 2D</div>
          <div class="text-xs font-bold text-slate-500 mt-1">EAN-13, Code-128 &amp; QR TOT</div>
        </div>
      </div>
    </div>
  </section>

  <!-- Fonctionnalités Majeures -->
  <section id="features" class="py-20 bg-white border-t border-slate-200">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="text-center max-w-3xl mx-auto mb-16">
        <h2 class="text-xs font-black uppercase tracking-wider text-orange-600">Puissance &amp; Simplicité</h2>
        <p class="text-3xl font-black text-slate-900 mt-2">Conçu sur mesure pour la réalité du terrain</p>
        <p class="text-slate-500 text-sm mt-3">Pas de formation complexe nécessaire : vos magasiniers et techniciens sont opérationnels en 2 minutes.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
        <!-- Carte 1 -->
        <div class="p-6 rounded-3xl bg-slate-50 border border-slate-200 hover:border-orange-300 hover:shadow-lg transition">
          <div class="w-12 h-12 rounded-2xl bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-xl mb-4">
            📷
          </div>
          <h3 class="text-lg font-black text-slate-900">Double Scanner Intégré</h3>
          <p class="text-xs text-slate-600 mt-2 leading-relaxed">
            Reconnaissance instantanée des codes-barres fabricant (EAN-13, UPC, Code-128) sur les boîtes d'origine, et des QR Codes TOT imprimables sur étiquettes adhésives.
          </p>
        </div>

        <!-- Carte 2 -->
        <div class="p-6 rounded-3xl bg-slate-50 border border-slate-200 hover:border-orange-300 hover:shadow-lg transition">
          <div class="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xl mb-4">
            🏗️
          </div>
          <h3 class="text-lg font-black text-slate-900">Sorties Chantiers &amp; Conducteurs</h3>
          <p class="text-xs text-slate-600 mt-2 leading-relaxed">
            Assignez le matériel à un numéro de chantier précis. Filtrage automatique des conducteurs de travaux et ajout de suppléants avec un simple bouton "+".
          </p>
        </div>

        <!-- Carte 3 -->
        <div class="p-6 rounded-3xl bg-slate-50 border border-slate-200 hover:border-orange-300 hover:shadow-lg transition">
          <div class="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold text-xl mb-4">
            🏢
          </div>
          <h3 class="text-lg font-black text-slate-900">Multi-Dépôts &amp; Magasins</h3>
          <p class="text-xs text-slate-600 mt-2 leading-relaxed">
            Gérez plusieurs dépôts physiques, véhicules utilitaires ou ateliers. Filtrez vos KPIs par dépôt spécifique ou consultez l'inventaire global consolidé.
          </p>
        </div>

        <!-- Carte 4 -->
        <div class="p-6 rounded-3xl bg-slate-50 border border-slate-200 hover:border-orange-300 hover:shadow-lg transition">
          <div class="w-12 h-12 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xl mb-4">
            🛡️
          </div>
          <h3 class="text-lg font-black text-slate-900">Droits &amp; Rôles Personnalisables</h3>
          <p class="text-xs text-slate-600 mt-2 leading-relaxed">
            Définissez dans l'application qui peut voir la valeur financière, qui a accès aux KPIs de tous les dépôts, et réservez des vues individuelles pour les opérateurs.
          </p>
        </div>

        <!-- Carte 5 -->
        <div class="p-6 rounded-3xl bg-slate-50 border border-slate-200 hover:border-orange-300 hover:shadow-lg transition">
          <div class="w-12 h-12 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center font-bold text-xl mb-4">
            📜
          </div>
          <h3 class="text-lg font-black text-slate-900">Journal d'Audit &amp; Traçabilité</h3>
          <p class="text-xs text-slate-600 mt-2 leading-relaxed">
            Historique infalsifiable : sachez à la seconde près qui a pris quel matériel, pour quel chantier, l'heure exacte et l'opérateur connecté.
          </p>
        </div>

        <!-- Carte 6 -->
        <div class="p-6 rounded-3xl bg-slate-50 border border-slate-200 hover:border-orange-300 hover:shadow-lg transition">
          <div class="w-12 h-12 rounded-2xl bg-purple-100 text-purple-600 flex items-center justify-center font-bold text-xl mb-4">
            🔄
          </div>
          <h3 class="text-lg font-black text-slate-900">Synchronisation Supabase Cloud</h3>
          <p class="text-xs text-slate-600 mt-2 leading-relaxed">
            Propriété totale de vos données (BYOD) via PostgreSQL Supabase. Connectez autant de téléphones que nécessaire avec une simple clé ou QR code.
          </p>
        </div>
      </div>
    </div>
  </section>

  <!-- Section Mobile Android -->
  <section id="mobile" class="py-20 bg-slate-900 text-white">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div>
          <span class="text-xs font-black uppercase tracking-wider text-orange-400">Mobilité &amp; Terrain</span>
          <h2 class="text-3xl sm:text-4xl font-black mt-2 leading-tight">
            Disponible sur Smartphone Android &amp; Navigateur Web
          </h2>
          <p class="mt-4 text-slate-400 text-sm leading-relaxed">
            Que vous soyez au volant sur le chemin d'un chantier, dans les allées du magasin central ou au bureau de la direction, accédez à votre stock en temps réel.
          </p>

          <ul class="mt-6 space-y-3 text-xs text-slate-300">
            <li class="flex items-center gap-2">
              <span class="text-emerald-400">✓</span>
              <span>Application native Android installable via APK ou Google Play Store</span>
            </li>
            <li class="flex items-center gap-2">
              <span class="text-emerald-400">✓</span>
              <span>Connexion ultra-rapide par code PIN à 4 chiffres</span>
            </li>
            <li class="flex items-center gap-2">
              <span class="text-emerald-400">✓</span>
              <span>Mode découverte gratuit pour démarrer immédiatement</span>
            </li>
          </ul>

          <div class="mt-8 flex items-center gap-4">
            <a href="#contact" class="px-5 py-3 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs shadow-lg shadow-orange-600/30 transition">
              Demander une licence
            </a>
          </div>
        </div>

        <div class="p-6 bg-slate-800 rounded-3xl border border-slate-700 shadow-2xl text-center">
          <div class="inline-block p-4 bg-slate-950 rounded-2xl border border-slate-700 mb-4">
            <div class="text-5xl">📱</div>
          </div>
          <h3 class="text-base font-bold text-white">Prêt pour Android Studio</h3>
          <p class="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Projet web exportable instantanément avec Capacitor en application Android native (.apk et .aab).
          </p>
        </div>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="py-12 bg-white border-t border-slate-200 text-xs text-slate-500">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
      <div>
        © 2026 <strong>TOT Stock</strong>. Tous droits réservés. Solution éditée pour les professionnels du bâtiment et de l'industrie.
      </div>
      <div class="flex items-center gap-6">
        <a href="#features" class="hover:text-orange-600">Fonctionnalités</a>
        <a href="#mobile" class="hover:text-orange-600">Android</a>
        <a href="#contact" class="hover:text-orange-600">Support &amp; Contact</a>
      </div>
    </div>
  </footer>

</body>
</html>`;

  const CLI_COMMANDS_TEXT = `# =========================================================================
# COMMANDES OFFICIELLES TERMINAL (SUPABASE CLI & PSQL) - TOT STOCK v5.4
# =========================================================================

# --- MÉTHODE 1 : VIA SUPABASE CLI (Recommandée pour migrations versionnées) ---

# 1. Installer la CLI Supabase (si non installée)
npm install supabase --save-dev

# 2. Se connecter à votre compte Supabase
npx supabase login

# 3. Lier votre projet local au projet cloud Supabase
# (Remplacez <VOTRE_PROJECT_REF> par l'ID visible dans l'URL de votre Dashboard Supabase)
npx supabase link --project-ref <VOTRE_PROJECT_REF>

# 4. Générer le fichier de migration SQL
npx supabase migration new update_tot_stock_v5_4

# 5. Copier le contenu du script SQL (onglet Schéma SQL ou fichier téléchargé) dans :
# supabase/migrations/<timestamp>_update_tot_stock_v5_4.sql

# 6. Déployer et appliquer la migration sur votre base distante
npx supabase db push

# --- MÉTHODE 2 : DIRECTEMENT VIA PSQL (PostgreSQL en ligne de commande) ---
psql "postgresql://postgres:[VOTRE_MOT_DE_PASSE]@db.[VOTRE_PROJECT_REF].supabase.co:5432/postgres" -f update_tot_stock_tables_v5_4.sql

# --- MÉTHODE 3 : SANS AUCUN OUTIL EN LIGNE DE COMMANDE (100% NAVIGATEUR) ---
# 1. Ouvrez https://supabase.com/dashboard/project/<VOTRE_PROJECT_REF>/sql
# 2. Cliquez sur "New query", collez le script SQL ci-dessous et cliquez sur "Run".`;

  const SQL_MIGRATION_TEXT = `-- =========================================================================
-- TOT STOCK PRO v5.4 - SCHÉMA COMPLET ET MIGRATION POSTGRESQL / SUPABASE
-- Compatible avec bases neuves ET bases existantes (Idempotent: IF NOT EXISTS)
-- =========================================================================

-- 1. TABLE ROLES
CREATE TABLE IF NOT EXISTS public.roles (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  permissions TEXT[] NOT NULL DEFAULT '{}'
);

INSERT INTO public.roles (id, name, permissions)
VALUES 
  (0, 'Super Administrateur 👑', '{"*"}'),
  (1, 'Administrateur 🏢', '{"perm_tab_dashboard","perm_tab_inventory","perm_btn_center_show","perm_tab_movements","perm_tab_plus","perm_mov_out","perm_stock_in","perm_action_create_prod","perm_stock_transfer","perm_dash_kpi","perm_dash_finance","perm_dash_kpi_all","perm_prod_view","perm_prod_view_price","perm_inv_btn_scan","perm_menu_print_labels","perm_menu_inventory_audit","perm_inventory_validate","perm_prod_edit","perm_prod_delete","perm_mov_tabs","perm_mov_view_all","perm_mov_view_depot","perm_mov_tab_my","perm_mov_tab_proj","perm_mov_filter_dep","perm_mov_export_csv","perm_create_order","perm_order_approve","perm_order_cancel","perm_manage_currency","perm_depproj_menu","perm_dep_edit","perm_dep_delete","perm_proj_edit","perm_proj_delete","perm_manage_categories","perm_manage_depots","perm_depot_create","perm_depot_toggle_status","perm_depot_delete","perm_report_view","perm_audit_view","perm_view_all_login_logs","perm_config_email","perm_email_manual_send","perm_doc_manual"}'),
  (2, 'Magasinier 👷', '{"perm_tab_dashboard","perm_tab_inventory","perm_btn_center_show","perm_tab_movements","perm_tab_plus","perm_mov_out","perm_stock_in","perm_action_create_prod","perm_stock_transfer","perm_dash_kpi","perm_kpi_filter_depot","perm_prod_view","perm_inv_btn_scan","perm_menu_print_labels","perm_menu_inventory_audit","perm_prod_edit","perm_prod_movement_direct","perm_stock_transfer","perm_prod_batch_cart","perm_inv_filters","perm_mov_tabs","perm_mov_view_depot","perm_mov_tab_my","perm_mov_filter_dep","perm_mov_export_csv","perm_create_order","perm_menu_order_prep","perm_order_assign","perm_order_mark_ready","perm_order_mark_collected","perm_doc_manual"}'),
  (3, 'Chef de Chantier 🏗️', '{"perm_tab_dashboard","perm_tab_inventory","perm_btn_center_show","perm_tab_movements","perm_tab_plus","perm_mov_out","perm_dash_kpi","perm_kpi_filter_depot","perm_prod_view","perm_inv_btn_scan","perm_inv_filters","perm_prod_batch_cart","perm_menu_inventory_audit","perm_create_order","perm_order_approve","perm_order_mark_collected","perm_mov_tabs","perm_mov_tab_proj","perm_mov_tab_my","perm_doc_manual"}'),
  (4, 'Opérateur 🔨', '{"perm_tab_inventory","perm_btn_center_show","perm_tab_movements","perm_tab_plus","perm_mov_out","perm_prod_view","perm_inv_btn_scan","perm_inv_filters","perm_prod_batch_cart","perm_menu_inventory_audit","perm_create_order","perm_order_mark_collected","perm_mov_tabs","perm_mov_tab_my","perm_doc_manual"}')
ON CONFLICT (id) DO NOTHING;

-- 2. TABLE DEPARTMENTS (Départements / Services)
CREATE TABLE IF NOT EXISTS public.departments (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  manager_id TEXT,
  deputy_manager_ids TEXT[] DEFAULT '{}',
  allow_global_kpis BOOLEAN DEFAULT false,
  is_preparer_dept BOOLEAN DEFAULT false,
  require_order_approval BOOLEAN DEFAULT false,
  order_approval_threshold NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.departments 
  ADD COLUMN IF NOT EXISTS manager_id TEXT,
  ADD COLUMN IF NOT EXISTS deputy_manager_ids TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS allow_global_kpis BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_preparer_dept BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_order_approval BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS order_approval_threshold NUMERIC(10,2) DEFAULT 0;

-- 3. TABLE USERS (Utilisateurs & Accès PIN)
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigram TEXT,
  email TEXT,
  department TEXT,
  pin TEXT NOT NULL,
  pin_hash TEXT,
  role_id BIGINT REFERENCES public.roles(id) DEFAULT 4,
  is_blocked BOOLEAN DEFAULT false,
  allowed_depots TEXT[] DEFAULT NULL,
  must_change_pin BOOLEAN DEFAULT false,
  is_preparer BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.users 
  ADD COLUMN IF NOT EXISTS allowed_depots TEXT[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS must_change_pin BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_preparer BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS pin_hash TEXT;

-- 4. TABLE PROJECTS (Chantiers & Projets)
CREATE TABLE IF NOT EXISTS public.projects (
  id BIGSERIAL PRIMARY KEY,
  department_id BIGINT REFERENCES public.departments(id),
  project_number TEXT NOT NULL UNIQUE,
  project_name TEXT NOT NULL,
  manager_id TEXT,
  deputy_manager_ids TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.projects 
  ADD COLUMN IF NOT EXISTS deputy_manager_ids TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS manager_id TEXT;

-- 5. TABLE SUB_CATEGORIES (Catégories d'outillage & consommables)
CREATE TABLE IF NOT EXISTS public.sub_categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. TABLE DEPOTS (Dépôts physiques, magasins, véhicules & ateliers)
CREATE TABLE IF NOT EXISTS public.depots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL UNIQUE,
  code TEXT,
  address TEXT,
  description TEXT,
  type TEXT DEFAULT 'FIXED', -- 'FIXED' ou 'VEHICLE'
  vehicle_type TEXT DEFAULT NULL, -- 'FOURGON', 'CAMIONNETTE', 'UTILITAIRE', 'POIDS_LOURD', etc.
  license_plate TEXT DEFAULT NULL,
  manager_id TEXT DEFAULT NULL,
  manager_name TEXT DEFAULT NULL,
  department_id TEXT DEFAULT NULL,
  department_name TEXT DEFAULT NULL,
  pickup_zones JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.depots 
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'FIXED',
  ADD COLUMN IF NOT EXISTS vehicle_type TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS license_plate TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS manager_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS manager_name TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS department_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS department_name TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pickup_zones JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- 7. TABLE PRODUCTS (Catalogue Références, Outillage & Stocks)
CREATE TABLE IF NOT EXISTS public.products (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  manufacturer_ref TEXT,
  barcode TEXT,
  qr_code TEXT,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  sub_category_id BIGINT REFERENCES public.sub_categories(id),
  unit_price NUMERIC(10,2) DEFAULT 0,
  description TEXT,
  tags TEXT,
  supplier_1_name TEXT,
  ref_supplier_1 TEXT,
  supplier_2_name TEXT,
  ref_supplier_2 TEXT,
  store_name TEXT,
  room_name TEXT,
  shelf_name TEXT,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
  min_stock_alert NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.products 
  ADD COLUMN IF NOT EXISTS manufacturer_ref TEXT,
  ADD COLUMN IF NOT EXISTS barcode TEXT,
  ADD COLUMN IF NOT EXISTS qr_code TEXT,
  ADD COLUMN IF NOT EXISTS supplier_1_name TEXT,
  ADD COLUMN IF NOT EXISTS ref_supplier_1 TEXT,
  ADD COLUMN IF NOT EXISTS supplier_2_name TEXT,
  ADD COLUMN IF NOT EXISTS ref_supplier_2 TEXT,
  ADD COLUMN IF NOT EXISTS store_name TEXT,
  ADD COLUMN IF NOT EXISTS room_name TEXT,
  ADD COLUMN IF NOT EXISTS shelf_name TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_ref_uniq ON public.products (LOWER(BTRIM(reference)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_uniq ON public.products (LOWER(BTRIM(barcode))) WHERE barcode IS NOT NULL AND BTRIM(barcode) <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_oem_uniq ON public.products (LOWER(BTRIM(manufacturer_ref))) WHERE manufacturer_ref IS NOT NULL AND BTRIM(manufacturer_ref) <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_qr_uniq ON public.products (LOWER(BTRIM(qr_code))) WHERE qr_code IS NOT NULL AND BTRIM(qr_code) <> '';

-- 8. TABLE STOCK_MOVEMENTS / MOVEMENTS (Historique & Traçabilité des Flux)
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_ref TEXT,
  user_id TEXT,
  user_name TEXT,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('IN', 'OUT')),
  quantity_changed NUMERIC(10,2) NOT NULL,
  site_number TEXT,
  department_name TEXT,
  total_cost NUMERIC(10,2) DEFAULT 0,
  order_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_ref TEXT,
  user_id TEXT,
  user_name TEXT,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('IN', 'OUT')),
  quantity_changed NUMERIC(10,2) NOT NULL,
  site_number TEXT,
  department_name TEXT,
  total_cost NUMERIC(10,2) DEFAULT 0,
  order_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_movements 
  ADD COLUMN IF NOT EXISTS order_number TEXT,
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS department_name TEXT;

ALTER TABLE public.movements 
  ADD COLUMN IF NOT EXISTS order_number TEXT,
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS department_name TEXT;

-- 9. TABLE MATERIAL_ORDERS (Commandes de matériel, Drive Chantier, Validation & Préparation)
CREATE TABLE IF NOT EXISTS public.material_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  site_number TEXT NOT NULL,
  site_name TEXT,
  depot_name TEXT,
  requester_id TEXT NOT NULL,
  requester_name TEXT NOT NULL,
  requester_department TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('WAITING_APPROVAL', 'PENDING', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED', 'REJECTED')),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  total_cost NUMERIC(10,2) DEFAULT 0,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  rejected_by TEXT,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  pickup_zone TEXT,
  ready_qr_code TEXT,
  signature_data TEXT,
  proof_photo_url TEXT,
  is_edited BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_at TIMESTAMPTZ,
  preparer_id TEXT,
  preparer_name TEXT,
  ready_at TIMESTAMPTZ,
  collected_at TIMESTAMPTZ,
  collected_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.material_orders 
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS pickup_zone TEXT,
  ADD COLUMN IF NOT EXISTS ready_qr_code TEXT,
  ADD COLUMN IF NOT EXISTS depot_name TEXT,
  ADD COLUMN IF NOT EXISTS signature_data TEXT,
  ADD COLUMN IF NOT EXISTS proof_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Mise à jour sécurisée de la contrainte CHECK status
DO $$ 
BEGIN 
  ALTER TABLE public.material_orders DROP CONSTRAINT IF EXISTS material_orders_status_check;
  ALTER TABLE public.material_orders ADD CONSTRAINT material_orders_status_check 
    CHECK (status IN ('WAITING_APPROVAL', 'PENDING', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED', 'REJECTED'));
EXCEPTION WHEN OTHERS THEN 
  NULL;
END $$;

-- 10. TABLE APP_SETTINGS (Devise centrale & Configuration entreprise)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.app_settings (key, value)
VALUES ('company_currency', 'EUR')
ON CONFLICT (key) DO NOTHING;

-- 11. TABLE LOGIN_LOGS (Audit des connexions)
CREATE TABLE IF NOT EXISTS public.login_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  user_name TEXT,
  action TEXT DEFAULT 'LOGIN_SUCCESS',
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- =========================================================================
-- 12. SÉCURITÉ ROW LEVEL SECURITY (RLS) DURCIE SUR TOUTES LES TABLES
-- Accès restreint : anonyme (anon) fermé, accès sécurisé (authenticated)
-- =========================================================================
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon roles" ON public.roles;
CREATE POLICY "Authenticated read roles" ON public.roles FOR SELECT TO authenticated USING (true);

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon departments" ON public.departments;
CREATE POLICY "Authenticated read departments" ON public.departments FOR SELECT TO authenticated USING (true);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon users" ON public.users;
CREATE POLICY "Authenticated read users" ON public.users FOR SELECT TO authenticated USING (true);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon projects" ON public.projects;
CREATE POLICY "Authenticated read projects" ON public.projects FOR SELECT TO authenticated USING (true);

ALTER TABLE public.sub_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon sub_categories" ON public.sub_categories;
CREATE POLICY "Authenticated read sub_categories" ON public.sub_categories FOR SELECT TO authenticated USING (true);

ALTER TABLE public.depots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon depots" ON public.depots;
CREATE POLICY "Authenticated read depots" ON public.depots FOR SELECT TO authenticated USING (true);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon products" ON public.products;
CREATE POLICY "Authenticated read products" ON public.products FOR SELECT TO authenticated USING (true);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon stock_movements" ON public.stock_movements;
CREATE POLICY "Authenticated read stock_movements" ON public.stock_movements FOR SELECT TO authenticated USING (true);

ALTER TABLE public.material_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon material_orders" ON public.material_orders;
CREATE POLICY "Authenticated read material_orders" ON public.material_orders FOR SELECT TO authenticated USING (true);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon app_settings" ON public.app_settings;
CREATE POLICY "Anon read public app_settings" ON public.app_settings FOR SELECT TO anon USING (key IN ('company_currency', 'company_name', 'company_logo', 'app_logo_url'));
CREATE POLICY "Authenticated read app_settings" ON public.app_settings FOR SELECT TO authenticated USING (key NOT IN ('smtp_pass', 'brevo_api_key'));

ALTER TABLE public.login_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon login_logs" ON public.login_logs;
CREATE POLICY "Authenticated read login_logs" ON public.login_logs FOR SELECT TO authenticated USING (true);

-- =========================================================================
-- 13. INDEX DE HAUTE PERFORMANCE POUR RECHERCHE & RAPPORTS
-- =========================================================================
CREATE INDEX IF NOT EXISTS idx_products_brand_model ON public.products (brand, model);
CREATE INDEX IF NOT EXISTS idx_products_ref ON public.products (reference);
CREATE INDEX IF NOT EXISTS idx_products_store ON public.products (store_name);
CREATE INDEX IF NOT EXISTS idx_products_subcat ON public.products (sub_category_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products (barcode);

CREATE INDEX IF NOT EXISTS idx_users_allowed_depots ON public.users USING GIN (allowed_depots);
CREATE INDEX IF NOT EXISTS idx_users_dept ON public.users (department);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users (role_id);

CREATE INDEX IF NOT EXISTS idx_dep_kpi ON public.departments (allow_global_kpis);
CREATE INDEX IF NOT EXISTS idx_projects_dept ON public.projects (department_id);
CREATE INDEX IF NOT EXISTS idx_projects_number ON public.projects (project_number);

CREATE INDEX IF NOT EXISTS idx_movements_prod ON public.stock_movements (product_id);
CREATE INDEX IF NOT EXISTS idx_movements_created ON public.stock_movements (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_order ON public.stock_movements (order_number);
CREATE INDEX IF NOT EXISTS idx_movements_site ON public.stock_movements (site_number);

CREATE UNIQUE INDEX IF NOT EXISTS idx_material_orders_order_number_unique ON public.material_orders (UPPER(TRIM(order_number)));
CREATE INDEX IF NOT EXISTS idx_material_orders_status ON public.material_orders (status);
CREATE INDEX IF NOT EXISTS idx_material_orders_site ON public.material_orders (site_number);
CREATE INDEX IF NOT EXISTS idx_material_orders_requester ON public.material_orders (requester_id);
CREATE INDEX IF NOT EXISTS idx_material_orders_preparer ON public.material_orders (preparer_id);
CREATE INDEX IF NOT EXISTS idx_material_orders_created ON public.material_orders (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_login_logs_user_date ON public.login_logs (user_id, created_at DESC);`;

  const handleCopyMarketingCode = () => {
    navigator.clipboard.writeText(MARKETING_HTML_CODE);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2500);
  };

  const handleCopyCli = () => {
    navigator.clipboard.writeText(CLI_COMMANDS_TEXT);
    setCopiedCli(true);
    setTimeout(() => setCopiedCli(false), 2500);
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(SQL_MIGRATION_TEXT);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2500);
  };

  const handleDownloadSqlFile = () => {
    const blob = new Blob([SQL_MIGRATION_TEXT], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'update_tot_stock_tables_v5_4.sql';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadManualHtml = () => {
    const printArea = document.getElementById('printable-manual-root');
    const content = printArea ? DOMPurify.sanitize(printArea.innerHTML) : '';
    const fullHtml = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Manuel d'Utilisation Officiel - TOT Stock PRO v5.4</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @page { size: A4 portrait; margin: 12mm 10mm 12mm 10mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #ffffff; color: #0f172a; }
    .ui-mockup-frame { border: 1px solid #cbd5e1; border-radius: 12px; margin: 14px 0; break-inside: avoid; page-break-inside: avoid; }
    .manual-chapter { break-inside: avoid; page-break-inside: avoid; margin-bottom: 28px; }
    @media print {
      .print-btn-bar { display: none !important; }
    }
  </style>
</head>
<body class="p-6 sm:p-10 max-w-4xl mx-auto text-slate-800">
  <div class="print-btn-bar sticky top-2 z-50 mb-6 p-4 bg-orange-50 border-2 border-orange-400 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg">
    <div>
      <div class="font-black text-orange-950 text-sm">📄 Manuel d'Utilisation Prêt pour Impression PDF A4</div>
      <div class="text-xs text-orange-700">Cliquez sur le bouton ci-contre pour imprimer ou enregistrer en PDF (A4 Portrait).</div>
    </div>
    <button onclick="window.print()" class="px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-black text-xs shadow-md transition cursor-pointer shrink-0">
      🖨️ Imprimer / Enregistrer en PDF
    </button>
  </div>
  \${content}
</body>
</html>`;

    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Manuel_Utilisation_TOT_Stock_PRO_v5.4.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadMarketingHtml = () => {
    const blob = new Blob([MARKETING_HTML_CODE], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tot_stock_landing_page.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setDocumentationModalOpen({ open: false, tab: 'manual' });
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-3 bg-slate-950/75 backdrop-blur-sm animate-fadeIn documentation-modal-backdrop"
    >
      <div className="w-full max-w-4xl bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-5 text-slate-800 dark:text-slate-100 max-h-[94dvh] sm:max-h-[92vh] flex flex-col overflow-hidden documentation-modal-box">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 pb-2.5 sm:pb-3 border-b border-slate-100 dark:border-slate-800 documentation-header-bar">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-2xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 flex items-center justify-center font-bold shrink-0">
              <BookOpen className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white truncate">
                {tr(language, 'Centre de Documentation, Guides PDF & Export Android', 'Documentation Center, PDF Guides & Android Export')}
              </h2>
              <div className="text-[10px] sm:text-[11px] text-slate-400 truncate">
                {tr(language, `Devise active : ${currObj.name} (${currObj.symbol}) • Version Pro v5.4.0`, `Active Currency : ${currObj.name} (${currObj.symbol}) • Version Pro v5.4.0`)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={handleDownloadManualHtml}
              className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-orange-50 dark:bg-orange-950/40 hover:bg-orange-100 dark:hover:bg-orange-900/50 text-orange-700 dark:text-orange-300 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shrink-0"
              title="Télécharger le manuel au format HTML autonome prêt pour impression PDF A4"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Télécharger (.html/PDF)</span>
            </button>
            <button
              onClick={handlePrint}
              className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shrink-0"
              title="Imprimer / Exporter en PDF"
            >
              <Printer className="w-3.5 h-3.5 text-orange-500" />
              <span className="hidden xs:inline">{tr(language, 'Imprimer / PDF', 'Print / PDF')}</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDocumentationModalOpen({ open: false, tab: 'manual' });
              }}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer active:scale-95 shadow-xs shrink-0"
              title={t('common_close')}
              aria-label="Fermer"
            >
              <X className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="grid grid-cols-2 sm:grid-cols-4 rounded-2xl bg-slate-100 dark:bg-slate-800/80 p-1 my-3 border border-slate-200 dark:border-slate-700/80 gap-1 text-[11px] font-bold documentation-tabs">
          <button
            onClick={() => setActiveTab('manual')}
            className={`py-2 px-2 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'manual'
                ? 'bg-white dark:bg-slate-900 text-orange-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">📖 {tr(language, 'Manuel (PDF)', 'Manual (PDF)')}</span>
          </button>

          <button
            onClick={() => setActiveTab('android')}
            className={`py-2 px-2 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'android'
                ? 'bg-white dark:bg-slate-900 text-orange-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">🤖 {tr(language, 'Android Studio', 'Android Studio')}</span>
          </button>

          <button
            onClick={() => setActiveTab('marketing')}
            className={`py-2 px-2 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'marketing'
                ? 'bg-white dark:bg-slate-900 text-orange-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Globe className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">🌐 {tr(language, 'Site Web HTML', 'Web HTML')}</span>
          </button>

          <button
            onClick={() => setActiveTab('supabase')}
            className={`py-2 px-2 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'supabase'
                ? 'bg-white dark:bg-slate-900 text-orange-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Terminal className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">💾 {tr(language, 'Supabase CLI & SQL', 'Supabase CLI & SQL')}</span>
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div id="printable-manual-root" className="flex-1 overflow-y-auto pr-1 text-xs space-y-4 printable-content">

          {/* TAB 1: MANUEL D'UTILISATION OFFICIEL AVEC CAPTURES D'ÉCRAN */}
          {activeTab === 'manual' && (
            <div className="space-y-6 p-4 sm:p-6 bg-slate-50 dark:bg-slate-800/40 rounded-3xl border border-slate-200 dark:border-slate-800">
              {/* Entête du Document */}
              <div className="border-b border-slate-200 dark:border-slate-700 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 text-[10px] font-black uppercase tracking-wider mb-1">
                    Document de Référence Officiel • v5.4 PRO
                  </div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
                    MANUEL D'UTILISATION OFFICIEL - TOT STOCK PRO
                  </h3>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Guide exhaustif illustré : architecture, devise centralisée, multi-dépôts, traçabilité et exploitation terrain
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    onClick={handleDownloadManualHtml}
                    className="px-3.5 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 font-bold flex items-center justify-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer text-xs"
                    title="Télécharger le manuel autonome au format HTML prêt pour impression PDF A4"
                  >
                    <Download className="w-3.5 h-3.5 text-orange-600" />
                    <span>Télécharger le Manuel (A4 Prêt)</span>
                  </button>
                  <button
                    onClick={handlePrint}
                    className="px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-orange-600/20 transition active:scale-95 cursor-pointer shrink-0 text-xs"
                    title="Exporter ou imprimer le manuel au format A4"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Imprimer en PDF (A4)</span>
                  </button>
                </div>
              </div>

              {/* Notification d'impression */}
              {printNotice && (
                <div className="p-3 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200 rounded-2xl text-xs flex items-center gap-2.5 animate-pulse shadow-sm">
                  <Printer className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>{printNotice} Destination recommandée : <strong>« Enregistrer au format PDF »</strong>.</span>
                </div>
              )}

              {/* Guide Impression PDF sans blocage */}
              <div className="p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-2xl flex items-start gap-2.5 text-[11px] text-amber-900 dark:text-amber-200">
                <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold">Comment exporter ce manuel complet en PDF ?</div>
                  <div>1. Cliquez sur <strong>« Imprimer en PDF (A4) »</strong>, puis dans le menu de destination de votre imprimante, sélectionnez <strong>« Enregistrer au format PDF »</strong> (ou « Save as PDF »).</div>
                  <div>2. Si votre navigateur restreint l'impression directe dans cet aperçu intégré, cliquez sur <strong>« Télécharger le Manuel (A4 Prêt) »</strong> : ouvrez le fichier téléchargé dans votre navigateur (Chrome/Edge/Safari) et faites <kbd className="px-1.5 py-0.5 bg-amber-200/60 dark:bg-amber-900 rounded font-mono font-bold">Ctrl + P</kbd> pour générer le PDF A4 parfait sans aucune coupure.</div>
                </div>
              </div>

              {/* Sommaire & Guide Rapide */}
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="text-xs font-black text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-orange-600" />
                  <span>TABLE DES MATIÈRES &amp; CHAPITRES DU MANUEL</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-300 pt-1">
                  <div>1. Architecture &amp; Devise Centralisée Entreprise</div>
                  <div>2. Authentification PIN &amp; Forçage de Réinitialisation</div>
                  <div>3. Fiches Articles &amp; Double Traçabilité (1D / 2D)</div>
                  <div>4. Multi-Dépôts &amp; Droits d'Accès Collaborateurs (1, 2, 3... ou tous)</div>
                  <div>5. Mouvements de Stock &amp; Panier Multi-Articles (Batch)</div>
                  <div>6. Organisation : Chantiers, Conducteurs &amp; Suppléants (+)</div>
                  <div>7. Rôles RBAC &amp; Confidentialité des Logs de Connexion</div>
                  <div>8. Menu Général « ••• (Plus) » &amp; Recherche Instantanée</div>
                  <div>9. Comptage d'Inventaire Physique &amp; Régularisation</div>
                  <div>10. Multi-Postes, Partage QR &amp; Synchronisation Cloud</div>
                  <div className="col-span-1 sm:col-span-2 text-orange-600 dark:text-orange-400 font-bold">11. Commandes Matériel, Drive Magasin &amp; Paniers Multi-Chantiers Indépendants (↑ / ↓)</div>
                </div>
              </div>

              {/* CHAPITRE 1 */}
              <div className="manual-chapter space-y-3 pt-2">
                <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 font-black text-sm border-b border-orange-200 dark:border-orange-950 pb-1.5">
                  <span className="w-6 h-6 rounded-lg bg-orange-600 text-white flex items-center justify-center text-xs">1</span>
                  <h4>Architecture Système : La devise est-elle locale ou centralisée ?</h4>
                </div>
                <div className="space-y-2 text-slate-600 dark:text-slate-300 leading-relaxed text-justify">
                  <p>
                    <strong>Réponse formelle :</strong> La devise de valorisation de TOT Stock est <strong>100 % CENTRALISÉE au niveau de l'entreprise</strong>.
                  </p>
                  <p>
                    Contrairement aux applications bureautiques isolées où chaque appareil conserve son propre réglage, la devise choisie (Euro <code>EUR €</code>, Dollar US <code>USD $</code>, Franc Suisse <code>CHF</code>, Livre Sterling <code>GBP £</code>, Dollar Canadien <code>CAD $</code>, Franc CFA <code>XOF CFA</code>, Dirham Marocain <code>MAD</code>, etc.) est enregistrée dans la table centrale Supabase <code>app_settings</code> (clé <code>company_currency</code>).
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li><strong>Synchronisation instantanée :</strong> lorsqu'un administrateur sélectionne une nouvelle devise dans les préférences, l'ensemble des smartphones d'atelier, tablettes de chantier et ordinateurs de bureau adoptent immédiatement cette monnaie sans redémarrage.</li>
                    <li><strong>Résilience hors-ligne (Offline) :</strong> une copie locale sécurisée dans le stockage mémoire du terminal (cache <code>localStorage</code>) garantit que les prix, valorisations d'inventaire et coûts de sorties continuent de s'afficher avec le bon symbole monétaire même en l'absence temporaire de réseau 4G/WiFi.</li>
                  </ul>
                </div>

                {/* Capture 1 */}
                <UiScreenshotCard
                  title="Préférences Entreprise • Sélecteur de Devise Centralisée"
                  badge="Cloud Sync Actif"
                  caption="Capture 1 : Module de configuration de la devise centralisée dans le Menu Général. La sélection met à jour automatiquement l'ensemble des postes de travail connectés à l'entreprise."
                >
                  <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center font-black">
                          <Coins className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="font-extrabold text-xs text-slate-900 dark:text-white">Devise de Valorisation Entreprise</div>
                          <div className="text-[10px] text-slate-400">Enregistrée sur Supabase table app_settings</div>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-extrabold text-[10px]">
                        ✓ Centralisée
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 pt-1">
                      {['EUR (€)', 'USD ($)', 'CHF (CHF)', 'XOF (CFA)'].map((curr, idx) => (
                        <div
                          key={curr}
                          className={`p-2 rounded-xl text-center font-bold text-[10px] border ${
                            idx === 0
                              ? 'bg-orange-500 text-white border-orange-600 shadow-sm'
                              : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {curr}
                        </div>
                      ))}
                    </div>
                  </div>
                </UiScreenshotCard>
              </div>

              {/* CHAPITRE 2 */}
              <div className="manual-chapter space-y-3 pt-2">
                <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 font-black text-sm border-b border-orange-200 dark:border-orange-950 pb-1.5">
                  <span className="w-6 h-6 rounded-lg bg-orange-600 text-white flex items-center justify-center text-xs">2</span>
                  <h4>Connexion Sécurisée par Code PIN &amp; Forçage de Réinitialisation</h4>
                </div>
                <div className="space-y-2 text-slate-600 dark:text-slate-300 leading-relaxed text-justify">
                  <p>
                    L'application utilise un système d'authentification rapide et robuste par <strong>Code PIN à 4 chiffres</strong> couplé au hachage cryptographique SHA-256.
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li><strong>Sélection du profil :</strong> l'opérateur choisit son département ou nom, puis compose son code secret sur le pavé numérique virtuel ou physique.</li>
                    <li><strong>Option « Exiger la réinitialisation du code PIN à la prochaine connexion » :</strong> l'administrateur peut cocher cette option dans la fiche utilisateur ou cliquer sur le bouton clé rapide. Dès que le collaborateur se connecte, l'application bloque l'accès et affiche obligatoirement l'écran de changement de code PIN (avec saisie et confirmation).</li>
                    <li><strong>Verrouillage par inactivité (Auto-Lock) :</strong> afin de prévenir toute usurpation sur les chantiers, l'application verrouille la session après un délai d'inactivité paramétrable (15s, 30s, 1m, 5m, 15m, 30m ou jamais).</li>
                  </ul>
                </div>

                {/* Capture 2 */}
                <UiScreenshotCard
                  title="Écran de Connexion • Forçage de Nouveau Code PIN"
                  badge="Sécurité Active"
                  caption="Capture 2 : Écran de connexion sécurisée avec détection du flag must_change_pin obligeant l'utilisateur à créer son nouveau code confidentiel."
                >
                  <div className="max-w-xs mx-auto p-3.5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-3 text-center">
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-950 text-orange-600 font-bold mx-auto">
                      <KeyRound className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-extrabold text-xs text-slate-900 dark:text-white">Définir votre nouveau code PIN</div>
                      <div className="text-[10px] text-slate-500">Alexandre Martin (Responsable Outillage)</div>
                    </div>
                    <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[10px] text-amber-800 dark:text-amber-300 text-left flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                      <span>L'administrateur exige le renouvellement de votre code PIN avant d'accéder au stock.</span>
                    </div>
                    <div className="space-y-1.5 text-left">
                      <div className="text-[10px] font-bold text-slate-600 dark:text-slate-300">Nouveau PIN :</div>
                      <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-900 border text-center font-mono text-sm tracking-widest font-black text-slate-800 dark:text-white">
                        • • • •
                      </div>
                      <div className="text-[10px] font-bold text-slate-600 dark:text-slate-300">Confirmer PIN :</div>
                      <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-900 border text-center font-mono text-sm tracking-widest font-black text-slate-800 dark:text-white">
                        • • • •
                      </div>
                    </div>
                    <button className="w-full py-2 rounded-xl bg-orange-600 text-white font-extrabold text-xs shadow-md shadow-orange-600/20">
                      Enregistrer &amp; Ouvrir ma Session
                    </button>
                  </div>
                </UiScreenshotCard>
              </div>

              {/* CHAPITRE 3 */}
              <div className="manual-chapter space-y-3 pt-2">
                <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 font-black text-sm border-b border-orange-200 dark:border-orange-950 pb-1.5">
                  <span className="w-6 h-6 rounded-lg bg-orange-600 text-white flex items-center justify-center text-xs">3</span>
                  <h4>Fiches Articles &amp; Double Traçabilité : Codes 1D Fabricant &amp; QR TOT 2D</h4>
                </div>
                <div className="space-y-2 text-slate-600 dark:text-slate-300 leading-relaxed text-justify">
                  <p>
                    Chaque article de votre catalogue dispose d'une fiche complète et d'une double traçabilité optique native :
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li><strong>Code-barres fabricant 1D (EAN-13, Code-128, UPC) :</strong> c'est le code imprimé d'origine sur le carton ou l'emballage du fournisseur (Hilti, Bosch, Legrand, Schneider, etc.). Vous pouvez le scanner immédiatement pour affecter du stock sans ré-étiqueter le matériel.</li>
                    <li><strong>QR Code TOT 2D Propriétaire :</strong> code haute densité incluant le logo vectoriel TOT gravé au centre, généré automatiquement par l'application pour étiqueter les bacs, casiers, outillages électroportatifs et consommables en vrac.</li>
                    <li><strong>Localisation en 3 dimensions :</strong> chaque référence est rattachée à son Dépôt (ou Magasin), sa Salle (ou Allée) et son Étagère (ou Bac).</li>
                  </ul>
                </div>

                {/* Capture 3 */}
                <UiScreenshotCard
                  title="Fiche Article • Bosch Perforateur SDS-Plus GBH 2-28 F"
                  badge="Réf : OUT-PERFO-01"
                  caption="Capture 3 : Fiche article détaillée avec double affichage 1D/2D, statut de stock dynamique, seuil d'alerte et valorisation en devise centralisée."
                >
                  <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-[10px] font-bold text-orange-600 uppercase">Outillage Électroportatif</div>
                        <div className="font-black text-sm text-slate-900 dark:text-white">Perforateur Burineur SDS-Plus 880W</div>
                        <div className="text-[10px] text-slate-500">Marque : Bosch Professional | Modèle : GBH 2-28 F</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-black text-slate-900 dark:text-white">189,50 €</div>
                        <div className="text-[9px] text-emerald-600 font-bold">12 en stock (Min : 3)</div>
                      </div>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">Emplacement :</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">📍 Dépôt Principal &gt; Atelier Central &gt; Étagère C3</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-1 text-center">
                      <div className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                        <Barcode className="w-8 h-8 mx-auto text-slate-800 dark:text-slate-200" />
                        <div className="text-[9px] font-mono mt-1 text-slate-500">3165140882859 (EAN13)</div>
                      </div>
                      <div className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                        <QrCode className="w-8 h-8 mx-auto text-orange-600" />
                        <div className="text-[9px] font-mono mt-1 text-slate-500">OUT-PERFO-01 (QR TOT)</div>
                      </div>
                    </div>
                  </div>
                </UiScreenshotCard>
              </div>

              {/* CHAPITRE 4 */}
              <div className="manual-chapter space-y-3 pt-2">
                <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 font-black text-sm border-b border-orange-200 dark:border-orange-950 pb-1.5">
                  <span className="w-6 h-6 rounded-lg bg-orange-600 text-white flex items-center justify-center text-xs">4</span>
                  <h4>Multi-Dépôts &amp; Droits d'Accès par Collaborateur (1 dépôt, 2 dépôts, 3 dépôts... ou tous)</h4>
                </div>
                <div className="space-y-2 text-slate-600 dark:text-slate-300 leading-relaxed text-justify">
                  <p>
                    <strong>Gestion stricte des autorisations de prélèvement :</strong> Les utilisateurs n'ont pas forcément accès à l'ensemble des entrepôts de la société. TOT Stock Pro intègre un contrôle d'accès multi-dépôts d'une grande finesse :
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li><strong>Option « Accès à tous les dépôts (Prélèvement libre) » :</strong> accorde au collaborateur le droit d'effectuer des sorties dans n'importe quel entrepôt sans restriction.</li>
                    <li><strong>Option granulaire par cases à cocher :</strong> vous pouvez cocher exactement les dépôts autorisés : <strong>1 seul dépôt</strong> (ex: Dépôt Nord uniquement), <strong>2 dépôts</strong>, <strong>3 dépôts</strong> ou plus.</li>
                    <li><strong>Contrôle au scan et au panier :</strong> si un utilisateur tente de prélever du matériel appartenant à un dépôt non autorisé pour son profil, le scanner refuse immédiatement l'opération et affiche : <code>🚫 Prélèvement interdit : Vous n'avez pas accès au dépôt « Dépôt Sud »</code>.</li>
                  </ul>
                </div>

                {/* Capture 4 */}
                <UiScreenshotCard
                  title="Utilisateurs &amp; Droits • Configuration des Dépôts Autorisés"
                  badge="Contrôle Multi-Dépôts"
                  caption="Capture 4 : Configuration des autorisations de dépôts pour un utilisateur. Possibilité d'accorder l'accès à 1 dépôt, 2 dépôts, 3 dépôts... ou à tous."
                >
                  <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <Building className="w-3.5 h-3.5 text-orange-600" />
                        Dépôts &amp; Magasins autorisés pour ce compte
                      </span>
                      <span className="text-[10px] text-orange-600 font-bold">2 sélectionné(s)</span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-900 border text-[11px] space-y-1.5">
                      <label className="flex items-center gap-2 font-bold text-slate-600 dark:text-slate-400">
                        <input type="checkbox" checked={false} readOnly className="rounded text-orange-600" />
                        <span>🏢 Accès à tous les dépôts (Prélèvement libre)</span>
                      </label>
                      <div className="pt-1 border-t border-slate-200 dark:border-slate-700 grid grid-cols-2 gap-1.5">
                        <div className="p-1.5 rounded-lg bg-orange-100/70 dark:bg-orange-950/60 border border-orange-300 dark:border-orange-800 text-[10px] font-bold text-orange-900 dark:text-orange-200 flex items-center gap-1.5">
                          <span>☑️ 📍 Dépôt Principal</span>
                        </div>
                        <div className="p-1.5 rounded-lg bg-orange-100/70 dark:bg-orange-950/60 border border-orange-300 dark:border-orange-800 text-[10px] font-bold text-orange-900 dark:text-orange-200 flex items-center gap-1.5">
                          <span>☑️ 📍 Dépôt Sud (A7)</span>
                        </div>
                        <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border text-[10px] text-slate-500 flex items-center gap-1.5">
                          <span>◻️ 📍 Magasin Outillage</span>
                        </div>
                        <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border text-[10px] text-slate-500 flex items-center gap-1.5">
                          <span>◻️ 📍 Entrepot Central</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </UiScreenshotCard>
              </div>

              {/* CHAPITRE 5 */}
              <div className="manual-chapter space-y-3 pt-2">
                <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 font-black text-sm border-b border-orange-200 dark:border-orange-950 pb-1.5">
                  <span className="w-6 h-6 rounded-lg bg-orange-600 text-white flex items-center justify-center text-xs">5</span>
                  <h4>Mouvements de Stock : Sorties Chantiers, Entrées Réception &amp; Panier Multi-Articles</h4>
                </div>
                <div className="space-y-2 text-slate-600 dark:text-slate-300 leading-relaxed text-justify">
                  <p>
                    Le moteur de transactions assure un débit ultra-rapide tout en garantissant la traçabilité absolue des flux :
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li><strong>Mode SORTIE CHANTIER (OUT) :</strong> sélectionnez ou scannez le numéro de chantier (ex: <code>CH-2024-042</code>). Le stock est décrémenté, le coût financier est valorisé et l'opération est rattachée au conducteur de travaux responsable.</li>
                    <li><strong>Mode ENTRÉE RÉCEPTION (IN) :</strong> incrémentation immédiate du stock lors de l'arrivée des livraisons fournisseurs ou retours chantier.</li>
                    <li><strong>Sécurité stricte Camionnettes &amp; Binômes :</strong> seul l'utilisateur titulaire de la camionnette et ses <strong>binômes autorisés</strong> peuvent emprunter ou prélever du matériel dans ce véhicule. De plus, le titulaire et ses binômes peuvent <strong>entrer du stock uniquement dans leur camionnette</strong>, même s'ils ne disposent pas de l'autorisation d'entrée dans les autres dépôts centraux.</li>
                    <li><strong>Panier Multi-Articles (Batch Cart) :</strong> idéal pour les magasiniers et techniciens prélevant plusieurs références d'affilée en sortie directe. Vous scannez 5, 10 ou 20 articles à la suite, ajustez les quantités avec les boutons <code>+</code> / <code>-</code> (ou <code>↑</code> / <code>↓</code>), puis validez le tout en 1 seule signature horodatée. Pour les <strong>commandes anticipées Drive avec affectation multi-chantiers indépendants</strong>, reportez-vous au <em>Chapitre 11</em>.</li>
                  </ul>
                </div>

                {/* Capture 5 */}
                <UiScreenshotCard
                  title="Scanner Haute Vitesse • Mode Sortie Chantier &amp; Panier Multi-Articles"
                  badge="Scan Actif &lt; 0.2s"
                  caption="Capture 5 : Interface de scan en temps réel et tiroir Panier Multi-Articles permettant la validation groupée vers le chantier sélectionné."
                >
                  <div className="p-3 bg-slate-900 rounded-xl text-white space-y-2.5">
                    {/* Viewfinder Mockup */}
                    <div className="relative h-24 bg-slate-950 rounded-lg border border-orange-500/40 flex items-center justify-center overflow-hidden">
                      <div className="w-32 h-16 border-2 border-dashed border-orange-500 rounded-lg flex items-center justify-center">
                        <span className="text-[9px] font-mono text-orange-400 animate-pulse">VISÉE EN COURS</span>
                      </div>
                      <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-rose-600 text-white text-[9px] font-black">
                        SORTIE CHANTIER
                      </div>
                    </div>
                    {/* Panier Mini */}
                    <div className="p-2 rounded-lg bg-slate-800 text-[10px] space-y-1">
                      <div className="flex justify-between font-bold text-slate-300">
                        <span>Panier : 3 références scannées</span>
                        <span className="text-orange-400">Total : 452,30 €</span>
                      </div>
                      <div className="text-slate-400">Chantier d'affectation : 🏗️ CH-2024-042 (Rénovation Clinique)</div>
                    </div>
                  </div>
                </UiScreenshotCard>
              </div>

              {/* CHAPITRE 6 */}
              <div className="manual-chapter space-y-3 pt-2">
                <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 font-black text-sm border-b border-orange-200 dark:border-orange-950 pb-1.5">
                  <span className="w-6 h-6 rounded-lg bg-orange-600 text-white flex items-center justify-center text-xs">6</span>
                  <h4>Organisation : Départements, Chantiers, Responsables &amp; Suppléants (+)</h4>
                </div>
                <div className="space-y-2 text-slate-600 dark:text-slate-300 leading-relaxed text-justify">
                  <p>
                    L'architecture analytique reflète la réalité opérationnelle des entreprises du BTP et de l'artisanat :
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li><strong>Filtrage automatique par département :</strong> lors de l'enregistrement d'un chantier, le choix du département (ex: Génie Climatique) restreint la liste des conducteurs de travaux éligibles aux seuls techniciens de ce service.</li>
                    <li><strong>Bouton "+" Suppléants :</strong> vous pouvez associer autant de suppléants que nécessaire sur un chantier ou un département pour garantir la continuité de validation des sorties en cas de congés ou d'astreinte.</li>
                    <li><strong>Droit KPI Global Société :</strong> option activable sur les départements clés (Logistique, Direction générale, Achats) pour leur donner une visibilité panoramique sur tous les dépôts réunis.</li>
                  </ul>
                </div>
              </div>

              {/* CHAPITRE 7 */}
              <div className="manual-chapter space-y-3 pt-2">
                <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 font-black text-sm border-b border-orange-200 dark:border-orange-950 pb-1.5">
                  <span className="w-6 h-6 rounded-lg bg-orange-600 text-white flex items-center justify-center text-xs">7</span>
                  <h4>Rôles RBAC &amp; Confidentialité Stricte des Logs de Connexion</h4>
                </div>
                <div className="space-y-2 text-slate-600 dark:text-slate-300 leading-relaxed text-justify">
                  <p>
                    <strong>Protection de la vie privée et traçabilité de sécurité :</strong> La visibilité des logs de connexion est désormais strictement cloisonnée grâce à la permission <code>perm_view_all_login_logs</code> ("🔐 Voir tous les logs de connexion - Superviseur") :
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li><strong>Rôles Superviseurs &amp; Administrateurs :</strong> les utilisateurs détenant cette permission visualisent le journal complet de l'ensemble des connexions, trigrammes, adresses IP et horodatages avec le badge <code>🛡️ Supervision : Tous les logs</code>.</li>
                    <li><strong>Utilisateurs standards :</strong> chaque collaborateur visualise <strong>uniquement ses propres logs de connexion</strong> avec le badge <code>🔒 Mes logs uniquement</code>, préservant la confidentialité des collègues.</li>
                  </ul>
                </div>

                {/* Capture 6 */}
                <UiScreenshotCard
                  title="Flux d'Activités • Cloisonnement des Logs de Connexion"
                  badge="Contrôle RBAC"
                  caption="Capture 6 : Vue comparée du flux d'activité. Les superviseurs visualisent l'ensemble des accès tandis que les opérateurs ne voient que leurs propres connexions."
                >
                  <div className="space-y-2">
                    <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[10px] space-y-1">
                      <div className="flex items-center justify-between font-bold text-amber-900 dark:text-amber-200">
                        <span className="flex items-center gap-1">🛡️ Profil Administrateur (Supervision : Tous les logs)</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100">perm_view_all_login_logs</span>
                      </div>
                      <div className="text-slate-600 dark:text-slate-300">Affiche les connexions de Marie D., Paul V., Thomas R. et tous les techniciens.</div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-[10px] space-y-1">
                      <div className="flex items-center justify-between font-bold text-blue-900 dark:text-blue-200">
                        <span className="flex items-center gap-1">🔒 Profil Technicien Standard (Mes logs uniquement)</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-200 dark:bg-blue-800 text-blue-900 dark:text-blue-100">Confidentialité Active</span>
                      </div>
                      <div className="text-slate-600 dark:text-slate-300">Les logs des autres collaborateurs sont masqués. Seule votre propre activité est visible.</div>
                    </div>
                  </div>
                </UiScreenshotCard>
              </div>

              {/* CHAPITRE 8 */}
              <div className="manual-chapter space-y-3 pt-2">
                <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 font-black text-sm border-b border-orange-200 dark:border-orange-950 pb-1.5">
                  <span className="w-6 h-6 rounded-lg bg-orange-600 text-white flex items-center justify-center text-xs">8</span>
                  <h4>Navigation Ergonomique : Barre de Recherche dans le Menu « ••• (Plus) »</h4>
                </div>
                <div className="space-y-2 text-slate-600 dark:text-slate-300 leading-relaxed text-justify">
                  <p>
                    Le menu général regroupe l'ensemble des modules d'administration et de gestion avancée. Pour éviter tout défilement inutile :
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li><strong>Recherche instantanée :</strong> tapez simplement un mot-clé (ex: <code>devise</code>, <code>dépôt</code>, <code>pin</code>, <code>conducteur</code>, <code>pdf</code>, <code>inventaire</code>, <code>étiquette</code>, <code>licence</code>).</li>
                    <li><strong>Indexation multicritère :</strong> la recherche analyse les titres, rubriques, descriptions et synonymes pour afficher le résultat immédiatement avec compteur de correspondances et bouton d'effacement rapide <code>(X)</code>.</li>
                  </ul>
                </div>

                {/* Capture 7 */}
                <UiScreenshotCard
                  title="Menu Général « ••• (Plus) » • Recherche Instantanée Intelligente"
                  badge="Navigation Rapide"
                  caption="Capture 7 : Barre de recherche intégrée dans le menu Plus permettant de retrouver instantanément n'importe quel écran en moins d'une seconde."
                >
                  <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2.5">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-orange-500" />
                      <div className="w-full pl-8 pr-8 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-orange-400 text-xs font-bold text-slate-800 dark:text-white flex items-center justify-between">
                        <span>depot</span>
                        <X className="w-3 h-3 text-slate-400" />
                      </div>
                    </div>
                    <div className="text-[10px] font-bold text-orange-600">2 résultat(s) trouvé(s) :</div>
                    <div className="space-y-1.5 text-xs">
                      <div className="p-2 rounded-lg bg-orange-50/60 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800 flex items-center justify-between">
                        <span className="font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                          <Warehouse className="w-3.5 h-3.5 text-orange-600" />
                          Gestion des Dépôts &amp; Magasins
                        </span>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      </div>
                      <div className="p-2 rounded-lg bg-orange-50/60 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800 flex items-center justify-between">
                        <span className="font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-orange-600" />
                          Utilisateurs, Dépôts Autorisés &amp; Forçage PIN
                        </span>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      </div>
                    </div>
                  </div>
                </UiScreenshotCard>
              </div>

              {/* CHAPITRE 9 */}
              <div className="manual-chapter space-y-3 pt-2">
                <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 font-black text-sm border-b border-orange-200 dark:border-orange-950 pb-1.5">
                  <span className="w-6 h-6 rounded-lg bg-orange-600 text-white flex items-center justify-center text-xs">9</span>
                  <h4>Comptage d'Inventaire Physique &amp; Régularisation Automatique</h4>
                </div>
                <div className="space-y-2 text-slate-600 dark:text-slate-300 leading-relaxed text-justify">
                  <p>
                    Le module d'audit physique vous permet de réaliser les inventaires de fin d'année ou tournants :
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li><strong>Saisie du comptage réel :</strong> scannez ou saisissez les quantités réellement présentes sur les étagères.</li>
                    <li><strong>Calcul automatique des écarts :</strong> l'application calcule instantanément les écarts théoriques vs physiques (surplus ou manquant) et leur valorisation monétaire selon la devise d'entreprise.</li>
                    <li><strong>Régularisation traçable :</strong> en cliquant sur « Appliquer la régularisation », le stock est ajusté et un mouvement d'audit horodaté est archivé dans le flux avec le trigramme du contrôleur.</li>
                  </ul>
                </div>
              </div>

              {/* CHAPITRE 10 */}
              <div className="manual-chapter space-y-3 pt-2">
                <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 font-black text-sm border-b border-orange-200 dark:border-orange-950 pb-1.5">
                  <span className="w-6 h-6 rounded-lg bg-orange-600 text-white flex items-center justify-center text-xs">10</span>
                  <h4>Multi-Postes, Partage de Licence par QR Code &amp; Base Cloud Supabase</h4>
                </div>
                <div className="space-y-2 text-slate-600 dark:text-slate-300 leading-relaxed text-justify">
                  <p>
                    TOT Stock Pro est conçu pour fonctionner en réseau multi-utilisateurs et multi-terminaux :
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li><strong>Clonage instantané par QR Code :</strong> ouvrez « Partage de Licence QR Code » sur l'appareil administrateur. Le second smartphone scanne ce code et reçoit automatiquement l'URL Supabase, la clé API et la clé de licence d'entreprise sans aucune saisie fastidieuse.</li>
                    <li><strong>Synchronisation en arrière-plan :</strong> chaque sortie, entrée ou création d'article est synchronisée en temps réel avec votre base PostgreSQL Supabase hébergée.</li>
                  </ul>
                </div>
              </div>

              {/* CHAPITRE 11 */}
              <div className="manual-chapter space-y-3 pt-2">
                <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 font-black text-sm border-b border-orange-200 dark:border-orange-950 pb-1.5">
                  <span className="w-6 h-6 rounded-lg bg-orange-600 text-white flex items-center justify-center text-xs">11</span>
                  <h4>Commandes Matériel, Drive Magasin &amp; Paniers Multi-Chantiers Indépendants</h4>
                </div>
                <div className="space-y-2 text-slate-600 dark:text-slate-300 leading-relaxed text-justify">
                  <p>
                    Le module <strong>« Panier &amp; Commandes Matériel »</strong> (Click &amp; Collect Drive Magasin) permet aux conducteurs de travaux, chefs de chantier et techniciens de planifier et réserver les fournitures nécessaires avant leur passage au dépôt :
                  </p>
                  <ul className="list-disc pl-5 space-y-1.5">
                    <li>
                      <strong>Chaque panier possède son propre numéro de chantier indépendant :</strong>
                      Vous pouvez créer et gérer plusieurs paniers actifs simultanément (ex: <em>Panier 1</em>, <em>Panier 2</em>). Contrairement à un panier unique global, chaque panier dispose de son propre chantier d'affectation (ex: <code>CH-2026-01 Résidence Les Lilas</code> pour le premier panier, et <code>CH-2026-04 Hôpital Nord</code> pour le second). Lors de la validation, le numéro de commande et l'imputation analytique sont générés spécifiquement pour le chantier associé à chaque panier.
                    </li>
                    <li>
                      <strong>Gestion mono-dépôt par panier :</strong>
                      Pour garantir une préparation physique cohérente sans éclatement logistique, chaque panier est rattaché au dépôt d'origine de ses articles. Vous pouvez ainsi préparer une commande pour le « Dépôt Principal » et une autre pour le « Dépôt Nord ».
                    </li>
                    <li>
                      <strong>Masquage et affichage de la liste des articles via les boutons Agrandir (↑) et Diminuer (↓) :</strong>
                      <ul className="list-circle pl-5 mt-1 space-y-1">
                        <li><strong>Bouton Diminuer (↓) :</strong> masque la liste complète des articles du panier pour dégager immédiatement l'accès au choix du chantier, au dépôt de retrait et au bouton de validation de la commande. Un bandeau synthétique indique le nombre de références et de pièces totales.</li>
                        <li><strong>Bouton Agrandir (↑) :</strong> déplie et affiche l'intégralité des articles avec leurs références, dépôts d'origine, prix unitaires, ajustements pas-à-pas de quantités et boutons de retrait.</li>
                        <li><strong>Accessibilité double :</strong> ces contrôles (↑ / ↓) sont présents dans l'en-tête du panier ainsi qu'au-dessus de la liste des articles, tant dans le module Commandes Matériel que dans le Panier Scanner Rapide.</li>
                      </ul>
                    </li>
                    <li>
                      <strong>Validation préalable obligatoire et transmission au magasin :</strong>
                      <ul className="list-circle pl-5 mt-1 space-y-1">
                        <li><strong>Bouton de transmission rapide sur la miniature :</strong> chaque miniature de panier dispose désormais d'un bouton d'action directe <code>Transmettre</code> permettant d'envoyer le panier au magasin sans avoir à ouvrir chaque détail.</li>
                        <li><strong>Validation sécurisée par dialogue de confirmation :</strong> tout comme les actions de suppression, chaque transmission de commande ou de panier vers le magasin déclenche une fenêtre de validation modale récapitulative (Nom du panier, Chantier d'affectation 🏗️, Nombre d'articles et de pièces totales, Dépôt de retrait 🏢). L'utilisateur doit expressément confirmer l'envoi pour éviter toute commande intempestive.</li>
                        <li><strong>Boutons Vider et Supprimer le panier :</strong> accessibles sur chaque miniature, dans la barre active et au-dessus de la liste des articles. Ils disposent tous d'un dialogue de confirmation empêchant les pertes accidentelles. Si un seul panier existe, le bouton supprimer réinitialise proprement le panier à zéro.</li>
                      </ul>
                    </li>
                    <li>
                      <strong>Présence systématique des numéros de chantier dans toutes les miniatures des paniers :</strong>
                      <ul className="list-circle pl-5 mt-1 space-y-1">
                        <li><strong>Visibilité permanente :</strong> chaque miniature de panier (dans la rangée d'onglets miniatures comme dans la grille complète) affiche systématiquement son numéro de chantier d'affectation (ex: <code>🏗️ Chantier : CH-2026-01</code>).</li>
                        <li><strong>Affectation directe :</strong> un menu déroulant intégré à chaque miniature permet d'attribuer ou de changer le chantier associé à un panier en un clic.</li>
                        <li><strong>Bascule instantanée :</strong> cliquer sur une miniature active le panier correspondant et synchronise automatiquement le chantier choisi dans le formulaire.</li>
                      </ul>
                    </li>
                    <li>
                      <strong>Circuit de validation hiérarchique et retrait Drive sécurisé :</strong>
                      Si un département applique un seuil budgétaire d'approbation (<code>require_order_approval</code>), les commandes supérieures au montant configuré passent en statut <code>WAITING_APPROVAL</code> jusqu'à signature du responsable ou de ses suppléants. Les magasiniers reçoivent une alerte sonore et visuelle en temps réel, préparent le lot, et le demandeur procède au retrait sécurisé par scan QR Code, saisie manuelle, signature tactile et photo de preuve.
                    </li>
                  </ul>
                </div>

                {/* Capture 11 */}
                <UiScreenshotCard
                  title="Panier &amp; Commandes Matériel • Multi-Paniers par Chantier, Transmission Rapide &amp; Validation"
                  badge="Drive &amp; Click &amp; Collect"
                  caption="Capture 11 : Interface de commande avec gestion multi-paniers. Chaque miniature affiche son numéro de chantier, ses boutons Vider / Supprimer avec confirmation, et son bouton de transmission rapide validé par fenêtre de sécurité avant envoi au magasin."
                >
                  <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2.5">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-700">
                      <div className="flex items-center gap-2">
                        <span className="p-1 rounded-lg bg-orange-100 text-orange-600 text-xs">🧺</span>
                        <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                          Mes Paniers Actifs (2)
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-[10px]">
                        <span className="px-2 py-0.5 rounded-md bg-orange-600 text-white font-bold">Agrandir (↑ Afficher)</span>
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">Diminuer (↓ Masquer)</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                      <div className="p-2 rounded-lg border-2 border-orange-500 bg-orange-50/40 dark:bg-orange-950/20 space-y-1">
                        <div className="flex justify-between font-bold">
                          <span>Panier 1 • Sanitaire</span>
                          <span className="text-orange-600">✓ Actif</span>
                        </div>
                        <div className="text-[10px] text-blue-700 dark:text-blue-300 font-bold">
                          🏗️ Chantier : CH-2026-01 (Résidence Les Lilas)
                        </div>
                        <div className="text-[10px] text-amber-700 dark:text-amber-300 font-bold">
                          🏢 Dépôt Principal • 4 articles (12 pcs)
                        </div>
                        <div className="flex items-center gap-1 pt-1 border-t border-orange-200 dark:border-orange-900/60 text-[10px]">
                          <span className="px-2 py-0.5 rounded-md bg-emerald-600 text-white font-bold">Transmettre</span>
                          <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 font-bold">Vider</span>
                          <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-700 font-bold">Supprimer</span>
                        </div>
                      </div>
                      <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 space-y-1">
                        <div className="flex justify-between font-bold text-slate-600 dark:text-slate-300">
                          <span>Panier 2 • Électricité</span>
                          <span className="text-slate-400">En attente</span>
                        </div>
                        <div className="text-[10px] text-blue-700 dark:text-blue-300 font-bold">
                          🏗️ Chantier : CH-2026-04 (Hôpital Nord)
                        </div>
                        <div className="text-[10px] text-amber-700 dark:text-amber-300 font-bold">
                          🏢 Dépôt Nord • 2 articles (6 pcs)
                        </div>
                        <div className="flex items-center gap-1 pt-1 border-t border-slate-200 dark:border-slate-700 text-[10px]">
                          <span className="px-2 py-0.5 rounded-md bg-emerald-600 text-white font-bold">Transmettre</span>
                          <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 font-bold">Vider</span>
                          <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-700 font-bold">Supprimer</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </UiScreenshotCard>
              </div>

              {/* Pied de Page du Manuel */}
              <div className="pt-4 border-t border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-400 gap-2">
                <div>TOT Stock Pro v5.4 • Manuel d'Utilisation Officiel</div>
                <div>Document conforme pour archivage qualité &amp; audit interne</div>
              </div>
            </div>
          )}

          {/* TAB 2: EXPORT ANDROID STUDIO */}
          {activeTab === 'android' && (
            <div className="space-y-6 p-4 bg-slate-50 dark:bg-slate-800/40 rounded-3xl border border-slate-200 dark:border-slate-800">
              <div className="border-b border-slate-200 dark:border-slate-700 pb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    PROCÉDURE D'EXPORT VERS ANDROID STUDIO (CAPACITOR)
                  </h3>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Générez votre application mobile Android native (.APK &amp; .AAB Google Play)
                  </div>
                </div>
                <button
                  onClick={handlePrint}
                  className="px-3 py-1.5 rounded-xl bg-orange-600 text-white font-bold flex items-center gap-1.5 hover:bg-orange-700 shadow-sm"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Imprimer le Guide PDF</span>
                </button>
              </div>

              {/* Alerte Prêt à l'emploi + Téléchargement direct APK compilé */}
              <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="text-xl">✅</span>
                    <div className="text-xs text-emerald-800 dark:text-emerald-200 leading-relaxed">
                      <strong>APK Android natif v{APP_VERSION} :</strong> Inclut le vibreur natif Android (<code>TotNativeHaptics</code> + permission <code>VIBRATE</code>), la synchronisation automatique des utilisateurs Supabase et les contrôles de sécurité v{APP_VERSION}.
                    </div>
                  </div>
                  {apkDownloadUrl ? (
                    <a
                      href={apkDownloadUrl}
                      download={`tot-stock-v${APP_VERSION}.apk`}
                      className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow-md flex items-center justify-center gap-1.5 shrink-0 no-underline transition active:scale-95"
                    >
                      <Download className="w-4 h-4 stroke-[2.5]" />
                      <span>
                        {t('info_download_apk')} v{APP_VERSION}
                      </span>
                    </a>
                  ) : (
                    <div className="px-3.5 py-2 rounded-xl bg-white/80 dark:bg-slate-900/70 border border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 font-bold text-[11px] flex items-center gap-1.5 shrink-0">
                      <Download className="w-3.5 h-3.5 shrink-0" />
                      <span>{t('apk_ask_admin_link')}</span>
                    </div>
                  )}
                </div>

                {apkSha256 && (
                  <div className="pt-2 border-t border-emerald-200/70 dark:border-emerald-800/70 flex items-center justify-between gap-2 text-[10.5px]">
                    <div className="min-w-0 flex-1">
                      <span className="font-bold text-emerald-900 dark:text-emerald-200 mr-1.5">
                        {t('apk_sha256_label')}
                      </span>
                      <code className="font-mono text-[10px] text-emerald-800 dark:text-emerald-300 break-all">
                        {apkSha256}
                      </code>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(apkSha256);
                        setCopiedSha(true);
                        setTimeout(() => setCopiedSha(false), 2000);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      {copiedSha ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      <span>
                        {copiedSha
                          ? tr(language, 'Copié !', 'Copied!', 'Gekopieerd!')
                          : tr(language, 'Copier', 'Copy', 'Kopiëren')}
                      </span>
                    </button>
                  </div>
                )}
              </div>

              {/* Méthode 1 : Android Studio (Recommandée pour APK natif hors-ligne) */}
              <div className="space-y-3">
                <h4 className="font-extrabold text-sm text-orange-600 dark:text-orange-400 flex items-center gap-1.5">
                  <span className="px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300 text-xs">Méthode 1</span>
                  <span>Génération locale de l'APK via Android Studio (Capacitor)</span>
                </h4>
                
                <div className="space-y-2 text-slate-600 dark:text-slate-300 text-xs">
                  <p><strong>1. Prérequis :</strong> Avoir <strong>Android Studio</strong> installé avec le SDK Android (33 ou supérieur) et Java JDK 17.</p>
                  
                  <p><strong>2. Compiler le code Web et synchroniser Android :</strong></p>
                  <div className="p-3 bg-slate-900 text-emerald-400 font-mono rounded-xl text-xs overflow-x-auto">
                    npm run build:android
                  </div>

                  <p><strong>3. Ouvrir le projet dans Android Studio :</strong></p>
                  <div className="p-3 bg-slate-900 text-emerald-400 font-mono rounded-xl text-xs overflow-x-auto">
                    npx cap open android
                  </div>
                  <p className="text-[11px] text-slate-500">
                    (Ou lancez Android Studio, puis cliquez sur <em>File &gt; Open</em> et sélectionnez le sous-dossier <code>android</code> du projet).
                  </p>

                  <p><strong>4. Générer le fichier .APK dans Android Studio :</strong></p>
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>Laissez Gradle synchroniser le projet (1 à 2 minutes lors de la première ouverture).</li>
                    <li>Dans le menu supérieur, cliquez sur : <strong>Build &gt; Build Bundle(s) / APK(s) &gt; Build APK(s)</strong>.</li>
                    <li>Une fois la compilation terminée, une bulle en bas à droite s'affiche : cliquez sur <strong>locate</strong>.</li>
                    <li>Votre fichier APK prêt à être transféré sur n'importe quel smartphone Android se trouve dans :<br/>
                      <code className="text-[11px] bg-slate-100 dark:bg-slate-900 px-1 py-0.5 rounded text-orange-600 dark:text-orange-400">android/app/build/outputs/apk/debug/app-debug.apk</code>
                    </li>
                  </ol>

                  <p><strong>5. Pour générer un APK signé de production (Release) :</strong></p>
                  <p className="text-[11px]">
                    Allez dans <strong>Build &gt; Generate Signed Bundle / APK</strong>, choisissez <em>APK</em>, créez ou sélectionnez votre clé de signature (Keystore) et validez.
                  </p>
                </div>
              </div>

              {/* Méthode 2 : Génération d'APK en 1 clic sans installer Android Studio (PWABuilder) */}
              <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-700">
                <h4 className="font-extrabold text-sm text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                  <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-xs">Méthode 2</span>
                  <span>Génération d'APK en ligne en 30 secondes (PWABuilder - Sans Android Studio)</span>
                </h4>
                
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  L'application intègre un Web App Manifest complet (icônes HD, splashscreen, mode plein écran). Vous pouvez obtenir un package APK directement depuis l'outil officiel Microsoft PWABuilder :
                </p>

                <ol className="list-decimal pl-5 space-y-1 text-slate-600 dark:text-slate-300 text-xs">
                  <li>Rendez-vous sur <a href="https://www.pwabuilder.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 font-bold underline">pwabuilder.com</a>.</li>
                  <li>Entrez l'URL publique de votre application hébergée (Cloud Run ou votre domaine personnalisé).</li>
                  <li>Cliquez sur <strong>Start</strong> puis sur <strong>Package for Android</strong>.</li>
                  <li>Téléchargez votre package APK / AAB directement prêt pour smartphone ou publication Google Play Store.</li>
                </ol>
              </div>

              {/* Méthode 3 : Installation instantanée WebAPK directe sur Smartphone */}
              <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-700">
                <h4 className="font-extrabold text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-xs">Méthode 3</span>
                  <span>Installation directe sur Smartphone (WebAPK sans fichier APK à transférer)</span>
                </h4>
                
                <div className="p-3 bg-slate-100 dark:bg-slate-900/60 rounded-xl text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
                  <p>Sur votre smartphone Android :</p>
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>Ouvrez l'application dans <strong>Google Chrome</strong> sur le téléphone.</li>
                    <li>Appuyez sur le menu ⋮ (trois petits points en haut à droite).</li>
                    <li>Appuyez sur <strong>« Installer l'application »</strong> ou <strong>« Ajouter à l'écran d'accueil »</strong>.</li>
                    <li>Android transforme automatiquement le projet en application autonome (WebAPK) avec icône dédiée, mode plein écran et accès complet au capteur caméra pour le scanner.</li>
                  </ol>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: CODE HTML SITE WEB */}
          {activeTab === 'marketing' && (
            <div className="space-y-4 p-4 bg-slate-50 dark:bg-slate-800/40 rounded-3xl border border-slate-200 dark:border-slate-800">
              <div className="border-b border-slate-200 dark:border-slate-700 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    CODE HTML DE PROMOTION POUR VOTRE SITE WEB
                  </h3>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Page d'atterrissage autonome, responsive et prête à être hébergée sur votre serveur
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleCopyMarketingCode}
                    className="px-3 py-1.5 rounded-xl bg-orange-600 text-white font-bold flex items-center gap-1.5 hover:bg-orange-700 transition shadow-sm cursor-pointer"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedCode ? 'Copié !' : 'Copier le code'}</span>
                  </button>

                  <button
                    onClick={handleDownloadMarketingHtml}
                    className="px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Télécharger (.html)</span>
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-[11px] text-amber-800 dark:text-amber-300">
                💡 <strong>Conseil d'intégration :</strong> Vous pouvez copier-coller ce code directement dans WordPress (bloc HTML personnalisé), Webflow, Wix, Shopify ou héberger le fichier <code>tot_stock_landing_page.html</code> sur votre serveur Apache/Nginx.
              </div>

              {/* Zone de code */}
              <div className="relative">
                <pre className="p-4 bg-slate-900 text-slate-200 rounded-2xl text-[11px] font-mono overflow-x-auto max-h-96 leading-relaxed border border-slate-800">
                  {MARKETING_HTML_CODE}
                </pre>
              </div>
            </div>
          )}

          {/* TAB 4: SUPABASE CLI & SQL */}
          {activeTab === 'supabase' && (
            <div className="space-y-4 p-4 bg-slate-50 dark:bg-slate-800/40 rounded-3xl border border-slate-200 dark:border-slate-800">
              <div className="border-b border-slate-200 dark:border-slate-700 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    COMMANDES TERMINAL CLI &amp; SCRIPT SQL DE MIGRATION v5.4
                  </h3>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Mettez à jour vos tables distantes (Dépôts autorisés, PIN reset, Suppléants, Paramètres &amp; Devise)
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    onClick={handleCopyCli}
                    className="px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold flex items-center gap-1.5 transition shadow-sm cursor-pointer text-xs"
                  >
                    {copiedCli ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedCli ? 'CLI Copié !' : 'Copier CLI'}</span>
                  </button>

                  <button
                    onClick={handleCopySql}
                    className="px-3 py-1.5 rounded-xl bg-orange-600 text-white font-bold flex items-center gap-1.5 hover:bg-orange-700 transition shadow-sm cursor-pointer text-xs"
                  >
                    {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedSql ? 'SQL Copié !' : 'Copier Script SQL'}</span>
                  </button>

                  <button
                    onClick={handleDownloadSqlFile}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 dark:bg-slate-700 text-amber-300 hover:bg-slate-700 font-bold flex items-center gap-1.5 transition shadow-sm cursor-pointer text-xs"
                    title="Télécharger le fichier .sql prêt à exécuter"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Télécharger (.sql)</span>
                  </button>
                </div>
              </div>

              {/* Guide de mise à jour rapide */}
              <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 text-[11px] text-emerald-900 dark:text-emerald-200 flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold">3 façons simples d'appliquer cette mise à jour à votre base de données :</div>
                  <div><strong>Option A (La plus rapide, 100% dans le navigateur) :</strong> Allez sur le Dashboard Supabase &gt; SQL Editor &gt; New Query &gt; Collez le script SQL ci-dessous &gt; Cliquez sur « Run ».</div>
                  <div><strong>Option B (CLI Supabase versionnée) :</strong> Lancez <code>npx supabase migration new update_tot_stock_v5_4</code>, collez le script dans le fichier généré, puis <code>npx supabase db push</code>.</div>
                  <div><strong>Option C (PostgreSQL psql en ligne de commande) :</strong> Téléchargez le fichier <code>update_tot_stock_tables_v5_4.sql</code> et exécutez <code>psql &lt;connection_string&gt; -f update_tot_stock_tables_v5_4.sql</code>.</div>
                  <div className="pt-1 border-t border-emerald-300 dark:border-emerald-700/60 text-emerald-950 dark:text-emerald-100 font-semibold">
                    🔒 <strong>Sécurité impérative V13 :</strong> Désactivez les inscriptions publiques dans Supabase <em>(Authentication &gt; Providers &gt; Email &gt; Enable Signups = OFF)</em> avant la mise en service. Le premier Super Administrateur (rôle 0) se crée manuellement dans SQL Editor conformément au guide d'exploitation (aucun rôle 0 ni droit universel « * » n'est attribué automatiquement).
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-extrabold text-xs text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-orange-600" />
                    <span>1. Commandes Terminal CLI (Supabase CLI &amp; PSQL) :</span>
                  </h4>
                  <button
                    onClick={handleCopyCli}
                    className="text-[10px] text-orange-600 hover:text-orange-700 font-bold flex items-center gap-1"
                  >
                    {copiedCli ? '✓ Copié' : 'Copier CLI'}
                  </button>
                </div>
                <pre className="p-3.5 bg-slate-900 text-emerald-400 rounded-2xl text-xs font-mono overflow-x-auto border border-slate-800">
                  {CLI_COMMANDS_TEXT}
                </pre>
              </div>

              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-extrabold text-xs text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-orange-600" />
                    <span>2. Script SQL de mise à jour des tables (Migration Safe IF NOT EXISTS) :</span>
                  </h4>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCopySql}
                      className="text-[10px] text-orange-600 hover:text-orange-700 font-bold flex items-center gap-1 cursor-pointer"
                    >
                      {copiedSql ? '✓ Copié' : 'Copier SQL'}
                    </button>
                    <button
                      onClick={handleDownloadSqlFile}
                      className="text-[10px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 font-bold flex items-center gap-1 cursor-pointer"
                    >
                      Télécharger (.sql)
                    </button>
                  </div>
                </div>
                <pre className="p-3.5 bg-slate-900 text-amber-300 rounded-2xl text-xs font-mono overflow-x-auto border border-slate-800 leading-relaxed">
                  {SQL_MIGRATION_TEXT}
                </pre>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
