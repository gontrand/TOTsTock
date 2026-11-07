import React, { useState, useEffect, useRef, useMemo } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import { Product } from '../types';
import {
  X,
  Save,
  Package,
  Trash2,
  AlertTriangle,
  Barcode,
  QrCode,
  Camera,
  CheckCircle2,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { playScanBeep, validateProductIdentifiersUniqueness } from '../utils/crypto';
import { getPlanMaxReferences } from '../services/licenseService';
import jsQR from 'jsqr';
import {
  decodeBarcodeFromCanvas,
  openSmartphoneCameraStream,
  prewarmSmartphoneCameraStream,
  attachStreamToVideoElement,
} from '../utils/qrCodeHelper';
import {
  requestGuardedNavigation,
  scrollToAndFocusForm,
  useRegisterUnsavedForm,
} from '../services/unsavedChangesGuard';

export const ProductFormModal: React.FC = () => {
  const {
    productFormState,
    setProductFormState,
    saveProduct,
    deleteProduct,
    subCategories,
    depots,
    setDepotsModalOpen,
    userHasPermission,
    license,
    products,
    setCompanySetupModalOpen,
    language,
    t,
  } = useApp();

  const isEdit = Boolean(productFormState.product);
  const maxReferences = getPlanMaxReferences(license?.plan_type);
  const isQuotaReached = !isEdit && products.length >= maxReferences;
  const canDelete = userHasPermission('perm_prod_delete');
  const canViewPrices = userHasPermission('perm_prod_view_price');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [reference, setReference] = useState('');
  const [manufacturerRef, setManufacturerRef] = useState('');
  const [barcode, setBarcode] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [subCategoryId, setSubCategoryId] = useState<string>('');
  const [unitPrice, setUnitPrice] = useState<string>('0.00');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [supplier1Name, setSupplier1Name] = useState('');
  const [refSupplier1, setRefSupplier1] = useState('');
  const [supplier2Name, setSupplier2Name] = useState('');
  const [refSupplier2, setRefSupplier2] = useState('');
  const [storeName, setStoreName] = useState('Dépôt Principal');
  const [roomName, setRoomName] = useState('');
  const [shelfName, setShelfName] = useState('');
  const [quantity, setQuantity] = useState<string>('10');
  const [minStockAlert, setMinStockAlert] = useState<string>('2');
  const [errorMsg, setErrorMsg] = useState('');

  // Quick Barcode / QR Scanning via camera
  const [scanTargetField, setScanTargetField] = useState<'barcode' | 'qr_code' | null>(null);
  const isScanningBarcode = scanTargetField !== null;
  const scanVideoRef = useRef<HTMLVideoElement | null>(null);
  const scanStreamRef = useRef<MediaStream | null>(null);
  const scanAnimFrameRef = useRef<number | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const refInputRef = useRef<HTMLInputElement | null>(null);
  const brandInputRef = useRef<HTMLInputElement | null>(null);

  const formInitKey = productFormState.open ? String(productFormState.product?.id ?? 'new') : '';

  useEffect(() => {
    if (!productFormState.open) return;
    if (productFormState.product) {
      const p = productFormState.product;
      setReference(p.reference || '');
      setManufacturerRef(p.manufacturer_ref || '');
      setBarcode(p.barcode || '');
      setQrCode(p.qr_code || '');
      setBrand(p.brand || '');
      setModel(p.model || '');
      setSubCategoryId(p.sub_category_id ? String(p.sub_category_id) : '');
      setUnitPrice(String(p.unit_price || 0));
      setDescription(p.description || '');
      setTags(p.tags || '');
      setSupplier1Name(p.supplier_1_name || '');
      setRefSupplier1(p.ref_supplier_1 || '');
      setSupplier2Name(p.supplier_2_name || '');
      setRefSupplier2(p.ref_supplier_2 || '');
      setStoreName(p.store_name || 'Dépôt Principal');
      setRoomName(p.room_name || '');
      setShelfName(p.shelf_name || '');
      setQuantity(String(p.quantity || 0));
      setMinStockAlert(String(p.min_stock_alert || 2));
    } else {
      setReference('');
      setManufacturerRef('');
      setBarcode('');
      setQrCode('');
      setBrand('');
      setModel('');
      setSubCategoryId('');
      setUnitPrice('0.00');
      setDescription('');
      setTags('');
      setSupplier1Name('');
      setRefSupplier1('');
      setSupplier2Name('');
      setRefSupplier2('');
      setStoreName(depots.length > 0 ? depots[0].name : 'Dépôt Principal');
      setRoomName('');
      setShelfName('');
      setQuantity('10');
      setMinStockAlert('2');
    }
    setErrorMsg('');
    scrollToAndFocusForm(
      formRef.current,
      productFormState.product ? brandInputRef.current : refInputRef.current
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productFormState.open, formInitKey]);

  // Real-time uniqueness validation across Reference, Manufacturer Ref (OEM), Barcode, and QR Code
  const uniquenessCheck = useMemo(() => {
    return validateProductIdentifiersUniqueness(
      {
        id: productFormState.product?.id,
        reference,
        manufacturer_ref: manufacturerRef,
        barcode,
        qr_code: qrCode,
      },
      products,
      {
        isNew: !isEdit,
        editingId: productFormState.product?.id ?? null,
        language,
      }
    );
  }, [reference, manufacturerRef, barcode, qrCode, products, isEdit, productFormState.product, language]);

  // Handle quick barcode / QR camera lifecycle
  useEffect(() => {
    if (!scanTargetField) {
      if (scanAnimFrameRef.current) cancelAnimationFrame(scanAnimFrameRef.current);
      if (scanStreamRef.current) {
        scanStreamRef.current.getTracks().forEach((t) => t.stop());
        scanStreamRef.current = null;
      }
      return;
    }

    let isCancelled = false;

    const applyDetectedValue = (rawVal: string) => {
      const cleanVal = rawVal.trim();
      if (!cleanVal) return;

      const nextCandidate = {
        id: productFormState.product?.id,
        reference,
        manufacturer_ref: manufacturerRef,
        barcode: scanTargetField === 'barcode' ? cleanVal : barcode,
        qr_code: scanTargetField === 'qr_code' ? cleanVal : qrCode,
      };
      const check = validateProductIdentifiersUniqueness(nextCandidate, products, {
        isNew: !isEdit,
        editingId: productFormState.product?.id ?? null,
        language,
      });

      if (scanTargetField === 'barcode') {
        setBarcode(cleanVal);
      } else {
        setQrCode(cleanVal);
      }

      if (!check.valid && check.error) {
        playScanBeep(false);
        setErrorMsg(check.error);
      } else {
        playScanBeep(true);
        setErrorMsg('');
      }
      setScanTargetField(null);
    };

    const startBarcodeScanner = async () => {
      try {
        const stream = await openSmartphoneCameraStream();
        if (isCancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        scanStreamRef.current = stream;
        if (scanVideoRef.current) {
          await attachStreamToVideoElement(scanVideoRef.current, stream);

          // Native BarcodeDetector or ZXing
          const hasNativeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;
          let nativeDetector: any = null;
          if (hasNativeDetector) {
            try {
              nativeDetector = new (window as any).BarcodeDetector({
                formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code'],
              });
            } catch {
              nativeDetector = null;
            }
          }

          const canvas = document.createElement('canvas');

          const loop = async () => {
            if (isCancelled || !scanVideoRef.current) return;
            const video = scanVideoRef.current;

            if (video.readyState >= 2) {
              if (nativeDetector) {
                try {
                  const detected = await nativeDetector.detect(video);
                  if (detected && detected.length > 0 && detected[0].rawValue) {
                    applyDetectedValue(detected[0].rawValue);
                    return;
                  }
                } catch {
                  // Ignore per-frame error
                }
              } else {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (ctx) {
                  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                  const qr = jsQR(imgData.data, imgData.width, imgData.height);
                  if (qr && qr.data) {
                    applyDetectedValue(qr.data);
                    return;
                  }
                  const bc = decodeBarcodeFromCanvas(canvas);
                  if (bc) {
                    applyDetectedValue(bc);
                    return;
                  }
                }
              }
            }

            scanAnimFrameRef.current = requestAnimationFrame(loop);
          };

          scanAnimFrameRef.current = requestAnimationFrame(loop);
        }
      } catch (err) {
        console.warn('Cannot open camera for barcode scan:', err);
        setScanTargetField(null);
      }
    };

    startBarcodeScanner();

    return () => {
      isCancelled = true;
      if (scanAnimFrameRef.current) cancelAnimationFrame(scanAnimFrameRef.current);
      if (scanStreamRef.current) {
        scanStreamRef.current.getTracks().forEach((t) => t.stop());
        scanStreamRef.current = null;
      }
    };
  }, [scanTargetField, reference, manufacturerRef, barcode, qrCode, products, isEdit, productFormState.product, language]);

  const performSaveProduct = async (): Promise<boolean> => {
    if (isQuotaReached) {
      setErrorMsg(`${t('prod_form_quota_reached')} (${products.length}/${maxReferences} ${t('common_references')}).`);
      return false;
    }
    if (!reference.trim() || !brand.trim() || !model.trim()) {
      setErrorMsg(t('prod_form_required_error'));
      return false;
    }

    if (!uniquenessCheck.valid) {
      setErrorMsg(
        uniquenessCheck.error ||
          (tr(language, 'Doublon détecté : chaque référence, code-barres, QR Code et identification fabricant doit être unique.', 'Duplicate detected: every reference, barcode, QR Code, and manufacturer ID must be unique.'))
      );
      return false;
    }

    const payload: Partial<Product> = {
      id: productFormState.product?.id || reference.trim(),
      reference: reference.trim(),
      manufacturer_ref: manufacturerRef.trim(),
      barcode: barcode.trim() || undefined,
      qr_code: qrCode.trim() || undefined,
      brand: brand.trim(),
      model: model.trim(),
      sub_category_id: subCategoryId ? parseInt(subCategoryId) : null,
      unit_price: canViewPrices
        ? (parseFloat(unitPrice) || 0)
        : (productFormState.product?.unit_price ?? 0),
      description: description.trim(),
      tags: tags.trim(),
      supplier_1_name: supplier1Name.trim(),
      ref_supplier_1: refSupplier1.trim(),
      supplier_2_name: supplier2Name.trim(),
      ref_supplier_2: refSupplier2.trim(),
      store_name: storeName.trim() || t('common_main_depot'),
      room_name: roomName.trim() || 'Zone A',
      shelf_name: shelfName.trim() || 'Bac 1',
      quantity: parseInt(quantity) || 0,
      min_stock_alert: parseInt(minStockAlert) || 2,
    };

    const ok = await saveProduct(payload, {
      isNew: !isEdit,
      editingId: productFormState.product?.id ?? null,
    });
    if (ok) {
      setProductFormState({ open: false, product: null });
      return true;
    }
    setErrorMsg(
      uniquenessCheck.error ||
        (tr(language, "Impossible d'enregistrer l'article : vérifiez l'unicité de la référence, du code-barres, du QR Code et de l'identification fabricant.", 'Unable to save product: please check uniqueness of reference, barcode, QR Code, and manufacturer ID.'))
    );
    return false;
  };

  const isProductFormDirty = Boolean(
    productFormState.open &&
      (isEdit ||
        reference.trim() ||
        manufacturerRef.trim() ||
        barcode.trim() ||
        qrCode.trim() ||
        brand.trim() ||
        model.trim() ||
        description.trim() ||
        tags.trim())
  );

  useRegisterUnsavedForm({
    id: 'mobile-product-form-modal',
    isDirty: isProductFormDirty,
    label: isEdit
      ? `${t('prod_form_edit_title')} (${reference || productFormState.product?.reference || ''})`
      : t('prod_form_create_title'),
    onSave: performSaveProduct,
    onDiscard: () => {
      setProductFormState({ open: false, product: null });
    },
  });

  const handleRequestClose = () => {
    requestGuardedNavigation(() => {
      setProductFormState({ open: false, product: null });
    }, ['mobile-product-form-modal']);
  };

  // Keyboard shortcut: close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && productFormState.open) {
        if (isScanningBarcode) {
          setScanTargetField(null);
        } else if (confirmDeleteOpen) {
          setConfirmDeleteOpen(false);
        } else {
          handleRequestClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [productFormState.open, isScanningBarcode, confirmDeleteOpen, isProductFormDirty]);

  if (!productFormState.open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await performSaveProduct();
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleRequestClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-fadeIn"
    >
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-5 text-slate-800 dark:text-slate-100 max-h-[92dvh] sm:max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-orange-100 dark:bg-orange-950/60 text-orange-600 flex items-center justify-center">
              <Package className="w-4 h-4" />
            </div>
            <h2 className="text-base font-black text-slate-900 dark:text-white">
              {isEdit ? t('prod_form_edit_title') : t('prod_form_create_title')}
            </h2>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleRequestClose();
            }}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer active:scale-95 shadow-xs shrink-0"
            title={t('common_close')}
            aria-label="Fermer"
          >
            <X className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>

        {errorMsg && (
          <div className="mt-3 p-2.5 rounded-xl bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400 border border-red-200 dark:border-red-900/60 text-xs font-semibold flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {isQuotaReached && (
          <div className="mt-3 p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div>
                <p className="font-extrabold">
                  {t('prod_form_quota_reached')} ({products.length} / {maxReferences})
                </p>
                <p className="text-[11px] text-amber-800/90 dark:text-amber-300/90 mt-0.5">
                  {t('prod_form_quota_desc')}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setProductFormState({ open: false, product: null });
                setCompanySetupModalOpen(true);
              }}
              className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer"
            >
              <span>{t('prod_form_quota_unlock_btn')}</span>
            </button>
          </div>
        )}

        {/* Scrollable Form */}
        <form ref={formRef} onSubmit={handleSubmit} className="flex-1 overflow-y-auto py-3 space-y-3 pr-1 text-xs">
          <div>
            <label className="font-bold block text-slate-700 dark:text-slate-300 mb-1">
              {t('prod_form_category_label')}
            </label>
            <select
              value={subCategoryId}
              onChange={(e) => setSubCategoryId(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
            >
              <option value="">{t('prod_form_category_placeholder')}</option>
              {subCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          {/* Identification & Code-barres Fabricant (Unicité Garantie) */}
          <div className="p-3 rounded-2xl bg-slate-50/90 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-extrabold text-slate-800 dark:text-slate-200">
                <Barcode className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                <span>
                  {tr(language, 'Identification & Code-barres Fabricant', 'Manufacturer ID & Barcode')}
                </span>
              </div>
              {uniquenessCheck.valid ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
                  <ShieldCheck className="w-3 h-3" />
                  <span>{tr(language, 'Unicité vérifiée', 'Unique IDs')}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 text-[10px] font-bold">
                  <AlertTriangle className="w-3 h-3" />
                  <span>{tr(language, 'Doublon détecté', 'Duplicate ID')}</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* 1. Référence Interne (Unique) */}
              <div>
                <label className="font-bold flex items-center justify-between text-slate-700 dark:text-slate-300 mb-1">
                  <span>{t('prod_form_ref_label')}</span>
                  {reference.trim() && !uniquenessCheck.fieldErrors.reference && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> Unique
                    </span>
                  )}
                </label>
                <input
                  ref={refInputRef}
                  type="text"
                  value={reference}
                  onChange={(e) => {
                    setReference(e.target.value);
                    setErrorMsg('');
                  }}
                  placeholder="Ex: REF-605"
                  disabled={isEdit}
                  required
                  className={`w-full p-2.5 rounded-xl bg-white dark:bg-slate-900 border outline-none font-bold ${
                    uniquenessCheck.fieldErrors.reference
                      ? 'border-red-500 ring-1 ring-red-500 text-red-600 dark:text-red-400'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                />
                {uniquenessCheck.fieldErrors.reference && (
                  <p className="text-[10px] font-bold text-red-600 dark:text-red-400 mt-1">
                    {uniquenessCheck.fieldErrors.reference}
                  </p>
                )}
              </div>

              {/* 2. Identification / Réf. Fabricant OEM (Unique) */}
              <div>
                <label className="font-bold flex items-center justify-between text-slate-700 dark:text-slate-300 mb-1">
                  <span>{t('prod_form_oem_label')}</span>
                  {manufacturerRef.trim() && !uniquenessCheck.fieldErrors.manufacturer_ref && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> Unique
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  value={manufacturerRef}
                  onChange={(e) => {
                    setManufacturerRef(e.target.value);
                    setErrorMsg('');
                  }}
                  placeholder="Ex: GEBE-BAT-UP320"
                  className={`w-full p-2.5 rounded-xl bg-white dark:bg-slate-900 border outline-none ${
                    uniquenessCheck.fieldErrors.manufacturer_ref
                      ? 'border-red-500 ring-1 ring-red-500 text-red-600 dark:text-red-400'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                />
                {uniquenessCheck.fieldErrors.manufacturer_ref && (
                  <p className="text-[10px] font-bold text-red-600 dark:text-red-400 mt-1">
                    {uniquenessCheck.fieldErrors.manufacturer_ref}
                  </p>
                )}
              </div>
            </div>

            {/* 3. 1D Manufacturer Barcode (EAN-13, Code-128...) (Unique) */}
            <div>
              <label className="font-bold flex items-center justify-between text-slate-700 dark:text-slate-300 mb-1">
                <span className="flex items-center gap-1.5">
                  <Barcode className="w-3.5 h-3.5 text-orange-500" />
                  <span>{t('prod_form_barcode_label')}</span>
                  {barcode.trim() && !uniquenessCheck.fieldErrors.barcode && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> Unique
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    prewarmSmartphoneCameraStream();
                    setScanTargetField('barcode');
                  }}
                  className="text-[10px] text-orange-600 dark:text-orange-400 font-bold hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Camera className="w-3 h-3" />
                  <span>{t('prod_form_barcode_scan_btn')}</span>
                </button>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={barcode}
                  onChange={(e) => {
                    setBarcode(e.target.value);
                    setErrorMsg('');
                  }}
                  placeholder={t('prod_form_barcode_placeholder')}
                  className={`w-full p-2.5 pr-9 rounded-xl bg-white dark:bg-slate-900 border outline-none font-mono text-xs ${
                    uniquenessCheck.fieldErrors.barcode
                      ? 'border-red-500 ring-1 ring-red-500 text-red-600 dark:text-red-400'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => {
                    prewarmSmartphoneCameraStream();
                    setScanTargetField('barcode');
                  }}
                  title={t('prod_form_barcode_scan_btn')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-orange-500 transition cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                </button>
              </div>
              {uniquenessCheck.fieldErrors.barcode && (
                <p className="text-[10px] font-bold text-red-600 dark:text-red-400 mt-1">
                  {uniquenessCheck.fieldErrors.barcode}
                </p>
              )}
            </div>

            {/* 4. QR Code d'inventaire (Unique) */}
            <div>
              <label className="font-bold flex items-center justify-between text-slate-700 dark:text-slate-300 mb-1">
                <span className="flex items-center gap-1.5">
                  <QrCode className="w-3.5 h-3.5 text-orange-500" />
                  <span>
                    {tr(language, "QR Code d'inventaire (Unique)", 'Inventory QR Code (Unique)')}
                  </span>
                  {(qrCode.trim() || reference.trim()) && !uniquenessCheck.fieldErrors.qr_code && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> Unique
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    prewarmSmartphoneCameraStream();
                    setScanTargetField('qr_code');
                  }}
                  className="text-[10px] text-orange-600 dark:text-orange-400 font-bold hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Camera className="w-3 h-3" />
                  <span>{tr(language, 'Scanner QR', 'Scan QR')}</span>
                </button>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={qrCode}
                  onChange={(e) => {
                    setQrCode(e.target.value);
                    setErrorMsg('');
                  }}
                  placeholder={
                    reference.trim()
                      ? `${tr(language, 'Auto (Basé sur la réf) :', 'Auto (Based on ref):')} ${reference.trim()}`
                      : tr(language, 'Généré automatiquement depuis la référence ou saisir/scanner un QR unique', 'Auto-generated from reference or enter/scan a unique QR')
                  }
                  className={`w-full p-2.5 pr-9 rounded-xl bg-white dark:bg-slate-900 border outline-none font-mono text-xs ${
                    uniquenessCheck.fieldErrors.qr_code
                      ? 'border-red-500 ring-1 ring-red-500 text-red-600 dark:text-red-400'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => {
                    prewarmSmartphoneCameraStream();
                    setScanTargetField('qr_code');
                  }}
                  title={tr(language, 'Scanner un QR Code', 'Scan QR Code')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-orange-500 transition cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                </button>
              </div>
              {uniquenessCheck.fieldErrors.qr_code && (
                <p className="text-[10px] font-bold text-red-600 dark:text-red-400 mt-1">
                  {uniquenessCheck.fieldErrors.qr_code}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="font-bold block text-slate-700 dark:text-slate-300 mb-1">
                {t('prod_form_brand_label')}
              </label>
              <input
                ref={brandInputRef}
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Ex: Geberit"
                required
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
              />
            </div>
            <div>
              <label className="font-bold block text-slate-700 dark:text-slate-300 mb-1">
                {t('prod_form_model_label')}
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Ex: Bâti Duofix Sigma"
                required
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {canViewPrices ? (
              <div>
                <label className="font-bold block text-slate-700 dark:text-slate-300 mb-1">
                  {t('prod_form_price_label')}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none font-bold"
                />
              </div>
            ) : (
              <div>
                <label className="font-bold block text-slate-700 dark:text-slate-300 mb-1">
                  {t('prod_form_price_label')}
                </label>
                <div className="w-full p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-400 font-bold text-xs flex items-center justify-between min-h-[42px]">
                  <span>🔒 {tr(language, 'Masqué (Rôle restreint)', 'Hidden (Restricted role)')}</span>
                  <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                </div>
              </div>
            )}
            <div>
              <label className="font-bold block text-slate-700 dark:text-slate-300 mb-1">
                {t('prod_form_tags_label')}
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="wc, bati, raccord"
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="font-bold block text-slate-700 dark:text-slate-300 mb-1">
              {t('prod_form_desc_label')}
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('prod_form_desc_placeholder')}
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none resize-none"
            />
          </div>

          {/* Location */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-bold block text-slate-700 dark:text-slate-300 text-xs">
                  {t('prod_form_store_label')}
                </label>
                <button
                  type="button"
                  onClick={() => setDepotsModalOpen(true)}
                  className="text-[10px] text-amber-600 dark:text-amber-400 font-bold hover:underline"
                  title={tr(language, 'Gérer les magasins et dépôts', 'Manage stores and depots')}
                >
                  + {t('common_edit')}
                </button>
              </div>
              <select
                value={storeName}
                onChange={(e) => {
                  if (e.target.value === '__MANAGE__') {
                    setDepotsModalOpen(true);
                  } else {
                    setStoreName(e.target.value);
                  }
                }}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-xs font-semibold text-slate-800 dark:text-slate-100"
              >
                {/* Preserve existing custom value if not yet in depots list */}
                {storeName && !depots.some((d) => d.name.toLowerCase() === storeName.toLowerCase()) && (
                  <option value={storeName}>{storeName} ({tr(language, 'Actuel', 'Current')})</option>
                )}
                {depots.map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name} {d.code ? `(${d.code})` : ''}
                  </option>
                ))}
                {depots.length === 0 && (
                  <option value="Dépôt Principal">{t('common_main_depot')}</option>
                )}
                <option value="__MANAGE__" className="text-amber-600 font-bold">
                  {t('prod_form_manage_depots')}
                </option>
              </select>
            </div>
            <div>
              <label className="font-bold block text-slate-700 dark:text-slate-300 mb-1 text-xs">
                {t('prod_form_room_label')}
              </label>
              <input
                type="text"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="Zone Plomberie"
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-xs font-semibold"
              />
            </div>
            <div>
              <label className="font-bold block text-slate-700 dark:text-slate-300 mb-1 text-xs">
                {t('prod_form_shelf_label')}
              </label>
              <input
                type="text"
                value={shelfName}
                onChange={(e) => setShelfName(e.target.value)}
                placeholder="Rack P2"
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-xs font-semibold"
              />
            </div>
          </div>

          {/* Suppliers */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="font-bold block text-slate-700 dark:text-slate-300 mb-1">
                {t('prod_form_supplier1_label')}
              </label>
              <div className="space-y-1">
                <input
                  type="text"
                  value={supplier1Name}
                  onChange={(e) => setSupplier1Name(e.target.value)}
                  placeholder="Nom: CEDEO"
                  className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
                />
                <input
                  type="text"
                  value={refSupplier1}
                  onChange={(e) => setRefSupplier1(e.target.value)}
                  placeholder="Réf Fournisseur 1"
                  className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
                />
              </div>
            </div>
            <div>
              <label className="font-bold block text-slate-700 dark:text-slate-300 mb-1">
                {t('prod_form_supplier2_label')}
              </label>
              <div className="space-y-1">
                <input
                  type="text"
                  value={supplier2Name}
                  onChange={(e) => setSupplier2Name(e.target.value)}
                  placeholder="Nom: CEF"
                  className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
                />
                <input
                  type="text"
                  value={refSupplier2}
                  onChange={(e) => setRefSupplier2(e.target.value)}
                  placeholder="Réf Fournisseur 2"
                  className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
                />
              </div>
            </div>
          </div>

          {/* Stock Levels */}
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <div>
              <label className="font-bold block text-slate-700 dark:text-slate-300 mb-1">
                {t('prod_form_initial_stock')}
              </label>
              <input
                type="number"
                min="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none font-bold"
              />
            </div>
            <div>
              <label className="font-bold block text-slate-700 dark:text-slate-300 mb-1">
                {t('prod_form_min_alert')}
              </label>
              <input
                type="number"
                min="0"
                value={minStockAlert}
                onChange={(e) => setMinStockAlert(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none font-bold text-amber-600"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
            <button
              type="submit"
              disabled={isQuotaReached || !uniquenessCheck.valid}
              className={`flex-1 py-3 px-4 rounded-xl text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md transition active:scale-95 cursor-pointer ${
                isQuotaReached || !uniquenessCheck.valid
                  ? 'bg-slate-400 dark:bg-slate-700 cursor-not-allowed opacity-60 shadow-none'
                  : 'bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 shadow-orange-500/25'
              }`}
            >
              <Save className="w-4 h-4" />
              <span>{isQuotaReached ? t('prod_form_quota_reached') : t('prod_form_save_btn')}</span>
            </button>

            {isEdit && canDelete && (
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(true)}
                className="py-3 px-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 hover:bg-rose-100 text-rose-600 font-bold text-xs flex items-center justify-center gap-1 transition"
                title={t('common_delete')}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={handleRequestClose}
              className="py-3 px-4 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-xs transition"
            >
              {t('common_cancel')}
            </button>
          </div>
        </form>

        {/* Confirmation Modal for Deleting Reference */}
        {confirmDeleteOpen && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-fadeIn">
            <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border-2 border-rose-500/40 p-5 text-slate-800 dark:text-slate-100 text-center animate-scaleIn">
              <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-rose-100 dark:bg-rose-950/80 text-rose-600 flex items-center justify-center shadow-inner">
                <AlertTriangle className="w-7 h-7 text-rose-600 dark:text-rose-400" />
              </div>

              <h3 className="text-base font-black text-slate-900 dark:text-white mb-1">
                {t('prod_form_delete_title')}
              </h3>

              <div className="p-3 my-3 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 text-left">
                <div className="text-xs font-black text-rose-600 dark:text-rose-400">
                  {reference}
                </div>
                <div className="text-xs font-bold text-slate-800 dark:text-slate-100 mt-0.5">
                  {brand} {model}
                </div>
              </div>

              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mb-4">
                ⚠️ {t('prod_form_delete_warning')}
              </p>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteOpen(false)}
                  disabled={isDeleting}
                  className="flex-1 py-2.5 px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  {t('common_cancel')}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (productFormState.product?.id) {
                      setIsDeleting(true);
                      const ok = await deleteProduct(productFormState.product.id);
                      setIsDeleting(false);
                      if (ok) {
                        setConfirmDeleteOpen(false);
                        setProductFormState({ open: false, product: null });
                      }
                    }
                  }}
                  disabled={isDeleting}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-rose-600/30 transition disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{isDeleting ? t('common_loading') : t('prod_form_delete_btn')}</span>
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Quick Barcode / QR Scanner Camera Overlay */}
        {isScanningBarcode && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-fadeIn">
            <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col items-center">
              <div className="w-full flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-orange-100 dark:bg-orange-950 text-orange-600 flex items-center justify-center">
                    {scanTargetField === 'qr_code' ? (
                      <QrCode className="w-4 h-4" />
                    ) : (
                      <Barcode className="w-4 h-4" />
                    )}
                  </div>
                  <h4 className="text-xs font-black text-slate-800 dark:text-slate-100">
                    {scanTargetField === 'qr_code'
                      ? tr(language, 'Scanner le QR Code unique', 'Scan unique QR Code')
                      : t('prod_form_barcode_scan_btn')}
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setScanTargetField(null)}
                  className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-black flex items-center justify-center">
                <video
                  ref={scanVideoRef}
                  className="w-full h-full object-cover"
                  autoPlay
                  playsInline
                  muted
                />
                {/* Aiming Reticle */}
                <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-16 border-2 border-orange-500 rounded-lg pointer-events-none flex items-center justify-center bg-orange-500/10">
                  <div className="w-full h-0.5 bg-red-500 shadow-sm animate-pulse" />
                </div>
              </div>

              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3 text-center">
                {tr(language, 'Pointez la caméra vers le code-barres (EAN-13, Code-128) ou QR code.', 'Point camera at the 1D barcode (EAN-13, Code-128) or QR code.')}
              </p>

              <button
                type="button"
                onClick={() => setScanTargetField(null)}
                className="w-full mt-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                {t('common_cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
