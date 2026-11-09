import React, { useState, useMemo, useEffect } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  RefreshCw,
  Search,
  Check,
  X,
  Send,
  ShieldAlert,
  History,
  Inbox,
  FileCheck2,
  Ban,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { SearchableSelect } from './SearchableSelect';
import { tr } from '../i18n/dutchTranslator';
import { StockTransferRecord, StockTransferStatus } from '../types';
import { getClientSupabase } from '../services/clientSupabase';
import {
  canUserReceiveTransfer,
  canUserConfirmTransferAdjustment,
  canUserCancelTransfer,
  canUserResolveTransferDispute,
  isTransferOverdue,
  computeTransferBadgeCounts,
  buildReceiveTransferItemsPayload,
  ReceiveLineDraft,
  receiveStockTransferRpc,
  rejectStockTransferRpc,
  cancelStockTransferRpc,
  confirmStockTransferAdjustmentRpc,
  resolveTransferDisputeRpc,
  fetchOverdueTransfersRpc,
} from '../services/transferService';

export type TransfersTabKey =
  | 'to_receive'
  | 'to_confirm'
  | 'disputes'
  | 'sent_by_me'
  | 'history';

interface TransfersValidationPanelProps {
  isModal?: boolean;
  onClose?: () => void;
  initialTab?: TransfersTabKey;
}

