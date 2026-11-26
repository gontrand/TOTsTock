import React, { useMemo, useState } from 'react';
import { AlertTriangle, Trash2, ArrowRightLeft } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { tr } from '../i18n/dutchTranslator';
import { SearchableSelect } from './SearchableSelect';
import type { Depot } from '../types';

interface DepotDeleteDialogProps {
  depot: Depot;
  onClose: () => void;
  onDeleted?: (message: string) => void;
}

/**
 * v5.24.0 — Suppression d'un dépôt avec migration obligatoire de son contenu.
 * Fenêtre centrée : le contenu défile, les boutons restent toujours visibles.
 */
export const DepotDeleteDialog: React.FC<DepotDeleteDialogProps> = ({ depot, onClose, onDeleted }) => {
  const { language, depots, products, stockLevels, deleteDepot } = useApp();

  const key = depot.name.toLowerCase();
  const otherDepots = useMemo(
    () => depots.filter((d) => String(d.id) !== String(depot.id)),
    [depots, depot.id]
  );
  const refCount = useMemo(
    () => products.filter((p) => p.store_name?.toLowerCase() === key).length,
    [products, key]
  );
  const stockLines = useMemo(
    () => stockLevels.filter((sl) => String(sl.depot_name || '').toLowerCase() === key),
    [stockLevels, key]
  );
  const unitsCount = useMemo(
    () => stockLines.reduce((sum, sl) => sum + Number(sl.quantity || 0), 0),
    [stockLines]
  );
  const hasContent = refCount > 0 || stockLines.length > 0;

  const [action, setAction] = useState<'transfer' | 'detach'>(otherDepots.length > 0 ? 'transfer' : 'detach');
  const [target, setTarget] = useState<string>(otherDepots[0]?.name || '');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = confirmed && !busy && (!hasContent || action === 'detach' || Boolean(target));

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const reassignTo = !hasContent ? undefined : action === 'transfer' ? target : '';
    const res = await deleteDepot(depot.id, reassignTo);
    setBusy(false);
    if (!res.success) {
      setError(res.message);
      return;
    }
    onDeleted?.(res.message);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center p-3 bg-black/50"
      role="dialog"
      aria-modal="true"
      data-testid="depot-delete-dialog"
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
            <h3 className="font-black text-slate-900 dark:text-white text-sm break-words">
              {tr(language, `Supprimer le dépôt « ${depot.name} » ?`, `Delete depot "${depot.name}"?`, `Depot "${depot.name}" verwijderen?`)}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {tr(language, 'Cette action est définitive.', 'This action cannot be undone.', 'Deze actie is definitief.')}
            </p>
          </div>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto min-h-0 text-xs">
          {!hasContent ? (
            <p className="text-slate-600 dark:text-slate-300">
              {tr(language, "Ce dépôt est vide : aucune référence ni stock n'y est rattaché.", 'This depot is empty: no item or stock is linked to it.', 'Dit depot is leeg.')}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-100 dark:bg-slate-800 p-2">
                  <div className="text-base font-black text-slate-900 dark:text-white tabular-nums">{refCount}</div>
                  <div className="text-[10px] text-slate-500">{tr(language, 'référence(s)', 'item(s)', 'referentie(s)')}</div>
                </div>
                <div className="rounded-xl bg-slate-100 dark:bg-slate-800 p-2">
                  <div className="text-base font-black text-slate-900 dark:text-white tabular-nums">{stockLines.length}</div>
                  <div className="text-[10px] text-slate-500">{tr(language, 'ligne(s) de stock', 'stock line(s)', 'voorraadlijn(en)')}</div>
                </div>
                <div className="rounded-xl bg-slate-100 dark:bg-slate-800 p-2">
                  <div className="text-base font-black text-slate-900 dark:text-white tabular-nums">{unitsCount}</div>
                  <div className="text-[10px] text-slate-500">{tr(language, 'unités en stock', 'units in stock', 'eenheden')}</div>
                </div>
              </div>

              <div className="p-3 rounded-xl border border-rose-200 dark:border-rose-900 space-y-2">
                <div className="font-bold text-slate-800 dark:text-slate-200">
                  {tr(language, 'Que faire du contenu de ce dépôt ?', 'What to do with the content of this depot?', 'Wat met de inhoud van dit depot?')}
                </div>

                {otherDepots.length > 0 && (
                  <label className="flex flex-wrap items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="depot-delete-action"
                      checked={action === 'transfer'}
                      onChange={() => setAction('transfer')}
                    />
                    <ArrowRightLeft className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {tr(language, 'Migrer tout le contenu vers :', 'Migrate all content to:', 'Alle inhoud migreren naar:')}
                    </span>
                    <SearchableSelect
                      value={target}
                      disabled={action !== 'transfer'}
                      onChange={(val) => setTarget(val)}
                      recentKey="depots"
                      className="min-w-[10rem] flex-1 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg font-bold text-xs outline-none"
                    >
                      {otherDepots.map((d) => (
                        <option key={d.id} value={d.name}>
                          {d.name} {d.code ? `(${d.code})` : ''}
                        </option>
                      ))}
                    </SearchableSelect>
                  </label>
                )}
                {action === 'transfer' && otherDepots.length > 0 && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 pl-6">
                    {tr(
                      language,
                      'Les quantités d’une même référence déjà présente dans le dépôt cible sont additionnées.',
                      'Quantities of an item already present in the target depot are added together.',
                      'Hoeveelheden van een referentie die al in het doeldepot staat, worden opgeteld.'
                    )}
                  </p>
                )}

                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="depot-delete-action"
                    checked={action === 'detach'}
                    onChange={() => setAction('detach')}
                    className="mt-0.5"
                  />
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {tr(
                      language,
                      'Détacher les références (le stock n’est pas migré)',
                      'Detach items (stock is not migrated)',
                      'Referenties loskoppelen (voorraad wordt niet gemigreerd)'
                    )}
                  </span>
                </label>
              </div>
            </>
          )}

          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" data-testid="depot-delete-confirm" />
            <span className="font-semibold text-rose-800 dark:text-rose-200">
              {tr(
                language,
                `Je confirme la suppression définitive du dépôt « ${depot.name} ».`,
                `I confirm the permanent deletion of depot "${depot.name}".`,
                `Ik bevestig de definitieve verwijdering van depot "${depot.name}".`
              )}
            </span>
          </label>

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
            data-testid="depot-delete-submit"
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-xs flex items-center gap-1.5 shadow cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>
              {busy
                ? tr(language, 'Migration et suppression…', 'Migrating and deleting…', 'Migreren en verwijderen…')
                : hasContent && action === 'transfer'
                  ? tr(language, 'Migrer puis supprimer', 'Migrate then delete', 'Migreren en verwijderen')
                  : tr(language, 'Supprimer le dépôt', 'Delete depot', 'Depot verwijderen')}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default DepotDeleteDialog;
