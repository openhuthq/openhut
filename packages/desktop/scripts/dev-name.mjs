import { execFileSync } from 'node:child_process'
import { copyFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const app = join(dirname(createRequire(import.meta.url).resolve('electron')), 'dist/Electron.app/Contents')
const plist = join(app, 'Info.plist')
const icon = new URL('../build/icon-dev.icns', import.meta.url)
const shown = join(app, 'Resources/electron.icns')
if (process.platform === 'darwin' && !(readFileSync(plist, 'utf8').includes('<string>OpenHut Dev</string>') && readFileSync(shown).equals(readFileSync(icon)))) {
  for (const key of ['CFBundleName', 'CFBundleDisplayName']) execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} OpenHut Dev`, plist])
  copyFileSync(icon, shown)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', dirname(app)])
}
