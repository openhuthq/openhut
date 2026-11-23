import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkHandler } from '../src/desktop-entry.mjs'

const execOf = (text: string) => text.split('\n').find((line) => line.startsWith('Exec='))

test('an AppImage registers itself for openhut:// links, with only the flags this launch had', () => {
  const text = linkHandler({ exec: '/home/ana/.local/share/openhut/OpenHut.AppImage', argv: ['/tmp/.mount_x/openhut', '--no-sandbox', '--password-store=basic', '--remote-debugging-port=9222', '--hidden'], scheme: 'openhut' })
  assert.equal(execOf(text), 'Exec=/home/ana/.local/share/openhut/OpenHut.AppImage --no-sandbox --password-store=basic %U')
  assert.match(text, /^MimeType=x-scheme-handler\/openhut;$/m)
  assert.match(text, /^NoDisplay=true$/m)
  assert.equal(execOf(linkHandler({ exec: '/opt/OpenHut.AppImage', argv: ['/opt/openhut'], scheme: 'openhut' })), 'Exec=/opt/OpenHut.AppImage %U')
})

test('a path with spaces or shell characters is quoted and escaped the way the Desktop Entry spec says', () => {
  assert.equal(execOf(linkHandler({ exec: '/home/a b/Open "Hut" $x `y` 100%\\z.AppImage', argv: [], scheme: 'openhut' })), 'Exec="/home/a b/Open \\\\"Hut\\\\" \\\\$x \\\\`y\\\\` 100%%\\\\\\\\z.AppImage" %U')
})
