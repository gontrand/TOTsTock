/**
 * Universal Printing Helper for TOT Stock PRO
 * Works reliably inside sandboxed environments and iframes with direct DOM sheet isolation.
 */

export function printHtmlViaIframe(htmlContent: string): void {
  // 1. First attempt: Direct DOM sheet injection with @media print isolation
  try {
    const prevSheet = document.getElementById('tot-direct-printable-sheet');
    if (prevSheet) prevSheet.remove();

    const printContainer = document.createElement('div');
    printContainer.id = 'tot-direct-printable-sheet';

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');

    // Copy styles
    const styles = doc.head.querySelectorAll('style');
    styles.forEach((s) => printContainer.appendChild(s.cloneNode(true)));

    // Copy body contents
    Array.from(doc.body.childNodes).forEach((n) => {
      if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).classList.contains('print-control-bar')) {
        return;
      }
      printContainer.appendChild(n.cloneNode(true));
    });

    document.body.appendChild(printContainer);
    document.body.classList.add('is-printing-direct-sheet');

    setTimeout(() => {
      try {
        window.focus();
        window.print();
      } catch (err) {
        console.warn('Direct print error:', err);
      } finally {
        setTimeout(() => {
          document.body.classList.remove('is-printing-direct-sheet');
          if (printContainer.parentNode) {
            printContainer.remove();
          }
        }, 1200);
      }
    }, 250);
    return;
  } catch (directErr) {
    console.warn('Direct sheet print failed, attempting iframe fallback:', directErr);
  }

  // 2. Fallback: Hidden iframe printing
  const existingFrame = document.getElementById('tot-print-iframe');
  if (existingFrame) {
    existingFrame.remove();
  }

  const iframe = document.createElement('iframe');
  iframe.id = 'tot-print-iframe';
  iframe.style.position = 'fixed';
  iframe.style.top = '0';
  iframe.style.left = '0';
  iframe.style.width = '100vw';
  iframe.style.height = '100vh';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.style.zIndex = '-9999';
  iframe.setAttribute('aria-hidden', 'true');

  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document || iframe.contentDocument;
  if (!doc) {
    console.error('Cannot access iframe document for printing');
    window.print();
    return;
  }

  let printed = false;
  const triggerPrint = () => {
    if (printed) return;
    printed = true;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (err) {
      console.warn('Iframe print error, falling back to standard print:', err);
      window.print();
    } finally {
      setTimeout(() => {
        iframe.remove();
      }, 4000);
    }
  };

  iframe.onload = () => {
    setTimeout(triggerPrint, 250);
  };

  doc.open();
  doc.write(htmlContent);
  doc.close();

  // Trigger print after slight delay in case onload did not trigger
  setTimeout(triggerPrint, 450);
}

/**
 * Generate Printable HTML for Standard Order Slip (Bon de Retrait A4 / A5)
 */
