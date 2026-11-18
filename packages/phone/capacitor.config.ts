/// <reference types="@capawesome/capacitor-live-update" />
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'dev.openhut.app',
  appName: 'OpenHut',
  webDir: '../desktop/dist/renderer',
  backgroundColor: '#f7f7f7',
  ios: { scrollEnabled: false },
  loggingBehavior: 'none',
  plugins: {
    Keyboard: { resize: 'none' },
    LiveUpdate: { publicKey: process.env.VITE_PHONE_UPDATE_KEY, readyTimeout: 10000, autoBlockRolledBackBundles: true },
  },
}

export default config
