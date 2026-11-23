const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('openhut', {
  platform: process.platform,
  dev: process.argv.find((arg) => arg.startsWith('--openhut-dev='))?.slice('--openhut-dev='.length),
  version: process.argv.find((arg) => arg.startsWith('--openhut-version='))?.slice('--openhut-version='.length),
  tailnet: () => ipcRenderer.invoke('tailnet'),
  machine: () => ipcRenderer.invoke('machine'),
  showFolder: () => ipcRenderer.invoke('show-folder'),
  prefs: () => ipcRenderer.invoke('prefs'),
  setPrefs: (patch) => ipcRenderer.invoke('set-prefs', patch),
  firstRun: () => ipcRenderer.invoke('first-run'),
  update: {
    state: () => ipcRenderer.invoke('update.state'),
    check: () => ipcRenderer.invoke('update.check'),
    install: () => ipcRenderer.invoke('update.install'),
    onChange: (listener) => ipcRenderer.on('update.changed', (_event, state) => listener(state)),
  },
  onChanged: (listener) => ipcRenderer.on('changed', () => listener()),
  browserLive: (path, onLine, onClose) => {
    const { port1, port2 } = new MessageChannel()
    port1.onmessage = ({ data }) => typeof data === 'string' ? onLine(data) : onClose(data.closed, data.reason)
    ipcRenderer.postMessage('browser-live', path, [port2])
    return { send: (line) => port1.postMessage(line), close: () => port1.close() }
  },
  cloud: {
    notify: (input) => ipcRenderer.invoke('cloud.notify', input),
  },
  passkey: {
    status: () => ipcRenderer.invoke('passkey.status'),
    create: (input) => ipcRenderer.invoke('passkey.create', input),
    open: () => ipcRenderer.invoke('passkey.open'),
  },
  kit: {
    save: (input) => ipcRenderer.invoke('kit.save', input),
  },
  computers: {
    add: (input) => ipcRenderer.invoke('computers.add', input),
    enrollments: () => ipcRenderer.invoke('computers.enrollments'),
    dismiss: (input) => ipcRenderer.invoke('computers.dismiss', input),
    onEnrollments: (listener) => ipcRenderer.on('computers.enrollments', (_event, list) => listener(list)),
  },
})