export function generateOrderSlipHtml(
  paramsOrOrder:
    | {
        orderNumber: string;
        siteNumber: string;
        requesterName: string;
        pickupZone: string;
        depotName: string;
        preparerName?: string | null;
        items: Array<{
          product_name: string;
          product_ref: string;
          quantity: number;
          unit?: string;
          picked?: boolean;
          unavailable?: boolean;
          unavailable_comment?: string;
          substituted?: boolean;
          substituted_with_ref?: string;
          substituted_with_name?: string;
        }>;
        qrCodeDataUrl?: string | null;
        notes?: string;
        signatureDataUrl?: string | null;
        signedByName?: string | null;
        signedAt?: string | null;
        canIncludeSignature?: boolean;
      }
    | Record<string, any>,
  _companyName?: string,
  _currency?: string,
  _logo?: string,
  maybeOptions?: { canIncludeSignature?: boolean }
): string {
  const isMaterialOrder =
    paramsOrOrder &&
    typeof paramsOrOrder === 'object' &&
    'order_number' in paramsOrOrder &&
    !('orderNumber' in paramsOrOrder);

  const orderNumber = isMaterialOrder
    ? String(paramsOrOrder.order_number || '')
    : String(paramsOrOrder.orderNumber || '');
  const siteNumber = isMaterialOrder
    ? String(paramsOrOrder.site_number || '')
    : String(paramsOrOrder.siteNumber || '');
  const requesterName = isMaterialOrder
    ? String(paramsOrOrder.requester_name || '')
    : String(paramsOrOrder.requesterName || '');
  const pickupZone = isMaterialOrder
    ? String(paramsOrOrder.pickup_zone || 'RETRAIT')
    : String(paramsOrOrder.pickupZone || '');
  const depotName = isMaterialOrder
    ? String(paramsOrOrder.depot_name || 'Dépôt Principal')
    : String(paramsOrOrder.depotName || '');
  const preparerName = isMaterialOrder
    ? paramsOrOrder.preparer_name || null
    : paramsOrOrder.preparerName || null;
  const items = Array.isArray(paramsOrOrder.items) ? paramsOrOrder.items : [];
  const qrCodeDataUrl = isMaterialOrder
    ? paramsOrOrder.qrCodeDataUrl || null
    : paramsOrOrder.qrCodeDataUrl || null;
  const notes = paramsOrOrder.notes;
  const signatureDataUrl = isMaterialOrder
    ? paramsOrOrder.signature_data || null
    : paramsOrOrder.signatureDataUrl || null;
  const signedByName = isMaterialOrder
    ? paramsOrOrder.collected_by || paramsOrOrder.requester_name || null
    : paramsOrOrder.signedByName || null;
  const signedAt = isMaterialOrder
    ? paramsOrOrder.collected_at || null
    : paramsOrOrder.signedAt || null;
  const canIncludeSignature = isMaterialOrder
    ? Boolean(maybeOptions?.canIncludeSignature ?? paramsOrOrder.canIncludeSignature)
    : Boolean(paramsOrOrder.canIncludeSignature);

  const nowFormatted = new Date().toLocaleString('fr-FR', {
    dateStyle: 'full',
    timeStyle: 'short',
  });

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>Bon de Retrait Commande - ${orderNumber}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 15mm 15mm 15mm 15mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 0;
      font-size: 13px;
      line-height: 1.4;
    }
    .header-table {
      width: 100%;
      border-bottom: 3px solid #0f172a;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .brand-title {
      font-size: 22px;
      font-weight: 900;
      color: #ea580c;
      letter-spacing: -0.5px;
    }
    .subtitle {
      font-size: 11px;
      color: #64748b;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .order-badge {
      display: inline-block;
      background: #0f172a;
      color: #ffffff;
      padding: 6px 12px;
      border-radius: 8px;
      font-family: monospace;
      font-weight: 900;
      font-size: 16px;
    }
    .highlight-zone {
      background: #f1f5f9;
      border: 2px solid #7c3aed;
      border-radius: 12px;
      padding: 12px 16px;
      margin-bottom: 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .zone-title {
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 800;
      color: #6d28d9;
    }
    .zone-name {
      font-size: 20px;
      font-weight: 900;
      color: #4c1d95;
    }
    .info-grid {
      display: table;
      width: 100%;
      margin-bottom: 20px;
    }
    .info-cell {
      display: table-cell;
      width: 50%;
      vertical-align: top;
      padding: 10px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
    }
    .info-cell:first-child {
      margin-right: 10px;
    }
    .info-label {
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 700;
      color: #64748b;
      margin-bottom: 2px;
    }
    .info-value {
      font-size: 14px;
      font-weight: 800;
      color: #1e293b;
    }
    table.items-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      margin-bottom: 20px;
    }
    table.items-table th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 800;
      font-size: 11px;
      text-transform: uppercase;
      text-align: left;
      padding: 8px 10px;
      border-bottom: 2px solid #cbd5e1;
    }
    table.items-table td {
      padding: 8px 10px;
      border-bottom: 1px solid #e2e8f0;
      font-size: 12px;
    }
    .qr-container {
      text-align: center;
      margin-top: 20px;
      padding-top: 15px;
      border-top: 1px dashed #cbd5e1;
    }
    .qr-img {
      width: 140px;
      height: 140px;
      margin: 0 auto;
      display: block;
    }
    .footer-note {
      font-size: 10px;
      color: #64748b;
      text-align: center;
      margin-top: 15px;
    }
  </style>
