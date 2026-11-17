const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('openhut', {
  mcp: process.argv.find((arg) => arg.startsWith('--openhut-mcp='))?.slice('--openhut-mcp='.length),
  tailnet: () => ipcRenderer.invoke('tailnet'),
  machine: () => ipcRenderer.invoke('machine'),
  showFolder: () => ipcRenderer.invoke('show-folder'),
  prefs: () => ipcRenderer.invoke('prefs'),
  setPrefs: (patch) => ipcRenderer.invoke('set-prefs', patch),
  firstRun: (start) => ipcRenderer.invoke('first-run', start),
  mcpCommands: () => ipcRenderer.invoke('mcp.commands'),
  onChanged: (listener) => ipcRenderer.on('changed', () => listener()),
  computers: {
    list: () => ipcRenderer.invoke('computers.list'),
    add: (input) => ipcRenderer.invoke('computers.add', input),
    adopt: (input) => ipcRenderer.invoke('computers.adopt', input),
    remove: (input) => ipcRenderer.invoke('computers.remove', input),
    onProgress: (listener) => ipcRenderer.on('computers.progress', (_event, progress) => listener(progress)),
  },
})
