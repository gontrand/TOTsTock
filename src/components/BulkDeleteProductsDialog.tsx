import React, { useMemo, useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { tr } from '../i18n/dutchTranslator';
import type { Product } from '../types';

interface BulkDeleteProductsDialogProps {
  products: Product[];
  onClose: () => void;
  onDone?: (deletedCount: number) => void;
}

const TYPED_CONFIRM_THRESHOLD = 10;

/**
 * v5.24.0 — Confirmation de suppression multiple de références.
 * Au-delà de 10 références, la saisie du mot « SUPPRIMER » est exigée.
 */
export const BulkDeleteProductsDialog: React.FC<BulkDeleteProductsDialogProps> = ({ products, onClose, onDone }) => {
  const { language, stockLevels, deleteProducts } = useApp();
  const [confirmed, setConfirmed] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsTyped = products.length >= TYPED_CONFIRM_THRESHOLD;
  const keyword = tr(language, 'SUPPRIMER', 'DELETE', 'VERWIJDEREN');

  const totalUnits = useMemo(() => {
    const ids = new Set(products.map((p) => String(p.id)));
    return stockLevels.reduce((sum, sl) => (ids.has(String(sl.product_id)) ? sum + Number(sl.quantity || 0) : sum), 0);
  }, [products, stockLevels]);

  const canSubmit = confirmed && !busy && (!needsTyped || typed.trim().toUpperCase() === keyword);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const res = await deleteProducts(products.map((p) => p.id));
    setBusy(false);
    if (!res.success) {
      setError(res.message);
      return;
    }
    onDone?.(res.deleted);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center p-3 bg-black/50"
      role="dialog"
      aria-modal="true"
      data-testid="bulk-delete-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-lg max-h-[92vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border-2 border-rose-300 dark:border-rose-800 shadow-2xl">
        <div className="flex items-start gap-3 p-4 border-b border-rose-100 dark:border-rose-900/60 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-black text-slate-900 dark:text-white text-sm">
              {tr(
                language,
                `Supprimer ${products.length} référence(s) ?`,
                `Delete ${products.length} item(s)?`,
                `${products.length} referentie(s) verwijderen?`
              )}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {tr(
                language,
                `Le stock associé (${totalUnits} unité(s)) et l’historique de mouvements de ces références seront supprimés. Action définitive.`,
                `The related stock (${totalUnits} unit(s)) and movement history of these items will be deleted. This cannot be undone.`,
                `De bijbehorende voorraad (${totalUnits} eenheid/eenheden) en bewegingshistoriek worden verwijderd. Definitief.`
              )}
            </p>
          </div>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto min-h-0 text-xs">
          <ul className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
            {products.slice(0, 50).map((p) => (
              <li key={p.id} className="px-3 py-1.5 flex items-center gap-2">
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200 shrink-0">{p.reference}</span>
                <span className="text-slate-500 dark:text-slate-400 truncate">
                  {p.brand} {p.model}
                </span>
              </li>
            ))}
            {products.length > 50 && (
              <li className="px-3 py-1.5 text-slate-500">
                {tr(language, `… et ${products.length - 50} autre(s)`, `… and ${products.length - 50} more`, `… en nog ${products.length - 50}`)}
              </li>
            )}
          </ul>

          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" data-testid="bulk-delete-confirm" />
            <span className="font-semibold text-rose-800 dark:text-rose-200">
              {tr(
                language,
                `Je confirme la suppression définitive de ces ${products.length} référence(s).`,
                `I confirm the permanent deletion of these ${products.length} item(s).`,
                `Ik bevestig de definitieve verwijdering van deze ${products.length} referentie(s).`
              )}
            </span>
          </label>

          {needsTyped && (
            <div className="space-y-1">
              <div className="text-slate-600 dark:text-slate-300">
                {tr(language, 'Pour valider, tapez', 'To confirm, type', 'Typ om te bevestigen')}{' '}
                <strong className="font-mono">{keyword}</strong>
              </div>
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs outline-none"
                data-testid="bulk-delete-typed"
                autoComplete="off"
              />
            </div>
          )}

          {error && (
            <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 font-medium break-words">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 p-3 border-t border-slate-200 dark:border-slate-800 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            {tr(language, 'Annuler', 'Cancel', 'Annuleren')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="bulk-delete-submit"
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-xs flex items-center gap-1.5 shadow cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>
              {busy
                ? tr(language, 'Suppression…', 'Deleting…', 'Verwijderen…')
                : tr(language, `Supprimer ${products.length} référence(s)`, `Delete ${products.length} item(s)`, `${products.length} verwijderen`)}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default BulkDeleteProductsDialog;
