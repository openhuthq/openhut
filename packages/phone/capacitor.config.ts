import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'dev.openhut.app',
  appName: 'OpenHut',
  webDir: '../app/dist',
  backgroundColor: '#f7f7f7',
  ios: { scrollEnabled: false },
  loggingBehavior: 'none',
  plugins: {
    Keyboard: { resize: 'none' },
  },
}

export default config
