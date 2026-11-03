import React, { useState, useEffect } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import { hashPin } from '../utils/crypto';
import { X, User, Lock, CheckCircle, Shield, Clock, LogOut, Smartphone, Sparkles, Volume2, VolumeX, Trash2, Scan } from 'lucide-react';
import {
  isScannerSoundEnabled,
  setScannerSoundEnabled,
  isScannerVibrationEnabled,
  setScannerVibrationEnabled,
  triggerScannerFeedback,
} from '../services/orderPickingLogic';
import {
  isVibrationSupported,
  isHapticsEnabled,
  setHapticsEnabled,
  isSoundEnabled,
  setSoundEnabled,
  getHapticIntensity,
  setHapticIntensity,
  HapticIntensity,
  triggerHapticTest,
  triggerSoundTest,
  hapticFeedback,
} from '../utils/haptics';

export const ProfileModal: React.FC = () => {
  const {
    profileModalOpen,
    setProfileModalOpen,
    currentUser,
    updateUserPIN,
    roles,
    autoLogoutMinutes,
    setAutoLogoutMinutes,
    logout,
    wipeDeviceAndSignOut,
    language,
    t,
  } = useApp();

  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmWipeDevice, setConfirmWipeDevice] = useState(false);
  const [wipingDevice, setWipingDevice] = useState(false);
  const [hapticEnabled, setHapticEnabledState] = useState<boolean>(() => isHapticsEnabled());
  const [soundEnabled, setSoundEnabledState] = useState<boolean>(() => isSoundEnabled());
  const [hapticIntensity, setHapticIntensityState] = useState<HapticIntensity>(() => getHapticIntensity());
  const [testedHaptic, setTestedHaptic] = useState(false);
  const [testedSound, setTestedSound] = useState(false);
  const [scannerSoundOn, setScannerSoundOn] = useState<boolean>(() => isScannerSoundEnabled());
  const [scannerVibOn, setScannerVibOn] = useState<boolean>(() => isScannerVibrationEnabled());
  const vibrationSupported = isVibrationSupported();

  useEffect(() => {
    const syncPrefs = () => {
      setHapticEnabledState(isHapticsEnabled());
      setSoundEnabledState(isSoundEnabled());
      setHapticIntensityState(getHapticIntensity());
    };
    window.addEventListener('tot-audio-haptics-changed', syncPrefs);
    return () => window.removeEventListener('tot-audio-haptics-changed', syncPrefs);
  }, []);

  // Keyboard shortcut: close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && profileModalOpen) {
        setProfileModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [profileModalOpen, setProfileModalOpen]);

  if (!profileModalOpen || !currentUser) return null;

  const currentRole = roles.find((r) => Number(r.id) === Number(currentUser.role_id));

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    const res = await updateUserPIN(oldPin, newPin, confirmPin);
    setLoading(false);

    if (res.success) {
      setMsg({
        type: 'success',
        text: res.message || (tr(language, 'Code PIN modifié avec succès !', 'PIN updated successfully!')),
      });
      setOldPin('');
      setNewPin('');
      setConfirmPin('');
      setTimeout(() => {
        setProfileModalOpen(false);
        setMsg(null);
      }, 1500);
    } else {
      setMsg({
        type: 'error',
        text: res.message || (tr(language, 'Erreur lors de la mise à jour.', 'Error during update.')),
      });
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setProfileModalOpen(false);
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-3 bg-slate-950/75 backdrop-blur-sm animate-fadeIn"
    >
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-5 text-slate-800 dark:text-slate-100 max-h-[92dvh] sm:max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-2.5 sm:pb-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 flex items-center justify-center font-bold">
              <User className="w-4 h-4" />
            </div>
            <h2 className="text-base font-black text-slate-900 dark:text-white">
              {t('profile_title')}
            </h2>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setProfileModalOpen(false);
            }}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer active:scale-95 shadow-xs shrink-0"
            title={t('common_close')}
            aria-label="Fermer"
          >
            <X className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto pr-1 py-1">
        {/* User Card */}
        <div className="my-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-orange-500 to-amber-500 text-white font-black text-lg flex items-center justify-center shadow-md">
            {currentUser.trigram}
          </div>
          <div>
            <div className="font-extrabold text-slate-900 dark:text-white text-sm">
              {currentUser.name}
            </div>
            <div className="text-[11px] text-slate-400">
              {currentUser.department || t('common_general')} •{' '}
              <span className="font-semibold text-orange-600">{currentRole?.name}</span>
            </div>
            {currentUser.email && (
              <div className="text-[10px] text-slate-400">{currentUser.email}</div>
            )}
          </div>
        </div>

        {msg && (
          <div
            className={`p-2.5 rounded-xl text-xs font-bold mb-2 flex items-center gap-2 ${
              msg.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 border border-emerald-200 dark:border-emerald-800'
                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 border border-rose-200 dark:border-rose-800'
            }`}
          >
            {msg.type === 'success' && <CheckCircle className="w-4 h-4 shrink-0" />}
            <span>{msg.text}</span>
          </div>
        )}

        {/* Change PIN Form */}
        <form onSubmit={handleChangePin} className="space-y-2.5 text-xs">
          <span className="font-extrabold text-slate-700 dark:text-slate-300 block">
            {t('profile_change_pin')}
          </span>

          <div>
            <label className="block text-[11px] text-slate-500 font-bold mb-0.5">
              {t('profile_old_pin')}
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={oldPin}
              onChange={(e) => setOldPin(e.target.value.replace(/\D/g, ''))}
              required
              className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-center font-bold tracking-widest text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-500 font-bold mb-0.5">
                {t('profile_new_pin')}
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                required
                className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-center font-bold tracking-widest text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 font-bold mb-0.5">
                {t('profile_confirm_pin')}
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                required
                className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-center font-bold tracking-widest text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs transition shadow-md disabled:opacity-50"
          >
            {loading ? t('common_loading') : t('profile_btn_update')}
          </button>
        </form>

        {/* Sound Effects (Beeps) Independent Settings */}
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              {soundEnabled ? (
                <Volume2 className="w-4 h-4 text-orange-500 shrink-0" />
              ) : (
                <VolumeX className="w-4 h-4 text-slate-400 shrink-0" />
              )}
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                {tr(language, 'Sons Interface & Alertes Commandes', 'UI Sounds & Order Alerts')}
              </h4>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-haptic="light"
                onClick={() => {
                  if (!soundEnabled) {
                    setSoundEnabledState(true);
                    setSoundEnabled(true);
                  }
                  triggerSoundTest();
                  setTestedSound(true);
                  setTimeout(() => setTestedSound(false), 1200);
                }}
                className="px-2 py-0.5 text-[10px] font-bold rounded-lg bg-orange-100 hover:bg-orange-200 dark:bg-orange-950/60 dark:hover:bg-orange-900/60 text-orange-700 dark:text-orange-300 transition flex items-center gap-1 cursor-pointer shrink-0"
              >
                <Volume2 className="w-3 h-3 shrink-0" />
                <span>{testedSound ? (tr(language, 'Bip !', 'Beep!')) : (tr(language, 'Tester', 'Test'))}</span>
              </button>
              <button
                type="button"
                data-haptic="light"
                onClick={() => {
                  const nextVal = !soundEnabled;
                  setSoundEnabledState(nextVal);
                  setSoundEnabled(nextVal);
                  if (nextVal) {
                    triggerSoundTest();
                  }
                }}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  soundEnabled ? 'bg-orange-500' : 'bg-slate-300 dark:bg-slate-700'
                }`}
                role="switch"
                aria-checked={soundEnabled}
                title={tr(language, 'Activer ou couper les sons d\'interface et d\'alertes', 'Toggle UI & alert sounds')}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    soundEnabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {tr(language, 'Coupez les sons des touches et des alertes ici. Le bip du Scan / Entrée / Sortie reste toujours actif.', 'Mute button and alert sounds here. The Scan / Stock In / Stock Out beep always remains active.')}
          </p>
        </div>

        {/* Haptic Feedback (Vibrations) Settings */}
        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-orange-500 shrink-0" />
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                {tr(language, 'Retour tactile & Vibrations (Haptique)', 'Haptic Feedback & Vibrations')}
              </h4>
            </div>
            <button
              type="button"
              data-haptic="medium"
              onClick={() => {
                const nextVal = !hapticEnabled;
                setHapticEnabledState(nextVal);
                setHapticsEnabled(nextVal);
                if (nextVal) {
                  triggerHapticTest();
                }
              }}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                hapticEnabled ? 'bg-orange-500' : 'bg-slate-300 dark:bg-slate-700'
              }`}
              role="switch"
              aria-checked={hapticEnabled}
              title={tr(language, 'Activer ou désactiver les vibrations', 'Toggle haptic vibrations')}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  hapticEnabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
            {tr(language, "Vibre lors des scans QR/code-barres et à l'appui sur les boutons tactiles.", 'Vibrates on barcode/QR scans and button presses across the app.')}
          </p>

          {/* Intensity selector */}
          <div className="grid grid-cols-3 gap-1.5 mb-2">
            {(
              [
                { id: 'light' as HapticIntensity, label: tr(language, 'Léger', 'Light') },
                { id: 'normal' as HapticIntensity, label: tr(language, 'Normal', 'Normal') },
                { id: 'strong' as HapticIntensity, label: tr(language, 'Fort (Chantier)', 'Strong') },
              ]
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={!hapticEnabled}
                data-haptic="medium"
                onClick={() => {
                  setHapticIntensityState(opt.id);
                  setHapticIntensity(opt.id);
                  hapticFeedback.medium();
                }}
                className={`py-1 px-2 rounded-lg text-[10px] font-bold border transition cursor-pointer disabled:opacity-40 ${
                  hapticIntensity === opt.id
                    ? 'bg-orange-500 text-white border-orange-500 shadow-xs'
                    : 'bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 bg-slate-50 dark:bg-slate-800/60 p-2 rounded-xl border border-slate-200/70 dark:border-slate-700/60">
            <span className="text-[10px] text-slate-500 dark:text-slate-400">
              {vibrationSupported
                ? (tr(language, '📱 Vibreur matériel + Impulsion active', '📱 Hardware vibration + Tactile pulse active'))
                : (tr(language, '🔊 Impulsion Haptique Audio-Tactile active', '🔊 Audio-Tactile Haptic Pulse active'))}
            </span>
            <button
              type="button"
              disabled={!hapticEnabled}
              data-haptic="scan"
              onClick={() => {
                triggerHapticTest();
                setTestedHaptic(true);
                setTimeout(() => setTestedHaptic(false), 1200);
              }}
              className="px-2.5 py-1 text-[10px] font-bold rounded-lg bg-orange-100 hover:bg-orange-200 dark:bg-orange-950/60 dark:hover:bg-orange-900/60 text-orange-700 dark:text-orange-300 transition flex items-center gap-1 disabled:opacity-40 cursor-pointer shrink-0"
            >
              <Sparkles className="w-3 h-3 shrink-0" />
              <span>{testedHaptic ? (tr(language, 'Vibration !', 'Buzz!')) : (tr(language, 'Tester', 'Test'))}</span>
            </button>
          </div>
        </div>

        {/* Scanner Mode Sound & Vibration Per-Device Settings */}
        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 mb-1">
            <Scan className="w-4 h-4 text-emerald-600 shrink-0" />
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
              {t('profile_scanner_settings_title')}
            </h4>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
            {t('profile_scanner_settings_desc')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                const next = !scannerSoundOn;
                setScannerSoundOn(next);
                setScannerSoundEnabled(next);
                if (next) triggerScannerFeedback('success');
              }}
              className={`p-2 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                scannerSoundOn
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200'
                  : 'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              <span className="text-[11px] font-bold">{t('profile_scanner_sound')}</span>
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${scannerSoundOn ? 'bg-emerald-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                {scannerSoundOn ? 'ON' : 'OFF'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                const next = !scannerVibOn;
                setScannerVibOn(next);
                setScannerVibrationEnabled(next);
                if (next) triggerScannerFeedback('success');
              }}
              className={`p-2 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                scannerVibOn
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200'
                  : 'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              <span className="text-[11px] font-bold">{t('profile_scanner_vibration')}</span>
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${scannerVibOn ? 'bg-emerald-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                {scannerVibOn ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>
        </div>

        {/* Inactivity Auto-logout Settings */}
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-orange-500" />
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
              {t('profile_auto_logout')}
            </h4>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
            {tr(language, 'Verrouille la session après une période sans interaction sur cet appareil.', 'Locks session after a period of inactivity on this device.')}
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { label: '1 min', val: 1 },
              { label: '3 min', val: 3 },
              { label: '5 min', val: 5 },
              { label: '10 min', val: 10 },
              { label: '15 min', val: 15 },
              { label: tr(language, 'Désactivé', 'Disabled'), val: 0 },
            ].map((opt) => (
              <button
                key={opt.val}
                type="button"
                onClick={() => setAutoLogoutMinutes(opt.val)}
                className={`py-1.5 px-2 rounded-lg text-xs font-semibold border transition ${
                  autoLogoutMinutes === opt.val
                    ? 'bg-orange-500 text-white border-orange-500 shadow-sm'
                    : 'bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="mt-2 text-[10px] text-right text-slate-400">
            {autoLogoutMinutes === 0
              ? (tr(language, '⚠️ Aucune déconnexion automatique', '⚠️ No auto logout'))
              : `${tr(language, 'Actif : Déconnexion après', 'Active: Logout after')} ${autoLogoutMinutes} min`}
          </div>
        </div>

        </div>

        {/* Quick Logout & Wipe Device Buttons */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 shrink-0 space-y-2">
          <button
            type="button"
            onClick={() => {
              setProfileModalOpen(false);
              logout();
            }}
            className="w-full py-2.5 px-4 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 font-bold text-xs flex items-center justify-center gap-2 border border-rose-200 dark:border-rose-900/50 transition cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>{t('profile_logout_btn')}</span>
          </button>

          {!confirmWipeDevice ? (
            <button
              type="button"
              onClick={() => setConfirmWipeDevice(true)}
              className="w-full py-2 px-3 rounded-xl bg-slate-100 hover:bg-rose-100 dark:bg-slate-800 dark:hover:bg-rose-950/60 text-slate-700 hover:text-rose-700 dark:text-slate-300 dark:hover:text-rose-300 font-bold text-[11px] flex items-center justify-center gap-2 border border-slate-200 dark:border-slate-700 transition cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              <span>{t('profile_wipe_device_btn')}</span>
            </button>
          ) : (
            <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 space-y-2">
              <p className="text-[11px] font-semibold text-rose-800 dark:text-rose-200 leading-snug">
                {t('profile_wipe_device_confirm')}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={wipingDevice}
                  onClick={() => setConfirmWipeDevice(false)}
                  className="flex-1 py-1.5 px-2 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-bold text-[11px] cursor-pointer"
                >
                  {t('common_cancel')}
                </button>
                <button
                  type="button"
                  disabled={wipingDevice}
                  onClick={async () => {
                    setWipingDevice(true);
                    await wipeDeviceAndSignOut();
                  }}
                  className="flex-1 py-1.5 px-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] cursor-pointer disabled:opacity-50"
                >
                  {wipingDevice ? t('common_loading') : t('profile_wipe_device_btn')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
