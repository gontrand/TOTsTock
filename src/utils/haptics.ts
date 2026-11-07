/**
 * Haptic Feedback Utility (Tactile Vibration & Multi-Engine Fallback)
 * Provides physical vibration and tactile feedback for barcode/QR code scans
 * and button interactions across:
 * 1. Android Native APK Bridge (TotNativeHaptics)
 * 2. Web Vibration API (navigator.vibrate) with motor-calibrated durations
 * 3. iOS 17.4+ / 18+ Safari Native Taptic Engine (<input type="checkbox" switch>)
 * 4. Web Audio Sub-Bass Tactile Transducer Pulse (for iOS, iframes, and devices where vibration is restricted)
 */

import {
  readLocalPreferenceValue,
  setUserPreference,
} from '../services/userPreferencesService';

const HAPTICS_KEY = 'tot_stock_haptics_enabled';
const HAPTICS_INTENSITY_KEY = 'tot_stock_haptics_intensity';
const SOUND_KEY = 'tot_stock_sound_enabled';

export type HapticIntensity = 'light' | 'normal' | 'strong';

interface TotNativeHapticsBridge {
  vibrate?: (durationMs: number) => void;
  vibratePattern?: (patternCsv: string) => void;
  tap?: () => void;
}

declare global {
  interface Window {
    TotNativeHaptics?: TotNativeHapticsBridge;
    webkitAudioContext?: typeof AudioContext;
  }
}

// Shared AudioContext unlocked on first user gesture for zero-latency tactile pulse & scan beeps
let sharedAudioCtx: AudioContext | null = null;

export function getUnlockedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioContextClass();
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

// Check if native Android bridge or Web Vibration API is available
export function isVibrationSupported(): boolean {
  if (typeof window !== 'undefined' && window.TotNativeHaptics) {
    return true;
  }
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

// Check if haptic feedback is enabled in user settings
export function isHapticsEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true;
  const val = readLocalPreferenceValue('haptics_enabled');
  if (val !== undefined) return val;
  const stored = localStorage.getItem(HAPTICS_KEY);
  return stored !== 'false'; // Enabled by default
}

// Toggle or set haptic feedback enabled state
export function setHapticsEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    setUserPreference('haptics_enabled', Boolean(enabled));
  } catch {
    localStorage.setItem(HAPTICS_KEY, enabled ? 'true' : 'false');
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tot-audio-haptics-changed'));
  }
}

// Check if sound effects (beeps, chimes, audio pulses) are enabled in user settings
export function isSoundEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true;
  const val = readLocalPreferenceValue('sound_enabled');
  if (val !== undefined) return val;
  const stored = localStorage.getItem(SOUND_KEY);
  return stored !== 'false'; // Enabled by default
}

// Toggle or set sound effects enabled state independently from vibrations
export function setSoundEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    setUserPreference('sound_enabled', Boolean(enabled));
  } catch {
    localStorage.setItem(SOUND_KEY, enabled ? 'true' : 'false');
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tot-audio-haptics-changed'));
  }
}

// Get current vibration intensity ('light' | 'normal' | 'strong')
export function getHapticIntensity(): HapticIntensity {
  if (typeof localStorage === 'undefined') return 'strong';
  const val = readLocalPreferenceValue('haptics_intensity');
  if (val === 'light' || val === 'normal' || val === 'strong') {
    return val;
  }
  const stored = localStorage.getItem(HAPTICS_INTENSITY_KEY);
  if (stored === 'light' || stored === 'normal' || stored === 'strong') {
    return stored;
  }
  return 'strong'; // Default to 'strong' so industrial/mobile motors clearly spin up
}

export function setHapticIntensity(intensity: HapticIntensity): void {
  if (typeof localStorage === 'undefined') return;
  try {
    setUserPreference('haptics_intensity', intensity);
  } catch {
    localStorage.setItem(HAPTICS_INTENSITY_KEY, intensity);
  }
}

function getIntensityMultiplier(): number {
  const intensity = getHapticIntensity();
  if (intensity === 'light') return 0.7;
  if (intensity === 'normal') return 1.0;
  return 1.45; // 'strong'
}

