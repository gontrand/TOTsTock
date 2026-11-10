/**
 * Paramètres de facturation affichés dans « Souscrire un abonnement » (devis / bon de commande proforma).
 * ➜ Modifiez UNIQUEMENT ce fichier pour changer le taux de TVA, l'IBAN, le BIC, le bénéficiaire ou le préfixe de facture.
 */
export const BILLING_CONFIG = {
  /** TVA applicable (Belgique : 21 %). Format décimal : 0.21 = 21 %. */
  vatRate: 0.21,
  /** Bénéficiaire du virement */
  beneficiary: 'TOT STOCK',
  /** IBAN du virement (⚠ valeur d'exemple : à remplacer par votre vrai IBAN) */
  iban: 'BEXX XXXX XXXX XXXX XXXX XXXX XX',
  /** BIC / SWIFT (⚠ valeur d'exemple : à remplacer) */
  bic: 'XXXXXXXXXXX',
  /** Préfixe du numéro de référence : PREFIXE-ANNÉE-CODE (ex. FAC-TOT-2026-A1B2) */
  invoicePrefix: 'FAC-TOT',
} as const;

/** Faux tant que l'IBAN / le BIC contiennent encore des « X » d'exemple : le devis n'affiche alors aucune coordonnée bancaire. */
export const BANK_DETAILS_CONFIGURED =
  !/X{4,}/i.test(BILLING_CONFIG.iban.replace(/\s/g, '')) && !/^X+$/i.test(BILLING_CONFIG.bic.replace(/\s/g, ''));

export const VAT_PERCENT_LABEL = `${Number((BILLING_CONFIG.vatRate * 100).toFixed(2)).toString().replace('.', ',')}%`;

/** Prix HT par forfait et par périodicité (en €) */
export const PLAN_PRICES_HT: Record<'sta' | 'pro' | 'ent', { annual: number; monthly: number }> = {
  sta: { annual: 390, monthly: 39 },
  pro: { annual: 890, monthly: 89 },
  ent: { annual: 1990, monthly: 199 },
};

export function computeInvoiceAmounts(ht: number) {
  const vat = Math.round(ht * BILLING_CONFIG.vatRate * 100) / 100;
  return { ht, vat, ttc: Math.round((ht + vat) * 100) / 100 };
}

export function formatEuro(n: number): string {
  return new Intl.NumberFormat('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' €';
}
