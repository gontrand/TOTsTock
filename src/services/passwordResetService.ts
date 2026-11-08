import {
  extractEdgeFunctionErrorDetails,
  getResolvedEdgeFunctionName,
  loadEdgeFunctionOverridesFromClientDb,
} from '../constants/edgeFunctions';

export const GENERIC_PASSWORD_RESET_REQUEST_MESSAGE =
  'Si ce compte existe, un code a été envoyé.';
export const PASSWORD_RESET_SUCCESS_MESSAGE =
  'Mot de passe modifié avec succès. Vous pouvez maintenant vous connecter.';
export const RESET_RESEND_COOLDOWN_SECONDS = 60;

export function validateResetEmail(rawEmail: string): {
  valid: boolean;
  cleanEmail: string;
  error?: string;
} {
  const cleanEmail = String(rawEmail || '').trim().toLowerCase();
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return {
      valid: false,
      cleanEmail,
      error: 'Veuillez saisir une adresse e-mail valide.',
    };
  }
  return { valid: true, cleanEmail };
}

export function sanitizeSixDigitCodeInput(raw: string): string {
  return String(raw || '')
    .replace(/\D/g, '')
    .slice(0, 6);
}

export function validateResetCode(rawCode: string): {
  valid: boolean;
  cleanCode: string;
  error?: string;
} {
  const cleanCode = sanitizeSixDigitCodeInput(rawCode);
  if (!/^\d{6}$/.test(cleanCode)) {
    return {
      valid: false,
      cleanCode,
      error: 'Veuillez saisir le code à 6 chiffres reçu par e-mail.',
    };
  }
  return { valid: true, cleanCode };
}

export function validateResetPassword(
  password: string,
  confirmPassword?: string
): {
  valid: boolean;
  error?: string;
} {
  const pwd = String(password || '');
  if (pwd.length < 6 || pwd.length > 72) {
    return {
      valid: false,
      error: 'Le mot de passe doit contenir entre 6 et 72 caractères.',
    };
  }
  if (confirmPassword !== undefined && pwd !== confirmPassword) {
    return {
      valid: false,
      error: 'Les deux mots de passe ne correspondent pas.',
    };
  }
  return { valid: true };
}

export function computePasswordStrength(password: string): {
  level: 'weak' | 'medium' | 'strong';
  score: number;
  label: string;
  labelFr: string;
} {
  const pwd = String(password || '');
  if (pwd.length < 6) {
    return { level: 'weak', score: 1, label: 'Faible (< 6 car.)', labelFr: 'Faible (< 6 car.)' };
  }
  let points = 0;
  if (pwd.length >= 8) points += 1;
  if (pwd.length >= 12) points += 1;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) points += 1;
  if (/\d/.test(pwd)) points += 1;
  if (/[^A-Za-z0-9]/.test(pwd)) points += 1;

  if (points >= 4) {
    return { level: 'strong', score: 3, label: 'Robuste', labelFr: 'Robuste' };
  }
  if (points >= 2) {
    return { level: 'medium', score: 2, label: 'Moyen', labelFr: 'Moyen' };
  }
  return { level: 'weak', score: 1, label: 'Acceptable', labelFr: 'Acceptable' };
}

export function mapPasswordResetError(
  parsed: { status: number; code: string; message: string; isNotFound: boolean },
  fnName = 'APP_TOT-Stock_password-reset'
): string {
  if (parsed.isNotFound || parsed.status === 404) {
    return `Fonction Edge ${fnName} non déployée — ouvrez Paramètres > Fonctions Edge pour la déployer.`;
  }
  const code = (parsed.code || '').toUpperCase();
  const msg = parsed.message || '';
  const lower = msg.toLowerCase();

  if (
    code === 'SCHEMA_OUTDATED' ||
    lower.includes('core_password_resets') ||
    lower.includes('18_password_reset') ||
    lower.includes('install_v55')
  ) {
    return 'Script SQL non à jour — exécutez install_v55.sql (ou 18_password_reset.sql).';
  }
  if (code === 'CODE_LOCKED' || code === 'LOCKED' || parsed.status === 429) {
    return 'Code verrouillé après trop de tentatives. Demandez un nouveau code.';
  }
  if (code === 'WEAK_PASSWORD' || code === 'PASSWORD_REJECTED') {
    return msg || 'Le mot de passe doit contenir entre 6 et 72 caractères.';
  }
  if (code === 'INVALID_CODE' || code === 'INVALID') {
    return 'Code invalide ou expiré.';
  }
  if (lower.includes('failed to fetch') || lower.includes('network')) {
    return 'Impossible de joindre le serveur Supabase. Vérifiez votre connexion.';
  }
  return msg || 'Erreur lors de la réinitialisation du mot de passe.';
}