</head>
<body>
  <table class="header-table">
    <tr>
      <td>
        <div class="brand-title">TOT STOCK PRO</div>
        <div class="subtitle">BON DE RETRAIT MAGASIN & POINTAGE DRIVE CHANTIER</div>
      </td>
      <td style="text-align: right;">
        <div class="order-badge">${orderNumber}</div>
        <div style="font-size: 10px; color: #64748b; margin-top: 4px;">Édité le ${nowFormatted}</div>
      </td>
    </tr>
  </table>

  <div class="highlight-zone">
    <div>
      <div class="zone-title">📍 EMPLACEMENT / CASIER DE RETRAIT :</div>
      <div class="zone-name">${pickupZone}</div>
    </div>
    <div style="text-align: right;">
      <div style="font-size: 11px; font-weight: 800; color: #475569;">DÉPÔT : ${depotName}</div>
      <div style="font-size: 10px; color: #64748b;">Préparateur : ${preparerName || 'Magasinier'}</div>
    </div>
  </div>

  <table style="width: 100%; margin-bottom: 16px;">
    <tr>
      <td style="width: 50%; padding-right: 6px;">
        <div class="info-cell" style="width: 100%;">
          <div class="info-label">Chantier d'affectation</div>
          <div class="info-value">🏗️ ${siteNumber}</div>
        </div>
      </td>
      <td style="width: 50%; padding-left: 6px;">
        <div class="info-cell" style="width: 100%;">
          <div class="info-label">Demandeur du matériel</div>
          <div class="info-value">👤 ${requesterName}</div>
        </div>
      </td>
    </tr>
  </table>

  ${notes ? `
    <div style="background: #fffbeb; border: 1px solid #fef3c7; border-left: 4px solid #f59e0b; padding: 8px 12px; margin-bottom: 16px; border-radius: 6px; font-size: 11px;">
      <strong>Note de commande :</strong> ${notes}
    </div>
  ` : ''}

  <div style="font-size: 13px; font-weight: 900; margin-bottom: 4px;">
    LISTE DU MATÉRIEL PRÉPARÉ (${items.length} références) :
  </div>

  <table class="items-table">
    <thead>
      <tr>
        <th style="width: 8%;">Pointé</th>
        <th style="width: 22%;">Référence</th>
        <th style="width: 50%;">Désignation Article</th>
        <th style="width: 20%; text-align: right;">Quantité</th>
      </tr>
    </thead>
    <tbody>
      ${items
        .map(
          (it) => `
        <tr style="${it.unavailable ? 'background: #fff1f2;' : it.substituted ? 'background: #fffbeb;' : ''}">
          <td style="text-align: center; font-size: 14px;">
            ${it.unavailable ? '❌' : it.substituted ? '🔄' : '✅'}
          </td>
          <td style="font-family: monospace; font-weight: 700;">
            ${it.product_ref}
          </td>
          <td>
            <strong>${it.product_name}</strong>
            ${
              it.substituted
                ? `<div style="color: #b45309; font-size: 10px; font-weight: bold; margin-top: 2px;">
                    ↳ Substitué par : ${it.substituted_with_ref} - ${it.substituted_with_name}
                  </div>`
                : ''
            }
            ${
              it.unavailable
                ? `<div style="color: #e11d48; font-size: 10px; font-style: italic; margin-top: 2px;">
                    ↳ Non disponible : ${it.unavailable_comment || 'Rupture magasin'}
                  </div>`
                : ''
            }
          </td>
          <td style="text-align: right; font-weight: 900; font-size: 13px;">
            ${it.quantity} ${it.unit || 'pc'}
          </td>
        </tr>
      `
        )
        .join('')}
    </tbody>
  </table>

  ${
    signatureDataUrl && String(signatureDataUrl).trim().length > 0
      ? canIncludeSignature
        ? `
  <div style="margin-top: 16px; padding: 12px; border: 1px solid #cbd5e1; border-radius: 8px; background: #f8fafc; text-align: center;">
    <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: #334155; margin-bottom: 6px;">
      Preuve de retrait signée
    </div>
    <img src="${signatureDataUrl}" alt="Signature de retrait" style="max-height: 90px; max-width: 260px; object-fit: contain; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px;" />
    <div style="font-size: 11px; font-weight: 700; color: #0f172a; margin-top: 6px;">
      Signé par ${signedByName || requesterName}${
          signedAt
            ? ` le ${new Date(signedAt).toLocaleString('fr-FR', {
                dateStyle: 'short',
                timeStyle: 'short',
              })}`
            : ''
        }
    </div>
  </div>`
        : `
  <div style="margin-top: 16px; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; background: #f8fafc; text-align: center; font-size: 12px; font-weight: 800; color: #0f172a;">
    Retrait signé${
      signedByName
        ? ` — Signé par ${signedByName}${
            signedAt
              ? ` le ${new Date(signedAt).toLocaleString('fr-FR', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}`
              : ''
          }`
        : ''
    }
  </div>`
      : ''
  }

  <div class="qr-container">
    ${
      qrCodeDataUrl
        ? `<img class="qr-img" src="${qrCodeDataUrl}" alt="QR Retrait" />`
        : ''
    }
    <div style="font-family: monospace; font-weight: 800; font-size: 12px; margin-top: 6px;">
      TOT-ORDER:${orderNumber}
    </div>
    <div style="font-size: 11px; color: #64748b; margin-top: 2px;">
      Le demandeur scanne ce QR Code sur le casier pour confirmer et clôturer le retrait du matériel.
    </div>
  </div>

  <div class="footer-note">
    Document généré automatiquement par TOT Stock PRO - Système de Gestion & Drive Chantier
  </div>
