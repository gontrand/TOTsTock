import React, { useEffect, useRef, useState, useCallback } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import {
  playScanBeep,
  isDepotClosed,
  canUserBorrowFromDepot,
  canUserEnterStockInDepot,
} from '../utils/crypto';
import jsQR from 'jsqr';
import {
  decodeBarcodeFromCanvas,
  openSmartphoneCameraStream,
  stopSmartphoneCameraStream,
  attachStreamToVideoElement,
  decodeCodeFromImageFile,
} from '../utils/qrCodeHelper';
import {
  X,
  Camera,
  CameraOff,
  ArrowRight,
  Barcode,
  QrCode,
  RefreshCw,
  Image as ImageIcon,
  SwitchCamera,
  Volume2,
  Smartphone,
} from 'lucide-react';
import {
  isHapticsEnabled,
  setHapticsEnabled,
  triggerHapticTest,
} from '../utils/haptics';

export const ScannerModal: React.FC = () => {
  const {
    scanState,
    setScanState,
    products,
    depots,
    departments,
    users,
    currentUser,
    setActiveProductId,
    addToCart,
    setBatchCartModalOpen,
    setPendingScannedConfig,
    setCompanySetupModalOpen,
    userHasPermission,
    logActivity,
    language,
    t,
  } = useApp();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraSessionIdRef = useRef<number>(0);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraErrorDetail, setCameraErrorDetail] = useState<string | null>(null);
  const [isStartingCamera, setIsStartingCamera] = useState<boolean>(false);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceIndex, setSelectedDeviceIndex] = useState<number>(0);
  const [manualCode, setManualCode] = useState('');
  const [scannedAlert, setScannedAlert] = useState<string | null>(null);
  const [hapticsOn, setHapticsOn] = useState<boolean>(() => isHapticsEnabled());
  const isCooldownRef = useRef(false);

  useEffect(() => {
    const syncPrefs = () => {
      setHapticsOn(isHapticsEnabled());
    };
    window.addEventListener('tot-audio-haptics-changed', syncPrefs);
    return () => window.removeEventListener('tot-audio-haptics-changed', syncPrefs);
  }, []);

  const stopCamera = useCallback((forceKillGlobal: boolean = false) => {
    cameraSessionIdRef.current += 1;
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      } catch {}
    }
    if (forceKillGlobal) {
      stopSmartphoneCameraStream(streamRef.current, true);
    }
    streamRef.current = null;
  }, []);

  const handleDetectedCode = useCallback(
    (scannedText: string) => {
      if (isCooldownRef.current) return;
      isCooldownRef.current = true;

      const raw = scannedText.trim();
      const cleanRef = raw.includes(' - ') ? raw.split(' - ')[0].trim() : raw;

      // Handle config scan mode: NEVER save automatically. Pre-fill the form and require user confirmation.
      if (scanState.mode === 'CONFIG_SCAN') {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.url && parsed.key) {
            playScanBeep(true);
            setPendingScannedConfig({
              url: String(parsed.url),
              key: String(parsed.key),
              license_key: parsed.license_key ? String(parsed.license_key) : undefined,
            });
            logActivity({
              type: 'SCAN_CONFIG',
              category: 'SCANS',
              title: tr(language, 'QR Code Configuration lu', 'Company Config QR Read'),
              description: "Paramètres pré-remplis en attente de confirmation de l'adresse du serveur",
              user_name: currentUser?.name || 'Administrateur',
              user_trigram: currentUser?.trigram || 'ADM',
              meta: { status: 'info' },
            });
            setScannedAlert(t('scan_config_success'));
            setTimeout(() => {
              stopCamera(true);
              setScanState({ open: false, mode: 'OUT' });
              setCompanySetupModalOpen(true);
            }, 600);
            return;
          }
        } catch {
          playScanBeep(false);
          setScannedAlert(t('scan_config_invalid'));
          setTimeout(() => {
            isCooldownRef.current = false;
            setScannedAlert(null);
          }, 1500);
          return;
        }
      }

      // Find product (by exact ID, reference, QR code, OEM ref, or registered 1D barcode first)
      const targetClean = cleanRef.toLowerCase();
      const targetRaw = raw.toLowerCase();

      const prod =
        products.find((p) => {
          const pId = String(p.id ?? '').trim().toLowerCase();
          const pRef = String(p.reference ?? '').trim().toLowerCase();
          const pQr = p.qr_code ? String(p.qr_code).trim().toLowerCase() : '';
          const pOem = p.manufacturer_ref ? String(p.manufacturer_ref).trim().toLowerCase() : '';
          const pBarcode = p.barcode ? String(p.barcode).trim().toLowerCase() : '';
          return (
            pId === targetClean ||
            pRef === targetClean ||
            (pQr && (pQr === targetClean || pQr === targetRaw)) ||
            (pOem && (pOem === targetClean || pOem === targetRaw)) ||
            (pBarcode && (pBarcode === targetClean || pBarcode === targetRaw))
          );
        }) ||
        products.find((p) => {
          const pRef = String(p.reference ?? '').trim().toLowerCase();
          return Boolean(pRef && targetRaw.includes(pRef));
        });

      if (!prod) {
        logActivity({
          type: 'SCAN_NOT_FOUND',
          category: 'SCANS',
          title: tr(language, 'Scan : Référence Inconnue', 'Scan: Unknown Reference'),
          description: `Code scanné introuvable : "${cleanRef}"`,
          user_name: currentUser?.name || 'Opérateur',
          user_trigram: currentUser?.trigram || 'OP',
          meta: {
            scannedCode: raw,
            scanFormat: /^\d{8,14}$/.test(raw) ? 'Code-barres 1D' : 'QR Code',
            scanMode: scanState.mode,
            status: 'warning',
          },
        });
        setScannedAlert(`${t('scanner_not_found')} : "${cleanRef}"`);
        playScanBeep(false);
        setTimeout(() => {
          isCooldownRef.current = false;
          setScannedAlert(null);
        }, 1500);
        return;
      }

      // Check if depot is closed or inactive
      isDepotClosed(depots, prod.store_name);

      // In OUT mode: validate vehicle borrow rule (only assigned driver and binômes) and general depot permissions
      if (scanState.mode === 'OUT') {
        const borrowCheck = canUserBorrowFromDepot(
          currentUser,
          prod.store_name,
          depots,
          language,
          departments,
          users
        );
        if (!borrowCheck.allowed) {
          setScannedAlert(borrowCheck.reason || t('common_error'));
          playScanBeep(false);
          setTimeout(() => {
            isCooldownRef.current = false;
            setScannedAlert(null);
          }, 3500);
          return;
        }
      }

      // In IN mode: validate vehicle stock entry rule
      if (scanState.mode === 'IN') {
        const hasGeneralStockIn = userHasPermission('perm_stock_in');
        const entryCheck = canUserEnterStockInDepot(
          currentUser,
          prod.store_name,
          depots,
          hasGeneralStockIn,
          language
        );
        if (!entryCheck.allowed) {
          setScannedAlert(entryCheck.reason || t('common_error'));
          playScanBeep(false);
          setTimeout(() => {
            isCooldownRef.current = false;
            setScannedAlert(null);
          }, 3500);
          return;
        }
      }

      playScanBeep(true);
      logActivity({
        type: 'SCAN_FOUND',
        category: 'SCANS',
        title: tr(language, 'Scan Code Référence', 'Code Scanned'),
        description: `${prod.brand} ${prod.model} (${prod.reference})`,
        user_name: currentUser?.name || 'Opérateur',
        user_trigram: currentUser?.trigram || 'OP',
        product_id: prod.id,
        product_ref: prod.reference,
        depot_name: prod.store_name,
        meta: {
          scannedCode: raw,
          scanFormat: /^\d{8,14}$/.test(raw) ? 'Code-barres EAN/1D' : 'QR Code',
          scanMode: scanState.mode,
          status: 'success',
          deviceInfo: 'Caméra Viseur Live',
        },
      });

      setScannedAlert(`${t('scan_found_msg')} ${prod.brand} ${prod.model} (${prod.reference})`);

      setTimeout(() => {
        stopCamera(true);
        setScanState({ open: false, mode: scanState.mode });

        if (scanState.mode === 'SEARCH') {
          setActiveProductId(prod.id);
        } else {
          addToCart(prod, 1);
          setBatchCartModalOpen(true);
        }
      }, 500);
    },
    [
      scanState.mode,
      products,
      setPendingScannedConfig,
      stopCamera,
      setScanState,
      setCompanySetupModalOpen,
      setActiveProductId,
      addToCart,
      setBatchCartModalOpen,
      depots,
      departments,
      users,
      userHasPermission,
      currentUser,
      language,
      logActivity,
      t,
    ]
  );

  // Keep a stable ref to handleDetectedCode so camera stream never restarts on context re-renders
  const handleDetectedCodeRef = useRef(handleDetectedCode);
  useEffect(() => {
    handleDetectedCodeRef.current = handleDetectedCode;
  }, [handleDetectedCode]);

  const startCamera = useCallback(
    async (preferredDeviceId?: string) => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if ( preferredDeviceId && streamRef.current) {
        stopSmartphoneCameraStream(streamRef.current, true);
        streamRef.current = null;
      }

      const sessionId = ++cameraSessionIdRef.current;
      setCameraError(null);
      setCameraErrorDetail(null);
      setIsStartingCamera(true);
      isCooldownRef.current = false;

      try {
        const stream = await openSmartphoneCameraStream(preferredDeviceId);

        // If modal closed or another camera session started while awaiting getUserMedia, abort cleanly
        if (sessionId !== cameraSessionIdRef.current) {
          return;
        }

        streamRef.current = stream;

        // Populate available video devices for lens switching
        if (navigator.mediaDevices?.enumerateDevices) {
          navigator.mediaDevices
            .enumerateDevices()
            .then((devices) => {
              const vDevs = devices.filter((d) => d.kind === 'videoinput' && d.deviceId);
              if (vDevs.length > 1) {
                setVideoDevices(vDevs);
              }
            })
            .catch(() => {});
        }

        if (videoRef.current) {
          await attachStreamToVideoElement(videoRef.current, stream);

          if (sessionId !== cameraSessionIdRef.current) {
            return;
          }

          const hasNativeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;
          let nativeDetector: any = null;
          if (hasNativeDetector) {
            try {
              nativeDetector = new (window as any).BarcodeDetector({
                formats: [
                  'qr_code',
                  'ean_13',
                  'ean_8',
                  'code_128',
                  'code_39',
                  'upc_a',
                  'upc_e',
                  'itf',
                ],
              });
            } catch {
              nativeDetector = null;
            }
          }

          const tick = async () => {
            if (
              sessionId !== cameraSessionIdRef.current ||
              !streamRef.current ||
              !videoRef.current
            ) {
              return;
            }
            const video = videoRef.current;
            const canvas = canvasRef.current;

            if (video.readyState >= 2 && video.videoWidth > 0 && canvas && !isCooldownRef.current) {
              if (nativeDetector) {
                try {
                  const barcodes = await nativeDetector.detect(video);
                  if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                    handleDetectedCodeRef.current(barcodes[0].rawValue);
                    return;
                  }
                } catch {}
              }

              if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
              }

              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

                const code = jsQR(imgData.data, imgData.width, imgData.height, {
                  inversionAttempts: 'dontInvert',
                });

                if (code && code.data) {
                  handleDetectedCodeRef.current(code.data);
                  return;
                }

                const barcodeText = decodeBarcodeFromCanvas(canvas);
                if (barcodeText) {
                  handleDetectedCodeRef.current(barcodeText);
                  return;
                }
              }
            }

            if (sessionId === cameraSessionIdRef.current) {
              animFrameRef.current = requestAnimationFrame(tick);
            }
          };

          animFrameRef.current = requestAnimationFrame(tick);
        }
      } catch (err: any) {
        if (sessionId !== cameraSessionIdRef.current) {
          return;
        }
        console.warn('Camera stream error:', err);
        setCameraError(t('scan_camera_error'));
        const errInfo = err?.name ? `${err.name}${err.message ? ': ' + err.message : ''}` : String(err || '');
        if (errInfo) {
          setCameraErrorDetail(errInfo);
        }
      } finally {
        if (sessionId === cameraSessionIdRef.current) {
          setIsStartingCamera(false);
        }
      }
    },
    [t]
  );

  const handleSwitchCameraLens = () => {
    if (videoDevices.length <= 1) {
      startCamera();
      return;
    }
    const nextIdx = (selectedDeviceIndex + 1) % videoDevices.length;
    setSelectedDeviceIndex(nextIdx);
    startCamera(videoDevices[nextIdx].deviceId);
  };

  // Start/stop camera when scanState.open changes
  useEffect(() => {
    if (scanState.open) {
      startCamera();
    } else {
      stopCamera(true);
    }

    return () => {
      stopCamera(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanState.open]);

  if (!scanState.open) return null;

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualCode.trim()) {
      handleDetectedCode(manualCode.trim());
      setManualCode('');
    }
  };

  const handleNativePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const decoded = await decodeCodeFromImageFile(file);
    e.target.value = '';
    if (decoded) {
      handleDetectedCode(decoded);
    } else {
      playScanBeep(false);
      setScannedAlert(
        tr(language, 'Aucun QR code ou code-barres détecté sur la photo. Rapprochez-vous ou saisissez le code.', 'No QR code or barcode detected in photo.')
      );
      setTimeout(() => setScannedAlert(null), 2500);
    }
  };

  const modeTitle =
    scanState.mode === 'SEARCH'
      ? t('scan_title_search')
      : scanState.mode === 'IN'
      ? t('scan_title_in')
      : scanState.mode === 'CONFIG_SCAN'
      ? t('scan_title_config')
      : t('scan_title_out');

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-3 bg-slate-950/85 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-slate-800 dark:text-slate-100 max-h-[94dvh] sm:max-h-[92vh] flex flex-col overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-orange-500 text-white flex items-center justify-center font-bold">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900 dark:text-white leading-tight">
                {modeTitle}
              </h2>
              <p className="text-[10px] text-slate-400">{t('scan_point_camera')}</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              data-haptic="light"
              onClick={() => playScanBeep(true)}
              title={
                tr(language, 'Bip du Scan / Entrée / Sortie toujours actif (cliquer pour tester)', 'Scan / Stock In / Stock Out beep always active (click to test)')
              }
              className="px-2 h-8 rounded-full flex items-center gap-1 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 text-[10px] font-black transition cursor-pointer"
            >
              <Volume2 className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden xs:inline">{tr(language, 'Bip Actif', 'Beep ON')}</span>
            </button>
            <button
              type="button"
              data-haptic="light"
              onClick={() => {
                const next = !hapticsOn;
                setHapticsOn(next);
                setHapticsEnabled(next);
                if (next) triggerHapticTest();
              }}
              title={
                hapticsOn
                  ? tr(language, 'Désactiver le vibreur', 'Disable vibration')
                  : tr(language, 'Activer le vibreur', 'Enable vibration')
              }
              className={`w-8 h-8 rounded-full flex items-center justify-center transition cursor-pointer ${
                hapticsOn
                  ? 'bg-orange-100 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-600'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
            </button>
            {videoDevices.length > 1 && (
              <button
                type="button"
                onClick={handleSwitchCameraLens}
                title={tr(language, 'Changer de capteur caméra', 'Switch camera lens')}
                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-orange-500 transition cursor-pointer"
              >
                <SwitchCamera className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => startCamera()}
              title={tr(language, 'Relancer la caméra', 'Restart camera')}
              className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-orange-500 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isStartingCamera ? 'animate-spin text-orange-500' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => {
                stopCamera(true);
                setScanState({ open: false, mode: scanState.mode });
              }}
              className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Video Scanner Box - Always keep <video> mounted in DOM */}
        <div className="relative w-full h-56 bg-black rounded-2xl overflow-hidden my-2.5 shadow-inner flex items-center justify-center">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Target frame */}
          {!cameraError && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-40 h-40 border-2 border-orange-500 rounded-2xl relative shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]">
                {/* Animated laser line */}
                <div className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-red-500 to-transparent animate-pulse shadow-sm shadow-red-500 top-1/2 -translate-y-1/2" />
                <div className="absolute -top-1 -left-1 w-4 h-4 border-t-4 border-l-4 border-orange-400 rounded-tl" />
                <div className="absolute -top-1 -right-1 w-4 h-4 border-t-4 border-r-4 border-orange-400 rounded-tr" />
                <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-4 border-l-4 border-orange-400 rounded-bl" />
                <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-4 border-r-4 border-orange-400 rounded-br" />
              </div>
            </div>
          )}

          {/* Camera Error Overlay with Retry & Native Camera Fallback */}
          {cameraError && (
            <div className="absolute inset-0 bg-slate-950/95 p-4 flex flex-col items-center justify-center text-center text-slate-300 space-y-2">
              <CameraOff className="w-7 h-7 text-amber-500" />
              <p className="text-[11px] leading-snug text-slate-300">{cameraError}</p>
              {cameraErrorDetail && (
                <p className="text-[9px] font-mono text-amber-400/90 bg-slate-900 px-2 py-0.5 rounded border border-slate-800 max-w-full truncate">
                  {cameraErrorDetail}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => startCamera()}
                  className="px-3 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-[11px] flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>{tr(language, 'Relancer la caméra', 'Retry camera')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>{tr(language, 'Appareil photo natif', 'Native camera')}</span>
                </button>
              </div>
            </div>
          )}

          {/* Feedback Toast */}
          {scannedAlert && (
            <div className="absolute bottom-2 inset-x-2 p-2 rounded-xl bg-slate-900/90 text-white text-xs font-bold text-center border border-orange-500/50 shadow-lg animate-bounce">
              {scannedAlert}
            </div>
          )}
        </div>

        {/* Always-accessible Native Smartphone Camera Capture Button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full mb-2 py-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-bold text-[11px] flex items-center justify-center gap-1.5 transition cursor-pointer"
        >
          <Camera className="w-3.5 h-3.5 text-orange-500" />
          <span>
            {tr(language, 'Scanner via appareil photo natif du smartphone', 'Scan with native smartphone camera')}
          </span>
        </button>

        {/* Hidden Native Camera Input Fallback */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleNativePhotoCapture}
          className="hidden"
        />

        {/* Manual Code Entry Form */}
        <form onSubmit={handleManualSubmit} className="flex gap-1.5 mb-2">
          <input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder={t('scan_manual_placeholder')}
            className="flex-1 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-orange-500"
          />
          <button
            type="submit"
            className="px-3 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs flex items-center gap-1 shrink-0 cursor-pointer"
          >
            <span>{t('scan_test_btn')}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>

        {/* Quick Demo Simulator Shortcuts */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
            {t('scan_test_shortcuts')}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {products.slice(0, 3).map((p) => (
              <React.Fragment key={p.id}>
                <button
                  type="button"
                  onClick={() => handleDetectedCode(p.reference)}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-orange-50 dark:hover:bg-orange-950/40 hover:text-orange-600 text-[11px] font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition flex items-center gap-1 cursor-pointer"
                >
                  <QrCode className="w-3 h-3 text-orange-500" />
                  <span>{p.reference}</span>
                </button>
                {p.barcode && (
                  <button
                    type="button"
                    onClick={() => handleDetectedCode(p.barcode!)}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-orange-50 dark:hover:bg-orange-950/40 hover:text-orange-600 text-[11px] font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition flex items-center gap-1 cursor-pointer"
                  >
                    <Barcode className="w-3 h-3 text-emerald-500" />
                    <span>{p.barcode}</span>
                  </button>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            stopCamera(true);
            setScanState({ open: false, mode: scanState.mode });
          }}
          className="w-full mt-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
        >
          {t('common_close')}
        </button>
      </div>
    </div>
  );
};
