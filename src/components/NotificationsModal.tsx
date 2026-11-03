import React from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import { X, Bell, AlertTriangle, AlertOctagon, CheckCircle2, ChevronRight, PackageCheck } from 'lucide-react';

export const NotificationsModal: React.FC = () => {
  const {
    notificationsModalOpen,
    setNotificationsModalOpen,
    products,
    setActiveProductId,
    orders,
    setOrderCartModalOpen,
    currentUser,
    language,
    t,
  } = useApp();

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

  const outOfStock = products.filter((p) => (p.quantity || 0) === 0);
  const lowStock = products.filter(
    (p) => (p.quantity || 0) > 0 && (p.quantity || 0) <= (p.min_stock_alert || 2)
  );

  const myReadyOrders = orders.filter(
    (o) =>
      (String(o.requester_id) === String(currentUser?.id) ||
        (o.requester_name && o.requester_name.toLowerCase() === currentUser?.name?.toLowerCase())) &&
      o.status === 'READY'
  );

  const totalAlerts = outOfStock.length + lowStock.length + myReadyOrders.length;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setNotificationsModalOpen(false);
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-3 bg-slate-950/75 backdrop-blur-sm animate-fadeIn"
    >
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-5 text-slate-800 dark:text-slate-100 max-h-[88dvh] sm:max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 flex items-center justify-center font-bold">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                {t('notif_title')}
              </h2>
              <p className="text-[11px] text-slate-400">
                {totalAlerts} {t('notif_active_alerts')}
              </p>
            </div>
          </div>

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
              {myReadyOrders.map((ro) => (
                <div
                  key={ro.id}
                  onClick={() => {
                    setNotificationsModalOpen(false);
                    setOrderCartModalOpen(true);
                  }}
                  className="p-3 rounded-2xl bg-emerald-500/15 dark:bg-emerald-950/50 border border-emerald-500/40 hover:border-emerald-500 transition cursor-pointer flex items-center justify-between shadow-xs animate-pulse"
                >
                  <div className="flex items-start gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                      <PackageCheck className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-extrabold text-emerald-900 dark:text-emerald-100 leading-tight">
                        {tr(language, '🎉 Commande prête au magasin !', '🎉 Order ready for pickup!')}
                      </div>
                      <div className="text-[11px] font-mono font-bold text-emerald-700 dark:text-emerald-300 mt-0.5">
                        {ro.order_number} ({ro.items.length} articles)
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">
                        Chantier {ro.site_number} • Cliquez pour confirmer le retrait
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-emerald-600" />
                </div>
              ))}

              {outOfStock.map((p) => (
                <div
                  key={p.id}
                  onClick={() => {
                    setNotificationsModalOpen(false);
                    setActiveProductId(p.id);
                  }}
                  className="p-3 rounded-2xl bg-rose-50/50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 hover:border-rose-400 transition cursor-pointer flex items-center justify-between"
                >
                  <div className="flex items-start gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-rose-100 dark:bg-rose-900/50 text-rose-600 flex items-center justify-center shrink-0 mt-0.5">
                      <AlertOctagon className="w-4 h-4" />
                    </div>
                    <div>
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
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              ))}

              {lowStock.map((p) => (
                <div
                  key={p.id}
                  onClick={() => {
                    setNotificationsModalOpen(false);
                    setActiveProductId(p.id);
                  }}
                  className="p-3 rounded-2xl bg-amber-50/50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 hover:border-amber-400 transition cursor-pointer flex items-center justify-between"
                >
                  <div className="flex items-start gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/50 text-amber-600 flex items-center justify-center shrink-0 mt-0.5">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-extrabold text-slate-900 dark:text-white leading-tight">
                        {p.brand} {p.model}
                      </div>
                      <div className="text-[11px] text-amber-600 font-bold mt-0.5">
                        {t('notif_low_badge')} : {p.quantity} ({t('product_alert_threshold')}: {p.min_stock_alert})
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {p.store_name} &gt; {p.shelf_name}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              ))}
            </>
          )}
        </div>

        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
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
