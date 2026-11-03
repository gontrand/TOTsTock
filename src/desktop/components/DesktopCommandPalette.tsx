import React, { useEffect, useMemo, useRef, useState } from 'react';
import { tr } from '../../i18n/dutchTranslator';
import { useApp } from '../../context/AppContext';
import { DesktopPageId } from '../types';
import {
  Search,
  Package,
  ShoppingBag,
  Plus,
  Printer,
  Scan,
  ArrowLeftRight,
  Sliders,
  X,
} from 'lucide-react';

interface DesktopCommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigatePage: (page: DesktopPageId) => void;
  onSelectProduct: (productId: string) => void;
  onSelectOrder: (orderId: string) => void;
  onNewProduct: () => void;
  onNewMovement: () => void;
  onPrintLabels: () => void;
}

interface CommandItem {
  id: string;
  group: 'action' | 'product' | 'order';
  label: string;
  subtitle?: string;
  icon: React.ReactNode;
  run: () => void;
}

export const DesktopCommandPalette: React.FC<DesktopCommandPaletteProps> = ({
  open,
  onClose,
  onNavigatePage,
  onSelectProduct,
  onSelectOrder,
  onNewProduct,
  onNewMovement,
  onPrintLabels,
}) => {
  const {
    products,
    orders,
    language,
    userHasPermission,
    isPreparer,
    t,
  } = useApp();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const canEditProduct = userHasPermission('perm_prod_edit');
  const canPrintLabels = userHasPermission('perm_menu_print_labels');
  const canOrderPrep = isPreparer || userHasPermission('perm_menu_order_prep');

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const items = useMemo<CommandItem[]>(() => {
    const q = query.toLowerCase().trim();
    const list: CommandItem[] = [];

    // 1. Actions rapides
    const actions: CommandItem[] = [
      ...(canEditProduct
        ? [
            {
              id: 'act-new-prod',
              group: 'action' as const,
              label: tr(language, 'Nouveau produit', 'New product', 'Nieuw product'),
              subtitle: tr(language, 'Ajouter une référence au catalogue', 'Add reference to catalog', 'Referentie toevoegen'),
              icon: <Plus className="w-4 h-4 text-orange-600" />,
              run: () => {
                onClose();
                onNewProduct();
              },
            },
          ]
        : []),
      {
        id: 'act-new-mov',
        group: 'action',
        label: tr(language, 'Nouveau mouvement', 'New movement', 'Nieuwe beweging'),
        subtitle: tr(language, 'Entrée ou sortie de stock', 'Stock in or out', 'Voorraad in of uit'),
        icon: <ArrowLeftRight className="w-4 h-4 text-emerald-600" />,
        run: () => {
          onClose();
          onNewMovement();
        },
      },
      ...(canPrintLabels
        ? [
            {
              id: 'act-print-labels',
              group: 'action' as const,
              label: tr(language, 'Imprimer des étiquettes', 'Print labels', 'Etiketten afdrukken'),
              subtitle: tr(language, 'Avery A4, thermique 50×30, ZPL...', 'Avery A4, thermal 50×30, ZPL...', 'Avery A4, thermisch 50×30, ZPL...'),
              icon: <Printer className="w-4 h-4 text-orange-600" />,
              run: () => {
                onClose();
                onPrintLabels();
              },
            },
          ]
        : []),
      ...(canOrderPrep
        ? [
            {
              id: 'act-open-prep',
              group: 'action' as const,
              label: tr(language, 'Ouvrir le mode préparation', 'Open order picking', 'Orderpicken openen'),
              subtitle: tr(language, 'Poste de préparation de commandes en 3 zones', '3-zone desktop order picking', 'Orderpickstation met 3 zones'),
              icon: <Scan className="w-4 h-4 text-sky-600" />,
              run: () => {
                onClose();
                onNavigatePage('preparation');
              },
            },
          ]
        : []),
      {
        id: 'act-go-settings',
        group: 'action',
        label: tr(language, 'Ouvrir les paramètres', 'Open settings', 'Instellingen openen'),
        subtitle: tr(language, 'Utilisateurs, dépôts, licence, imprimantes', 'Users, depots, license, printers', 'Gebruikers, depots, licentie, printers'),
        icon: <Sliders className="w-4 h-4 text-slate-600" />,
        run: () => {
          onClose();
          onNavigatePage('settings');
        },
      },
    ];

    for (const act of actions) {
      if (
        !q ||
        act.label.toLowerCase().includes(q) ||
        (act.subtitle && act.subtitle.toLowerCase().includes(q))
      ) {
        list.push(act);
      }
    }

    // 2. Produits (référence, code-barres, désignation)
    const matchedProducts = products
      .filter((p) => {
        if (!q) return true;
        return (
          p.reference.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.toLowerCase().includes(q)) ||
          `${p.brand} ${p.model}`.toLowerCase().includes(q)
        );
      })
      .slice(0, q ? 12 : 5);

    for (const p of matchedProducts) {
      list.push({
        id: `prod-${p.id}`,
        group: 'product',
        label: `${p.reference} — ${p.brand} ${p.model}`,
        subtitle: `${p.store_name || '—'} · Stock: ${p.quantity ?? 0}`,
        icon: <Package className="w-4 h-4 text-slate-500" />,
        run: () => {
          onClose();
          onNavigatePage('inventory');
          onSelectProduct(p.id);
        },
      });
    }

    // 3. Commandes par numéro ou chantier
    const matchedOrders = orders
      .filter((o) => {
        if (!q) return true;
        return (
          o.order_number.toLowerCase().includes(q) ||
          (o.site_number && o.site_number.toLowerCase().includes(q)) ||
          (o.requester_name && o.requester_name.toLowerCase().includes(q))
        );
      })
      .slice(0, q ? 8 : 3);

    for (const o of matchedOrders) {
      list.push({
        id: `ord-${o.id}`,
        group: 'order',
        label: `${o.order_number}`,
        subtitle: `${o.site_number || '—'} · ${o.requester_name} · ${o.status}`,
        icon: <ShoppingBag className="w-4 h-4 text-indigo-500" />,
        run: () => {
          onClose();
          onNavigatePage('orders');
          onSelectOrder(o.id);
        },
      });
    }

    return list;
  }, [
    query,
    products,
    orders,
    canEditProduct,
    canPrintLabels,
    canOrderPrep,
    language,
    onClose,
    onNavigatePage,
    onSelectProduct,
    onSelectOrder,
    onNewProduct,
    onNewMovement,
    onPrintLabels,
  ]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (items.length > 0 ? (prev + 1) % items.length : 0));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        items.length > 0 ? (prev - 1 + items.length) % items.length : 0
      );
      return;
    }
    if (e.key === 'Enter' && items[selectedIndex]) {
      e.preventDefault();
      items[selectedIndex].run();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('desktop_cmd_palette_title')}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-slate-950/60 backdrop-blur-xs"
    >
      <div
        onKeyDown={handleKeyDown}
        className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2.5">
          <Search className="w-4 h-4 text-orange-600 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('desktop_cmd_palette_placeholder')}
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {items.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              {tr(
                language,
                'Aucun produit, commande ou action trouvé.',
                'No matching product, order, or action found.',
                'Geen overeenkomend product, bestelling of actie gevonden.'
              )}
            </div>
          ) : (
            items.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={item.run}
                  className={`w-full px-3 py-2 rounded-xl text-left flex items-center justify-between gap-3 transition cursor-pointer ${
                    isSelected
                      ? 'bg-orange-50 dark:bg-orange-950/40 text-orange-900 dark:text-orange-200'
                      : 'text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {item.icon}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold truncate">{item.label}</div>
                      {item.subtitle && (
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 shrink-0">
                    {item.group === 'action'
                      ? tr(language, 'Action', 'Action', 'Actie')
                      : item.group === 'product'
                      ? tr(language, 'Produit', 'Product', 'Product')
                      : tr(language, 'Commande', 'Order', 'Bestelling')}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <span>↑↓ {tr(language, 'Naviguer', 'Navigate', 'Navigeren')} · ↵ {tr(language, 'Ouvrir', 'Open', 'Openen')}</span>
          <span>Échap {tr(language, 'Fermer', 'Close', 'Sluiten')}</span>
        </div>
      </div>
    </div>
  );
};
