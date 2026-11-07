package com.tot.stock;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.HapticFeedbackConstants;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.security.KeyStore;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public class MainActivity extends BridgeActivity {
    private static final int CAMERA_PERMISSION_REQUEST_CODE = 1001;
    private static final String KEYSTORE_ALIAS = "tot_stock_local_crypto_master_v1";
    private static final String PREFS_FILE = "tot_stock_native_keystore_prefs";
    private static final String PREF_WRAPPED_KEY = "wrapped_aes_key_v1";
    private static final String PREF_WRAPPED_IV = "wrapped_aes_iv_v1";
    private PermissionRequest pendingWebPermissionRequest = null;
    private boolean hapticsBridgeInjected = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureWebViewForCamera();
        ensureCameraPermission();
    }

    @Override
    public void onResume() {
        super.onResume();
        configureWebViewForCamera();
    }

    private Vibrator getDeviceVibrator() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                if (vm != null) {
                    return vm.getDefaultVibrator();
                }
            }
            return (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        } catch (Exception ignored) {
            return null;
        }
    }

    public class TotNativeKeystore {
        private synchronized SecretKey getOrCreateHardwareWrappingKey() throws Exception {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            if (ks.containsAlias(KEYSTORE_ALIAS)) {
                KeyStore.Entry entry = ks.getEntry(KEYSTORE_ALIAS, null);
                if (entry instanceof KeyStore.SecretKeyEntry) {
                    return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
                }
            }
            KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                    KEYSTORE_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setUserAuthenticationRequired(false)
                    .build();
            kg.init(spec);
            return kg.generateKey();
        }

        @JavascriptInterface
        public synchronized String getOrCreateKeyBase64() {
            try {
                SharedPreferences prefs = getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE);
                SecretKey wrappingKey = getOrCreateHardwareWrappingKey();
                String wrappedCtB64 = prefs.getString(PREF_WRAPPED_KEY, null);
                String wrappedIvB64 = prefs.getString(PREF_WRAPPED_IV, null);

                if (wrappedCtB64 != null && wrappedIvB64 != null) {
                    byte[] ct = Base64.decode(wrappedCtB64, Base64.NO_WRAP);
                    byte[] iv = Base64.decode(wrappedIvB64, Base64.NO_WRAP);
                    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                    cipher.init(Cipher.DECRYPT_MODE, wrappingKey, new GCMParameterSpec(128, iv));
                    byte[] rawKey = cipher.doFinal(ct);
                    if (rawKey != null && rawKey.length == 32) {
                        return Base64.encodeToString(rawKey, Base64.NO_WRAP);
                    }
                }

                byte[] newRawKey = new byte[32];
                new SecureRandom().nextBytes(newRawKey);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, wrappingKey);
                byte[] iv = cipher.getIV();
                byte[] ct = cipher.doFinal(newRawKey);

                prefs.edit()
                        .putString(PREF_WRAPPED_KEY, Base64.encodeToString(ct, Base64.NO_WRAP))
                        .putString(PREF_WRAPPED_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
                        .apply();

                return Base64.encodeToString(newRawKey, Base64.NO_WRAP);
            } catch (Exception ignored) {
                return "";
            }
        }

        @JavascriptInterface
        public synchronized boolean clearKey() {
            try {
                SharedPreferences prefs = getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE);
                prefs.edit().remove(PREF_WRAPPED_KEY).remove(PREF_WRAPPED_IV).apply();
                KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
                ks.load(null);
                if (ks.containsAlias(KEYSTORE_ALIAS)) {
                    ks.deleteEntry(KEYSTORE_ALIAS);
                }
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }
    }

    public class TotNativeHaptics {
        @JavascriptInterface
        public void vibrate(long durationMs) {
            try {
                final long safeDuration = Math.max(25L, Math.min(durationMs, 1000L));
                Vibrator v = getDeviceVibrator();
                if (v != null && v.hasVibrator()) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        v.vibrate(VibrationEffect.createOneShot(safeDuration, VibrationEffect.DEFAULT_AMPLITUDE));
                    } else {
                        v.vibrate(safeDuration);
                    }
                }
                if (getBridge() != null && getBridge().getWebView() != null) {
                    runOnUiThread(() -> {
                        try {
                            getBridge().getWebView().performHapticFeedback(
                                    HapticFeedbackConstants.VIRTUAL_KEY,
                                    HapticFeedbackConstants.FLAG_IGNORE_VIEW_SETTING | HapticFeedbackConstants.FLAG_IGNORE_GLOBAL_SETTING
                            );
                        } catch (Exception ignored) {
                        }
                    });
                }
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void vibratePattern(String patternCsv) {
            try {
                if (patternCsv == null || patternCsv.trim().isEmpty()) return;
                String[] parts = patternCsv.split(",");
                long[] timings = new long[parts.length + 1];
                timings[0] = 0L; // Start immediately
                for (int i = 0; i < parts.length; i++) {
                    timings[i + 1] = Math.max(20L, Long.parseLong(parts[i].trim()));
                }
                Vibrator v = getDeviceVibrator();
                if (v != null && v.hasVibrator()) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        v.vibrate(VibrationEffect.createWaveform(timings, -1));
                    } else {
                        v.vibrate(timings, -1);
                    }
                }
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void tap() {
            vibrate(40L);
        }
    }

    private void configureWebViewForCamera() {
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                WebView webView = getBridge().getWebView();
                WebSettings settings = webView.getSettings();
                settings.setMediaPlaybackRequiresUserGesture(false);
                settings.setJavaScriptCanOpenWindowsAutomatically(true);
                settings.setDomStorageEnabled(true);
                settings.setAllowFileAccess(true);
                settings.setAllowContentAccess(true);
                webView.setHapticFeedbackEnabled(true);

                if (!hapticsBridgeInjected) {
                    webView.addJavascriptInterface(new TotNativeHaptics(), "TotNativeHaptics");
                    webView.addJavascriptInterface(new TotNativeKeystore(), "TotNativeKeystore");
                    hapticsBridgeInjected = true;
                }

                webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
                    @Override
                    public void onPermissionRequest(final PermissionRequest request) {
                        runOnUiThread(() -> {
                            try {
                                boolean wantsCamera = false;
                                for (String res : request.getResources()) {
                                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) {
                                        wantsCamera = true;
                                        break;
                                    }
                                }
                                if (!wantsCamera || ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                                        == PackageManager.PERMISSION_GRANTED) {
                                    request.grant(request.getResources());
                                } else {
                                    pendingWebPermissionRequest = request;
                                    ActivityCompat.requestPermissions(
                                            MainActivity.this,
                                            new String[]{Manifest.permission.CAMERA},
                                            CAMERA_PERMISSION_REQUEST_CODE
                                    );
                                }
                            } catch (Exception e) {
                                try {
                                    request.deny();
                                } catch (Exception ignored) {
                                }
                            }
                        });
                    }
                });
            }
        } catch (Exception ignored) {
        }
    }

    private void ensureCameraPermission() {
        try {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                        this,
                        new String[]{Manifest.permission.CAMERA},
                        CAMERA_PERMISSION_REQUEST_CODE
                );
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == CAMERA_PERMISSION_REQUEST_CODE && pendingWebPermissionRequest != null) {
            final PermissionRequest req = pendingWebPermissionRequest;
            pendingWebPermissionRequest = null;
            runOnUiThread(() -> {
                try {
                    if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                        req.grant(req.getResources());
                    } else {
                        req.deny();
                    }
                } catch (Exception ignored) {
                }
            });
        }
    }
}