// iOS 17.4+ Safari Taptic Engine hidden switch element
let iosTapticLabel: HTMLLabelElement | null = null;
let isInternalTapticClick = false;

function triggerIosTapticSwitch(): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  try {
    if (!iosTapticLabel) {
      const label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.setAttribute('data-haptic', 'none');
      label.style.cssText =
        'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.setAttribute('data-haptic', 'none');
      label.appendChild(input);
      document.body.appendChild(label);
      iosTapticLabel = label;
    }
    isInternalTapticClick = true;
    iosTapticLabel.click();
    isInternalTapticClick = false;
    return true;
  } catch {
    isInternalTapticClick = false;
    return false;
  }
}

/**
 * Generates a physical sub-bass & mid-range tactile transducer pulse via Web Audio API.
 * On smartphones, tablets, iPhones, and restricted WebViews/iframes, a 60Hz-140Hz short
 * envelope physically vibrates the speaker diaphragm and chassis to provide crisp tactile feedback.
 */
function playTactileTransducerPulse(mode: 'tap' | 'medium' | 'heavy' | 'scanSuccess' | 'scanError'): void {
  // Never emit button/UI audio speaker pulses if the user muted general sound effects (scan beeps remain always active)
  if (mode !== 'scanSuccess' && mode !== 'scanError' && !isSoundEnabled()) return;
  const ctx = getUnlockedAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const mult = getIntensityMultiplier();

    if (mode === 'scanSuccess') {
      // Double tactile thump
      [0, 0.09].forEach((offset, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(idx === 0 ? 95 : 135, now + offset);
        osc.frequency.exponentialRampToValueAtTime(55, now + offset + 0.055);
        gain.gain.setValueAtTime(Math.min(0.45, 0.3 * mult), now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.06);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.065);
      });
      return;
    }

    if (mode === 'scanError') {
      // Triple warning thump
      [0, 0.11, 0.22].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(110, now + offset);
        osc.frequency.exponentialRampToValueAtTime(50, now + offset + 0.075);
        gain.gain.setValueAtTime(Math.min(0.5, 0.35 * mult), now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.085);
      });
      return;
    }

    // Single crisp tactile tap / thump
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';

    const duration = mode === 'heavy' ? 0.045 : mode === 'medium' ? 0.032 : 0.022;
    const startFreq = mode === 'heavy' ? 130 : mode === 'medium' ? 150 : 175;
    const endFreq = mode === 'heavy' ? 50 : 65;
    const peakGain = Math.min(
      0.45,
      (mode === 'heavy' ? 0.32 : mode === 'medium' ? 0.24 : 0.18) * mult
    );

    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);

    gain.gain.setValueAtTime(peakGain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.005);
  } catch {
    // Ignore audio context restrictions
  }
}

// Cooldowns to prevent duplicate vibrations or cancelling an active pattern vibration
let lastVibrationTime = 0;
let patternLockUntil = 0;
const BUTTON_THROTTLE_MS = 55;

function scalePattern(pattern: number | number[]): number | number[] {
  const mult = getIntensityMultiplier();
  if (typeof pattern === 'number') {
    // Minimum 30ms so Android ERM/LRA vibration motors physically spin up
    return Math.max(30, Math.round(pattern * mult));
  }
  return pattern.map((val, idx) => {
    // Even indices are vibration durations, odd indices are pauses
    if (idx % 2 === 0) {
      return Math.max(35, Math.round(val * mult));
    }
    return val;
  });
}

function getPatternTotalDuration(pattern: number | number[]): number {
  if (typeof pattern === 'number') return pattern;
  return pattern.reduce((acc, v) => acc + v, 0);
}

