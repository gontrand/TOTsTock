import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../context/AppContext';
import { Product } from '../types';
import { tr } from '../i18n/dutchTranslator';

export interface ProductRefLinkProps {
  productId?: string | number | null;
  reference?: string | null;
  children?: React.ReactNode;
  className?: string;
  title?: string;
  onAfterOpen?: () => void;
  onOpenProduct?: (productId: string) => void;
}

/**
 * Résout un article dans la liste `products` par identifiant (`productId`)
 * ou à défaut par `reference` / `sku` (insensible à la casse et aux espaces).
 */
export function resolveProductForRefLink(
  products: Product[] = [],
  lookupOrProductId?:
    | { productId?: string | number | null; reference?: string | null }
    | string
    | number
    | null,
  referenceArg?: string | null
): Product | undefined {
  if (!Array.isArray(products) || products.length === 0) return undefined;

  const lookup =
    lookupOrProductId && typeof lookupOrProductId === 'object'
      ? lookupOrProductId
      : { productId: lookupOrProductId, reference: referenceArg };

  const rawId =
    lookup.productId !== undefined && lookup.productId !== null
      ? String(lookup.productId).trim()
      : '';
  const rawRef =
    lookup.reference !== undefined && lookup.reference !== null
      ? String(lookup.reference).trim()
      : '';

  if (rawId) {
    const byId = products.find((p) => String(p.id).trim() === rawId);
    if (byId) return byId;
  }

  const refCandidates = [rawRef, rawId].filter(Boolean).map((v) => v.toLowerCase());
  if (refCandidates.length > 0) {
    for (const candidate of refCandidates) {
      const byRef = products.find((p) => {
        const pRef = String(p.reference || '').trim().toLowerCase();
        const pSku = String((p as unknown as Record<string, unknown>).sku || '')
          .trim()
          .toLowerCase();
        return (pRef && pRef === candidate) || (pSku && pSku === candidate);
      });
      if (byRef) return byRef;
    }
  }

  return undefined;
}

export const ProductRefLink: React.FC<ProductRefLinkProps> = ({
  productId,
  reference,
  children,
  className = '',
  title,
  onAfterOpen,
  onOpenProduct,
}) => {
  const { products, setActiveProductId, language } = useApp();
  const [missingToastVisible, setMissingToastVisible] = useState(false);

  useEffect(() => {
    if (!missingToastVisible) return;
    const timer = window.setTimeout(() => {
      setMissingToastVisible(false);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [missingToastVisible]);

  const handleActivate = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    const matched = resolveProductForRefLink(products, { productId, reference });
    if (matched) {
      setActiveProductId(matched.id);
      if (onOpenProduct) onOpenProduct(String(matched.id));
      if (onAfterOpen) onAfterOpen();
    } else {
      setMissingToastVisible(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleActivate(e);
    }
  };

  const fallbackLabel = children ?? reference ?? (productId !== undefined && productId !== null ? String(productId) : '—');
  const missingMessage = tr(
    language,
    'Fiche introuvable',
    'Product sheet not found',
    'Productfiche niet gevonden'
  );

  return (
    <>
      <span
        role="link"
        tabIndex={0}
        onClick={handleActivate}
        onKeyDown={handleKeyDown}
        title={
          title ||
          tr(
            language,
            'Ouvrir la fiche complète de la référence',
            'Open full product details',
            'Volledige productfiche openen'
          )
        }
        className={`hover:underline cursor-pointer focus:outline-none focus:ring-2 focus:ring-orange-500/50 rounded-xs ${className}`.trim()}
      >
        {fallbackLabel}
      </span>
      {missingToastVisible &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            data-testid="product-ref-missing-toast"
            onClick={(e) => {
              e.stopPropagation();
              setMissingToastVisible(false);
            }}
            className="fixed bottom-5 right-5 z-[250] px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-800 text-white text-xs font-bold shadow-xl border border-slate-700 flex items-center gap-2 animate-fadeIn cursor-pointer"
          >
            <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
            <span>{missingMessage}</span>
          </div>,
          document.body
        )}
    </>
  );
};
