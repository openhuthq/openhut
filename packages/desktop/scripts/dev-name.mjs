import { execFileSync } from 'node:child_process'
import { copyFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const app = join(dirname(createRequire(import.meta.url).resolve('electron')), 'dist/Electron.app/Contents')
const plist = join(app, 'Info.plist')
if (process.platform === 'darwin' && !readFileSync(plist, 'utf8').includes('<string>OpenHut Dev</string>')) {
  for (const key of ['CFBundleName', 'CFBundleDisplayName']) execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} OpenHut Dev`, plist])
  copyFileSync(new URL('../build/icon.icns', import.meta.url), join(app, 'Resources/electron.icns'))
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', dirname(app)])
}
