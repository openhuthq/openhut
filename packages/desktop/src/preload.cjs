const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('openhut', {
  platform: process.platform,
  mcp: JSON.parse(process.argv.find((arg) => arg.startsWith('--openhut-mcp='))?.slice('--openhut-mcp='.length) ?? 'null') ?? undefined,
  version: process.argv.find((arg) => arg.startsWith('--openhut-version='))?.slice('--openhut-version='.length),
  tailnet: () => ipcRenderer.invoke('tailnet'),
  machine: () => ipcRenderer.invoke('machine'),
  showFolder: () => ipcRenderer.invoke('show-folder'),
  prefs: () => ipcRenderer.invoke('prefs'),
  setPrefs: (patch) => ipcRenderer.invoke('set-prefs', patch),
  firstRun: (start) => ipcRenderer.invoke('first-run', start),
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
  devices: {
    list: () => ipcRenderer.invoke('devices.list'),
    remove: (input) => ipcRenderer.invoke('devices.remove', input),
    allow: (input) => ipcRenderer.invoke('devices.allow', input),
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
    list: () => ipcRenderer.invoke('computers.list'),
    add: (input) => ipcRenderer.invoke('computers.add', input),
    remove: (input) => ipcRenderer.invoke('computers.remove', input),
    enrollments: () => ipcRenderer.invoke('computers.enrollments'),
    dismiss: (input) => ipcRenderer.invoke('computers.dismiss', input),
    onEnrollments: (listener) => ipcRenderer.on('computers.enrollments', (_event, list) => listener(list)),
  },
})
