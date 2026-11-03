import { useEffect, useState } from 'react';

export type LayoutMode = 'mobile' | 'desktop';

export const DESKTOP_MIN_WIDTH_PX = 1024;
export const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH_PX}px)`;

/**
 * Fonction pure testable qui détermine le mode d'affichage ('mobile' | 'desktop')
 * selon la largeur de la fenêtre (seuil : 1024 px).
 */
export function computeLayoutModeFromWidth(width: number): LayoutMode {
  if (typeof width !== 'number' || !Number.isFinite(width)) {
    return 'mobile';
  }
  return width >= DESKTOP_MIN_WIDTH_PX ? 'desktop' : 'mobile';
}

/**
 * Lit le mode d'affichage courant depuis `window.matchMedia` ou `window.innerWidth`.
 */
export function getCurrentLayoutMode(): LayoutMode {
  if (typeof window === 'undefined') {
    return 'mobile';
  }
  if (typeof window.matchMedia === 'function') {
    const mq = window.matchMedia(DESKTOP_MEDIA_QUERY);
    if (typeof mq.matches === 'boolean') {
      return mq.matches ? 'desktop' : 'mobile';
    }
  }
  if (typeof window.innerWidth === 'number') {
    return computeLayoutModeFromWidth(window.innerWidth);
  }
  return 'mobile';
}

/**
 * Hook réactif qui renvoie `'mobile'` (< 1024 px) ou `'desktop'` (≥ 1024 px)
 * via `matchMedia('(min-width: 1024px)')` et écoute le redimensionnement.
 */
export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(() => getCurrentLayoutMode());

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateMode = () => {
      setMode(getCurrentLayoutMode());
    };

    updateMode();

    let mq: MediaQueryList | null = null;
    const handleMediaChange = (e: MediaQueryListEvent) => {
      setMode(e.matches ? 'desktop' : 'mobile');
    };

    if (typeof window.matchMedia === 'function') {
      mq = window.matchMedia(DESKTOP_MEDIA_QUERY);
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', handleMediaChange);
      } else if (typeof (mq as any).addListener === 'function') {
        (mq as any).addListener(handleMediaChange);
      }
    }

    window.addEventListener('resize', updateMode);

    return () => {
      window.removeEventListener('resize', updateMode);
      if (mq) {
        if (typeof mq.removeEventListener === 'function') {
          mq.removeEventListener('change', handleMediaChange);
        } else if (typeof (mq as any).removeListener === 'function') {
          (mq as any).removeListener(handleMediaChange);
        }
      }
    };
  }, []);

  return mode;
}