</body>
</html>
`;
}

/**
 * Generate Printable HTML for Thermal Labels (60x40 mm & 100x150 mm)
 */
export function generateThermalLabelHtml(params: {
  orderNumber: string;
  siteNumber: string;
  requesterName: string;
  pickupZone: string;
  depotName: string;
  preparerName?: string | null;
  itemsCount: number;
  qrCodeDataUrl?: string | null;
  format: '60x40' | '100x150';
}): string {
  const {
    orderNumber,
    siteNumber,
    requesterName,
    pickupZone,
    depotName,
    preparerName,
    itemsCount,
    qrCodeDataUrl,
    format,
  } = params;

  const isSmall = format === '60x40';
  const widthMm = isSmall ? '60mm' : '100mm';
  const heightMm = isSmall ? '40mm' : '150mm';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Étiquette ${format} - ${orderNumber}</title>
  <style>
    @page {
      size: ${widthMm} ${heightMm};
      margin: 0;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      margin: 0;
      padding: ${isSmall ? '2.5mm' : '6mm'};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
      color: #000000;
      background: #ffffff;
      width: ${widthMm};
      height: ${heightMm};
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .header {
      border-bottom: 2px solid #000;
      padding-bottom: 1.5px;
      margin-bottom: 1.5px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .title {
      font-size: ${isSmall ? '9pt' : '15pt'};
      font-weight: 900;
      text-transform: uppercase;
    }
    .site {
      font-size: ${isSmall ? '8pt' : '12pt'};
      font-weight: 900;
    }
    .zone {
      border: 2px solid #000;
      background: #000;
      color: #fff;
      font-size: ${isSmall ? '10pt' : '17pt'};
      font-weight: 900;
      text-align: center;
      padding: ${isSmall ? '2px 4px' : '5px'};
      margin: ${isSmall ? '1.5px 0' : '4px 0'};
      letter-spacing: 0.5px;
    }
    .body-grid {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 3px;
      flex: 1;
    }
    .qr-code {
      width: ${isSmall ? '22mm' : '45mm'};
      height: ${isSmall ? '22mm' : '45mm'};
      object-fit: contain;
    }
    .info {
      font-size: ${isSmall ? '6.5pt' : '11pt'};
      line-height: 1.25;
      flex: 1;
    }
    .order-num {
      font-family: monospace;
      font-weight: 900;
      font-size: ${isSmall ? '7.5pt' : '12pt'};
      word-break: break-all;
      margin-bottom: 2px;
    }
    .footer {
      border-top: 1px solid #000;
      padding-top: 1.5px;
      font-size: ${isSmall ? '5.5pt' : '9pt'};
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">DRIVE CHANTIER</div>
    <div class="site">${siteNumber}</div>
  </div>

  <div class="zone">
    ZONE: ${pickupZone || 'RETRAIT'}
  </div>

  <div class="body-grid">
    <div class="info">
      <div class="order-num">${orderNumber}</div>
      <div>Demandeur: <strong>${requesterName}</strong></div>
      <div>Articles: <strong>${itemsCount} réf.</strong></div>
      <div>Dépôt: <strong>${depotName}</strong></div>
    </div>
    ${qrCodeDataUrl ? `<img class="qr-code" src="${qrCodeDataUrl}" alt="QR" />` : ''}
  </div>

  <div class="footer">
    <span>Prep: ${preparerName || 'Magasinier'}</span>
    <span>${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
  </div>
</body>
</html>
`;
}
