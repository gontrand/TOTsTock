import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import jsQR from 'jsqr';
import {
  MultiFormatReader,
  HTMLCanvasElementLuminanceSource,
  BinaryBitmap,
  HybridBinarizer,
} from '@zxing/library';

export interface QrCodeOptions {
  size?: number;
  margin?: number;
  darkColor?: string;
  lightColor?: string;
}

/**
 * Draws a rounded rectangle path on a 2D canvas context.
 */
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Draws JUST the text "TOT" in orange inside a clean framed box (encadré) at the center of the QR code.
 * Replaces any graphical logo with a crisp white box, orange border, and bold orange "TOT" text.
 * Error correction level 'H' ensures 100% readability.
 */
function drawTotFramedText(
  ctx: CanvasRenderingContext2D,
  canvasSize: number
) {
  const center = canvasSize / 2;

  // Sizing: tailored for the 3-letter word "TOT" (~24% width, ~16% height)
  const boxWidth = Math.round(canvasSize * 0.25);
  const boxHeight = Math.round(canvasSize * 0.16);
  const cornerRadius = Math.round(boxHeight * 0.22); // subtle clean corners

  const x = Math.round(center - boxWidth / 2);
  const y = Math.round(center - boxHeight / 2);

  // 1. Outer white safety zone (to clear surrounding QR code pixels cleanly)
  const pad = 3;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  drawRoundedRect(
    ctx,
    x - pad,
    y - pad,
    boxWidth + pad * 2,
    boxHeight + pad * 2,
    cornerRadius + 2
  );
  ctx.fill();
  ctx.restore();

  // 2. White background for the frame
  ctx.save();
  ctx.fillStyle = '#ffffff';
  drawRoundedRect(ctx, x, y, boxWidth, boxHeight, cornerRadius);
  ctx.fill();

  // 3. Orange border ("l'encadré")
  ctx.strokeStyle = '#ea580c'; // Vibrant orange (Orange 600)
  ctx.lineWidth = Math.max(2, Math.round(canvasSize * 0.009));
  drawRoundedRect(ctx, x, y, boxWidth, boxHeight, cornerRadius);
  ctx.stroke();

  // 4. Pure orange text "TOT" inside the frame
  const fontSize = Math.round(boxHeight * 0.64);
  ctx.fillStyle = '#ea580c'; // Vibrant orange text
  ctx.font = `900 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  try {
    (ctx as any).letterSpacing = '1px';
  } catch {
    // fallback if letterSpacing not supported on canvas
  }

  ctx.fillText('TOT', center, center + Math.round(fontSize * 0.04));
  ctx.restore();
}

/**
 * Renders a QR code onto an existing HTMLCanvasElement with the orange text "TOT" in a box at the center.
 */
export async function renderQrCodeWithTotLogo(
  canvas: HTMLCanvasElement,
  text: string,
  options: QrCodeOptions = {}
): Promise<void> {
  const size = options.size || 240;
  const margin = options.margin !== undefined ? options.margin : 2;
  const darkColor = options.darkColor || '#0f172a';
  const lightColor = options.lightColor || '#ffffff';

  // Make sure canvas dimensions match size
  canvas.width = size;
  canvas.height = size;

  // Render QR code with Error Correction Level 'H' (High - 30% recovery tolerance)
  await QRCode.toCanvas(canvas, text, {
    width: size,
    margin,
    errorCorrectionLevel: 'H',
    color: {
      dark: darkColor,
      light: lightColor,
    },
  });

  const ctx = canvas.getContext('2d');
  if (ctx) {
    drawTotFramedText(ctx, size);
  }
}

/**
 * Generates a PNG data URL of a QR code with the orange text "TOT" in an encadré at the center.
 */
export async function generateQrCodeDataUrlWithTotLogo(
  text: string,
  options: QrCodeOptions = {}
): Promise<string> {
  const size = options.size || 280;
  const offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = size;
  offscreenCanvas.height = size;

  await renderQrCodeWithTotLogo(offscreenCanvas, text, options);
  return offscreenCanvas.toDataURL('image/png');
}

/**
 * Generates a PNG data URL of a 1D barcode (CODE128, EAN13, etc.) using JsBarcode.
 */
export function generateBarcode1DDataUrl(
  value: string,
  options: { format?: string; width?: number; height?: number; displayValue?: boolean } = {}
): string | null {
  if (!value || !value.trim()) return null;
  const clean = value.trim();
  try {
    const canvas = document.createElement('canvas');
    let format = options.format;
    if (!format) {
      if (/^\d{13}$/.test(clean)) format = 'EAN13';
      else if (/^\d{8}$/.test(clean)) format = 'EAN8';
      else if (/^\d{12}$/.test(clean)) format = 'UPC';
      else format = 'CODE128';
    }

    JsBarcode(canvas, clean, {
      format,
      width: options.width || 1.6,
      height: options.height || 45,
      displayValue: options.displayValue !== false,
      fontSize: 12,
      margin: 4,
      background: '#ffffff',
      lineColor: '#000000',
    });
    return canvas.toDataURL('image/png');
  } catch (err) {
    // If format validation fails (e.g. invalid checksum for EAN), retry with CODE128
    try {
      const canvas = document.createElement('canvas');
      JsBarcode(canvas, clean, {
        format: 'CODE128',
        width: options.width || 1.6,
        height: options.height || 45,
        displayValue: options.displayValue !== false,
        fontSize: 12,
        margin: 4,
        background: '#ffffff',
        lineColor: '#000000',
      });
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }
}

/**
 * Decodes 1D barcodes or 2D codes from a HTMLCanvasElement using ZXing MultiFormatReader.
 */
export function decodeBarcodeFromCanvas(canvas: HTMLCanvasElement): string | null {
  try {
    const lumSource = new HTMLCanvasElementLuminanceSource(canvas);
    const bitmap = new BinaryBitmap(new HybridBinarizer(lumSource));
    const reader = new MultiFormatReader();
    const result = reader.decode(bitmap);
    return result ? result.getText() : null;
  } catch {
    return null;
  }
}

// ============================================================================
// SINGLETON SMARTPHONE CAMERA STREAM COORDINATOR
// Prevents concurrent getUserMedia() hardware lock collisions (NotReadableError)
// and preserves synchronous user-gesture activation on Android & iOS.
// ============================================================================

let inFlightCameraPromise: Promise<MediaStream> | null = null;
let currentActiveStream: MediaStream | null = null;
let prewarmedTimestamp = 0;

function isStreamLive(stream: MediaStream | null): stream is MediaStream {
  if (!stream) return false;
  const tracks = stream.getVideoTracks();
  return tracks.length > 0 && tracks.some((t) => t.readyState === 'live' && t.enabled);
}

/**
 * Stops a camera stream safely without killing a fresh stream that was just prewarmed
 * within the last 400ms by a user tap gesture.
 */
export function stopSmartphoneCameraStream(
  streamToStop?: MediaStream | null,
  forceEvenIfPrewarmed: boolean = false
): void {
  if (!forceEvenIfPrewarmed && Date.now() - prewarmedTimestamp < 400 && !streamToStop) {
    return;
  }
  if (streamToStop) {
    try {
      streamToStop.getTracks().forEach((t) => t.stop());
    } catch {}
    if (currentActiveStream === streamToStop) {
      currentActiveStream = null;
    }
  } else if (currentActiveStream) {
    try {
      currentActiveStream.getTracks().forEach((t) => t.stop());
    } catch {}
    currentActiveStream = null;
  }
}

/**
 * Synchronously kicks off camera stream acquisition inside a button's `onClick` handler
 * so mobile browsers (iOS Safari, Android Chrome, Samsung Internet, Capacitor WebView)
 * execute `navigator.mediaDevices.getUserMedia` with active transient user activation.
 */
export function prewarmSmartphoneCameraStream(): void {
  prewarmedTimestamp = Date.now();
  openSmartphoneCameraStream().catch(() => {});
}

/**
 * Progressive smartphone camera stream opener with singleton concurrency protection,
 * multi-constraint fallback, and Android permission warm-up retry.
 */
export async function openSmartphoneCameraStream(preferredDeviceId?: string): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('CAMERA_API_UNAVAILABLE');
  }

  // 1. If a stream is already live and no specific new device was requested, reuse it immediately
  if (!preferredDeviceId && isStreamLive(currentActiveStream)) {
    return currentActiveStream;
  }

  // 2. If a getUserMedia request is already in flight, await it instead of colliding on the camera HAL
  if (!preferredDeviceId && inFlightCameraPromise) {
    return inFlightCameraPromise;
  }

  const acquire = async (): Promise<MediaStream> => {
    // Ensure any dead previous stream is stopped before requesting hardware access
    if (currentActiveStream) {
      try {
        currentActiveStream.getTracks().forEach((t) => t.stop());
      } catch {}
      currentActiveStream = null;
    }

    const constraintCandidates: MediaStreamConstraints[] = [];

    if (preferredDeviceId) {
      constraintCandidates.push({
        audio: false,
        video: { deviceId: { exact: preferredDeviceId } },
      });
    }

    // Most reliable mobile-first constraints in order (avoid rigid 1280x720 first which fails on some portrait Android sensors)
    constraintCandidates.push(
      {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
        },
      },
      {
        audio: false,
        video: {
          facingMode: 'environment',
        },
      },
      {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      },
      {
        audio: false,
        video: true,
      }
    );

    let lastError: any = null;

    for (const constraints of constraintCandidates) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (isStreamLive(stream)) {
          currentActiveStream = stream;
          return stream;
        }
      } catch (err: any) {
        lastError = err;
        // If hardware was briefly busy releasing a previous stream, wait 120ms before next candidate
        if (err?.name === 'NotReadableError' || err?.name === 'AbortError') {
          await new Promise((r) => setTimeout(r, 120));
        }
      }
    }

    // Try enumerating video input devices (useful on multi-lens Android phones / WebViews)
    try {
      if (navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter((d) => d.kind === 'videoinput' && d.deviceId);
        // Sort rear/back cameras first
        const sortedDevices = [...videoDevices].sort((a, b) => {
          const aBack = /back|rear|environment|arrière|0/i.test(a.label) ? 0 : 1;
          const bBack = /back|rear|environment|arrière|0/i.test(b.label) ? 0 : 1;
          return aBack - bBack;
        });

        for (const dev of sortedDevices) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: { deviceId: { exact: dev.deviceId } },
            });
            if (isStreamLive(stream)) {
              currentActiveStream = stream;
              return stream;
            }
          } catch (err: any) {
            lastError = err;
          }
        }
      }
    } catch (err) {
      lastError = err;
    }

    // Final Android WebView permission dialog warm-up retry (after 300ms)
    await new Promise((r) => setTimeout(r, 300));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' } },
      });
      if (isStreamLive(stream)) {
        currentActiveStream = stream;
        return stream;
      }
    } catch {
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: true,
        });
        if (isStreamLive(fallbackStream)) {
          currentActiveStream = fallbackStream;
          return fallbackStream;
        }
      } catch (finalErr) {
        lastError = finalErr;
      }
    }

    throw lastError || new Error('CAMERA_STREAM_FAILED');
  };

  const promise = acquire().finally(() => {
    if (inFlightCameraPromise === promise) {
      inFlightCameraPromise = null;
    }
  });

  inFlightCameraPromise = promise;
  return promise;
}

/**
 * Safely attaches a MediaStream to a <video> element and starts playback on mobile WebViews & iOS/Android browsers
 * without throwing false-positive AbortError/NotAllowedError exceptions.
 */
export async function attachStreamToVideoElement(
  video: HTMLVideoElement,
  stream: MediaStream
): Promise<void> {
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true');
  video.setAttribute('muted', 'true');
  video.setAttribute('autoplay', 'true');

  if (video.srcObject !== stream) {
    video.srcObject = stream;
  }

  // If video is already playing with ready metadata, nothing more needed
  if (!video.paused && video.readyState >= 2) {
    return;
  }

  try {
    await video.play();
  } catch {
    // Wait for loadedmetadata if play() was called before stream metadata was ready
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('canplay', onLoaded);
        video.play().catch(() => {}).finally(() => resolve());
      };
      const onLoaded = () => finish();
      const timer = setTimeout(finish, 350);
      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('canplay', onLoaded, { once: true });
    });
  }
}

/**
 * Decodes a QR code or 1D barcode from an image File (e.g. captured via native smartphone camera <input capture="environment">).
 */
export async function decodeCodeFromImageFile(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = async () => {
      try {
        // 1. Try native BarcodeDetector first if available
        if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
          try {
            const detector = new (window as any).BarcodeDetector({
              formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf'],
            });
            const results = await detector.detect(img);
            if (results && results.length > 0 && results[0].rawValue) {
              URL.revokeObjectURL(objectUrl);
              resolve(results[0].rawValue.trim());
              return;
            }
          } catch {}
        }

        // 2. Draw onto canvas (scaled to reasonable max dimension for sharp decoding)
        const maxDim = 1280;
        let w = img.naturalWidth || img.width || 640;
        let h = img.naturalHeight || img.height || 480;
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          const imgData = ctx.getImageData(0, 0, w, h);

          const qr = jsQR(imgData.data, imgData.width, imgData.height, {
            inversionAttempts: 'attemptBoth',
          });
          if (qr && qr.data) {
            URL.revokeObjectURL(objectUrl);
            resolve(qr.data.trim());
            return;
          }

          const barcode = decodeBarcodeFromCanvas(canvas);
          if (barcode) {
            URL.revokeObjectURL(objectUrl);
            resolve(barcode.trim());
            return;
          }
        }
      } catch {}
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };

    img.src = objectUrl;
  });
}
