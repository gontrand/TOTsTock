import React, { useState } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import {
  buildNotificationKey,
  getNotificationCardDescriptor,
  getTargetedOrderNotificationsForUser,
  getTargetedTransferNotificationsForUser,
  isUserRecipientForStockAlert,
  shouldAutoDismissOnCardClick,
  shouldShowNotificationBanner,
  TargetedOrderNotificationItem,
} from '../services/notificationService';
import { getClosedProjectContainerAlertsForUser } from '../services/projectStatusService';
import {
  X,
  Bell,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  ChevronRight,
  PackageCheck,
  Clock,
  Package,
  UserCheck,
  XCircle,
  Truck,
  CheckCheck,
  RotateCcw,
} from 'lucide-react';

export const NotificationsModal: React.FC = () => {
  const {
    notificationsModalOpen,
    setNotificationsModalOpen,
    products,
    setActiveProductId,
    orders,
    transfers,
    users,
    departments,
    projects,
    depots,
    depotHolders,
    roles,
    userHasPermission,
    setOrderCartModalOpen,
    setPreparerOrdersModalOpen,
    setTransfersModalOpen,
    setDepotsModalOpen,
    currentUser,
    dismissedNotificationKeys,
    dismissNotificationKeys,
    resetMyNotificationDismissals,
    language,
    t,
  } = useApp();

  const [confirmingResetBell, setConfirmingResetBell] = useState(false);

  // Keyboard shortcut: close on Escape
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && notificationsModalOpen) {
        setNotificationsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [notificationsModalOpen, setNotificationsModalOpen]);

  if (!notificationsModalOpen) return null;

  const canSeeStockAlerts = shouldShowNotificationBanner('STOCK_LOW_ALERT', currentUser?.id);
  const outOfStock = canSeeStockAlerts
    ? products.filter(
        (p) =>
          (p.quantity || 0) === 0 &&
          isUserRecipientForStockAlert({
            product: p,
            user: currentUser,
            departments,
            depots,
            depotHolders,
            roles,
            dismissedKeys: dismissedNotificationKeys,
            alertStatus: 'OUT',
          })
      )
    : [];
  const lowStock = canSeeStockAlerts
    ? products.filter(
        (p) =>
          (p.quantity || 0) > 0 &&
          (p.quantity || 0) <= (p.min_stock_alert || 2) &&
          isUserRecipientForStockAlert({
            product: p,
            user: currentUser,
            departments,
            depots,
            depotHolders,
            roles,
            dismissedKeys: dismissedNotificationKeys,
            alertStatus: 'LOW',
          })
      )
    : [];

  const targetedOrders = getTargetedOrderNotificationsForUser({
    orders,
    user: currentUser,
    users,
    departments,
    projects,
    depots,
    depotHolders,
    roles,
    dismissedKeys: dismissedNotificationKeys,
  });

  const targetedTransfers = getTargetedTransferNotificationsForUser({
    user: currentUser,
    transfers,
    depotHolders,
    depots,
    roles,
    hasReceiveAllPerm: userHasPermission('perm_stock_receive_all'),
    dismissedKeys: dismissedNotificationKeys,
  });

  const closedProjectAlerts = getClosedProjectContainerAlertsForUser(
    currentUser,
    projects,
    depots,
    departments,
    dismissedNotificationKeys
  );

  const allVisibleNotifKeys: string[] = [
    ...targetedOrders.map((item) => item.notifKey),
    ...targetedTransfers.map((trItem) => trItem.notifKey),
    ...closedProjectAlerts.map((a) => a.notifKey),
    ...outOfStock.map((p) => buildNotificationKey('STOCK_LOW_ALERT', p.id, 'OUT')),
    ...lowStock.map((p) => buildNotificationKey('STOCK_LOW_ALERT', p.id, 'LOW')),
  ];

  const totalAlerts = allVisibleNotifKeys.length;

  const handleOrderCardClick = (item: TargetedOrderNotificationItem) => {
    const { order, notificationType, notifKey } = item;
    if (
      shouldAutoDismissOnCardClick(notificationType) ||
      shouldAutoDismissOnCardClick(order.status)
    ) {
      dismissNotificationKeys([notifKey]).catch(() => {});
    }
    setNotificationsModalOpen(false);
    if (
      notificationType === 'ORDER_WAITING_APPROVAL' ||
      notificationType === 'ORDER_PENDING_PREP' ||
      notificationType === 'ORDER_ASSIGNED'
    ) {
      setPreparerOrdersModalOpen(true);
    } else {
      setOrderCartModalOpen(true);
    }
  };

  const renderOrderIcon = (iconName: string) => {
    switch (iconName) {
      case 'XCircle':
        return <XCircle className="w-4 h-4" />;
      case 'Clock':
        return <Clock className="w-4 h-4" />;
      case 'Package':
        return <Package className="w-4 h-4" />;
      case 'UserCheck':
        return <UserCheck className="w-4 h-4" />;
      default:
        return <PackageCheck className="w-4 h-4" />;
    }
  };

  const getOrderCardClasses = (colorScheme: string) => {
    switch (colorScheme) {
      case 'rose':
        return {
          container:
            'bg-rose-50/80 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800/70 hover:border-rose-500',
          badge: 'bg-rose-600 text-white',
          title: 'text-rose-900 dark:text-rose-100',
          number: 'text-rose-700 dark:text-rose-300',
        };
      case 'amber':
        return {
          container:
            'bg-amber-50/80 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800/70 hover:border-amber-500',
          badge: 'bg-amber-500 text-white',
          title: 'text-amber-900 dark:text-amber-100',
          number: 'text-amber-700 dark:text-amber-300',
        };
      case 'blue':
        return {
          container:
            'bg-blue-50/80 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800/70 hover:border-blue-500',
          badge: 'bg-blue-600 text-white',
          title: 'text-blue-900 dark:text-blue-100',
          number: 'text-blue-700 dark:text-blue-300',
        };
      case 'purple':
        return {
          container:
            'bg-purple-50/80 dark:bg-purple-950/40 border-purple-300 dark:border-purple-800/70 hover:border-purple-500',
          badge: 'bg-purple-600 text-white',
          title: 'text-purple-900 dark:text-purple-100',
          number: 'text-purple-700 dark:text-purple-300',
        };
      default:
        return {
          container:
            'bg-emerald-500/15 dark:bg-emerald-950/50 border-emerald-500/40 hover:border-emerald-500',
          badge: 'bg-emerald-500 text-white',
          title: 'text-emerald-900 dark:text-emerald-100',
          number: 'text-emerald-700 dark:text-emerald-300',
        };
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setNotificationsModalOpen(false);
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-3 bg-slate-950/75 backdrop-blur-sm animate-fadeIn"
    >
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-5 text-slate-800 dark:text-slate-100 max-h-[88dvh] sm:max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 flex items-center justify-center font-bold shrink-0">
              <Bell className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-black text-slate-900 dark:text-white truncate">
                {t('notif_title')}
              </h2>
              <p
                aria-live="polite"
                data-testid="notifications-active-count"
                className="text-[11px] text-slate-400"
              >
                {totalAlerts} {t('notif_active_alerts')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              data-testid="mark-all-notifications-read-btn"
              disabled={totalAlerts === 0}
              onClick={(e) => {
                e.stopPropagation();
                if (allVisibleNotifKeys.length > 0) {
                  dismissNotificationKeys(allVisibleNotifKeys).catch(() => {});
                }
              }}
              className="min-h-[36px] px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none text-[11px] font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1 transition cursor-pointer"
              title={tr(
                language,
                'Tout marquer comme lu',
                'Mark all as read',
                'Alles markeren als gelezen'
              )}
            >
              <CheckCheck className="w-3.5 h-3.5 text-orange-500 shrink-0" />
              <span>
                {tr(
                  language,
                  'Tout marquer comme lu',
                  'Mark all as read',
                  'Alles als gelezen'
                )}
              </span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setNotificationsModalOpen(false);
              }}
              className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer active:scale-95 shadow-xs shrink-0"
              title={t('common_close')}
              aria-label="Fermer"
            >
              <X className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto py-3 space-y-2 pr-1 text-xs">
          {totalAlerts === 0 ? (
            <div className="py-10 text-center text-slate-400">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-emerald-500 opacity-80" />
              <p className="font-bold text-slate-700 dark:text-slate-300">{t('notif_all_good')}</p>
              <p className="text-[11px]">{t('notif_all_good_desc')}</p>
            </div>
          ) : (
            <>
              {targetedOrders.map((item) => {
                const { order, notificationType, notifKey } = item;
                const descriptor = getNotificationCardDescriptor(
                  item,
                  (language as 'fr' | 'en' | 'nl') || 'fr'
                );
                const styles = getOrderCardClasses(descriptor.colorScheme);
                const isCancelledOrRejected =
                  notificationType === 'ORDER_MODIFIED_OR_CANCELLED' ||
                  order.status === 'CANCELLED' ||
                  order.status === 'REJECTED';

                return (
                  <div
                    key={notifKey}
                    data-testid={
                      isCancelledOrRejected
                        ? `notif-card-cancelled-${order.id}`
                        : `notif-card-order-${order.id}`
                    }
                    onClick={() => handleOrderCardClick(item)}
                    className={`p-3 rounded-2xl border transition cursor-pointer flex items-center justify-between gap-2 shadow-xs ${styles.container}`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 shadow-xs ${styles.badge}`}
                      >
                        {renderOrderIcon(descriptor.iconName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={`font-extrabold leading-tight ${styles.title}`}>
                          {descriptor.title}
                        </div>
                        <div className={`text-[11px] font-mono font-bold mt-0.5 ${styles.number}`}>
                          {order.order_number} ({order.items?.length || 0}{' '}
                          {tr(language, 'articles', 'items', 'artikelen')})
                        </div>
                        {isCancelledOrRejected && (descriptor.reason || descriptor.author) && (
                          <div className="text-[11px] text-rose-700 dark:text-rose-300 mt-1 space-y-0.5">
                            {descriptor.reason && (
                              <div>
                                <span className="font-bold">
                                  {tr(language, 'Motif :', 'Reason:', 'Reden:')}
                                </span>{' '}
                                {descriptor.reason}
                              </div>
                            )}
                            {descriptor.author && (
                              <div>
                                <span className="font-bold">
                                  {tr(language, 'Par :', 'By:', 'Door:')}
                                </span>{' '}
                                {descriptor.author}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {order.site_number ? `Chantier ${order.site_number} • ` : ''}
                          {descriptor.actionLabel}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        data-testid={`dismiss-notif-${notifKey}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          dismissNotificationKeys([notifKey]).catch(() => {});
                        }}
                        className="min-w-[44px] min-h-[44px] rounded-xl hover:bg-slate-900/10 dark:hover:bg-white/10 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition"
                        title={tr(
                          language,
                          'Marquer comme lue',
                          'Mark as read',
                          'Markeren als gelezen'
                        )}
                        aria-label={tr(
                          language,
                          'Marquer comme lue',
                          'Mark as read',
                          'Markeren als gelezen'
                        )}
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </div>
                  </div>
                );
              })}

              {targetedTransfers.map((trItem) => {
                const {
                  transfer,
                  notifKey,
                  isOverdue7Days,
                  isWarning5Days,
                  ageDays,
                  eventType,
                } = trItem;
                return (
                  <div
                    key={notifKey}
                    data-testid={
                      isOverdue7Days
                        ? `notif-card-transfer-overdue-${transfer.id}`
                        : `notif-card-transfer-${transfer.id}`
                    }
                    onClick={() => {
                      if (shouldAutoDismissOnCardClick(eventType)) {
                        dismissNotificationKeys([notifKey]).catch(() => {});
                      }
                      setNotificationsModalOpen(false);
                      setTransfersModalOpen(true);
                    }}
                    className={`p-3 rounded-2xl border transition cursor-pointer flex items-center justify-between gap-2 ${
                      isOverdue7Days
                        ? 'bg-rose-50/85 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800/70 hover:border-rose-500'
                        : isWarning5Days
                        ? 'bg-amber-50/85 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800/70 hover:border-amber-500'
                        : 'bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800/60 hover:border-indigo-400'
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <div
                        className={`w-7 h-7 rounded-lg text-white flex items-center justify-center shrink-0 mt-0.5 ${
                          isOverdue7Days
                            ? 'bg-rose-600'
                            : isWarning5Days
                            ? 'bg-amber-500'
                            : 'bg-indigo-600'
                        }`}
                      >
                        <Truck className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div
                          className={`font-extrabold leading-tight ${
                            isOverdue7Days
                              ? 'text-rose-950 dark:text-rose-100'
                              : isWarning5Days
                              ? 'text-amber-950 dark:text-amber-100'
                              : 'text-indigo-950 dark:text-indigo-100'
                          }`}
                        >
                          {isOverdue7Days
                            ? tr(
                                language,
                                `Transfert non validé depuis ${Math.floor(ageDays || 7)}j — remise en stock requise`,
                                `Transfer unvalidated for ${Math.floor(ageDays || 7)}d — return to stock required`,
                                `Overdracht ${Math.floor(ageDays || 7)}d niet gevalideerd — terugboeking vereist`
                              )
                            : isWarning5Days
                            ? tr(
                                language,
                                `Rappel : transfert en attente depuis ${Math.floor(ageDays || 5)} jours`,
                                `Reminder: transfer pending for ${Math.floor(ageDays || 5)} days`,
                                `Herinnering: overdracht ${Math.floor(ageDays || 5)} dagen in afwachting`
                              )
                            : tr(
                                language,
                                'Transfert inter-dépôts',
                                'Inter-depot transfer',
                                'Overdracht tussen depots'
                              )}
                        </div>
                        <div
                          className={`text-[11px] font-mono font-bold mt-0.5 ${
                            isOverdue7Days
                              ? 'text-rose-700 dark:text-rose-300'
                              : isWarning5Days
                              ? 'text-amber-700 dark:text-amber-300'
                              : 'text-indigo-700 dark:text-indigo-300'
                          }`}
                        >
                          {(transfer as any).transfer_number || `#${transfer.id}`}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400">
                          {(transfer as any).from_depot_name || transfer.source_depot || ''} →{' '}
                          {(transfer as any).to_depot_name || transfer.dest_depot || ''}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        data-testid={`dismiss-notif-${notifKey}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          dismissNotificationKeys([notifKey]).catch(() => {});
                        }}
                        className="min-w-[44px] min-h-[44px] rounded-xl hover:bg-slate-900/10 dark:hover:bg-white/10 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition"
                        title={tr(
                          language,
                          'Marquer comme lue',
                          'Mark as read',
                          'Markeren als gelezen'
                        )}
                        aria-label={tr(
                          language,
                          'Marquer comme lue',
                          'Mark as read',
                          'Markeren als gelezen'
                        )}
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </div>
                  </div>
                );
              })}

              {closedProjectAlerts.map((alertItem) => (
                <div
                  key={alertItem.notifKey}
                  data-testid={`notif-card-project-closed-${alertItem.project.project_number}`}
                  onClick={() => {
                    dismissNotificationKeys([alertItem.notifKey]).catch(() => {});
                    setNotificationsModalOpen(false);
                    setDepotsModalOpen(true);
                  }}
                  className="p-3 rounded-2xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/70 hover:border-amber-500 transition cursor-pointer flex items-center justify-between gap-2"
                >
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <div className="w-7 h-7 rounded-lg bg-amber-500 text-white flex items-center justify-center shrink-0 mt-0.5">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-extrabold text-amber-950 dark:text-amber-100 leading-tight">
                        {alertItem.message}
                      </div>
                      <div className="text-[11px] font-mono font-bold text-amber-700 dark:text-amber-300 mt-0.5">
                        [{alertItem.project.project_number}] {alertItem.project.project_name}
                      </div>
                      <div className="text-[10px] text-slate-600 dark:text-slate-400">
                        Rattaché(s) : {alertItem.attachedDepots.map((d) => d.name).join(', ')}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      data-testid={`dismiss-notif-${alertItem.notifKey}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        dismissNotificationKeys([alertItem.notifKey]).catch(() => {});
                      }}
                      className="min-w-[44px] min-h-[44px] rounded-xl hover:bg-slate-900/10 dark:hover:bg-white/10 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition"
                      title={tr(
                        language,
                        'Marquer comme lue',
                        'Mark as read',
                        'Markeren als gelezen'
                      )}
                      aria-label={tr(
                        language,
                        'Marquer comme lue',
                        'Mark as read',
                        'Markeren als gelezen'
                      )}
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </div>
                </div>
              ))}

              {outOfStock.map((p) => {
                const stockKey = buildNotificationKey('STOCK_LOW_ALERT', p.id, 'OUT');
                return (
                  <div
                    key={stockKey}
                    data-testid={`notif-card-stock-out-${p.id}`}
                    onClick={() => {
                      dismissNotificationKeys([stockKey]).catch(() => {});
                      setNotificationsModalOpen(false);
                      setActiveProductId(p.id);
                    }}
                    className="p-3 rounded-2xl bg-rose-50/50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 hover:border-rose-400 transition cursor-pointer flex items-center justify-between gap-2"
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <div className="w-7 h-7 rounded-lg bg-rose-100 dark:bg-rose-900/50 text-rose-600 flex items-center justify-center shrink-0 mt-0.5">
                        <AlertOctagon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-extrabold text-slate-900 dark:text-white leading-tight">
                          {p.brand} {p.model}
                        </div>
                        <div className="text-[11px] text-rose-600 font-bold mt-0.5">
                          {t('notif_out_badge')}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {p.store_name} &gt; {p.shelf_name}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        data-testid={`dismiss-notif-${stockKey}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          dismissNotificationKeys([stockKey]).catch(() => {});
                        }}
                        className="min-w-[44px] min-h-[44px] rounded-xl hover:bg-slate-900/10 dark:hover:bg-white/10 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition"
                        title={tr(
                          language,
                          'Marquer comme lue',
                          'Mark as read',
                          'Markeren als gelezen'
                        )}
                        aria-label={tr(
                          language,
                          'Marquer comme lue',
                          'Mark as read',
                          'Markeren als gelezen'
                        )}
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </div>
                  </div>
                );
              })}

              {lowStock.map((p) => {
                const stockKey = buildNotificationKey('STOCK_LOW_ALERT', p.id, 'LOW');
                return (
                  <div
                    key={stockKey}
                    data-testid={`notif-card-stock-low-${p.id}`}
                    onClick={() => {
                      dismissNotificationKeys([stockKey]).catch(() => {});
                      setNotificationsModalOpen(false);
                      setActiveProductId(p.id);
                    }}
                    className="p-3 rounded-2xl bg-amber-50/50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 hover:border-amber-400 transition cursor-pointer flex items-center justify-between gap-2"
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/50 text-amber-600 flex items-center justify-center shrink-0 mt-0.5">
                        <AlertTriangle className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-extrabold text-slate-900 dark:text-white leading-tight">
                          {p.brand} {p.model}
                        </div>
                        <div className="text-[11px] text-amber-600 font-bold mt-0.5">
                          {t('notif_low_badge')} : {p.quantity} ({t('product_alert_threshold')}:{' '}
                          {p.min_stock_alert})
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {p.store_name} &gt; {p.shelf_name}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        data-testid={`dismiss-notif-${stockKey}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          dismissNotificationKeys([stockKey]).catch(() => {});
                        }}
                        className="min-w-[44px] min-h-[44px] rounded-xl hover:bg-slate-900/10 dark:hover:bg-white/10 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition"
                        title={tr(
                          language,
                          'Marquer comme lue',
                          'Mark as read',
                          'Markeren als gelezen'
                        )}
                        aria-label={tr(
                          language,
                          'Marquer comme lue',
                          'Mark as read',
                          'Markeren als gelezen'
                        )}
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
          {!confirmingResetBell ? (
            <div className="flex items-center justify-center">
              <button
                type="button"
                data-testid="reset-my-bell-btn"
                onClick={() => setConfirmingResetBell(true)}
                className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center gap-1 py-1 px-2 rounded-lg transition cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>
                  {tr(
                    language,
                    'Réinitialiser ma cloche',
                    'Reset my bell',
                    'Mijn meldingen herstellen'
                  )}
                </span>
              </button>
            </div>
          ) : (
            <div
              data-testid="reset-my-bell-confirm-box"
              className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 text-[11px]"
            >
              <span className="text-slate-600 dark:text-slate-300">
                {tr(
                  language,
                  "Cela n'affecte que votre cloche",
                  'This only affects your bell',
                  'Dit heeft alleen invloed op uw eigen bel'
                )}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setConfirmingResetBell(false)}
                  className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-bold"
                >
                  {t('common_cancel')}
                </button>
                <button
                  type="button"
                  data-testid="confirm-reset-my-bell-btn"
                  onClick={() => {
                    resetMyNotificationDismissals().catch(() => {});
                    setConfirmingResetBell(false);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-bold"
                >
                  {tr(language, 'Confirmer', 'Confirm', 'Bevestigen')}
                </button>
              </div>
            </div>
          )}

          <button
            onClick={() => setNotificationsModalOpen(false)}
            className="w-full py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            {t('common_close')}
          </button>
        </div>
      </div>
    </div>
  );
};
