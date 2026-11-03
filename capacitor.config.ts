import type { CapacitorConfig } from '@capacitor/cli';

const isDevBuild = process.env.TOT_DEV_BUILD === '1';

const config: CapacitorConfig = {
  appId: 'com.tot.stock',
  appName: 'TOT Stock',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
    cleartext: isDevBuild,
  },
  android: {
    allowMixedContent: isDevBuild,
    captureInput: true,
    webContentsDebuggingEnabled: isDevBuild,
  },
};

export default config;

