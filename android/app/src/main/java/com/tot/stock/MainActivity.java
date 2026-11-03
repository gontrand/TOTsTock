package com.tot.stock;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
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

public class MainActivity extends BridgeActivity {
    private static final int CAMERA_PERMISSION_REQUEST_CODE = 1001;
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
