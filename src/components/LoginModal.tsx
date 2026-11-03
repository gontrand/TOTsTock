import React, { useState, useMemo, useEffect } from 'react';
import { tr } from '../i18n/dutchTranslator';
import { useApp } from '../context/AppContext';
import {
  Lock,
  Building2,
  KeyRound,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  X,
  Shield,
  Smartphone,
  Mail,
  Send,
} from 'lucide-react';
import { hasLocalDevicePin } from '../utils/crypto';

export const LoginModal: React.FC = () => {
  const {
    users,
    allUsers,
    loginModalOpen,
    setLoginModalOpen,
    login,
    resetUserPinOnLogin,
    requestPasswordReset,
    verifyPasswordResetOtp,
    passwordRecoveryMode,
    setPasswordRecoveryMode,
    setCompanySetupModalOpen,
    currentUser,
    isSupabaseConnected,
    syncFromSupabase,
    language,
    t,
  } = useApp();

  const [email, setEmail] = useState<string>(() => {
    try {
      return localStorage.getItem('tot_last_login_email') || '';
    } catch {
      return '';
    }
  });
  const [password, setPassword] = useState<string>('');
  const [authMode, setAuthMode] = useState<'password' | 'pin'>('password');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  // Forgot password view states
  const [forgotPasswordMode, setForgotPasswordMode] = useState<boolean>(false);
  const [resetEmailSent, setResetEmailSent] = useState<boolean>(false);
  const [recoveryCode, setRecoveryCode] = useState<string>('');
  const [recoveryNewPassword, setRecoveryNewPassword] = useState<string>('');
  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState<string>('');

  // Forced password reset state when user.must_change_pin is true or when returning from email recovery link
  const [mustResetPinUser, setMustResetPinUser] = useState<any | null>(null);
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');

  // Auto-sync company settings & license when LoginModal opens and DB is connected
  useEffect(() => {
    if (loginModalOpen && isSupabaseConnected) {
      syncFromSupabase().catch(() => {});
    }
  }, [loginModalOpen, isSupabaseConnected, syncFromSupabase]);

  const directoryUsers = useMemo(() => {
    return allUsers && allUsers.length > 0 ? allUsers : users;
  }, [allUsers, users]);

  // Match typed email to a user in directory to check if a local device PIN exists on this device
  const matchedUserByEmail = useMemo(() => {
    const clean = email.trim().toLowerCase();
    if (!clean || !clean.includes('@')) return null;
    return (
      directoryUsers.find((u) => u.email && u.email.trim().toLowerCase() === clean) || null
    );
  }, [directoryUsers, email]);

  const hasLocalPin = useMemo(() => {
    if (!matchedUserByEmail) return false;
    return hasLocalDevicePin(matchedUserByEmail.id);
  }, [matchedUserByEmail]);

  useEffect(() => {
    if (!hasLocalPin && authMode === 'pin') {
      setAuthMode('password');
    }
  }, [hasLocalPin, authMode]);

  if (!loginModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmail = email.trim().toLowerCase();

    if (!targetEmail || !targetEmail.includes('@')) {
      setErrorMsg(
        tr(language, 'Veuillez saisir une adresse e-mail valide.', 'Please enter a valid email address.')
      );
      return;
    }
    if (!password.trim()) {
      setErrorMsg(
        authMode === 'pin'
          ? tr(language, 'Veuillez saisir votre code PIN de déverrouillage local.', 'Please enter your local unlock PIN.')
          : tr(language, 'Veuillez saisir votre mot de passe.', 'Please enter your password.')
      );
      return;
    }

    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    const isLocalUnlock = authMode === 'pin' && hasLocalPin;
    const res = await login(targetEmail, password, isLocalUnlock);
    setLoading(false);

    if (res.requirePinReset && res.user) {
      setMustResetPinUser(res.user);
      setNewPassword('');
      setConfirmPassword('');
      setErrorMsg('');
      return;
    }

    if (!res.success) {
      setErrorMsg(
        res.message ||
          (authMode === 'pin'
            ? 'Code de déverrouillage local incorrect.'
            : 'Identifiants de connexion incorrects.')
      );
    } else {
      setPassword('');
    }
  };

  const handleRequestForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmail = email.trim().toLowerCase();
    if (!targetEmail || !targetEmail.includes('@')) {
      setErrorMsg(
        tr(language, 'Veuillez saisir votre adresse e-mail professionnelle.', 'Please enter your work email address.')
      );
      return;
    }

    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    const res = await requestPasswordReset(targetEmail);
    setLoading(false);

    if (!res.success) {
      setErrorMsg(res.message);
    } else {
      setSuccessMsg(res.message);
      setResetEmailSent(true);
    }
  };

  const handleVerifyRecoveryCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmail = email.trim().toLowerCase();
    if (recoveryNewPassword.length < 6) {
      setErrorMsg(
        tr(language, 'Le nouveau mot de passe doit comporter au moins 6 caractères.', 'New password must be at least 6 characters.')
      );
      return;
    }
    if (recoveryNewPassword !== recoveryConfirmPassword) {
      setErrorMsg(
        tr(language, 'Les deux mots de passe ne correspondent pas.', 'Passwords do not match.')
      );
      return;
    }

    setLoading(true);
    setErrorMsg('');
    const res = await verifyPasswordResetOtp(targetEmail, recoveryCode, recoveryNewPassword);
    setLoading(false);

    if (!res.success) {
      setErrorMsg(res.message);
    } else {
      setForgotPasswordMode(false);
      setResetEmailSent(false);
      setRecoveryCode('');
      setRecoveryNewPassword('');
      setRecoveryConfirmPassword('');
      setPassword('');
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      setErrorMsg(
        tr(language, 'Le mot de passe doit comporter au moins 6 caractères.', 'Password must be at least 6 characters.')
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg(
        tr(language, 'Les deux mots de passe ne correspondent pas.', 'Passwords do not match.')
      );
      return;
    }

    setLoading(true);
    setErrorMsg('');
    const targetId = mustResetPinUser ? mustResetPinUser.id : 'RECOVERY';
    const res = await resetUserPinOnLogin(targetId, newPassword);
    setLoading(false);

    if (!res.success) {
      setErrorMsg(
        res.message ||
          (tr(language, 'Erreur mise à jour du mot de passe.', 'Error updating password.'))
      );
    } else {
      setMustResetPinUser(null);
      setPasswordRecoveryMode(false);
      setNewPassword('');
      setConfirmPassword('');
    }
  };

  const handleQuickDemoAdmin = () => {
    setForgotPasswordMode(false);
    setResetEmailSent(false);
    setErrorMsg('');
    setSuccessMsg('');
    setEmail('admin@tot-stock.app');
    setAuthMode('password');
    setPassword('admin1234');
  };

  const isSettingNewPasswordView = Boolean(mustResetPinUser || passwordRecoveryMode);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-slate-800 dark:text-slate-100 max-h-[94dvh] sm:max-h-[92vh] overflow-y-auto relative">
        {/* Navigation Bar to Return to Welcome Screen */}
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={() => {
              if (forgotPasswordMode) {
                setForgotPasswordMode(false);
                setResetEmailSent(false);
                setErrorMsg('');
                setSuccessMsg('');
              } else {
                setLoginModalOpen(false);
              }
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-orange-600 dark:hover:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/30 transition cursor-pointer"
            title={t('login_back_welcome')}
          >
            <ArrowLeft className="w-4 h-4" />
            <span>
              {forgotPasswordMode
                ? tr(language, 'Retour à la connexion', 'Back to sign in')
                : t('login_back_welcome')}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setLoginModalOpen(false)}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            title={t('common_close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="text-center mb-5">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-600 text-white shadow-lg shadow-orange-500/30 mb-3">
            {forgotPasswordMode || isSettingNewPasswordView ? (
              <KeyRound className="w-7 h-7" />
            ) : (
              <Lock className="w-7 h-7" />
            )}
          </div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
            {forgotPasswordMode
              ? tr(language, 'Mot de passe oublié', 'Forgot Password')
              : t('login_secure_title')}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            TOT - Inventory &amp; Scan Edition
          </p>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 flex flex-col gap-2 text-xs text-red-600 dark:text-red-400">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="flex-1">{errorMsg}</span>
            </div>
            {(errorMsg.includes('Failed to fetch') ||
              errorMsg.includes('Supabase') ||
              errorMsg.includes('réseau')) && (
              <div className="pt-1 flex flex-col gap-1.5 border-t border-red-200/60 dark:border-red-900/60">
                <button
                  type="button"
                  onClick={() => {
                    setLoginModalOpen(false);
                    setCompanySetupModalOpen(true);
                  }}
                  className="w-full py-1.5 px-3 rounded-lg bg-white dark:bg-red-950/80 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 font-bold text-[11px] flex items-center justify-center gap-1.5 hover:bg-red-100 dark:hover:bg-red-900/50 transition cursor-pointer"
                >
                  <Building2 className="w-3.5 h-3.5 text-orange-500" />
                  <span>
                    {tr(language, '⚙️ Modifier l\'URL Supabase dans "Configurer Entreprise"', '⚙️ Configure Supabase URL')}
                  </span>
                </button>
              </div>
            )}
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 flex items-start gap-2.5 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
            <span className="flex-1">{successMsg}</span>
          </div>
        )}

        {isSettingNewPasswordView ? (
          <div className="space-y-4 animate-fadeIn">
            <div className="text-center mb-3">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                {mustResetPinUser
                  ? tr(language, 'Renouvellement obligatoire du mot de passe', 'Mandatory Password Reset')
                  : tr(language, 'Définir votre nouveau mot de passe', 'Set Your New Password')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {mustResetPinUser
                  ? tr(language, `Bonjour ${mustResetPinUser.name}, pour des raisons de sécurité, veuillez définir votre nouveau mot de passe secret (min. 6 caractères) avant de continuer.`, `Hello ${mustResetPinUser.name}, please choose a new secure password (min. 6 chars) before proceeding.`)
                  : tr(language, 'Choisissez un nouveau mot de passe sécurisé (minimum 6 caractères) pour votre compte.', 'Choose a new secure password (at least 6 characters) for your account.')}
              </p>
            </div>

            <form onSubmit={handleResetPasswordSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                  <span>
                    {tr(language, 'Nouveau mot de passe (min. 6 caractères)', 'New password (min. 6 chars)')}
                  </span>
                </label>
                <input
                  type="password"
                  minLength={6}
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoFocus
                  required
                  className="w-full px-3 py-2.5 text-base font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  <span>
                    {tr(language, 'Confirmer le nouveau mot de passe', 'Confirm new password')}
                  </span>
                </label>
                <input
                  type="password"
                  minLength={6}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 text-base font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition"
                />
              </div>

              <button
                type="submit"
                disabled={loading || newPassword.length < 6 || confirmPassword.length < 6}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-bold text-sm shadow-md shadow-orange-500/25 flex items-center justify-center gap-2 active:scale-[0.98] transition disabled:opacity-50 cursor-pointer"
              >
                <span>
                  {loading
                    ? t('common_loading')
                    : tr(language, 'Valider et me connecter', 'Validate & Sign in')}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setMustResetPinUser(null);
                  setPasswordRecoveryMode(false);
                  setErrorMsg('');
                  setSuccessMsg('');
                  setPassword('');
                }}
                className="w-full py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5 transition cursor-pointer mt-2"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>
                  {tr(language, 'Retour à la connexion', 'Back to sign in')}
                </span>
              </button>
            </form>
          </div>
        ) : forgotPasswordMode ? (
          <div className="space-y-4 animate-fadeIn">
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {tr(language, 'Saisissez votre adresse e-mail professionnelle pour recevoir un lien ou code de réinitialisation de votre mot de passe.', 'Enter your work email address to receive a password reset link or recovery code.')}
            </p>

            <form onSubmit={handleRequestForgotPassword} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-orange-500" />
                  <span>
                    {tr(language, 'Adresse e-mail professionnelle', 'Work Email Address')}
                  </span>
                </label>
                <input
                  type="email"
                  placeholder="nom@entreprise.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                  required
                  className="w-full px-3 py-2.5 text-sm font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-bold text-xs shadow-md shadow-orange-500/25 flex items-center justify-center gap-2 active:scale-[0.98] transition disabled:opacity-50 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>
                  {loading
                    ? t('common_loading')
                    : resetEmailSent
                      ? tr(language, "Renvoyer l'e-mail de réinitialisation", 'Resend reset email')
                      : tr(language, 'Envoyer le lien de réinitialisation', 'Send reset link')}
                </span>
              </button>
            </form>

            {resetEmailSent && (
              <form
                onSubmit={handleVerifyRecoveryCodeSubmit}
                className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3 animate-fadeIn"
              >
                <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  {tr(language, "Si votre e-mail contient un code de récupération (6 chiffres / jeton), vous pouvez également le saisir directement ci-dessous :", 'If your email includes a recovery code, you can also enter it directly below:')}
                </p>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {tr(language, 'Code de récupération reçu', 'Recovery Code')}
                  </label>
                  <input
                    type="text"
                    placeholder="123456"
                    value={recoveryCode}
                    onChange={(e) => setRecoveryCode(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-center tracking-widest text-sm font-bold bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {tr(language, 'Nouveau mot de passe (min. 6 caractères)', 'New Password (min. 6 chars)')}
                  </label>
                  <input
                    type="password"
                    minLength={6}
                    placeholder="••••••••"
                    value={recoveryNewPassword}
                    onChange={(e) => setRecoveryNewPassword(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {tr(language, 'Confirmer le nouveau mot de passe', 'Confirm New Password')}
                  </label>
                  <input
                    type="password"
                    minLength={6}
                    placeholder="••••••••"
                    value={recoveryConfirmPassword}
                    onChange={(e) => setRecoveryConfirmPassword(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition"
                  />
                </div>

                <button
                  type="submit"
                  disabled={
                    loading ||
                    !recoveryCode.trim() ||
                    recoveryNewPassword.length < 6 ||
                    recoveryConfirmPassword.length < 6
                  }
                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm flex items-center justify-center gap-2 transition disabled:opacity-50 cursor-pointer"
                >
                  <span>
                    {loading
                      ? t('common_loading')
                      : tr(language, 'Valider le nouveau mot de passe', 'Confirm new password')}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </form>
            )}

            <button
              type="button"
              onClick={() => {
                setForgotPasswordMode(false);
                setResetEmailSent(false);
                setErrorMsg('');
                setSuccessMsg('');
              }}
              className="w-full py-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>
                {tr(language, 'Retour à la connexion', 'Back to sign in')}
              </span>
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-orange-500" />
                  <span>
                    {tr(language, 'Adresse e-mail professionnelle', 'Work Email Address')}
                  </span>
                </label>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="nom@entreprise.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setErrorMsg('');
                  }}
                  autoFocus={!email}
                  required
                  className="w-full px-3 py-2.5 text-sm font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition"
                />
              </div>

              {/* Mode switch if local device PIN is available for this email */}
              {hasLocalPin && (
                <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('pin');
                      setPassword('');
                    }}
                    className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer ${
                      authMode === 'pin'
                        ? 'bg-white dark:bg-slate-700 text-orange-600 dark:text-orange-400 shadow-xs'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>PIN Appareil</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('password');
                      setPassword('');
                    }}
                    className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer ${
                      authMode === 'password'
                        ? 'bg-white dark:bg-slate-700 text-orange-600 dark:text-orange-400 shadow-xs'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <Shield className="w-3.5 h-3.5" />
                    <span>Mot de passe</span>
                  </button>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-orange-500" />
                    <span>
                      {authMode === 'pin'
                        ? 'Code PIN local (4 chiffres)'
                        : tr(language, 'Mot de passe', 'Password')}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setForgotPasswordMode(true);
                      setResetEmailSent(false);
                      setErrorMsg('');
                      setSuccessMsg('');
                    }}
                    className="text-[11px] font-semibold text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 hover:underline transition cursor-pointer"
                  >
                    {tr(language, 'Mot de passe oublié ?', 'Forgot password?')}
                  </button>
                </div>

                {authMode === 'pin' ? (
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={4}
                    placeholder="••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value.replace(/\D/g, ''))}
                    autoFocus={Boolean(email)}
                    className="w-full px-3 py-2.5 text-center tracking-[0.6em] text-xl font-bold bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition"
                  />
                ) : (
                  <input
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setErrorMsg('');
                    }}
                    autoFocus={Boolean(email)}
                    required
                    className="w-full px-3 py-2.5 text-base bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition"
                  />
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-bold text-sm shadow-md shadow-orange-500/25 flex items-center justify-center gap-2 active:scale-[0.98] transition disabled:opacity-50 cursor-pointer"
              >
                <span>{loading ? t('common_loading') : t('login_btn')}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleQuickDemoAdmin}
                className="w-full py-2 px-3 rounded-lg bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 text-xs font-semibold hover:bg-orange-100 dark:hover:bg-orange-900/50 flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-orange-500" />
                {t('login_demo_admin')}
              </button>

              <button
                type="button"
                onClick={() => {
                  setLoginModalOpen(false);
                  setCompanySetupModalOpen(true);
                }}
                className="w-full py-2 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <Building2 className="w-3.5 h-3.5 text-slate-500" />
                {t('login_company_btn')}
              </button>

              <button
                type="button"
                onClick={() => setLoginModalOpen(false)}
                className="w-full py-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer mt-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>
                  {currentUser
                    ? `${t('common_close')} (${tr(language, 'Continuer en tant que', 'Continue as')} ${currentUser.name})`
                    : t('login_back_welcome')}
                </span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