/**
 * Étape 1 : Demande d'envoi d'un code à 6 chiffres via `APP_TOT-Stock_password-reset`.
 */
export async function requestPasswordResetCode(
  client: any,
  rawEmail: string
): Promise<{ success: boolean; message: string; code?: string }> {
  const emailCheck = validateResetEmail(rawEmail);
  if (!emailCheck.valid) {
    return {
      success: false,
      code: 'INVALID_EMAIL',
      message: emailCheck.error || 'Adresse e-mail invalide.',
    };
  }

  if (!client || typeof client.functions?.invoke !== 'function') {
    return {
      success: false,
      code: 'NO_CLIENT',
      message: 'Serveur Supabase non configuré.',
    };
  }

  await loadEdgeFunctionOverridesFromClientDb(client);
  const fnName = getResolvedEdgeFunctionName('passwordReset');

  try {
    const { data, error } = await client.functions.invoke(fnName, {
      body: {
        action: 'request',
        email: emailCheck.cleanEmail,
      },
    });

    if (error || (data && data.success === false)) {
      const parsed = await extractEdgeFunctionErrorDetails(error, data);
      return {
        success: false,
        code: parsed.code || (parsed.isNotFound ? 'NOT_FOUND' : 'ERROR'),
        message: mapPasswordResetError(parsed, fnName),
      };
    }

    return {
      success: true,
      message: data?.message || GENERIC_PASSWORD_RESET_REQUEST_MESSAGE,
    };
  } catch (err: any) {
    const parsed = await extractEdgeFunctionErrorDetails(err);
    return {
      success: false,
      code: parsed.code || 'ERROR',
      message: mapPasswordResetError(parsed, fnName),
    };
  }
}

/**
 * Étape 2 : Confirmation du code à 6 chiffres et application du nouveau mot de passe.
 */
export async function confirmPasswordResetCode(
  client: any,
  rawEmail: string,
  rawCode: string,
  newPassword: string
): Promise<{ success: boolean; message: string; code?: string }> {
  const emailCheck = validateResetEmail(rawEmail);
  if (!emailCheck.valid) {
    return {
      success: false,
      code: 'INVALID_EMAIL',
      message: emailCheck.error || 'Adresse e-mail invalide.',
    };
  }

  const codeCheck = validateResetCode(rawCode);
  if (!codeCheck.valid) {
    return {
      success: false,
      code: 'INVALID_CODE',
      message: codeCheck.error || 'Code invalide ou expiré.',
    };
  }

  const pwdCheck = validateResetPassword(newPassword);
  if (!pwdCheck.valid) {
    return {
      success: false,
      code: 'WEAK_PASSWORD',
      message: pwdCheck.error || 'Le mot de passe doit contenir entre 6 et 72 caractères.',
    };
  }

  if (!client || typeof client.functions?.invoke !== 'function') {
    return {
      success: false,
      code: 'NO_CLIENT',
      message: 'Serveur Supabase non configuré.',
    };
  }

  await loadEdgeFunctionOverridesFromClientDb(client);
  const fnName = getResolvedEdgeFunctionName('passwordReset');

  try {
    const { data, error } = await client.functions.invoke(fnName, {
      body: {
        action: 'confirm',
        email: emailCheck.cleanEmail,
        code: codeCheck.cleanCode,
        newPassword,
      },
    });

    if (error || !data || data.success !== true) {
      const parsed = await extractEdgeFunctionErrorDetails(error, data);
      return {
        success: false,
        code: parsed.code || 'INVALID_CODE',
        message: mapPasswordResetError(parsed, fnName),
      };
    }

    return {
      success: true,
      message: data.message || PASSWORD_RESET_SUCCESS_MESSAGE,
    };
  } catch (err: any) {
    const parsed = await extractEdgeFunctionErrorDetails(err);
    return {
      success: false,
      code: parsed.code || 'ERROR',
      message: mapPasswordResetError(parsed, fnName),
    };
  }
}
