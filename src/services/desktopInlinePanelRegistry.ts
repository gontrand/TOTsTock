import { useSyncExternalStore } from 'react';

/**
 * Indique qu'une page desktop affiche déjà la fiche article dans son panneau latéral
 * (page Inventaire). Dans ce cas, la fenêtre modale ProductDetailModal ne doit PAS
 * s'ouvrir en plus : sinon sa fermeture remet activeProductId à null et ferme aussi le panneau.
 */
let count = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function registerDesktopInlinePanel(): () => void {
  count += 1;
  emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    count = Math.max(0, count - 1);
    emit();
  };
}

export function useDesktopInlinePanelActive(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => count > 0,
    () => false
  );
}
