const { app, BrowserWindow } = require('electron')
app.whenReady().then(() => new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }).loadURL(process.env.PAGE))
