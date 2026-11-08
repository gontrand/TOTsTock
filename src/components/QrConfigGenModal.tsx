import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { generateQrCodeDataUrlWithTotLogo } from '../utils/qrCodeHelper';
import {
  getClientSupabase,
  syncUserProfileAndDirectoryToSupabase,
  mirrorUsersDirectoryToSettings,
  verifyUserPinOrPasswordForKeyReplacement,
} from '../services/clientSupabase';
import { syncLicenseToClientDatabase } from '../services/licenseService';
import { logAuditEventServer } from '../services/auditService';
import { tr } from '../i18n/dutchTranslator';
import { X, QrCode, Download, Printer, AlertTriangle, Lock, EyeOff, ShieldCheck } from 'lucide-react';

export const QR_CONFIG_AUTO_HIDE_SECONDS = 60;

export const QrConfigGenModal: React.FC = () => {
  const {
    qrConfigGenModalOpen,
    setQrConfigGenModalOpen,
    supabaseConfig,
    license,
    currentUser,
    allUsers,
    language,
    t,
  } = useApp();
  const [qrSrc, setQrSrc] = useState<string>('');
  const [pinConfirmed, setPinConfirmed] = useState<boolean>(false);
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [verifyingPin, setVerifyingPin] = useState<boolean>(false);
  const [secondsLeft, setSecondsLeft] = useState<number>(QR_CONFIG_AUTO_HIDE_SECONDS);
  const [qrExpired, setQrExpired] = useState<boolean>(false);

  // Reset confirmation and QR state whenever modal opens or closes
  useEffect(() => {
    if (!qrConfigGenModalOpen) {
      setQrSrc('');
      setPinConfirmed(false);
      setPinInput('');
      setPinError('');
      setQrExpired(false);
      setSecondsLeft(QR_CONFIG_AUTO_HIDE_SECONDS);
    }
  }, [qrConfigGenModalOpen]);

  // Generate QR only AFTER PIN confirmation
  useEffect(() => {
    if (qrConfigGenModalOpen && pinConfirmed && !qrExpired && supabaseConfig?.url && supabaseConfig?.key) {
      const client = getClientSupabase(supabaseConfig.url, supabaseConfig.key);
      if (client) {
        if (license?.license_key && license.license_key !== 'TOT-STOCK-FREE-COMMUNITY') {
          syncLicenseToClientDatabase(license, client).catch(() => {});
        }
        if (currentUser) {
          syncUserProfileAndDirectoryToSupabase(client, currentUser, allUsers).catch(() => {});
        } else if (allUsers && allUsers.length > 0) {
          mirrorUsersDirectoryToSettings(client, allUsers).catch(() => {});
        }
      }

      const payload = JSON.stringify({
        url: supabaseConfig.url,
        key: supabaseConfig.key,
        ...(license?.license_key && license.license_key !== 'TOT-STOCK-FREE-COMMUNITY'
          ? {
              license_key: license.license_key,
              plan_type: license.plan_type,
              max_references: license.max_references,
              max_depots: license.max_depots,
            }
          : {}),
        ...(license?.organization_name ? { org: license.organization_name } : {}),
      });

      generateQrCodeDataUrlWithTotLogo(payload, {
        size: 300,
        margin: 2,
      })
        .then((url) => setQrSrc(url))
        .catch((err) => console.error('Erreur génération QR Code entreprise:', err));
    }
  }, [qrConfigGenModalOpen, pinConfirmed, qrExpired, supabaseConfig, license, currentUser, allUsers]);

  // Auto-hide QR after 60 seconds
  useEffect(() => {
    if (!qrConfigGenModalOpen || !pinConfirmed || qrExpired) return;
    setSecondsLeft(QR_CONFIG_AUTO_HIDE_SECONDS);
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setQrSrc('');
          setPinConfirmed(false);
          setQrExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [qrConfigGenModalOpen, pinConfirmed, qrExpired]);

  // Keyboard shortcut: close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && qrConfigGenModalOpen) {
        setQrConfigGenModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [qrConfigGenModalOpen, setQrConfigGenModalOpen]);

  if (!qrConfigGenModalOpen) return null;

  const handleConfirmPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');
    setVerifyingPin(true);
    try {
      const client =
        supabaseConfig?.url && supabaseConfig?.key
          ? getClientSupabase(supabaseConfig.url, supabaseConfig.key)
          : null;
      const res = await verifyUserPinOrPasswordForKeyReplacement({
        user: currentUser,
        secretInput: pinInput,
        requireAdminRole: false,
        verifyPasswordFn: client
          ? async (email, password) => {
              const { error } = await client.auth.signInWithPassword({ email, password });
              return !error;
            }
          : undefined,
        onAuditLog: () => {
          if (client) {
            logAuditEventServer(client, {
              category: 'SECURITY',
              type: 'QR_CONFIG_DISPLAYED',
              severity: 'WARN',
              title: 'Affichage du QR code de configuration Supabase (masquage auto 60 s)',
              details: { actor_id: currentUser?.id },
            }).catch(() => {});
          }
        },
      });

      if (!res.allowed) {
        setPinError(
          res.message ||
            tr(
              language,
              'Code PIN ou mot de passe incorrect.',
              'Incorrect PIN or password.',
              'Onjuiste pincode of wachtwoord.'
            )
        );
        return;
      }

      setPinInput('');
      setQrExpired(false);
      setPinConfirmed(true);
    } finally {
      setVerifyingPin(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    if (!qrSrc) return;
    const a = document.createElement('a');
    a.href = qrSrc;
    a.download = `qrcode_configuration_entreprise.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const hasConfig = Boolean(supabaseConfig?.url && supabaseConfig?.key);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setQrConfigGenModalOpen(false);
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-3 bg-slate-950/75 backdrop-blur-sm animate-fadeIn"
    >
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 text-slate-800 dark:text-slate-100 max-h-[90dvh] flex flex-col items-center text-center overflow-y-auto">
        <div className="w-full flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 flex items-center justify-center font-bold">
              <QrCode className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-black text-slate-900 dark:text-white">
              {t('qr_title')}
            </h2>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setQrConfigGenModalOpen(false);
            }}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer active:scale-95 shadow-xs shrink-0"
            title={t('common_close')}
            aria-label="Fermer"
          >
            <X className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>

        <div className="my-4 w-full flex flex-col items-center">
          {!hasConfig ? (
            <div className="p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-xs text-center space-y-2">
              <AlertTriangle className="w-6 h-6 mx-auto text-amber-500" />
              <p className="font-bold">{t('qr_no_config_title')}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {t('qr_no_config_desc')}
              </p>
            </div>
          ) : !pinConfirmed ? (
            <form onSubmit={handleConfirmPin} className="w-full space-y-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-left">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
                <Lock className="w-4 h-4 text-purple-600 shrink-0" />
                <span>
                  {tr(
                    language,
                    'Confirmation du PIN requise pour afficher le QR Code',
                    'PIN confirmation required to display QR Code',
                    'Pincode-bevestiging vereist om QR-code te tonen'
                  )}
                </span>
              </div>

              {qrExpired && (
                <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-200 flex items-center gap-1.5 font-semibold">
                  <EyeOff className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {tr(
                      language,
                      'QR code masqué automatiquement après 60 s par sécurité.',
                      'QR code automatically hidden after 60 s for security.',
                      'QR-code automatisch verborgen na 60 s voor de veiligheid.'
                    )}
                  </span>
                </div>
              )}

              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {tr(
                  language,
                  'Ce QR code contient la clé publique de connexion. Saisissez votre code PIN (ou mot de passe) pour le déverrouiller pendant 60 secondes.',
                  'This QR code contains the connection key. Enter your PIN (or password) to unlock it for 60 seconds.',
                  'Deze QR-code bevat de verbindingssleutel. Voer uw pincode (of wachtwoord) in om deze gedurende 60 seconden te tonen.'
                )}
              </p>

              <input
                type="password"
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value);
                  setPinError('');
                }}
                placeholder={tr(language, 'Code PIN ou mot de passe', 'PIN or password', 'Pincode of wachtwoord')}
                autoFocus
                className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-mono outline-none focus:ring-2 focus:ring-purple-500"
              />

              {pinError && (
                <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400">{pinError}</p>
              )}

              <button
                type="submit"
                disabled={verifyingPin}
                className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-50"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>
                  {verifyingPin
                    ? tr(language, 'Vérification...', 'Verifying...', 'Controleren...')
                    : tr(language, 'Afficher le QR Code (60 s)', 'Show QR Code (60 s)', 'QR-code tonen (60 s)')}
                </span>
              </button>
            </form>
          ) : qrSrc ? (
            <div className="flex flex-col items-center space-y-2">
              <div className="p-3 bg-white rounded-2xl border-2 border-slate-200 shadow-md">
                <img src={qrSrc} alt="QR Code Config" className="w-56 h-56 object-contain" />
              </div>
              <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                {tr(
                  language,
                  `Masquage automatique dans ${secondsLeft} s`,
                  `Auto-hiding in ${secondsLeft} s`,
                  `Automatisch verbergen over ${secondsLeft} s`
                )}
              </span>
            </div>
          ) : (
            <div className="w-56 h-56 flex items-center justify-center text-xs text-slate-400">
              {t('qr_generating')}
            </div>
          )}

          <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 px-2">
            {t('qr_scan_instruction')}
          </p>
        </div>

        {hasConfig && pinConfirmed && qrSrc && (
          <div className="w-full flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={handleDownload}
              className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition shadow cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t('qr_download')}</span>
            </button>

            <button
              onClick={handlePrint}
              className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{t('product_print')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
