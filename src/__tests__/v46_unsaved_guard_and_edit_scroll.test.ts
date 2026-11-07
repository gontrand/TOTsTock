import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  cancelPendingNavigation,
  confirmDiscardAndProceed,
  confirmSaveAndProceed,
  getPendingNavigationState,
  hasActiveDirtyForm,
  registerUnsavedForm,
  requestGuardedNavigation,
  resetAllUnsavedFormsForTest,
  scrollToAndFocusForm,
} from '../services/unsavedChangesGuard';

describe('v46 — Unsaved form modification guard & direct scroll/focus on Edit', () => {
  beforeEach(() => {
    resetAllUnsavedFormsForTest();
  });

  it('executes navigation immediately when no form is dirty', () => {
    const proceed = vi.fn();
    requestGuardedNavigation(proceed);
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(getPendingNavigationState().open).toBe(false);
  });

  it('intercepts menu navigation when a form is in edit/dirty state and allows Save & Continue', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onDiscard = vi.fn();
    const proceed = vi.fn();

    registerUnsavedForm({
      id: 'desktop-settings-form',
      isDirty: true,
      label: 'Modifier l’utilisateur (Jean Dupont)',
      onSave,
      onDiscard,
    });

    expect(hasActiveDirtyForm()).toBe(true);

    requestGuardedNavigation(proceed);
    expect(proceed).not.toHaveBeenCalled();

    const pending = getPendingNavigationState();
    expect(pending.open).toBe(true);
    expect(pending.entry?.label).toBe('Modifier l’utilisateur (Jean Dupont)');

    await confirmSaveAndProceed();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(getPendingNavigationState().open).toBe(false);
  });

  it('aborts navigation if Save fails validation (onSave returns false)', async () => {
    const onSave = vi.fn().mockResolvedValue(false);
    const onDiscard = vi.fn();
    const proceed = vi.fn();

    registerUnsavedForm({
      id: 'desktop-product-inline',
      isDirty: true,
      label: 'Fiche produit (REF-001)',
      onSave,
      onDiscard,
    });

    requestGuardedNavigation(proceed);
    expect(getPendingNavigationState().open).toBe(true);

    await confirmSaveAndProceed();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(proceed).not.toHaveBeenCalled();
    expect(getPendingNavigationState().open).toBe(false);
  });

  it('discards modifications and proceeds when user chooses Annuler la modification', () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    const proceed = vi.fn();

    registerUnsavedForm({
      id: 'mobile-depots-modal',
      isDirty: true,
      label: 'Modification du dépôt (Dépôt Principal)',
      onSave,
      onDiscard,
    });

    requestGuardedNavigation(proceed);
    expect(getPendingNavigationState().open).toBe(true);

    confirmDiscardAndProceed();
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(getPendingNavigationState().open).toBe(false);
  });

  it('cancels pending navigation and stays on the form when user chooses Rester sur le formulaire', () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    const proceed = vi.fn();

    registerUnsavedForm({
      id: 'mobile-users-roles-modal',
      isDirty: true,
      label: 'Modification du rôle (Chef de chantier)',
      onSave,
      onDiscard,
    });

    requestGuardedNavigation(proceed);
    expect(getPendingNavigationState().open).toBe(true);

    cancelPendingNavigation();
    expect(onSave).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
    expect(proceed).not.toHaveBeenCalled();
    expect(getPendingNavigationState().open).toBe(false);
  });

  it('scrollToAndFocusForm scrolls the form into view and focuses the primary input', () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    const select = vi.fn();

    const fakeForm = { scrollIntoView } as unknown as HTMLElement;
    const fakeInput = { focus, select } as unknown as HTMLInputElement;

    scrollToAndFocusForm(fakeForm, fakeInput);
    vi.advanceTimersByTime(60);

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('wires unsavedChangesGuard and scrollToAndFocusForm across Desktop and Mobile menus and forms', () => {
    const root = path.resolve(__dirname, '..');
    const filesToCheck = [
      'App.tsx',
      'desktop/DesktopShell.tsx',
      'desktop/pages/DesktopSettingsPage.tsx',
      'desktop/pages/DesktopInventoryPage.tsx',
      'desktop/components/DesktopProductDetailPanel.tsx',
      'desktop/components/DesktopProductFormDrawer.tsx',
      'components/BottomNav.tsx',
      'components/ProductFormModal.tsx',
      'components/UsersRolesModal.tsx',
      'components/DepotsModal.tsx',
      'components/DepartmentsProjectsModal.tsx',
      'components/CategoriesModal.tsx',
    ];

    for (const relPath of filesToCheck) {
      const content = fs.readFileSync(path.join(root, relPath), 'utf8');
      if (relPath === 'App.tsx') {
        expect(content).toContain('UnsavedChangesModal');
      } else {
        expect(content).toContain('unsavedChangesGuard');
      }
    }
  });
});
