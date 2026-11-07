import { useEffect, useRef, useSyncExternalStore } from 'react';

export interface UnsavedFormEntry {
  id: string;
  isDirty: boolean;
  label?: string;
  onSave: () => Promise<boolean | void> | boolean | void;
  onDiscard: () => void;
}

interface PendingNavigationState {
  open: boolean;
  entry: UnsavedFormEntry | null;
  proceed: (() => void) | null;
  saving: boolean;
}

const registeredForms = new Map<string, UnsavedFormEntry>();
const formOrder: string[] = [];

let pendingState: PendingNavigationState = {
  open: false,
  entry: null,
  proceed: null,
  saving: false,
};

const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export function registerUnsavedForm(entry: UnsavedFormEntry): () => void {
  registeredForms.set(entry.id, entry);
  if (!formOrder.includes(entry.id)) {
    formOrder.push(entry.id);
  }
  if (pendingState.open && pendingState.entry?.id === entry.id) {
    if (!entry.isDirty) {
      pendingState = { open: false, entry: null, proceed: null, saving: false };
    } else {
      pendingState = { ...pendingState, entry };
    }
    emitChange();
  }
  return () => {
    registeredForms.delete(entry.id);
    const idx = formOrder.indexOf(entry.id);
    if (idx !== -1) formOrder.splice(idx, 1);
    if (pendingState.open && pendingState.entry?.id === entry.id) {
      pendingState = { open: false, entry: null, proceed: null, saving: false };
      emitChange();
    }
  };
}

export function getActiveDirtyForm(scopeIds?: string[]): UnsavedFormEntry | null {
  for (let i = formOrder.length - 1; i >= 0; i--) {
    const id = formOrder[i];
    if (scopeIds && !scopeIds.includes(id)) continue;
    const entry = registeredForms.get(id);
    if (entry && entry.isDirty) {
      return entry;
    }
  }
  return null;
}

export function hasActiveDirtyForm(scopeIds?: string[]): boolean {
  return getActiveDirtyForm(scopeIds) !== null;
}

/**
 * Intercepts a menu/tab/modal navigation action if a form is currently in edit or modification mode.
 * If no form is active/dirty, executes `proceed()` immediately.
 * Otherwise opens the Save / Discard confirmation modal.
 */
export function requestGuardedNavigation(proceed: () => void, scopeIds?: string[]): void {
  const dirtyEntry = getActiveDirtyForm(scopeIds);
  if (!dirtyEntry) {
    proceed();
    return;
  }
  pendingState = {
    open: true,
    entry: dirtyEntry,
    proceed,
    saving: false,
  };
  emitChange();
}

export async function confirmSaveAndProceed(): Promise<void> {
  if (!pendingState.open || !pendingState.entry) return;
  const currentEntry = registeredForms.get(pendingState.entry.id) || pendingState.entry;
  const proceedFn = pendingState.proceed;

  pendingState = { ...pendingState, saving: true };
  emitChange();

  try {
    const result = await currentEntry.onSave();
    if (result === false) {
      // Validation or save error inside the form: close prompt and keep user on the form
      pendingState = { open: false, entry: null, proceed: null, saving: false };
      emitChange();
      return;
    }
    pendingState = { open: false, entry: null, proceed: null, saving: false };
    emitChange();
    proceedFn?.();
  } catch {
    pendingState = { open: false, entry: null, proceed: null, saving: false };
    emitChange();
  }
}

export function confirmDiscardAndProceed(): void {
  if (!pendingState.open || !pendingState.entry) return;
  const currentEntry = registeredForms.get(pendingState.entry.id) || pendingState.entry;
  const proceedFn = pendingState.proceed;

  pendingState = { open: false, entry: null, proceed: null, saving: false };
  emitChange();

  try {
    currentEntry.onDiscard();
  } finally {
    proceedFn?.();
  }
}

export function cancelPendingNavigation(): void {
  if (!pendingState.open) return;
  pendingState = { open: false, entry: null, proceed: null, saving: false };
  emitChange();
}

export function resetAllUnsavedFormsForTest(): void {
  registeredForms.clear();
  formOrder.length = 0;
  pendingState = { open: false, entry: null, proceed: null, saving: false };
  emitChange();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): PendingNavigationState {
  return pendingState;
}

export function getPendingNavigationState(): PendingNavigationState {
  return pendingState;
}

export function useUnsavedChangesPromptState(): PendingNavigationState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Hook for forms to register their active edit/modification state.
 */
export function useRegisterUnsavedForm(config: {
  id: string;
  isDirty: boolean;
  label?: string;
  onSave: () => Promise<boolean | void> | boolean | void;
  onDiscard: () => void;
}): void {
  const callbacksRef = useRef({ onSave: config.onSave, onDiscard: config.onDiscard });
  callbacksRef.current = { onSave: config.onSave, onDiscard: config.onDiscard };

  useEffect(() => {
    const unregister = registerUnsavedForm({
      id: config.id,
      isDirty: config.isDirty,
      label: config.label,
      onSave: () => callbacksRef.current.onSave(),
      onDiscard: () => callbacksRef.current.onDiscard(),
    });
    return unregister;
  }, [config.id, config.isDirty, config.label]);
}

/**
 * Utility to smoothly scroll a form into view and focus its primary input when clicking an Edit button.
 */
export function scrollToAndFocusForm(
  formElement: HTMLElement | null | undefined,
  inputElement?: HTMLElement | null | undefined
): void {
  const run = () => {
    if (formElement && typeof formElement.scrollIntoView === 'function') {
      formElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (inputElement && typeof inputElement.focus === 'function') {
      inputElement.focus();
      if ('select' in inputElement && typeof (inputElement as HTMLInputElement).select === 'function') {
        try {
          (inputElement as HTMLInputElement).select();
        } catch {
          // ignore select error on unsupported input types
        }
      }
    }
  };
  if (typeof window !== 'undefined') {
    window.setTimeout(run, 40);
  } else {
    run();
  }
}