function executeVibration(
  rawPattern: number | number[],
  fallbackTone: 'tap' | 'medium' | 'heavy' | 'scanSuccess' | 'scanError' = 'tap',
  isPriorityPattern = false
): boolean {
  if (!isHapticsEnabled()) return false;

  const now = Date.now();
  // Never let a simple button tap overwrite an ongoing scan/test multi-pulse vibration pattern
  if (!isPriorityPattern && now < patternLockUntil) {
    return false;
  }

  const scaled = scalePattern(rawPattern);
  if (isPriorityPattern) {
    patternLockUntil = now + getPatternTotalDuration(scaled) + 80;
  }

  let nativeOrWebTriggered = false;

  // 1. Try Android Native APK Bridge first if running inside Capacitor Android app
  if (typeof window !== 'undefined' && window.TotNativeHaptics) {
    try {
      if (typeof scaled === 'number') {
        if (window.TotNativeHaptics.vibrate) {
          window.TotNativeHaptics.vibrate(scaled);
          nativeOrWebTriggered = true;
        } else if (window.TotNativeHaptics.tap) {
          window.TotNativeHaptics.tap();
          nativeOrWebTriggered = true;
        }
      } else if (Array.isArray(scaled) && window.TotNativeHaptics.vibratePattern) {
        window.TotNativeHaptics.vibratePattern(scaled.join(','));
        nativeOrWebTriggered = true;
      }
    } catch {
      // Continue to web fallback
    }
  }

  // 2. Try standard Web Vibration API (navigator.vibrate)
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      const ok = navigator.vibrate(scaled);
      if (ok) {
        nativeOrWebTriggered = true;
      }
    } catch {
      // Ignore
    }
  }

  // 3. Try iOS 17.4+ Safari Taptic switch if Web Vibration API is not supported
  if (!nativeOrWebTriggered && !isVibrationSupported()) {
    triggerIosTapticSwitch();
  }

  // 4. Always trigger the sub-bass tactile transducer micro-pulse so the user feels/hears
  // immediate physical response even inside iframes, iOS devices, or restricted mobile browsers
  playTactileTransducerPulse(fallbackTone);

  return nativeOrWebTriggered;
}

export const hapticFeedback = {
  /**
   * Crisp vibration for mobile button presses (45ms base)
   */
  button: () => {
    const now = Date.now();
    if (now - lastVibrationTime < BUTTON_THROTTLE_MS || now < patternLockUntil) return;
    lastVibrationTime = now;
    executeVibration(45, 'tap', false);
  },

  /**
   * Distinct affirmative double buzz for successful barcode/QR scans ([85, 55, 130]ms)
   */
  scanSuccess: () => {
    lastVibrationTime = Date.now();
    executeVibration([85, 55, 130], 'scanSuccess', true);
  },

  /**
   * Strong warning triple pulse for scan failures or errors ([130, 60, 130, 60, 160]ms)
   */
  scanError: () => {
    lastVibrationTime = Date.now();
    executeVibration([130, 60, 130, 60, 160], 'scanError', true);
  },

  /**
   * Light tactile tap for toggles, tabs, and small inputs (35ms base)
   */
  light: () => {
    const now = Date.now();
    if (now - lastVibrationTime < BUTTON_THROTTLE_MS || now < patternLockUntil) return;
    lastVibrationTime = now;
    executeVibration(35, 'tap', false);
  },

  /**
   * Medium vibration for validations and item checkmarks (65ms base)
   */
  medium: () => {
    lastVibrationTime = Date.now();
    executeVibration(65, 'medium', true);
  },

  /**
   * Strong vibration for confirmations or alert prompts (100ms base)
   */
  heavy: () => {
    lastVibrationTime = Date.now();
    executeVibration(100, 'heavy', true);
  },

  /**
   * Success sequence for completing a workflow or order ([70, 50, 120]ms)
   */
  success: () => {
    lastVibrationTime = Date.now();
    executeVibration([70, 50, 120], 'scanSuccess', true);
  },

  /**
   * Selection tick for tab switching (40ms base)
   */
  selection: () => {
    const now = Date.now();
    if (now - lastVibrationTime < BUTTON_THROTTLE_MS || now < patternLockUntil) return;
    lastVibrationTime = now;
    executeVibration(40, 'tap', false);
  },
};

/**
 * Explicit diagnostic test for the "Tester le vibreur" button
 */
