/// <reference types="@capawesome/capacitor-live-update" />
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'dev.openhut.app',
  appName: 'OpenHut',
  webDir: '../desktop/dist/renderer',
  plugins: {
    LiveUpdate: { publicKey: process.env.VITE_PHONE_UPDATE_KEY, readyTimeout: 10000, autoBlockRolledBackBundles: true },
  },
}

export default config
