import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { DesktopShell } from './DesktopShell';
import { DesktopMovementsPage } from './pages/DesktopMovementsPage';
import { DesktopOrdersPage } from './pages/DesktopOrdersPage';
import { DesktopPreparationPage } from './pages/DesktopPreparationPage';
import { DesktopPrintStationPage } from './pages/DesktopPrintStationPage';
import { DesktopSettingsPage } from './pages/DesktopSettingsPage';
import { DesktopCsvImportModal } from './components/DesktopCsvImportModal';
import { DesktopPrintLabelsDialog } from './components/DesktopPrintLabelsDialog';
import { DESKTOP_LAST_PAGE_KEY } from './types';
import {
  getDesktopSystemSettings,
  isDesktopApp,
  triggerDesktopSystemNotification,
} from '../services/desktopBridge';

export const DesktopWorkspace: React.FC = () => {
  const {
    products,
    orders,
    activeProductId,
    printLabelsModal,
    setPrintLabelsModal,
    syncFromSupabase,
  } = useApp();

  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [newMovDrawerRequest, setNewMovDrawerRequest] = useState(false);
  const [newOrderRequestCount, setNewOrderRequestCount] = useState(0);
  const [labelDialogProductIds, setLabelDialogProductIds] = useState<string[]>([]);

  // Synchronize printLabelsModal trigger from inventory / product panel into DesktopPrintLabelsDialog
  useEffect(() => {
    if (printLabelsModal.open) {
      if (printLabelsModal.initialProductId) {
        setLabelDialogProductIds([printLabelsModal.initialProductId]);
      } else if (activeProductId) {
        setLabelDialogProductIds([activeProductId]);
      } else if (products.length > 0) {
        setLabelDialogProductIds(products.slice(0, 12).map((p) => p.id));
      }
      setPrintLabelsModal({ open: false, initialProductId: null });
    }
  }, [printLabelsModal, activeProductId, products, setPrintLabelsModal]);

  // Multi-window BroadcastChannel synchronization (Lot 4.5)
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('tot-stock-desktop-sync');
    channel.onmessage = (ev) => {
      if (ev.data?.type === 'DATA_MUTATED') {
        syncFromSupabase().catch(() => {});
      }
    };
    return () => {
      channel.close();
    };
  }, [syncFromSupabase]);

  // Native system notifications on new orders waiting approval / pending prep (Lot 4.3)
  useEffect(() => {
    if (!isDesktopApp() || orders.length === 0) return;
    getDesktopSystemSettings().then((sys) => {
      if (!sys.notificationsEnabled) return;
      const waitingApproval = orders.find((o) => o.status === 'WAITING_APPROVAL');
      if (waitingApproval && sys.notifyOrdersWaitingApproval) {
        triggerDesktopSystemNotification({
          title: 'Commande à approuver',
          body: `${waitingApproval.order_number} (${waitingApproval.requester_name})`,
          route: 'orders',
          dedupeKey: `order_approval_${waitingApproval.id}`,
        });
      }
    });
  }, [orders]);

  const productsToPrint = React.useMemo(() => {
    if (labelDialogProductIds.length === 0) return [];
    const setIds = new Set(labelDialogProductIds);
    return products.filter((p) => setIds.has(p.id));
  }, [labelDialogProductIds, products]);

  return (
    <>
      <DesktopShell
        onOpenCsvImportModal={() => setCsvImportOpen(true)}
        onOpenQuickMovementDrawer={() => {
          try {
            localStorage.setItem(DESKTOP_LAST_PAGE_KEY, 'movements');
          } catch {
            // Ignore
          }
          setNewMovDrawerRequest(true);
        }}
        onOpenDesktopLabelModal={() => {
          if (activeProductId) {
            setLabelDialogProductIds([activeProductId]);
          } else if (products.length > 0) {
            setLabelDialogProductIds(products.slice(0, 12).map((p) => p.id));
          }
        }}
        renderMovementsPage={({ globalDepotFilter }) => (
          <DesktopMovementsPage
            selectedDepotFilter={globalDepotFilter}
            openNewMovementRequested={newMovDrawerRequest}
            onConsumeNewMovementRequest={() => setNewMovDrawerRequest(false)}
          />
        )}
        renderOrdersPage={({ selectedOrderId, onSelectOrder, externalNewOrderTrigger }) => (
          <DesktopOrdersPage
            selectedDepotFilter="ALL"
            selectedOrderId={selectedOrderId}
            onSelectOrder={onSelectOrder}
            openNewOrderRequested={externalNewOrderTrigger > newOrderRequestCount}
            onConsumeNewOrderRequest={() => setNewOrderRequestCount(externalNewOrderTrigger)}
            onOpenPreparationForOrder={(ordId) => {
              onSelectOrder(ordId);
              window.dispatchEvent(
                new CustomEvent('tot-desktop-menu-command', {
                  detail: { command: 'nav-preparation' },
                })
              );
            }}
          />
        )}
        renderPreparationPage={({ selectedOrderId }) => (
          <DesktopPreparationPage
            selectedDepotFilter="ALL"
            initialOrderId={selectedOrderId}
          />
        )}
        renderPrintStationPage={() => <DesktopPrintStationPage />}
        renderSettingsPage={({ section, onChangeSection }) => (
          <DesktopSettingsPage
            initialSection={section}
            onChangeSection={onChangeSection}
            onNavigatePrintStation={() => {
              window.dispatchEvent(
                new CustomEvent('tot-desktop-menu-command', {
                  detail: { command: 'nav-print-station' },
                })
              );
            }}
          />
        )}
      />

      <DesktopCsvImportModal
        isOpen={csvImportOpen}
        onClose={() => setCsvImportOpen(false)}
      />

      {productsToPrint.length > 0 && (
        <DesktopPrintLabelsDialog
          productsToPrint={productsToPrint}
          onClose={() => setLabelDialogProductIds([])}
        />
      )}
    </>
  );
};