export function triggerHapticTest(): { vibrated: boolean; method: string } {
  if (!isHapticsEnabled()) {
    setHapticsEnabled(true);
  }
  getUnlockedAudioContext();
  const vibrated = executeVibration([100, 60, 160, 60, 100], 'scanSuccess', true);
  if (typeof window !== 'undefined' && window.TotNativeHaptics) {
    return { vibrated: true, method: 'Android Native Haptics' };
  }
  if (vibrated) {
    return { vibrated: true, method: 'Web Vibration API (Moteur Haptique)' };
  }
  return { vibrated: true, method: 'Impulsion Tactile & Audio-Haptique' };
}

/**
 * Explicit test for sound effects ("Tester le son") independent of vibrations
 */
export function triggerSoundTest(): void {
  if (!isSoundEnabled()) {
    setSoundEnabled(true);
  }
  try {
    const ctx = getUnlockedAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.24, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.14);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.14);
  } catch {
    // Ignore audio context restrictions
  }
}

/**
 * Initializes global event listeners for tactile button feedback across mobile & desktop.
 * Uses both pointerdown AND click/touchend so Chrome Android's Transient User Activation
 * policy always allows navigator.vibrate() on tap completion.
 */
let isGlobalHapticInitialized = false;

export function setupGlobalHapticFeedback(): void {
  if (typeof window === 'undefined' || isGlobalHapticInitialized) return;
  isGlobalHapticInitialized = true;

  const findInteractiveTarget = (target: EventTarget | null): HTMLElement | null => {
    if (!target || !(target instanceof HTMLElement)) return null;
    const clickable = target.closest<HTMLElement>(
      'button, [role="button"], [role="switch"], [role="tab"], a[href], input[type="button"], input[type="submit"], input[type="checkbox"], select, [data-haptic]'
    );
    if (!clickable) return null;

    if (
      (clickable as HTMLButtonElement).disabled ||
      clickable.getAttribute('aria-disabled') === 'true' ||
      clickable.classList.contains('disabled') ||
      clickable.classList.contains('pointer-events-none')
    ) {
      return null;
    }
    return clickable;
  };

  const triggerForElement = (clickable: HTMLElement) => {
    if (isInternalTapticClick) return;
    if (!isHapticsEnabled()) return;

    const customHaptic = clickable.getAttribute('data-haptic');
    if (customHaptic === 'none') return;
    if (customHaptic === 'scan') {
      hapticFeedback.scanSuccess();
    } else if (customHaptic === 'error') {
      hapticFeedback.scanError();
    } else if (customHaptic === 'light') {
      hapticFeedback.light();
    } else if (customHaptic === 'heavy') {
      hapticFeedback.heavy();
    } else if (customHaptic === 'medium') {
      hapticFeedback.medium();
    } else {
      hapticFeedback.button();
    }
  };

  // 1. Unlock AudioContext and attempt immediate tactile response on pointerdown
  const handlePointerDown = (event: PointerEvent) => {
    if (isInternalTapticClick) return;
    getUnlockedAudioContext();
    const clickable = findInteractiveTarget(event.target);
    if (!clickable) return;
    triggerForElement(clickable);
  };

  // 2. Also listen on click (which guarantees Transient User Activation in Chrome Android / WebView)
  // If pointerdown was throttled or blocked by browser user-activation rules prior to pointerup,
  // click ensures the vibration motor still fires!
  const handleClick = (event: MouseEvent) => {
    if (isInternalTapticClick) return;
    getUnlockedAudioContext();
    const clickable = findInteractiveTarget(event.target);
    if (!clickable) return;

    // Only fire on click if pointerdown didn't just vibrate within the last 45ms,
    // OR if navigator.vibrate was blocked on pointerdown before userActivation unlocked on pointerup
    const elapsed = Date.now() - lastVibrationTime;
    if (elapsed >= 40) {
      triggerForElement(clickable);
    } else if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' && Date.now() >= patternLockUntil) {
      // Reinforce physical motor spin-up right at click user-activation moment
      try {
        navigator.vibrate(scalePattern(45));
      } catch {
        // Ignore
      }
    }
  };

  window.addEventListener('pointerdown', handlePointerDown, { passive: true, capture: true });
  window.addEventListener('click', handleClick, { passive: true, capture: true });
}
