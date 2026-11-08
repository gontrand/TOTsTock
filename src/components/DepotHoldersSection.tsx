import React, { useState, useMemo } from 'react';
import { Users, Search, AlertTriangle, Plus, Trash2, Check, Lock } from 'lucide-react';
import { User } from '../types';
import { tr } from '../i18n/dutchTranslator';
import { Language } from '../i18n/translations';

export interface DraftDepotHolder {
  user_id: string | number;
  can_send: boolean;
  can_receive: boolean;
}

interface DepotHoldersSectionProps {
  language: Language;
  users: User[];
  holders: DraftDepotHolder[];
  onChange: (next: DraftDepotHolder[]) => void;
  canEdit: boolean;
  depotId?: string | number | null;
  onSaveDirect?: (holders: DraftDepotHolder[]) => Promise<{ success: boolean; error?: string }>;
}

export const DepotHoldersSection: React.FC<DepotHoldersSectionProps> = ({
  language,
  users,
  holders,
  onChange,
  canEdit,
  depotId,
  onSaveDirect,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const activeUsers = useMemo(
    () => users.filter((u) => !u.is_blocked && Number(u.id) !== 0),
    [users]
  );

  const holdersWithUser = useMemo(() => {
    return holders
      .map((h) => {
        const user = users.find((u) => String(u.id) === String(h.user_id));
        return {
          ...h,
          user,
          name: user?.name || `#${h.user_id}`,
          trigram: user?.trigram || '',
          department: user?.department || '',
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [holders, users]);

  const receiveHoldersCount = useMemo(
    () => holders.filter((h) => Boolean(h.can_receive)).length,
    [holders]
  );

  const candidateUsers = useMemo(() => {
    const existingIds = new Set(holders.map((h) => String(h.user_id)));
    const q = searchQuery.trim().toLowerCase();
    return activeUsers.filter((u) => {
      if (existingIds.has(String(u.id))) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        (u.trigram && u.trigram.toLowerCase().includes(q)) ||
        (u.department && u.department.toLowerCase().includes(q))
      );
    });
  }, [activeUsers, holders, searchQuery]);

  const handleToggleRight = (userId: string | number, field: 'can_send' | 'can_receive') => {
    if (!canEdit) return;
    const next = holders.map((h) =>
      String(h.user_id) === String(userId) ? { ...h, [field]: !h[field] } : h
    );
    onChange(next);
  };

  const handleAddHolder = (userId: string | number) => {
    if (!canEdit) return;
    if (holders.some((h) => String(h.user_id) === String(userId))) return;
    onChange([
      ...holders,
      {
        user_id: userId,
        can_send: true,
        can_receive: true,
      },
    ]);
  };

  const handleRemoveHolder = (userId: string | number) => {
    if (!canEdit) return;
    onChange(holders.filter((h) => String(h.user_id) !== String(userId)));
  };

  const handleDirectSave = async () => {
    if (!onSaveDirect || !canEdit) return;
    setSaving(true);
    setSaveFeedback(null);
    const res = await onSaveDirect(holders);
    setSaving(false);
    if (res.success) {
      setSaveFeedback({
        type: 'ok',
        text: tr(
          language,
          'Responsables du dépôt enregistrés (set_depot_holders).',
          'Depot holders saved (set_depot_holders).',
          'Depotverantwoordelijken opgeslagen (set_depot_holders).'
        ),
      });
      setTimeout(() => setSaveFeedback(null), 4000);
    } else {
      setSaveFeedback({
        type: 'err',
        text:
          res.error ||
          tr(
            language,
            'Erreur lors de la sauvegarde des responsables.',
            'Error saving depot holders.',
            'Fout bij opslaan van depotverantwoordelijken.'
          ),
      });
    }
  };

  return (
    <div
      data-testid="depot-holders-section"
      className="p-3.5 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/70 space-y-3"
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <span className="text-xs font-black text-indigo-950 dark:text-indigo-200">
            {tr(
              language,
              'Responsables du dépôt (Envoi & Réception de transferts)',
              'Depot Holders (Transfer Send & Receive)',
              'Depotverantwoordelijken (Verzenden & Ontvangen van overdrachten)'
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2.5 py-0.5 rounded-full font-black bg-indigo-200/80 dark:bg-indigo-900/60 text-indigo-900 dark:text-indigo-200">
            {holders.length}{' '}
            {tr(language, 'responsable(s)', 'holder(s)', 'verantwoordelijke(n)')}
          </span>
          {!canEdit && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center gap-1">
              <Lock className="w-3 h-3" />
              {tr(language, 'Lecture seule', 'Read-only', 'Alleen-lezen')}
            </span>
          )}
        </div>
      </div>

      {/* Avertissement si aucun responsable de réception (can_receive) */}
      {receiveHoldersCount === 0 && (
        <div
          data-testid="depot-no-receiver-warning"
          className="p-2.5 rounded-xl bg-amber-100/90 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <span>
            {tr(
              language,
              'Attention : aucun responsable de réception (can_receive) n’est désigné sur ce dépôt. Ce dépôt ne pourra pas être sélectionné comme destination d’un transfert.',
              'Warning: no reception holder (can_receive) is assigned to this depot. This depot cannot be selected as a transfer destination.',
              'Waarschuwing: er is geen ontvangstverantwoordelijke (can_receive) aangewezen voor dit depot. Dit depot kan niet als bestemming voor een overdracht worden geselecteerd.'
            )}
          </span>
        </div>
      )}

      {/* Liste des responsables assignés avec interrupteurs Envoi (can_send) / Réception (can_receive) */}
      <div className="space-y-1.5">
        {holdersWithUser.length === 0 ? (
          <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-indigo-100 dark:border-indigo-900 text-xs text-slate-500 italic text-center">
            {tr(
              language,
              'Aucun responsable assigné à ce dépôt.',
              'No holder assigned to this depot.',
              'Geen verantwoordelijke toegewezen aan dit depot.'
            )}
          </div>
        ) : (
          holdersWithUser.map((h) => (
            <div
              key={String(h.user_id)}
              className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-indigo-200/80 dark:border-indigo-800/70 flex flex-wrap items-center justify-between gap-2 text-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-bold text-slate-900 dark:text-white truncate">
                  {h.name}
                </span>
                {h.trigram && (
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono font-bold text-slate-600 dark:text-slate-300">
                    {h.trigram}
                  </span>
                )}
                {h.department && (
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    • {h.department}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={Boolean(h.can_send)}
                    disabled={!canEdit}
                    onChange={() => handleToggleRight(h.user_id, 'can_send')}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    {tr(language, 'Envoi', 'Send', 'Verzenden')}
                  </span>
                </label>

                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={Boolean(h.can_receive)}
                    disabled={!canEdit}
                    onChange={() => handleToggleRight(h.user_id, 'can_receive')}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    {tr(language, 'Réception', 'Receive', 'Ontvangen')}
                  </span>
                </label>

                {canEdit && (
                  <button
                    type="button"
                    onClick={() => handleRemoveHolder(h.user_id)}
                    className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition cursor-pointer"
                    title={tr(language, 'Retirer ce responsable', 'Remove holder', 'Verwijderen')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Recherche par nom / trigramme et ajout multiple */}
      {canEdit && (
        <div className="space-y-2 pt-1">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={tr(
                language,
                'Rechercher un utilisateur actif par nom ou trigramme pour l’ajouter...',
                'Search active user by name or trigram to add...',
                'Zoek actieve gebruiker op naam of trigram om toe te voegen...'
              )}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1">
            {candidateUsers.map((u) => (
              <button
                key={String(u.id)}
                type="button"
                onClick={() => handleAddHolder(u.id)}
                className="px-2.5 py-1 rounded-xl bg-white dark:bg-slate-900 hover:bg-indigo-600 hover:text-white text-slate-700 dark:text-slate-200 border border-indigo-200 dark:border-indigo-800 text-[11px] font-bold flex items-center gap-1 transition cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>{u.name}</span>
                {u.trigram && (
                  <span className="text-[10px] font-mono opacity-75">({u.trigram})</span>
                )}
              </button>
            ))}
          </div>

          {depotId !== null && depotId !== undefined && onSaveDirect && (
            <div className="flex items-center justify-between gap-2 pt-1">
              {saveFeedback ? (
                <span
                  className={`text-[11px] font-bold ${
                    saveFeedback.type === 'ok'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {saveFeedback.text}
                </span>
              ) : (
                <span className="text-[10.5px] text-slate-500">
                  {tr(
                    language,
                    'Enregistré automatiquement avec le formulaire ou directement ci-contre.',
                    'Saved with the depot form or directly using the button.',
                    'Opgeslagen met het formulier of direct via de knop.'
                  )}
                </span>
              )}
              <button
                type="button"
                disabled={saving}
                onClick={handleDirectSave}
                className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                <span>
                  {saving
                    ? tr(language, 'Enregistrement...', 'Saving...', 'Opslaan...')
                    : tr(
                        language,
                        'Enregistrer les responsables',
                        'Save Holders',
                        'Verantwoordelijken opslaan'
                      )}
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
