import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  ArrowLeftRight,
  Search,
  Plus,
  Minus,
  Trash2,
  ScanLine,
  ShoppingCart,
  Building2,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Package,
  ArrowRight,
  Clock,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { tr } from '../i18n/dutchTranslator';
import {
  getAvailableStockInDepot,
} from '../services/stockMovementService';
import {
  getEligibleSourceDepots,
  getEligibleDestDepots,
} from '../services/transferService';
import { generateOperationId } from '../services/offline/indexedDb';
import { playScanBeep } from '../utils/crypto';
import { SearchableSelect } from './SearchableSelect';

export interface StockTransferLineItem {
  productId: string;
  quantity: number;
  destRack: string;
}

export const StockTransferModal: React.FC = () => {
  const {
    stockTransferModal,
    setStockTransferModal,
    canTransferBetweenDepots,
    currentUser,
    depots,
    depotHolders,
    users,
    userHasPermission,
    products,
    stockLevels,
    batchCart,
    orderCart,
    transferStockBatchBetweenDepots,
    language,
  } = useApp();

  const eligibleSourceDepots = useMemo(
    () =>
      getEligibleSourceDepots(
        currentUser,
        depots,
        depotHolders,
        userHasPermission('perm_stock_transfer'),
        userHasPermission('perm_stock_transfer_store')
      ),
    [currentUser, depots, depotHolders, userHasPermission]
  );

  const [sourceDepot, setSourceDepot] = useState<string>('');
  const [destDepot, setDestDepot] = useState<string>('');
  const [lines, setLines] = useState<StockTransferLineItem[]>([]);
  const [reason, setReason] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [scanCodeInput, setScanCodeInput] = useState<string>('');
  const [showScannerInput, setShowScannerInput] = useState<boolean>(false);
  const [batchId, setBatchId] = useState<string>(() => generateOperationId());
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'offline' | 'error';
    message: string;
    transferNumber?: string;
    transferStatus?: string;
    receiverNames?: string[];
  } | null>(null);

  const scanInputRef = useRef<HTMLInputElement | null>(null);

  const destDepotOptions = useMemo(
    () => getEligibleDestDepots(sourceDepot, depots, depotHolders, users),
    [sourceDepot, depots, depotHolders, users]
  );

  // Initialisation à l'ouverture de la modale
  useEffect(() => {
    if (!stockTransferModal.open) return;

    const srcNames = eligibleSourceDepots.map((d) => d.name);
    let initSrc = stockTransferModal.initialSourceDepot || '';
    if (!initSrc || !srcNames.includes(initSrc)) {
      initSrc = srcNames[0] || '';
    }

    const dstOptions = getEligibleDestDepots(initSrc, depots, depotHolders, users);
    const dstNames = dstOptions.map((o) => o.depot.name);
    let initDst = stockTransferModal.initialDestDepot || '';
    if (!initDst || !dstNames.includes(initDst) || initDst === initSrc) {
      initDst = dstNames[0] || '';
    }

    setSourceDepot(initSrc);
    setDestDepot(initDst);
    setReason('');
    setSearchQuery('');
    setScanCodeInput('');
    setShowScannerInput(false);
    setFeedback(null);
    setBatchId(generateOperationId());

    if (
      Array.isArray(stockTransferModal.initialItems) &&
      stockTransferModal.initialItems.length > 0
    ) {
      const initialLines: StockTransferLineItem[] = [];
      for (const item of stockTransferModal.initialItems) {
        const prod = products.find((p) => String(p.id) === String(item.productId));
        if (!prod) continue;
        const avail = getAvailableStockInDepot(prod.id, initSrc, stockLevels, products);
        const defaultQty = item.quantity && item.quantity > 0 ? item.quantity : 1;
        const cappedQty = avail > 0 ? Math.min(defaultQty, avail) : defaultQty;
        initialLines.push({
          productId: String(prod.id),
          quantity: cappedQty,
          destRack: item.destRack || '',
        });
      }
      setLines(initialLines);
    } else {
      setLines([]);
    }
  }, [stockTransferModal.open]);

  // Si l'utilisateur change les lignes ou les dépôts, un nouveau lot (nouveau batchId) est préparé.
  // Si au contraire il relance la même validation après une erreur réseau/serveur sans modifier le lot,
  // le même batchId est conservé pour garantir l'idempotence serveur.
  const markDraftMutated = () => {
    setBatchId(generateOperationId());
    setFeedback(null);
  };

  useEffect(() => {
    const validDstNames = destDepotOptions.map((o) => o.depot.name);
    if (!destDepot || destDepot === sourceDepot || !validDstNames.includes(destDepot)) {
      setDestDepot(validDstNames[0] || '');
    }
  }, [sourceDepot, destDepot, destDepotOptions]);

  // Plafonner automatiquement les quantités lorsque le dépôt source change
  const handleSourceDepotChange = (nextSource: string) => {
    markDraftMutated();
    setSourceDepot(nextSource);
    const nextDestOpts = getEligibleDestDepots(nextSource, depots, depotHolders, users);
    if (!nextDestOpts.some((o) => o.depot.name === destDepot)) {
      setDestDepot(nextDestOpts[0]?.depot.name || '');
    }
    setLines((prev) =>
      prev.map((line) => {
        const avail = getAvailableStockInDepot(line.productId, nextSource, stockLevels, products);
        return {
          ...line,
          quantity: avail > 0 ? Math.min(Math.max(1, line.quantity), avail) : line.quantity,
        };
      })
    );
  };

  // Inversion rapide Source <-> Destination (⇄)
  const handleSwapDepots = () => {
    if (!sourceDepot || !destDepot) return;
    if (!eligibleSourceDepots.some((d) => d.name === destDepot)) return;
    markDraftMutated();
    const prevSource = sourceDepot;
    const prevDest = destDepot;
    setSourceDepot(prevDest);
    setDestDepot(prevSource);
    setLines((prev) =>
      prev.map((line) => {
        const avail = getAvailableStockInDepot(line.productId, prevDest, stockLevels, products);
        return {
          ...line,
          quantity: avail > 0 ? Math.min(Math.max(1, line.quantity), avail) : line.quantity,
        };
      })
    );
  };

  const addProductLine = (productId: string, requestedQty = 1, destRack = '') => {
    const prod = products.find((p) => String(p.id) === String(productId));
    if (!prod) return;
    markDraftMutated();
    const avail = getAvailableStockInDepot(prod.id, sourceDepot, stockLevels, products);

    setLines((prev) => {
      const existingIdx = prev.findIndex((l) => String(l.productId) === String(prod.id));
      if (existingIdx !== -1) {
        const next = [...prev];
        const currentQty = next[existingIdx].quantity;
        const targetQty = currentQty + Math.max(1, requestedQty);
        next[existingIdx] = {
          ...next[existingIdx],
          quantity: avail > 0 ? Math.min(targetQty, avail) : targetQty,
          destRack: destRack || next[existingIdx].destRack,
        };
        return next;
      }
      const initialQty = avail > 0 ? Math.min(Math.max(1, requestedQty), avail) : 1;
      return [
        ...prev,
        {
          productId: String(prod.id),
          quantity: initialQty,
          destRack,
        },
      ];
    });
  };

  const handleUpdateLineQty = (productId: string, rawQty: number) => {
    markDraftMutated();
    const avail = getAvailableStockInDepot(productId, sourceDepot, stockLevels, products);
    const cleanQty = Math.max(1, Math.floor(Number(rawQty) || 1));
    const cappedQty = avail > 0 ? Math.min(cleanQty, avail) : cleanQty;

    setLines((prev) =>
      prev.map((l) =>
        String(l.productId) === String(productId) ? { ...l, quantity: cappedQty } : l
      )
    );
  };

  const handleUpdateLineRack = (productId: string, destRack: string) => {
    markDraftMutated();
    setLines((prev) =>
      prev.map((l) =>
        String(l.productId) === String(productId) ? { ...l, destRack } : l
      )
    );
  };

  const handleRemoveLine = (productId: string) => {
    markDraftMutated();
    setLines((prev) => prev.filter((l) => String(l.productId) !== String(productId)));
  };

  // Ajout par scan code-barres / QR code
  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = scanCodeInput.trim();
    if (!code) return;
    const lower = code.toLowerCase();
    const matched = products.find(
      (p) =>
        (p.barcode && p.barcode.toLowerCase() === lower) ||
        (p.qr_code && p.qr_code.toLowerCase() === lower) ||
        (p.reference && p.reference.toLowerCase() === lower) ||
        (p.manufacturer_ref && p.manufacturer_ref.toLowerCase() === lower)
    );
    if (matched) {
      playScanBeep();
      addProductLine(matched.id, 1);
      setScanCodeInput('');
    } else {
      setFeedback({
        type: 'error',
        message: tr(
          language,
          `Aucun article trouvé pour le code « ${code} ».`,
          `No item found for code "${code}".`,
          `Geen artikel gevonden voor code "${code}".`
        ),
      });
    }
  };

  // Ajouter les articles depuis le panier en cours (batchCart ou orderCart)
  const totalCartItemsCount = (batchCart?.length || 0) + (orderCart?.length || 0);
  const handleImportFromCart = () => {
    if (totalCartItemsCount === 0) return;
    markDraftMutated();
    for (const bc of batchCart || []) {
      addProductLine(bc.product.id, bc.qtyActual || 1);
    }
    for (const oc of orderCart || []) {
      addProductLine(String(oc.product_id), oc.quantity || 1);
    }
  };

  // Recherche d'articles disponibles (filtrés par réf / désignation / marque / code-barres)
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const alreadyInLines = new Set(lines.map((l) => String(l.productId)));

    return products
      .filter((p) => {
        if (!q) {
          // Sans recherche texte, proposer les articles qui ont du stock dans le dépôt source
          const avail = getAvailableStockInDepot(p.id, sourceDepot, stockLevels, products);
          return avail > 0 && !alreadyInLines.has(String(p.id));
        }
        return (
          p.reference?.toLowerCase().includes(q) ||
          p.model?.toLowerCase().includes(q) ||
          p.brand?.toLowerCase().includes(q) ||
          p.barcode?.toLowerCase().includes(q) ||
          p.manufacturer_ref?.toLowerCase().includes(q)
        );
      })
      .slice(0, 20);
  }, [products, searchQuery, sourceDepot, stockLevels, lines]);

  // Totaux et validation des lignes
  const totalArticles = lines.length;
  const totalPieces = useMemo(
    () => lines.reduce((acc, l) => acc + Math.max(0, Number(l.quantity) || 0), 0),
    [lines]
  );

  const lineValidationError = useMemo(() => {
    if (!sourceDepot || !destDepot) {
      return tr(
        language,
        'Veuillez sélectionner un dépôt source et un dépôt de destination.',
        'Please select a source depot and a destination depot.',
        'Selecteer een brondepot en een doeldepot.'
      );
    }
    if (sourceDepot === destDepot) {
      return tr(
        language,
        'Le dépôt de destination doit être distinct du dépôt source.',
        'Destination depot must be different from source depot.',
        'Het doeldepot moet verschillen van het brondepot.'
      );
    }
    if (lines.length === 0) {
      return null;
    }
    for (const line of lines) {
      const prod = products.find((p) => String(p.id) === String(line.productId));
      const avail = getAvailableStockInDepot(line.productId, sourceDepot, stockLevels, products);
      if (!prod) continue;
      if (line.quantity <= 0) {
        return tr(
          language,
          `Quantité invalide pour ${prod.reference} (doit être > 0).`,
          `Invalid quantity for ${prod.reference} (must be > 0).`,
          `Ongeldig aantal voor ${prod.reference} (moet > 0 zijn).`
        );
      }
      if (line.quantity > avail) {
        return tr(
          language,
          `Stock insuffisant dans « ${sourceDepot} » pour « ${prod.reference} » (disponible : ${avail}, demandé : ${line.quantity}).`,
          `Insufficient stock in "${sourceDepot}" for "${prod.reference}" (available: ${avail}, requested: ${line.quantity}).`,
          `Onvoldoende voorraad in "${sourceDepot}" voor "${prod.reference}" (beschikbaar: ${avail}, gevraagd: ${line.quantity}).`
        );
      }
    }
    return null;
  }, [sourceDepot, destDepot, lines, products, stockLevels, language]);

  const summaryText = useMemo(() => {
    const artLabel =
      totalArticles > 1
        ? tr(language, 'articles', 'items', 'artikelen')
        : tr(language, 'article', 'item', 'artikel');
    const pcsLabel =
      totalPieces > 1
        ? tr(language, 'pièces', 'units', 'stuks')
        : tr(language, 'pièce', 'unit', 'stuk');
    return `${totalArticles} ${artLabel}, ${totalPieces} ${pcsLabel} : ${
      sourceDepot || '—'
    } → ${destDepot || '—'}`;
  }, [totalArticles, totalPieces, sourceDepot, destDepot, language]);

  if (!stockTransferModal.open || !canTransferBetweenDepots) {
    return null;
  }

  const handleClose = () => {
    if (submitting) return;
    setStockTransferModal({ open: false });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || lines.length === 0 || Boolean(lineValidationError)) return;

    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await transferStockBatchBetweenDepots({
        batchId,
        sourceDepotName: sourceDepot,
        destDepotName: destDepot,
        items: lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          destRack: l.destRack.trim() || undefined,
        })),
        reason: reason.trim() || undefined,
      });

      if (!res.success) {
        setFeedback({
          type: 'error',
          message: res.message,
        });
        return;
      }

      if (res.status === 'queued_offline') {
        setFeedback({
          type: 'offline',
          message: res.message,
          transferNumber: res.transferNumber,
          transferStatus: tr(language, 'En transit', 'In transit', 'Onderweg'),
          receiverNames: res.receiverNames,
        });
        setLines([]);
        setBatchId(generateOperationId());
        return;
      }

      setFeedback({
        type: 'success',
        message: res.message,
        transferNumber: res.transferNumber,
        transferStatus: tr(language, 'En transit', 'In transit', 'Onderweg'),
        receiverNames: res.receiverNames,
      });
      setLines([]);
      setBatchId(generateOperationId());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr(
        language,
        'Transférer vers un autre dépôt',
        'Transfer to another depot',
        'Overdragen naar een ander depot'
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/75 backdrop-blur-xs animate-fadeIn"
    >
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[94dvh] sm:max-h-[90vh] flex flex-col overflow-hidden text-slate-900 dark:text-slate-100">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-800/50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-sky-100 dark:bg-sky-950/70 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
              <ArrowLeftRight className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white truncate">
                {tr(
                  language,
                  'Transférer vers un autre dépôt',
                  'Transfer to another depot',
                  'Overdragen naar een ander depot'
                )}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {tr(
                  language,
                  'Transfert multi-articles atomique entre dépôts actifs autorisés',
                  'Atomic multi-item transfer between authorized active depots',
                  'Atomaire overdracht van meerdere artikelen tussen toegestane actieve depots'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={tr(language, 'Fermer', 'Close', 'Sluiten')}
            className="w-8 h-8 rounded-full bg-slate-200/70 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
          {/* Feedback Banner */}
          {feedback && (
            <div
              role="status"
              data-testid={`transfer-feedback-${feedback.type}`}
              className={`p-3 rounded-2xl border flex items-start gap-2.5 text-xs font-bold ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                  : feedback.type === 'offline'
                  ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
                  : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : feedback.type === 'offline' ? (
                <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 space-y-1">
                <div>{feedback.message}</div>
                {(feedback.transferNumber || feedback.transferStatus) && (
                  <div className="flex items-center gap-2 flex-wrap pt-0.5 text-[11px]">
                    {feedback.transferNumber && (
                      <span
                        data-testid="transfer-created-number"
                        className="px-2 py-0.5 rounded-lg bg-white/80 dark:bg-slate-900/80 border border-emerald-300 dark:border-emerald-700 font-mono font-black"
                      >
                        {feedback.transferNumber}
                      </span>
                    )}
                    {feedback.transferStatus && (
                      <span
                        data-testid="transfer-created-status"
                        className="px-2 py-0.5 rounded-lg bg-sky-100 dark:bg-sky-900/70 text-sky-900 dark:text-sky-200 border border-sky-300 dark:border-sky-700 font-black"
                      >
                        {feedback.transferStatus}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 1. Dépôt source & Dépôt destination + Inversion rapide ⇄ */}
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-end gap-2.5">
              <div>
                <label
                  htmlFor="transfer-source-depot"
                  className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1"
                >
                  {tr(language, 'Dépôt source', 'Source depot', 'Brondepot')}
                </label>
                <div className="relative">
                  <Building2 className="w-4 h-4 text-orange-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <SearchableSelect
                    id="transfer-source-depot"
                    data-testid="transfer-source-depot"
                    value={sourceDepot}
                    onChange={(val) => handleSourceDepotChange(val)}
                    recentKey="depots"
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold text-slate-900 dark:text-white"
                  >
                    {eligibleSourceDepots.map((d) => (
                      <option key={String(d.id)} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </SearchableSelect>
                </div>
              </div>

              <div className="flex justify-center">
                <button
                  type="button"
                  data-testid="swap-depots-btn"
                  onClick={handleSwapDepots}
                  title={tr(
                    language,
                    'Inverser dépôt source et destination (⇄)',
                    'Swap source and destination depots (⇄)',
                    'Bron- en doeldepot omwisselen (⇄)'
                  )}
                  className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-sky-50 dark:hover:bg-sky-950/50 text-sky-600 dark:text-sky-400 font-black text-sm transition cursor-pointer"
                >
                  ⇄
                </button>
              </div>

              <div>
                <label
                  htmlFor="transfer-dest-depot"
                  className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1"
                >
                  {tr(language, 'Dépôt destination', 'Destination depot', 'Doeldepot')}
                </label>
                <div className="relative">
                  <Building2 className="w-4 h-4 text-sky-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <SearchableSelect
                    id="transfer-dest-depot"
                    data-testid="transfer-dest-depot"
                    value={destDepot}
                    onChange={(val) => {
                      markDraftMutated();
                      setDestDepot(val);
                    }}
                    recentKey="depots"
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold text-slate-900 dark:text-white"
                  >
                    {destDepotOptions.map((opt) => (
                      <option key={String(opt.depot.id)} value={opt.depot.name}>
                        {opt.depot.name} ({opt.receiverLabel})
                      </option>
                    ))}
                  </SearchableSelect>
                </div>
                {destDepot && (
                  <p className="text-[10.5px] text-sky-700 dark:text-sky-300 font-semibold mt-1 truncate">
                    {tr(language, 'Validation réception par :', 'Reception validated by:', 'Ontvangst gevalideerd door:')}{' '}
                    <strong>
                      {destDepotOptions.find((o) => o.depot.name === destDepot)?.receiverLabel || '—'}
                    </strong>
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* 2. Barre d'ajout d'articles : recherche, scan code-barres, ajout depuis le panier */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-extrabold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Package className="w-4 h-4 text-sky-600" />
                <span>
                  {tr(
                    language,
                    'Articles à transférer',
                    'Items to transfer',
                    'Over te dragen artikelen'
                  )}
                </span>
              </span>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  data-testid="toggle-transfer-scan-btn"
                  onClick={() => {
                    setShowScannerInput((prev) => !prev);
                    setTimeout(() => scanInputRef.current?.focus(), 50);
                  }}
                  className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-sky-950/40 text-slate-700 dark:text-slate-200 font-bold text-[11px] flex items-center gap-1.5 cursor-pointer"
                >
                  <ScanLine className="w-3.5 h-3.5 text-sky-600" />
                  <span>{tr(language, 'Scanner code-barres', 'Scan barcode', 'Barcode scannen')}</span>
                </button>

                {totalCartItemsCount > 0 && (
                  <button
                    type="button"
                    data-testid="import-from-cart-btn"
                    onClick={handleImportFromCart}
                    className="px-2.5 py-1.5 rounded-xl border border-orange-200 dark:border-orange-800/70 bg-orange-50 dark:bg-orange-950/40 hover:bg-orange-100 text-orange-700 dark:text-orange-300 font-bold text-[11px] flex items-center gap-1.5 cursor-pointer"
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                    <span>
                      {tr(
                        language,
                        `Depuis le panier (${totalCartItemsCount})`,
                        `From cart (${totalCartItemsCount})`,
                        `Uit winkelwagen (${totalCartItemsCount})`
                      )}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Saisie / Douchette code-barres */}
            {showScannerInput && (
              <div className="p-2.5 rounded-xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 flex items-center gap-2">
                <ScanLine className="w-4 h-4 text-sky-600 shrink-0" />
                <input
                  ref={scanInputRef}
                  type="text"
                  data-testid="transfer-barcode-input"
                  value={scanCodeInput}
                  onChange={(e) => setScanCodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleBarcodeSubmit(e as any);
                    }
                  }}
                  placeholder={tr(
                    language,
                    'Scannez ou saisissez un code-barres / QR / réf puis Entrée...',
                    'Scan or enter a barcode / QR / ref then press Enter...',
                    'Scan of voer een barcode / QR / ref in en druk op Enter...'
                  )}
                  className="flex-1 px-2.5 py-1.5 rounded-lg border border-sky-300 dark:border-sky-700 bg-white dark:bg-slate-900 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={(e) => handleBarcodeSubmit(e as any)}
                  className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs cursor-pointer"
                >
                  {tr(language, 'Ajouter', 'Add', 'Toevoegen')}
                </button>
              </div>
            )}

            {/* Recherche par réf / désignation */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                data-testid="transfer-search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={tr(
                  language,
                  'Rechercher un article par référence, désignation, marque...',
                  'Search item by reference, designation, brand...',
                  'Zoek artikel op referentie, omschrijving, merk...'
                )}
                className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-900 dark:text-white"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Résultats de recherche rapides */}
            {searchResults.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                {searchResults.map((p) => {
                  const availInSrc = getAvailableStockInDepot(
                    p.id,
                    sourceDepot,
                    stockLevels,
                    products
                  );
                  return (
                    <div
                      key={p.id}
                      className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-900 dark:text-white">
                            {p.reference}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                              availInSrc > 0
                                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                                : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                            }`}
                          >
                            {tr(language, 'Dispo source :', 'Source avail:', 'Beschikbaar bron:')}{' '}
                            {availInSrc}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {p.brand} {p.model}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid={`add-transfer-item-${p.id}`}
                        disabled={availInSrc <= 0}
                        onClick={() => addProductLine(p.id, 1)}
                        className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{tr(language, 'Ajouter', 'Add', 'Toevoegen')}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Liste des lignes sélectionnées */}
          <div className="space-y-2">
            {lines.length === 0 ? (
              <div className="p-6 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-slate-400 dark:text-slate-500">
                {tr(
                  language,
                  'Aucun article sélectionné. Recherchez ou scannez un article ci-dessus.',
                  'No item selected. Search or scan an item above.',
                  'Geen artikel geselecteerd. Zoek of scan hierboven een artikel.'
                )}
              </div>
            ) : (
              lines.map((line) => {
                const prod = products.find((p) => String(p.id) === String(line.productId));
                if (!prod) return null;
                const availInSource = getAvailableStockInDepot(
                  prod.id,
                  sourceDepot,
                  stockLevels,
                  products
                );
                const isInsufficient = line.quantity > availInSource || availInSource <= 0;

                return (
                  <div
                    key={line.productId}
                    data-testid={`transfer-line-${line.productId}`}
                    className={`p-3 rounded-2xl border space-y-2 ${
                      isInsufficient
                        ? 'border-rose-300 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-950/20'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-black text-slate-900 dark:text-white">
                            {prod.reference}
                          </span>
                          <span
                            data-testid={`transfer-line-avail-${line.productId}`}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-mono ${
                              availInSource > 0
                                ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300'
                                : 'bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-300'
                            }`}
                          >
                            {tr(
                              language,
                              `Stock ${sourceDepot} : ${availInSource}`,
                              `Stock ${sourceDepot}: ${availInSource}`,
                              `Voorraad ${sourceDepot}: ${availInSource}`
                            )}
                          </span>
                        </div>
                        <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 truncate mt-0.5">
                          {prod.brand} {prod.model}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveLine(line.productId)}
                        aria-label={tr(language, 'Retirer', 'Remove', 'Verwijderen')}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                      {/* Quantité plafonnée au stock disponible dans le dépôt source */}
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                          {tr(language, 'Quantité :', 'Quantity:', 'Aantal:')}
                        </span>
                        <div className="inline-flex items-center rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                          <button
                            type="button"
                            onClick={() => handleUpdateLineQty(line.productId, line.quantity - 1)}
                            disabled={line.quantity <= 1}
                            className="p-1.5 text-slate-600 dark:text-slate-300 disabled:opacity-40 cursor-pointer"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <input
                            type="number"
                            data-testid={`transfer-line-qty-${line.productId}`}
                            min={1}
                            max={Math.max(1, availInSource)}
                            value={line.quantity}
                            onChange={(e) =>
                              handleUpdateLineQty(line.productId, Number(e.target.value))
                            }
                            className="w-16 text-center font-mono font-black bg-transparent py-1 text-slate-900 dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => handleUpdateLineQty(line.productId, line.quantity + 1)}
                            disabled={availInSource > 0 && line.quantity >= availInSource}
                            className="p-1.5 text-slate-600 dark:text-slate-300 disabled:opacity-40 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Emplacement destination optionnel (dest_rack) */}
                      <div className="relative">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          data-testid={`transfer-line-rack-${line.productId}`}
                          value={line.destRack}
                          onChange={(e) => handleUpdateLineRack(line.productId, e.target.value)}
                          placeholder={tr(
                            language,
                            'Emplacement destination (optionnel, ex: B2-04)',
                            'Destination rack (optional, e.g. B2-04)',
                            'Doellocatie (optioneel, bijv. B2-04)'
                          )}
                          className="w-full pl-8 pr-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-[11px]"
                        />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 3. Motif libre optionnel */}
          <div>
            <label
              htmlFor="transfer-reason-input"
              className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1"
            >
              {tr(
                language,
                'Motif du transfert (optionnel)',
                'Transfer reason (optional)',
                'Reden van overdracht (optioneel)'
              )}
            </label>
            <input
              id="transfer-reason-input"
              data-testid="transfer-reason-input"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={tr(
                language,
                'Ex : Réapprovisionnement camionnette, équilibrage stock...',
                'E.g. Van restock, stock balancing...',
                'Bijv. Bevoorrading bestelwagen, voorraadbalans...'
              )}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
          </div>

          {/* Récapitulatif avant validation */}
          <div
            data-testid="transfer-summary-banner"
            className="p-3.5 rounded-2xl bg-sky-50/90 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/80 flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2 font-black text-sky-900 dark:text-sky-200">
              <ArrowRight className="w-4 h-4 text-sky-600 shrink-0" />
              <span>{summaryText}</span>
            </div>
            <span className="font-mono text-[10px] text-sky-600 dark:text-sky-400">
              Lot #{batchId.slice(0, 8)}
            </span>
          </div>

          {lineValidationError && lines.length > 0 && (
            <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-bold text-[11px] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{lineValidationError}</span>
            </div>
          )}

          {/* Boutons d'action */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              {tr(language, 'Annuler', 'Cancel', 'Annuleren')}
            </button>
            <button
              type="submit"
              data-testid="submit-transfer-batch-btn"
              disabled={submitting || lines.length === 0 || Boolean(lineValidationError)}
              className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-extrabold flex items-center gap-2 shadow-md shadow-sky-600/20 cursor-pointer"
            >
              <ArrowLeftRight className="w-4 h-4" />
              <span>
                {submitting
                  ? tr(language, 'Transfert en cours...', 'Transferring...', 'Overdragen...')
                  : tr(
                      language,
                      'Valider le transfert',
                      'Confirm transfer',
                      'Overdracht bevestigen'
                    )}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
