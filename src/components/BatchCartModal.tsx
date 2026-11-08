import React, { useState } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import { SearchableSelect } from './SearchableSelect';
import {
  formatCurrency,
  isUserAllowedForDepot,
  isDepotClosed,
  canUserBorrowFromDepot,
  canUserEnterStockInDepot,
} from '../utils/crypto';
import {
  X,
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  CheckCircle,
  Building2,
  Camera,
  AlertTriangle,
  Lock,
  ChevronUp,
  ChevronDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';

export const BatchCartModal: React.FC = () => {
  const {
    batchCartModalOpen,
    setBatchCartModalOpen,
    batchCart,
    updateCartQty,
    removeFromCart,
    clearCart,
    confirmBatchMovements,
    scanState,
    setScanState,
    projects,
    departments,
    depots,
    users,
    currentUser,
    userHasPermission,
    language,
    t,
  } = useApp();

  const isOut = scanState.mode === 'OUT';
  const hasGeneralStockIn = userHasPermission('perm_stock_in');
  const [selectedSiteNumber, setSelectedSiteNumber] = useState<string>(() => {
    return projects.length > 0 ? projects[0].project_number : '';
  });
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  // Boutons Agrandir (↑) et Diminuer (↓) pour afficher ou masquer la liste des articles
  const [isArticlesListHidden, setIsArticlesListHidden] = useState<boolean>(false);

  // Auto-sync project selection if projects list updates
  React.useEffect(() => {
    if (projects.length > 0 && (!selectedSiteNumber || !projects.some((p) => p.project_number === selectedSiteNumber))) {
      setSelectedSiteNumber(projects[0].project_number);
    }
  }, [projects, selectedSiteNumber]);

  // Keyboard shortcut: close on Escape
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && batchCartModalOpen) {
        setBatchCartModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [batchCartModalOpen, setBatchCartModalOpen]);

  if (!batchCartModalOpen) return null;

  const handleConfirm = async () => {
    if (batchCart.length === 0) {
      setErrorMsg(t('cart_empty'));
      return;
    }

    if (isOut && !selectedSiteNumber) {
      setErrorMsg(tr(language, 'Veuillez sélectionner un chantier ou projet de destination.', 'Please select a destination job-site or project.'));
      return;
    }

    if (isOut) {
      for (const item of batchCart) {
        const borrowCheck = canUserBorrowFromDepot(currentUser, item.product.store_name, depots, language, departments, users);
        if (!borrowCheck.allowed) {
          setErrorMsg(borrowCheck.reason || (tr(language, 'Sortie interdite sur ce dépôt.', 'Withdrawal not allowed.')));
          return;
        }
      }
    } else {
      for (const item of batchCart) {
        const entryCheck = canUserEnterStockInDepot(currentUser, item.product.store_name, depots, hasGeneralStockIn, language, departments, users);
        if (!entryCheck.allowed) {
          setErrorMsg(entryCheck.reason || (tr(language, 'Entrée interdite sur ce dépôt.', 'Stock entry not allowed.')));
          return;
        }
      }
    }

    setErrorMsg('');
    setLoading(true);
    try {
      const res = await confirmBatchMovements(isOut ? selectedSiteNumber : undefined);
      if (!res.success) {
        setErrorMsg(res.message || t('common_error'));
      }
    } catch (err: any) {
      setErrorMsg(err?.message || (tr(language, 'Une erreur est survenue lors de la validation du panier.', 'An error occurred while confirming cart.')));
    } finally {
      setLoading(false);
    }
  };

  const totalUnitsInCart = batchCart.reduce((acc, item) => acc + item.qtyActual, 0);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setBatchCartModalOpen(false);
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-3 bg-slate-950/75 backdrop-blur-sm animate-fadeIn"
    >
      <div
        className="w-full max-w-lg max-h-[92dvh] sm:max-h-[92vh] bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-5 text-slate-800 dark:text-slate-100 flex flex-col overflow-hidden transition-all duration-300"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 pb-2.5 sm:pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center font-bold text-white shadow-sm shrink-0 ${
                isOut ? 'bg-rose-500' : 'bg-emerald-500'
              }`}
            >
              <ShoppingCart className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <h2 className="text-sm font-black text-slate-900 dark:text-white truncate">
                  {isOut ? t('cart_out_title') : t('cart_in_title')}
                </h2>
                {batchCart.length > 0 && (
                  <span className={`hidden sm:inline-flex px-2 py-0.5 rounded-lg text-[10px] font-black border ${
                    isArticlesListHidden
                      ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                      : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                  }`}>
                    {isArticlesListHidden
                      ? (tr(language, 'Articles masqués (↓)', 'Items hidden (↓)'))
                      : (tr(language, 'Articles affichés (↑)', 'Items visible (↑)'))}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                {batchCart.length} {t('common_references')} • {totalUnitsInCart} {t('product_units')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Boutons Agrandir (↑) et Diminuer (↓) destinés à masquer / afficher la liste des articles */}
            {batchCart.length > 0 && (
              <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setIsArticlesListHidden(false)}
                  className={`px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition cursor-pointer ${
                    !isArticlesListHidden
                      ? 'bg-orange-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 hover:text-orange-600'
                  }`}
                  title={tr(language, 'Agrandir / Afficher la liste des articles (↑)', 'Expand / Show items (↑)')}
                  aria-label="Agrandir la liste des articles"
                >
                  <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span className="text-[11px] hidden sm:inline">{tr(language, 'Agrandir', 'Expand')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsArticlesListHidden(true)}
                  className={`px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition cursor-pointer ${
                    isArticlesListHidden
                      ? 'bg-orange-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 hover:text-orange-600'
                  }`}
                  title={tr(language, 'Diminuer / Masquer la liste des articles (↓)', 'Reduce / Hide items (↓)')}
                  aria-label="Masquer la liste des articles"
                >
                  <ArrowDown className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span className="text-[11px] hidden sm:inline">{tr(language, 'Diminuer', 'Reduce')}</span>
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setBatchCartModalOpen(false);
              }}
              className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer active:scale-95 shadow-xs shrink-0"
              title={t('common_close')}
              aria-label="Fermer"
            >
              <X className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Project Selector for OUT operations */}
        {isOut && (
          <div className="pt-3">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-orange-500" />
              {t('cart_project_label')}
            </label>
            <SearchableSelect
              value={selectedSiteNumber}
              onChange={(val) => setSelectedSiteNumber(val)}
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium outline-none focus:ring-2 focus:ring-orange-500"
            >
              {projects.length === 0 ? (
                <option value="">{tr(language, 'Aucun projet enregistré', 'No project recorded')}</option>
              ) : (
                projects.map((p) => {
                  const dep = departments.find((d) => d.id === p.department_id);
                  return (
                    <option key={p.id} value={p.project_number}>
                      [{p.project_number}] {p.project_name} ({dep?.name || t('common_main_depot')})
                    </option>
                  );
                })
              )}
            </SearchableSelect>
          </div>
        )}

        {errorMsg && (
          <div className="mt-3 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 flex items-center gap-2 text-xs font-bold text-rose-600 dark:text-rose-400">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Cart Item List / Vue Masquée */}
        {isArticlesListHidden ? (
          <div
            onClick={() => setIsArticlesListHidden(false)}
            className="my-3 p-3.5 rounded-2xl bg-slate-100/90 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:border-orange-500 transition cursor-pointer flex items-center justify-between gap-3 shadow-2xs group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 flex items-center justify-center font-bold text-base shrink-0">
                📦
              </div>
              <div className="min-w-0">
                <div className="font-extrabold text-xs text-slate-800 dark:text-slate-100 truncate">
                  {batchCart.length} référence(s) • {totalUnitsInCart} pièces au total
                </div>
                <div className="text-[10.5px] text-slate-400">
                  {tr(language, 'Articles masqués (↓). Cliquez sur Agrandir (↑) pour modifier les quantités.', 'Items hidden (↓). Click Expand (↑) to view and edit items.')}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsArticlesListHidden(false);
              }}
              className="px-3 py-1.5 rounded-xl bg-orange-600 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs group-hover:bg-orange-700 transition shrink-0 cursor-pointer"
            >
              <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>{tr(language, 'Agrandir (↑)', 'Expand (↑)')}</span>
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto py-3 space-y-2.5 pr-1">
          {batchCart.length === 0 ? (
            <div className="py-8 text-center text-slate-400">
              <ShoppingCart className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">{t('cart_empty')}</p>
            </div>
          ) : (
            batchCart.map((item) => {
              const p = item.product;
              const hasEnough = !isOut || item.qtyActual <= p.quantity;
              const borrowCheck = isOut
                ? canUserBorrowFromDepot(currentUser, p.store_name, depots, language, departments, users)
                : { allowed: true };
              const entryCheck = !isOut
                ? canUserEnterStockInDepot(currentUser, p.store_name, depots, hasGeneralStockIn, language, departments, users)
                : { allowed: true };
              const isValid = hasEnough && (isOut ? borrowCheck.allowed : entryCheck.allowed);
              const permissionErrorMsg = isOut ? borrowCheck.reason : entryCheck.reason;

              return (
                <div
                  key={p.id}
                  className={`p-3 rounded-2xl border transition ${
                    isValid
                      ? 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/80'
                      : 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white leading-tight">
                        {p.brand} {p.model}
                      </h4>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {tr(language, 'Réf', 'Ref')}: <span className="font-semibold text-orange-600">{p.reference}</span> • {tr(language, 'Stock disponible', 'Available stock')}: <strong className={p.quantity === 0 ? 'text-rose-500' : ''}>{p.quantity}</strong>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1 font-medium">
                        <span>📍 {p.store_name || (tr(language, 'Dépôt Principal', 'Main Depot'))}</span>
                      </div>
                      {!isValid && permissionErrorMsg && (
                        <div className="text-[11px] text-rose-600 dark:text-rose-400 font-bold mt-1.5 flex items-start gap-1 p-2 rounded-xl bg-rose-100/60 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800">
                          <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{permissionErrorMsg}</span>
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => removeFromCart(p.id)}
                      className="text-slate-400 hover:text-rose-500 p-1"
                      title={t('common_delete')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Quantity controls */}
                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-200 dark:border-slate-700/50">
                    <span className="text-[11px] font-medium text-slate-500">
                      {isOut ? (tr(language, 'Quantité retirée :', 'Quantity removed:')) : (tr(language, 'Quantité ajoutée :', 'Quantity added:'))}
                    </span>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => updateCartQty(p.id, Math.max(1, item.qtyActual - 1))}
                          className="w-7 h-7 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer"
                          title="Diminuer (↓ / -)"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>

                        <input
                          type="number"
                          min="1"
                          value={item.qtyActual}
                          onChange={(e) => updateCartQty(p.id, Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-12 py-1 text-center font-bold text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg outline-none focus:ring-2 focus:ring-orange-500"
                        />

                        <button
                          type="button"
                          onClick={() => updateCartQty(p.id, item.qtyActual + 1)}
                          className="w-7 h-7 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer"
                          title="Agrandir / Augmenter (↑ / +)"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                      </div>
                  </div>

                  {!hasEnough && (
                    <div className="text-[10px] font-bold text-rose-600 dark:text-rose-400 mt-1">
                      ⚠️ {tr(language, `La quantité demandée dépasse le stock actuel (${p.quantity}).`, `Requested quantity exceeds current stock (${p.quantity}).`)}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

        {/* Action Buttons */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
          <button
            onClick={() => {
              setBatchCartModalOpen(false);
              setScanState({ open: true, mode: scanState.mode });
            }}
            className="w-full py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5 transition"
          >
            <Camera className="w-4 h-4 text-orange-500" />
            <span>{t('cart_scan_more')}</span>
          </button>

          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              disabled={
                loading ||
                batchCart.length === 0 ||
                batchCart.some((i) => {
                  if (isOut) {
                    if (i.qtyActual > i.product.quantity) return true;
                    return !canUserBorrowFromDepot(currentUser, i.product.store_name, depots, language, departments, users).allowed;
                  } else {
                    return !canUserEnterStockInDepot(currentUser, i.product.store_name, depots, hasGeneralStockIn, language, departments, users).allowed;
                  }
                })
              }
              className={`flex-1 py-3 px-4 rounded-xl text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md transition active:scale-95 disabled:opacity-40 ${
                isOut
                  ? 'bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 shadow-rose-500/20'
                  : 'bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 shadow-emerald-500/20'
              }`}
            >
              <CheckCircle className="w-4 h-4" />
              <span>{loading ? t('cart_validating') : t('cart_validate')}</span>
            </button>

            <button
              onClick={() => {
                clearCart();
                setBatchCartModalOpen(false);
              }}
              className="px-3 py-3 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 text-xs font-bold transition"
            >
              {t('common_cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