export const TransfersValidationPanel: React.FC<TransfersValidationPanelProps> = ({
  isModal = false,
  onClose,
  initialTab = 'to_receive',
}) => {
  const {
    currentUser,
    depots,
    depotHolders,
    users,
    transfers,
    refreshTransfers,
    syncFromSupabase,
    supabaseUrl,
    supabaseKey,
    userHasPermission,
    openStockTransferModal,
    canTransferBetweenDepots,
    language,
  } = useApp();

  const [activeTab, setActiveTab] = useState<TransfersTabKey>(initialTab);
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);
  const [lineDrafts, setLineDrafts] = useState<Record<string, ReceiveLineDraft>>({});
  const [receptionNote, setReceptionNote] = useState('');
  const [rejectAllMode, setRejectAllMode] = useState(false);
  const [rejectAllReason, setRejectAllReason] = useState('');
  const [confirmComment, setConfirmComment] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [disputeAcceptedQtys, setDisputeAcceptedQtys] = useState<Record<string, number>>({});
  const [disputeNote, setDisputeNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; message: string } | null>(null);

  // Filtre de l'onglet Litiges : DISPUTED vs Refus à traiter (PARTIALLY_RECEIVED / REJECTED)
  const [disputesFilter, setDisputesFilter] = useState<'disputed' | 'refusals'>('disputed');

  // Filtres de l'onglet Historique
  const [histPeriod, setHistPeriod] = useState<'7d' | '30d' | 'all'>('7d');
  const [histDepot, setHistDepot] = useState<string>('ALL');
  const [histStatus, setHistStatus] = useState<string>('ALL');
  const [histRef, setHistRef] = useState<string>('');
  const [histUser, setHistUser] = useState<string>('ALL');
  const [histVisibleCount, setHistVisibleCount] = useState<number>(25);

  const [overdueServerIds, setOverdueServerIds] = useState<Set<string>>(new Set());

  const canReceiveAll =
    Boolean(
      currentUser &&
        (Number(currentUser.id) === 0 ||
          Number(currentUser.role_id) === 0 ||
          Number(currentUser.role_id) === 1 ||
          userHasPermission('perm_stock_receive_all'))
    );

  const canResolveDisputes = canUserResolveTransferDispute(
    currentUser,
    userHasPermission('perm_stock_receive_all')
  );

  useEffect(() => {
    const client = getClientSupabase(supabaseUrl, supabaseKey);
    if (!client) return;
    fetchOverdueTransfersRpc(client, 48)
      .then((rows) => {
        if (Array.isArray(rows) && rows.length > 0) {
          setOverdueServerIds(new Set(rows.map((r) => String(r.id))));
        }
      })
      .catch(() => {});
  }, [supabaseUrl, supabaseKey, transfers.length]);

  const badgeCounts = useMemo(
    () =>
      computeTransferBadgeCounts(
        transfers,
        currentUser,
        depots,
        depotHolders,
        canReceiveAll
      ),
    [transfers, currentUser, depots, depotHolders, canReceiveAll]
  );

  // Listes par onglet
  const toReceiveList = useMemo(
    () =>
      transfers.filter((t) =>
        canUserReceiveTransfer(t, currentUser, depots, depotHolders, canReceiveAll)
      ),
    [transfers, currentUser, depots, depotHolders, canReceiveAll]
  );

  const toConfirmList = useMemo(
    () =>
      transfers.filter((t) =>
        canUserConfirmTransferAdjustment(t, currentUser, depots, depotHolders)
      ),
    [transfers, currentUser, depots, depotHolders]
  );

  const disputesList = useMemo(() => {
    if (disputesFilter === 'refusals') {
      return transfers.filter(
        (t) => t.status === 'PARTIALLY_RECEIVED' || t.status === 'REJECTED'
      );
    }
    return transfers.filter((t) => t.status === 'DISPUTED');
  }, [transfers, disputesFilter]);

  const sentByMeList = useMemo(
    () =>
      transfers.filter(
        (t) =>
          currentUser &&
          (String(t.sender_id) === String(currentUser.id) ||
            canUserCancelTransfer(t, currentUser, depots, depotHolders))
      ),
    [transfers, currentUser, depots, depotHolders]
  );

  const historyList = useMemo(() => {
    const nowMs = Date.now();
    const cutoffMs =
      histPeriod === '7d'
        ? nowMs - 7 * 24 * 3600 * 1000
        : histPeriod === '30d'
          ? nowMs - 30 * 24 * 3600 * 1000
          : 0;
    const qRef = histRef.trim().toLowerCase();

    return transfers.filter((t) => {
      if (cutoffMs > 0 && t.created_at) {
        const createdMs = new Date(t.created_at).getTime();
        if (Number.isFinite(createdMs) && createdMs < cutoffMs) return false;
      }
      if (histDepot !== 'ALL') {
        const matchSrc = t.source_depot?.toLowerCase() === histDepot.toLowerCase();
        const matchDst = t.dest_depot?.toLowerCase() === histDepot.toLowerCase();
        if (!matchSrc && !matchDst) return false;
      }
      if (histStatus !== 'ALL' && t.status !== histStatus) {
        return false;
      }
      if (histUser !== 'ALL') {
        const matchSender = String(t.sender_id || '') === histUser;
        const matchReceiver = String(t.receiver_id || '') === histUser;
        if (!matchSender && !matchReceiver) return false;
      }
      if (qRef) {
        const matchNumber = t.transfer_number?.toLowerCase().includes(qRef);
        const matchItem = (t.items || []).some(
          (it) =>
            it.product_ref?.toLowerCase().includes(qRef) ||
            it.product_name?.toLowerCase().includes(qRef) ||
            String(it.product_id).toLowerCase().includes(qRef)
        );
        if (!matchNumber && !matchItem) return false;
      }
      return true;
    });
  }, [transfers, histPeriod, histDepot, histStatus, histUser, histRef]);

  const currentList = useMemo(() => {
    switch (activeTab) {
      case 'to_receive':
        return toReceiveList;
      case 'to_confirm':
        return toConfirmList;
      case 'disputes':
        return disputesList;
      case 'sent_by_me':
        return sentByMeList;
      case 'history':
        return historyList.slice(0, histVisibleCount);
    }
  }, [
    activeTab,
    toReceiveList,
    toConfirmList,
    disputesList,
    sentByMeList,
    historyList,
    histVisibleCount,
  ]);

  const selectedTransfer = useMemo(
    () => transfers.find((t) => String(t.id) === String(selectedTransferId)) || null,
    [transfers, selectedTransferId]
  );

  // Initialiser les brouillons de ligne à la sélection d'un transfert
  useEffect(() => {
    if (!selectedTransfer) {
      setLineDrafts({});
      setReceptionNote('');
      setRejectAllMode(false);
      setRejectAllReason('');
      setConfirmComment('');
      setCancelReason('');
      setDisputeAcceptedQtys({});
      setDisputeNote('');
      return;
    }
    const initDrafts: Record<string, ReceiveLineDraft> = {};
    const initDisputeQtys: Record<string, number> = {};
    for (const item of selectedTransfer.items || []) {
      const pid = String(item.product_id);
      initDrafts[pid] = {
        productId: pid,
        mode: 'ACCEPT',
        quantitySent: Number(item.quantity_sent) || 1,
        quantityReceived: Number(item.quantity_sent) || 1,
        comment: '',
      };
      initDisputeQtys[pid] =
        item.quantity_received !== null && item.quantity_received !== undefined
          ? Number(item.quantity_received)
          : Number(item.quantity_sent) || 0;
    }
    setLineDrafts(initDrafts);
    setDisputeAcceptedQtys(initDisputeQtys);
    setReceptionNote('');
    setRejectAllMode(false);
    setRejectAllReason('');
    setConfirmComment('');
    setCancelReason('');
    setDisputeNote('');
  }, [selectedTransferId]);

  const handleAcceptAllLines = () => {
    if (!selectedTransfer) return;
    setRejectAllMode(false);
    const next: Record<string, ReceiveLineDraft> = {};
    for (const item of selectedTransfer.items || []) {
      const pid = String(item.product_id);
      next[pid] = {
        productId: pid,
        mode: 'ACCEPT',
        quantitySent: Number(item.quantity_sent) || 1,
        quantityReceived: Number(item.quantity_sent) || 1,
        comment: '',
      };
    }
    setLineDrafts(next);
  };

  // Vérification des règles de saisie de réception ligne par ligne
  const receptionValidationError = useMemo(() => {
    if (!selectedTransfer) return null;
    if (rejectAllMode) {
      if (!rejectAllReason.trim()) {
        return tr(
          language,
          'Le motif du refus total est obligatoire.',
          'Total refusal reason is required.',
          'Reden voor volledige weigering is verplicht.'
        );
      }
      return null;
    }
    for (const item of selectedTransfer.items || []) {
      const pid = String(item.product_id);
      const d = lineDrafts[pid];
      if (!d) continue;
      if (d.mode === 'MODIFY') {
        const qtyRec = Number(d.quantityReceived ?? d.quantity_received ?? 0);
        const qtySent = Number(d.quantitySent ?? item.quantity_sent ?? 1);
        const commentStr = String(d.comment ?? d.reason ?? '').trim();
        if (!Number.isFinite(qtyRec) || qtyRec < 1 || qtyRec > qtySent) {
          return tr(
            language,
            `Quantité reçue invalide pour ${item.product_ref || pid} (doit être comprise entre 1 et ${qtySent}).`,
            `Invalid received quantity for ${item.product_ref || pid} (must be between 1 and ${qtySent}).`,
            `Ongeldig ontvangen aantal voor ${item.product_ref || pid} (moet tussen 1 en ${qtySent} liggen).`
          );
        }
        if (qtyRec !== qtySent && !commentStr) {
          return tr(
            language,
            `Un commentaire est obligatoire pour la quantité modifiée sur ${item.product_ref || pid}.`,
            `A comment is required for the modified quantity on ${item.product_ref || pid}.`,
            `Een opmerking is verplicht voor het gewijzigde aantal op ${item.product_ref || pid}.`
          );
        }
      } else if (d.mode === 'REFUSE') {
        const commentStr = String(d.comment ?? d.reason ?? '').trim();
        if (!commentStr) {
          return tr(
            language,
            `Un motif est obligatoire pour le refus de la ligne ${item.product_ref || pid}.`,
            `A reason is required to refuse line ${item.product_ref || pid}.`,
            `Een reden is verplicht voor het weigeren van regel ${item.product_ref || pid}.`
          );
        }
      }
    }
    return null;
  }, [selectedTransfer, rejectAllMode, rejectAllReason, lineDrafts, language]);

  const receptionSummary = useMemo(() => {
    if (!selectedTransfer) return { accepted: 0, modified: 0, refused: 0 };
    if (rejectAllMode) {
      return {
        accepted: 0,
        modified: 0,
        refused: (selectedTransfer.items || []).length,
      };
    }
    let accepted = 0;
    let modified = 0;
    let refused = 0;
    for (const item of selectedTransfer.items || []) {
      const d = lineDrafts[String(item.product_id)];
      if (!d || d.mode === 'ACCEPT' || (d.mode === 'MODIFY' && d.quantityReceived === d.quantitySent)) {
        accepted++;
      } else if (d.mode === 'MODIFY') {
        modified++;
      } else if (d.mode === 'REFUSE') {
        refused++;
      }
    }
    return { accepted, modified, refused };
  }, [selectedTransfer, rejectAllMode, lineDrafts]);

  const handleValidateReception = async () => {
    if (!selectedTransfer || receptionValidationError) return;
    setSubmitting(true);
    setFeedback(null);
    const client = getClientSupabase(supabaseUrl, supabaseKey);

    try {
      if (rejectAllMode) {
        if (client) {
          const res = await rejectStockTransferRpc(client, {
            transferId: selectedTransfer.id,
            reason: rejectAllReason.trim(),
          });
          if (!res.success) {
            setFeedback({ type: 'err', message: res.error || 'Erreur lors du refus' });
            return;
          }
        }
        setFeedback({
          type: 'ok',
          message: tr(
            language,
            `Transfert ${selectedTransfer.transfer_number} refusé en totalité — stock recrédité au dépôt source.`,
            `Transfer ${selectedTransfer.transfer_number} refused — stock credited back to source depot.`,
            `Overdracht ${selectedTransfer.transfer_number} volledig geweigerd — voorraad teruggestort naar brondepot.`
          ),
        });
      } else {
        const draftList = Object.values(lineDrafts) as ReceiveLineDraft[];
        const modifiedOrRefusedPayload = buildReceiveTransferItemsPayload(draftList);
        if (client) {
          const res = await receiveStockTransferRpc(client, {
            transferId: selectedTransfer.id,
            items: modifiedOrRefusedPayload,
            note: receptionNote.trim() || undefined,
          });
          if (!res.success) {
            setFeedback({ type: 'err', message: res.error || 'Erreur lors de la réception' });
            return;
          }
        }
        setFeedback({
          type: 'ok',
          message: tr(
            language,
            `Réception du transfert ${selectedTransfer.transfer_number} enregistrée.`,
            `Transfer ${selectedTransfer.transfer_number} reception recorded.`,
            `Ontvangst van overdracht ${selectedTransfer.transfer_number} geregistreerd.`
          ),
        });
      }
      await refreshTransfers();
      await syncFromSupabase().catch(() => {});
      setSelectedTransferId(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSenderConfirmOrDispute = async (accept: boolean) => {
    if (!selectedTransfer) return;
    if (!accept && !confirmComment.trim()) {
      setFeedback({
        type: 'err',
        message: tr(
          language,
          'Un commentaire est obligatoire pour contester l’écart et ouvrir un litige.',
          'A comment is required to dispute the discrepancy.',
          'Een opmerking is verplicht om het verschil te betwisten.'
        ),
      });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    const client = getClientSupabase(supabaseUrl, supabaseKey);
    try {
      if (client) {
        const res = await confirmStockTransferAdjustmentRpc(client, {
          transferId: selectedTransfer.id,
          accept,
          comment: confirmComment.trim() || undefined,
        });
        if (!res.success) {
          setFeedback({ type: 'err', message: res.error || 'Erreur serveur' });
          return;
        }
      }
      setFeedback({
        type: 'ok',
        message: accept
          ? tr(
              language,
              `Écart confirmé sur ${selectedTransfer.transfer_number} : reliquat recrédité au dépôt source.`,
              `Discrepancy confirmed on ${selectedTransfer.transfer_number}: remainder credited back to source depot.`,
              `Verschil bevestigd op ${selectedTransfer.transfer_number}: restant teruggestort naar brondepot.`
            )
          : tr(
              language,
              `Transfert ${selectedTransfer.transfer_number} placé en litige (DISPUTED) pour arbitrage logistique.`,
              `Transfer ${selectedTransfer.transfer_number} marked as DISPUTED for logistics arbitration.`,
              `Overdracht ${selectedTransfer.transfer_number} in geschil (DISPUTED) geplaatst voor logistieke arbitrage.`
            ),
      });
      await refreshTransfers();
      await syncFromSupabase().catch(() => {});
      setSelectedTransferId(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelSentTransfer = async () => {
    if (!selectedTransfer) return;
    setSubmitting(true);
    setFeedback(null);
    const client = getClientSupabase(supabaseUrl, supabaseKey);
    try {
      if (client) {
        const res = await cancelStockTransferRpc(client, {
          transferId: selectedTransfer.id,
          reason: cancelReason.trim() || undefined,
        });
        if (!res.success) {
          setFeedback({ type: 'err', message: res.error || 'Erreur lors de l’annulation' });
          return;
        }
      }
      setFeedback({
        type: 'ok',
        message: tr(
          language,
          `Transfert ${selectedTransfer.transfer_number} annulé — stock recrédité au dépôt source.`,
          `Transfer ${selectedTransfer.transfer_number} cancelled — stock credited back to source depot.`,
          `Overdracht ${selectedTransfer.transfer_number} geannuleerd — voorraad teruggestort naar brondepot.`
        ),
      });
      await refreshTransfers();
      await syncFromSupabase().catch(() => {});
      setSelectedTransferId(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolveDispute = async () => {
    if (!selectedTransfer) return;
    if (!disputeNote.trim()) {
      setFeedback({
        type: 'err',
        message: tr(
          language,
          'Une note d’arbitrage est obligatoire pour clôturer un litige.',
          'An arbitration note is required to resolve a dispute.',
          'Een arbitragenotitie is verplicht om een geschil op te lossen.'
        ),
      });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    const client = getClientSupabase(supabaseUrl, supabaseKey);
    try {
      const resolutions = (selectedTransfer.items || []).map((it) => ({
        product_id: String(it.product_id),
        quantity_accepted: Math.max(
          0,
          Math.min(
            Number(it.quantity_sent) || 0,
            Number(disputeAcceptedQtys[String(it.product_id)] ?? it.quantity_received ?? 0)
          )
        ),
      }));
      if (client) {
        const res = await resolveTransferDisputeRpc(client, {
          transferId: selectedTransfer.id,
          resolutions,
          note: disputeNote.trim(),
        });
        if (!res.success) {
          setFeedback({ type: 'err', message: res.error || 'Erreur lors de l’arbitrage' });
          return;
        }
      }
      setFeedback({
        type: 'ok',
        message: tr(
          language,
          `Litige ${selectedTransfer.transfer_number} arbitré et clôturé.`,
          `Dispute ${selectedTransfer.transfer_number} resolved and closed.`,
          `Geschil ${selectedTransfer.transfer_number} beslecht en gesloten.`
        ),
      });
      await refreshTransfers();
      await syncFromSupabase().catch(() => {});
      setSelectedTransferId(null);
    } finally {
      setSubmitting(false);
    }
  };

  const renderStatusBadge = (t: StockTransferRecord) => {
    const overdue =
      t.status === 'IN_TRANSIT' &&
      (isTransferOverdue(t) || overdueServerIds.has(String(t.id)));
    const map: Record<StockTransferStatus, { label: string; cls: string }> = {
      IN_TRANSIT: {
        label: overdue
          ? tr(language, 'En transit (> 48 h)', 'In transit (> 48h)', 'Onderweg (> 48u)')
          : tr(language, 'En transit', 'In transit', 'Onderweg'),
        cls: overdue
          ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-200 border-rose-300 dark:border-rose-700'
          : 'bg-sky-100 text-sky-800 dark:bg-sky-950/80 dark:text-sky-200 border-sky-300 dark:border-sky-700',
      },
      AWAITING_SENDER: {
        label: tr(language, 'Écart à confirmer', 'Awaiting sender', 'Wacht op verzender'),
        cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950/80 dark:text-amber-200 border-amber-300 dark:border-amber-700',
      },
      DISPUTED: {
        label: tr(language, 'En litige', 'Disputed', 'In geschil'),
        cls: 'bg-rose-100 text-rose-900 dark:bg-rose-950/80 dark:text-rose-200 border-rose-400 dark:border-rose-700',
      },
      RECEIVED: {
        label: tr(language, 'Reçu complet', 'Received', 'Volledig ontvangen'),
        cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700',
      },
      PARTIALLY_RECEIVED: {
        label: tr(language, 'Reçu partiel', 'Partially received', 'Gedeeltelijk ontvangen'),
        cls: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-200 border-indigo-300 dark:border-indigo-700',
      },
      REJECTED: {
        label: tr(language, 'Refusé', 'Rejected', 'Geweigerd'),
        cls: 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-200 border-rose-300 dark:border-rose-700',
      },
      CANCELLED: {
        label: tr(language, 'Annulé', 'Cancelled', 'Geannuleerd'),
        cls: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700',
      },
      RETURNED_TO_STOCK: {
        label: tr(language, 'Remis en stock source', 'Returned to source stock', 'Teruggeboekt naar bronvoorraad'),
        cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700',
      },
    };
    const info = map[t.status] || map.IN_TRANSIT;
    return (
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${info.cls}`}>
        {info.label}
      </span>
    );
  };

  return (
    <div
      data-testid="transfers-validation-panel"
      className="flex flex-col h-full bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs"
    >
      {/* En-tête */}
      <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-800/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-sky-100 dark:bg-sky-950/70 text-sky-600 dark:text-sky-400 flex items-center justify-center">
            <ArrowLeftRight className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
              <span>
                {tr(
                  language,
                  'Transferts inter-dépôts & Réceptions',
                  'Inter-Depot Transfers & Receptions',
                  'Overdrachten tussen depots & Ontvangsten'
                )}
              </span>
              {badgeCounts.totalBadge > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-rose-600 text-white">
                  {badgeCounts.totalBadge}
                </span>
              )}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {tr(
                language,
                'Validation contradictoire à la réception, confirmation d’écarts et arbitrage des litiges',
                'Reception validation, discrepancy confirmation, and dispute resolution',
                'Ontvangstvalidatie, bevestiging van afwijkingen en geschillenbeslechting'
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canTransferBetweenDepots && (
            <button
              type="button"
              onClick={() => openStockTransferModal({})}
              className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-black text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {tr(language, 'Nouveau transfert', 'New Transfer', 'Nieuwe overdracht')}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => refreshTransfers()}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
            title={tr(language, 'Rafraîchir', 'Refresh', 'Vernieuwen')}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {isModal && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-200/70 dark:bg-slate-800 hover:bg-slate-300 text-slate-600 dark:text-slate-300 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Onglets */}
      <div className="px-4 sm:px-6 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1.5 overflow-x-auto shrink-0 bg-slate-50/40 dark:bg-slate-900">
        <button
          type="button"
          data-testid="tab-transfers-to-receive"
          onClick={() => {
            setActiveTab('to_receive');
            setSelectedTransferId(null);
          }}
          className={`px-3 py-1.5 rounded-xl font-black text-xs flex items-center gap-1.5 cursor-pointer shrink-0 ${
            activeTab === 'to_receive'
              ? 'bg-sky-600 text-white'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
          }`}
        >
          <Inbox className="w-3.5 h-3.5" />
          <span>{tr(language, 'À recevoir', 'To Receive', 'Te ontvangen')}</span>
          {badgeCounts.toReceiveCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-rose-500 text-white">
              {badgeCounts.toReceiveCount}
            </span>
          )}
        </button>

        <button
          type="button"
          data-testid="tab-transfers-to-confirm"
          onClick={() => {
            setActiveTab('to_confirm');
            setSelectedTransferId(null);
          }}
          className={`px-3 py-1.5 rounded-xl font-black text-xs flex items-center gap-1.5 cursor-pointer shrink-0 ${
            activeTab === 'to_confirm'
              ? 'bg-amber-600 text-white'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
          }`}
        >
          <FileCheck2 className="w-3.5 h-3.5" />
          <span>{tr(language, 'À confirmer', 'To Confirm', 'Te bevestigen')}</span>
          {badgeCounts.toConfirmCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-white">
              {badgeCounts.toConfirmCount}
            </span>
          )}
        </button>

        {canResolveDisputes && (
          <button
            type="button"
            data-testid="tab-transfers-disputes"
            onClick={() => {
              setActiveTab('disputes');
              setSelectedTransferId(null);
            }}
            className={`px-3 py-1.5 rounded-xl font-black text-xs flex items-center gap-1.5 cursor-pointer shrink-0 ${
              activeTab === 'disputes'
                ? 'bg-rose-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>{tr(language, 'Litiges', 'Disputes', 'Geschillen')}</span>
            {badgeCounts.disputedCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-rose-500 text-white">
                {badgeCounts.disputedCount}
              </span>
            )}
          </button>
        )}

        <button
          type="button"
          data-testid="tab-transfers-sent-by-me"
          onClick={() => {
            setActiveTab('sent_by_me');
            setSelectedTransferId(null);
          }}
          className={`px-3 py-1.5 rounded-xl font-black text-xs flex items-center gap-1.5 cursor-pointer shrink-0 ${
            activeTab === 'sent_by_me'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
          }`}
        >
          <Send className="w-3.5 h-3.5" />
          <span>{tr(language, 'Envoyés par moi', 'Sent by Me', 'Door mij verzonden')}</span>
        </button>

        <button
          type="button"
          data-testid="tab-transfers-history"
          onClick={() => {
            setActiveTab('history');
            setSelectedTransferId(null);
          }}
          className={`px-3 py-1.5 rounded-xl font-black text-xs flex items-center gap-1.5 cursor-pointer shrink-0 ${
            activeTab === 'history'
              ? 'bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>{tr(language, 'Historique', 'History', 'Geschiedenis')}</span>
        </button>
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          className={`mx-4 sm:mx-6 mt-3 p-3 rounded-xl border flex items-center justify-between gap-2 font-bold ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
          }`}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Filtres spécifiques à l'onglet Litiges */}
      {activeTab === 'disputes' && (
        <div className="px-4 sm:px-6 pt-3 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setDisputesFilter('disputed')}
            className={`px-3 py-1 rounded-lg font-bold text-xs cursor-pointer ${
              disputesFilter === 'disputed'
                ? 'bg-rose-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            {tr(language, 'Litiges à arbitrer (DISPUTED)', 'Disputes to Arbitrate (DISPUTED)', 'Geschillen (DISPUTED)')}
          </button>
          <button
            type="button"
            data-testid="filter-refusals-to-process"
            onClick={() => setDisputesFilter('refusals')}
            className={`px-3 py-1 rounded-lg font-bold text-xs cursor-pointer ${
              disputesFilter === 'refusals'
                ? 'bg-amber-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            {tr(
              language,
              'Refus à traiter (PARTIALLY_RECEIVED / REJECTED)',
              'Refusals to Process (PARTIALLY_RECEIVED / REJECTED)',
              'Te verwerken weigeringen (PARTIALLY_RECEIVED / REJECTED)'
            )}
          </button>
        </div>
      )}

      {/* Filtres spécifiques à l'onglet Historique */}
      {activeTab === 'history' && (
        <div className="px-4 sm:px-6 pt-3 grid grid-cols-1 sm:grid-cols-5 gap-2 shrink-0">
          <SearchableSelect
            value={histPeriod}
            onChange={(val) => setHistPeriod(val as '7d' | '30d' | 'all')}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
          >
            <option value="7d">{tr(language, '7 derniers jours (défaut)', 'Last 7 days (default)', 'Laatste 7 dagen')}</option>
            <option value="30d">{tr(language, '30 derniers jours', 'Last 30 days', 'Laatste 30 dagen')}</option>
            <option value="all">{tr(language, 'Toute la période', 'All time', 'Alle periodes')}</option>
          </SearchableSelect>

          <SearchableSelect
            value={histDepot}
            onChange={(val) => setHistDepot(val)}
            recentKey="depots"
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
          >
            <option value="ALL">{tr(language, 'Tous les dépôts', 'All depots', 'Alle depots')}</option>
            {depots.map((d) => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
          </SearchableSelect>

          <SearchableSelect
            value={histStatus}
            onChange={(val) => setHistStatus(val)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
          >
            <option value="ALL">{tr(language, 'Tous les statuts', 'All statuses', 'Alle statussen')}</option>
            <option value="IN_TRANSIT">IN_TRANSIT</option>
            <option value="AWAITING_SENDER">AWAITING_SENDER</option>
            <option value="DISPUTED">DISPUTED</option>
            <option value="RECEIVED">RECEIVED</option>
            <option value="PARTIALLY_RECEIVED">PARTIALLY_RECEIVED</option>
            <option value="REJECTED">REJECTED</option>
            <option value="CANCELLED">CANCELLED</option>
          </SearchableSelect>

          <SearchableSelect
            value={histUser}
            onChange={(val) => setHistUser(val)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
          >
            <option value="ALL">{tr(language, 'Tous les utilisateurs', 'All users', 'Alle gebruikers')}</option>
            {users.map((u) => (
              <option key={String(u.id)} value={String(u.id)}>
                {u.name} ({u.trigram})
              </option>
            ))}
          </SearchableSelect>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={histRef}
              onChange={(e) => setHistRef(e.target.value)}
              placeholder={tr(language, 'Référence ou TRF-...', 'Reference or TRF-...', 'Referentie of TRF-...')}
              className="w-full pl-8 pr-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
          </div>
        </div>
      )}

      {/* Corps : Liste à gauche + Détail ligne par ligne à droite */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 sm:p-6 overflow-y-auto">
        {/* Colonne Liste */}
        <div className="lg:col-span-5 space-y-2.5">
          {currentList.length === 0 ? (
            <div className="p-8 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-slate-400">
              {tr(
                language,
                'Aucun transfert dans cet onglet.',
                'No transfer in this tab.',
                'Geen overdracht in dit tabblad.'
              )}
            </div>
          ) : (
            currentList.map((t) => {
              const overdue =
                t.status === 'IN_TRANSIT' &&
                (isTransferOverdue(t) || overdueServerIds.has(String(t.id)));
              const isSelected = String(t.id) === String(selectedTransferId);
              return (
                <div
                  key={t.id}
                  data-testid={`transfer-card-${t.id}`}
                  onClick={() => setSelectedTransferId(t.id)}
                  className={`p-3.5 rounded-2xl border transition cursor-pointer space-y-1.5 ${
                    overdue
                      ? 'border-rose-400 dark:border-rose-700 bg-rose-50/60 dark:bg-rose-950/30'
                      : isSelected
                        ? 'border-sky-500 ring-2 ring-sky-500/20 bg-sky-50/40 dark:bg-sky-950/30'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-sky-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-mono font-black text-slate-900 dark:text-white">
                      {t.transfer_number}
                    </span>
                    {renderStatusBadge(t)}
                  </div>

                  <div className="font-bold text-slate-800 dark:text-slate-200">
                    {t.source_depot} → {t.dest_depot}
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span>
                      {t.total_items || (t.items || []).length}{' '}
                      {tr(language, 'réf.', 'ref.', 'ref.')} •{' '}
                      {t.total_quantity_sent}{' '}
                      {tr(language, 'pièce(s)', 'unit(s)', 'stuk(s)')}
                    </span>
                    <span>
                      {t.sender_name || '—'}{' '}
                      {t.created_at
                        ? `• ${new Date(t.created_at).toLocaleDateString()}`
                        : ''}
                    </span>
                  </div>

                  {overdue && (
                    <div
                      data-testid={`transfer-overdue-alert-${t.id}`}
                      className="text-[10.5px] font-black text-rose-700 dark:text-rose-300 flex items-center gap-1 pt-0.5"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {tr(
                          language,
                          'En retard (> 48 h en transit sans validation)',
                          'Overdue (> 48h in transit without validation)',
                          'Te laat (> 48u onderweg zonder validatie)'
                        )}
                      </span>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {activeTab === 'history' && historyList.length > histVisibleCount && (
            <button
              type="button"
              onClick={() => setHistVisibleCount((prev) => prev + 25)}
              className="w-full py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-black text-xs hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              {tr(language, 'Charger plus', 'Load more', 'Meer laden')} ({histVisibleCount} /{' '}
              {historyList.length})
            </button>
          )}
        </div>

        {/* Colonne Détail & Actions ligne par ligne */}
        <div className="lg:col-span-7">
          {!selectedTransfer ? (
            <div className="p-8 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-slate-400">
              {tr(
                language,
                'Sélectionnez un transfert dans la liste pour afficher le détail ligne par ligne.',
                'Select a transfer from the list to view line-by-line details.',
                'Selecteer een overdracht in de lijst om de details per regel te bekijken.'
              )}
            </div>
          ) : (
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-4">
              <div className="flex items-start justify-between gap-2 flex-wrap border-b border-slate-200 dark:border-slate-700 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-black text-slate-900 dark:text-white">
                      {selectedTransfer.transfer_number}
                    </span>
                    {renderStatusBadge(selectedTransfer)}
                  </div>
                  <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-1">
                    {selectedTransfer.source_depot} → {selectedTransfer.dest_depot}
                  </div>
                  {selectedTransfer.reason && (
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {tr(language, 'Motif :', 'Reason:', 'Reden:')} {selectedTransfer.reason}
                    </div>
                  )}
                </div>

                {/* Boutons Tout accepter / Tout refuser si réceptionnable */}
                {selectedTransfer.status === 'IN_TRANSIT' &&
                  canUserReceiveTransfer(
                    selectedTransfer,
                    currentUser,
                    depots,
                    depotHolders,
                    canReceiveAll
                  ) && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        data-testid="receive-accept-all-btn"
                        onClick={handleAcceptAllLines}
                        className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs flex items-center gap-1 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{tr(language, 'Tout accepter', 'Accept All', 'Alles accepteren')}</span>
                      </button>
                      <button
                        type="button"
                        data-testid="receive-reject-all-btn"
                        onClick={() => setRejectAllMode((prev) => !prev)}
                        className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-xs flex items-center gap-1 cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>{tr(language, 'Tout refuser', 'Reject All', 'Alles weigeren')}</span>
                      </button>
                    </div>
                  )}
              </div>

              {/* Mode Refus Total */}
              {rejectAllMode && selectedTransfer.status === 'IN_TRANSIT' && (
                <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 space-y-2">
                  <label className="block font-black text-rose-900 dark:text-rose-200">
                    {tr(
                      language,
                      'Motif du refus total (obligatoire — recrédite immédiatement le dépôt source) :',
                      'Total refusal reason (required — immediately credits back source depot):',
                      'Reden voor volledige weigering (verplicht — crediteert brondepot onmiddellijk):'
                    )}
                  </label>
                  <input
                    type="text"
                    data-testid="reject-all-reason-input"
                    value={rejectAllReason}
                    onChange={(e) => setRejectAllReason(e.target.value)}
                    placeholder={tr(
                      language,
                      'Ex: Mauvais camion destinataire, matériel endommagé...',
                      'Ex: Wrong destination van, damaged items...',
                      'Bijv. Verkeerde bestelwagen, beschadigd materiaal...'
                    )}
                    className="w-full px-3 py-2 rounded-lg border border-rose-300 dark:border-rose-700 bg-white dark:bg-slate-900"
                  />
                </div>
              )}

              {/* Lignes du transfert */}
              <div className="space-y-2.5">
                {(selectedTransfer.items || []).map((item) => {
                  const pid = String(item.product_id);
                  const draft = lineDrafts[pid] || {
                    productId: pid,
                    mode: 'ACCEPT',
                    quantitySent: Number(item.quantity_sent) || 1,
                    quantityReceived: Number(item.quantity_sent) || 1,
                    comment: '',
                  };
                  const canReceiveNow =
                    selectedTransfer.status === 'IN_TRANSIT' &&
                    !rejectAllMode &&
                    canUserReceiveTransfer(
                      selectedTransfer,
                      currentUser,
                      depots,
                      depotHolders,
                      canReceiveAll
                    );

                  return (
                    <div
                      key={pid}
                      data-testid={`transfer-detail-line-${pid}`}
                      className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <span className="font-mono font-black text-slate-900 dark:text-white">
                            {item.product_ref || pid}
                          </span>
                          {item.product_name && (
                            <span className="ml-2 text-slate-600 dark:text-slate-300 font-semibold">
                              {item.product_name}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 font-mono text-[11px]">
                          <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-bold">
                            {tr(language, 'Envoyé :', 'Sent:', 'Verzonden:')}{' '}
                            {item.quantity_sent}
                          </span>
                          {item.quantity_received !== null &&
                            item.quantity_received !== undefined && (
                              <span className="px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-200 font-bold">
                                {tr(language, 'Reçu :', 'Received:', 'Ontvangen:')}{' '}
                                {item.quantity_received}
                              </span>
                            )}
                          {item.quantity_accepted !== null &&
                            item.quantity_accepted !== undefined && (
                              <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 font-bold">
                                {tr(language, 'Accepté :', 'Accepted:', 'Geaccepteerd:')}{' '}
                                {item.quantity_accepted}
                              </span>
                            )}
                        </div>
                      </div>

                      {item.receiver_comment && (
                        <div className="text-[11px] text-amber-700 dark:text-amber-300 font-semibold">
                          {tr(language, 'Commentaire réception :', 'Receiver comment:', 'Opmerking ontvanger:')}{' '}
                          {item.receiver_comment}
                        </div>
                      )}

                      {/* Contrôles de réception ligne par ligne (Accepter / Modifier la quantité / Refuser) */}
                      {canReceiveNow && (
                        <div className="pt-1 space-y-2 border-t border-slate-100 dark:border-slate-800">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setLineDrafts((prev) => ({
                                  ...prev,
                                  [pid]: {
                                    ...draft,
                                    mode: 'ACCEPT',
                                    quantityReceived: draft.quantitySent,
                                    comment: '',
                                  },
                                }))
                              }
                              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] cursor-pointer ${
                                draft.mode === 'ACCEPT'
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              {tr(language, 'Accepter', 'Accept', 'Accepteren')} ({draft.quantitySent})
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                setLineDrafts((prev) => ({
                                  ...prev,
                                  [pid]: {
                                    ...draft,
                                    mode: 'MODIFY',
                                    quantityReceived: Math.max(1, (draft.quantitySent ?? 1) - 1),
                                  },
                                }))
                              }
                              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] cursor-pointer ${
                                draft.mode === 'MODIFY'
                                  ? 'bg-amber-600 text-white'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              {tr(
                                language,
                                'Modifier la quantité',
                                'Modify quantity',
                                'Aantal wijzigen'
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                setLineDrafts((prev) => ({
                                  ...prev,
                                  [pid]: {
                                    ...draft,
                                    mode: 'REFUSE',
                                    quantityReceived: 0,
                                  },
                                }))
                              }
                              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] cursor-pointer ${
                                draft.mode === 'REFUSE'
                                  ? 'bg-rose-600 text-white'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              {tr(language, 'Refuser', 'Refuse', 'Weigeren')}
                            </button>
                          </div>

                          {draft.mode === 'MODIFY' && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <div>
                                <label className="block text-[10.5px] font-bold text-slate-600 dark:text-slate-300 mb-0.5">
                                  {tr(language, 'Qté reçue (1 à', 'Qty received (1 to', 'Ontvangen (1 tot')}{' '}
                                  {draft.quantitySent})
                                </label>
                                <input
                                  type="number"
                                  min={1}
                                  max={draft.quantitySent}
                                  value={draft.quantityReceived}
                                  onChange={(e) =>
                                    setLineDrafts((prev) => ({
                                      ...prev,
                                      [pid]: {
                                        ...draft,
                                        quantityReceived: Number(e.target.value),
                                      },
                                    }))
                                  }
                                  className="w-full px-2.5 py-1 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 font-mono font-bold"
                                />
                              </div>
                              <div className="sm:col-span-2">
                                <label className="block text-[10.5px] font-bold text-slate-600 dark:text-slate-300 mb-0.5">
                                  {tr(
                                    language,
                                    'Commentaire d’écart (obligatoire) *',
                                    'Discrepancy comment (required) *',
                                    'Opmerking bij afwijking (verplicht) *'
                                  )}
                                </label>
                                <input
                                  type="text"
                                  value={draft.comment}
                                  onChange={(e) =>
                                    setLineDrafts((prev) => ({
                                      ...prev,
                                      [pid]: { ...draft, comment: e.target.value },
                                    }))
                                  }
                                  placeholder={tr(
                                    language,
                                    'Ex: 1 pièce manquante dans le carton...',
                                    'Ex: 1 unit missing in box...',
                                    'Bijv. 1 stuk ontbreekt in doos...'
                                  )}
                                  className="w-full px-2.5 py-1 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900"
                                />
                              </div>
                            </div>
                          )}

                          {draft.mode === 'REFUSE' && (
                            <div>
                              <label className="block text-[10.5px] font-bold text-rose-700 dark:text-rose-300 mb-0.5">
                                {tr(
                                  language,
                                  'Motif du refus de la ligne (obligatoire) *',
                                  'Line refusal reason (required) *',
                                  'Reden voor weigering van regel (verplicht) *'
                                )}
                              </label>
                              <input
                                type="text"
                                value={draft.comment}
                                onChange={(e) =>
                                  setLineDrafts((prev) => ({
                                    ...prev,
                                    [pid]: { ...draft, comment: e.target.value },
                                  }))
                                }
                                placeholder={tr(
                                  language,
                                  'Ex: Référence non commandée / défectueuse...',
                                  'Ex: Wrong reference / defective...',
                                  'Bijv. Verkeerde referentie / defect...'
                                )}
                                className="w-full px-2.5 py-1 rounded-lg border border-rose-300 dark:border-rose-700 bg-white dark:bg-slate-900"
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {/* Arbitrage logistique en cas de litige DISPUTED */}
                      {selectedTransfer.status === 'DISPUTED' && canResolveDisputes && (
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                          <span className="font-bold text-rose-700 dark:text-rose-300">
                            {tr(
                              language,
                              'Quantité retenue après arbitrage (0 à',
                              'Accepted quantity after arbitration (0 to',
                              'Geaccepteerd aantal na arbitrage (0 tot'
                            )}{' '}
                            {item.quantity_sent}) :
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={Number(item.quantity_sent) || 0}
                            value={disputeAcceptedQtys[pid] ?? 0}
                            onChange={(e) =>
                              setDisputeAcceptedQtys((prev) => ({
                                ...prev,
                                [pid]: Number(e.target.value),
                              }))
                            }
                            className="w-24 px-2.5 py-1 rounded-lg border border-rose-300 dark:border-rose-700 bg-white dark:bg-slate-900 font-mono font-black text-center"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Bloc Validation de Réception (IN_TRANSIT) */}
              {selectedTransfer.status === 'IN_TRANSIT' &&
                canUserReceiveTransfer(
                  selectedTransfer,
                  currentUser,
                  depots,
                  depotHolders,
                  canReceiveAll
                ) && (
                  <div className="p-3.5 rounded-xl bg-sky-50/80 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="font-black text-sky-900 dark:text-sky-200">
                        {tr(
                          language,
                          'Récapitulatif avant confirmation :',
                          'Summary before confirmation:',
                          'Overzicht voor bevestiging:'
                        )}
                      </span>
                      <div className="flex items-center gap-2 text-[11px] font-bold">
                        <span className="text-emerald-700 dark:text-emerald-300">
                          {receptionSummary.accepted}{' '}
                          {tr(language, 'acceptée(s)', 'accepted', 'geaccepteerd')}
                        </span>
                        <span>•</span>
                        <span className="text-amber-700 dark:text-amber-300">
                          {receptionSummary.modified}{' '}
                          {tr(language, 'modifiée(s)', 'modified', 'gewijzigd')}
                        </span>
                        <span>•</span>
                        <span className="text-rose-700 dark:text-rose-300">
                          {receptionSummary.refused}{' '}
                          {tr(language, 'refusée(s)', 'refused', 'geweigerd')}
                        </span>
                      </div>
                    </div>

                    {!rejectAllMode && (
                      <input
                        type="text"
                        value={receptionNote}
                        onChange={(e) => setReceptionNote(e.target.value)}
                        placeholder={tr(
                          language,
                          'Note de réception globale (optionnelle)...',
                          'Overall reception note (optional)...',
                          'Algemene ontvangstnotitie (optioneel)...'
                        )}
                        className="w-full px-3 py-1.5 rounded-lg border border-sky-200 dark:border-sky-800 bg-white dark:bg-slate-900"
                      />
                    )}

                    {receptionValidationError && (
                      <div className="p-2 rounded-lg bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-200 font-bold text-[11px]">
                        {receptionValidationError}
                      </div>
                    )}

                    <div className="flex justify-end">
                      <button
                        type="button"
                        data-testid="confirm-receive-transfer-btn"
                        disabled={submitting || Boolean(receptionValidationError)}
                        onClick={handleValidateReception}
                        className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-black text-xs flex items-center gap-1.5 cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>
                          {rejectAllMode
                            ? tr(
                                language,
                                'Confirmer le refus total',
                                'Confirm Total Refusal',
                                'Volledige weigering bevestigen'
                              )
                            : tr(
                                language,
                                'Valider la réception',
                                'Confirm Reception',
                                'Ontvangst valideren'
                              )}
                        </span>
                      </button>
                    </div>
                  </div>
                )}

              {/* Bloc À confirmer par l'expéditeur (AWAITING_SENDER) */}
              {selectedTransfer.status === 'AWAITING_SENDER' &&
                canUserConfirmTransferAdjustment(
                  selectedTransfer,
                  currentUser,
                  depots,
                  depotHolders
                ) && (
                  <div className="p-3.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 space-y-3">
                    <div className="font-black text-amber-900 dark:text-amber-200">
                      {tr(
                        language,
                        'Écart signalé à la réception — confirmation de l’expéditeur requise',
                        'Discrepancy reported at reception — sender confirmation required',
                        'Afwijking gemeld bij ontvangst — bevestiging door verzender vereist'
                      )}
                    </div>
                    <input
                      type="text"
                      value={confirmComment}
                      onChange={(e) => setConfirmComment(e.target.value)}
                      placeholder={tr(
                        language,
                        'Commentaire (obligatoire en cas de contestation / litige)...',
                        'Comment (required if disputing)...',
                        'Opmerking (verplicht bij betwisting)...'
                      )}
                      className="w-full px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        data-testid="dispute-adjustment-btn"
                        disabled={submitting}
                        onClick={() => handleSenderConfirmOrDispute(false)}
                        className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-xs cursor-pointer"
                      >
                        {tr(
                          language,
                          'Contester → Litige (DISPUTED)',
                          'Dispute → DISPUTED',
                          'Betwisten → Geschil (DISPUTED)'
                        )}
                      </button>
                      <button
                        type="button"
                        data-testid="accept-adjustment-btn"
                        disabled={submitting}
                        onClick={() => handleSenderConfirmOrDispute(true)}
                        className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs cursor-pointer"
                      >
                        {tr(
                          language,
                          'Accepter l’écart et recréditer le reliquat',
                          'Accept Discrepancy & Credit Remainder',
                          'Afwijking accepteren & restant terugboeken'
                        )}
                      </button>
                    </div>
                  </div>
                )}

              {/* Bloc Annulation par l'expéditeur tant que IN_TRANSIT */}
              {selectedTransfer.status === 'IN_TRANSIT' &&
                canUserCancelTransfer(
                  selectedTransfer,
                  currentUser,
                  depots,
                  depotHolders
                ) && (
                  <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2">
                    <input
                      type="text"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      placeholder={tr(
                        language,
                        'Motif d’annulation (optionnel)...',
                        'Cancellation reason (optional)...',
                        'Reden van annulering (optioneel)...'
                      )}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                    <button
                      type="button"
                      data-testid="cancel-sent-transfer-btn"
                      disabled={submitting}
                      onClick={handleCancelSentTransfer}
                      className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-xs flex items-center gap-1 cursor-pointer"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span>
                        {tr(
                          language,
                          'Annuler ce transfert',
                          'Cancel Transfer',
                          'Overdracht annuleren'
                        )}
                      </span>
                    </button>
                  </div>
                )}

              {/* Bloc Arbitrage d'un litige (DISPUTED) */}
              {selectedTransfer.status === 'DISPUTED' && canResolveDisputes && (
                <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 space-y-2.5">
                  <div className="font-black text-rose-900 dark:text-rose-200">
                    {tr(
                      language,
                      'Arbitrage logistique du litige (resolve_transfer_dispute)',
                      'Logistics Dispute Arbitration (resolve_transfer_dispute)',
                      'Logistieke arbitrage van geschil (resolve_transfer_dispute)'
                    )}
                  </div>
                  <input
                    type="text"
                    data-testid="dispute-resolution-note-input"
                    value={disputeNote}
                    onChange={(e) => setDisputeNote(e.target.value)}
                    placeholder={tr(
                      language,
                      'Note d’arbitrage obligatoire *',
                      'Mandatory arbitration note *',
                      'Verplichte arbitragenotitie *'
                    )}
                    className="w-full px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-700 bg-white dark:bg-slate-900"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      data-testid="resolve-dispute-submit-btn"
                      disabled={submitting}
                      onClick={handleResolveDispute}
                      className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-xs cursor-pointer"
                    >
                      {tr(
                        language,
                        'Clôturer et appliquer l’arbitrage',
                        'Resolve & Apply Arbitration',
                        'Arbitrage toepassen en sluiten'
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
