import { app, BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

const root = join(import.meta.dirname, '..')
const ios = join(root, 'packages/phone/ios/App/App/Assets.xcassets')
const res = join(root, 'packages/phone/android/app/src/main/res')
const hut = readFileSync(join(root, 'packages/app/src/hut.svg'), 'utf8').replace(/^<svg[^>]*>|<\/svg>\s*$/g, '')
const ground = '<ellipse cx="54" cy="102.5" rx="35.6" ry="3.3" fill="#c9952a" opacity=".28"/>'
const mono = hut.replace(/<circle[^>]*fill="#fff"\/>/g, '').replace(/fill="#(fbe3c8|f5a48c)"/g, 'fill="none"').replace(/#[0-9a-f]{6}/g, '#000')

const PAPER = '#f7f7f7'
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
const splashes = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] }

type Job = { out: string[]; width: number; height: number; svg: string; alpha: boolean }

function place({ art, cx, cy, size }: { art: string; cx: number; cy: number; size: number }): string {
  return `<svg x="${cx - size / 2}" y="${cy - size * 0.46}" width="${size}" height="${size}" viewBox="4 8 100 100" overflow="visible">${art}</svg>`
}

function doc({ width, height, view, body }: { width: number; height: number; view: number; body: string }): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${view} ${view}">${body}</svg>`
}

const field = '<defs><linearGradient id="field" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6dc"/><stop offset="1" stop-color="#ffd98f"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#field)"/>'
const icon = `${field}${place({ art: ground + hut, cx: 512, cy: 512, size: 820 })}`

function splash({ width, height, size }: { width: number; height: number; size: number }): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${PAPER}"/>${place({ art: hut, cx: width / 2, cy: height / 2, size })}</svg>`
}

const jobs: Job[] = [
  { out: [join(ios, 'AppIcon.appiconset/AppIcon-512@2x.png')], width: 1024, height: 1024, svg: doc({ width: 1024, height: 1024, view: 1024, body: icon }), alpha: false },
  ...[1, 2, 3].map((scale) => ({ out: [join(ios, `Splash.imageset/splash${scale > 1 ? `@${scale}x` : ''}.png`)], width: 120 * scale, height: 120 * scale, svg: doc({ width: 120 * scale, height: 120 * scale, view: 120, body: place({ art: hut, cx: 60, cy: 60, size: 100 }) }), alpha: true })),
  { out: [join(res, 'drawable/splash.png')], width: 480, height: 320, svg: splash({ width: 480, height: 320, size: 96 }), alpha: false },
]

for (const [name, d] of Object.entries(densities)) {
  const legacy = 48 * d
  const layer = 108 * d
  const mipmap = join(res, `mipmap-${name}`)
  jobs.push(
    { out: [join(mipmap, 'ic_launcher.png')], width: legacy, height: legacy, svg: doc({ width: legacy, height: legacy, view: 1024, body: `<clipPath id="c"><rect x="40" y="40" width="944" height="944" rx="200"/></clipPath><g clip-path="url(#c)">${icon}</g>` }), alpha: true },
    { out: [join(mipmap, 'ic_launcher_round.png')], width: legacy, height: legacy, svg: doc({ width: legacy, height: legacy, view: 1024, body: `<clipPath id="c"><circle cx="512" cy="512" r="472"/></clipPath><g clip-path="url(#c)">${icon}</g>` }), alpha: true },
    { out: [join(mipmap, 'ic_launcher_foreground.png')], width: layer, height: layer, svg: doc({ width: layer, height: layer, view: 108, body: place({ art: hut, cx: 54, cy: 54, size: 62 }) }), alpha: true },
    { out: [join(mipmap, 'ic_launcher_monochrome.png')], width: layer, height: layer, svg: doc({ width: layer, height: layer, view: 108, body: place({ art: mono, cx: 54, cy: 54, size: 62 }) }), alpha: true },
  )
  const [short, long] = splashes[name as keyof typeof splashes]
  for (const [orientation, width, height] of [['port', short, long], ['land', long, short]] as const) {
    jobs.push({ out: [join(res, `drawable-${orientation}-${name}/splash.png`)], width, height, svg: splash({ width, height, size: Math.round(short * 0.3) }), alpha: false })
  }
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length)
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(body))
  return Buffer.concat([head, body, tail])
}

function png({ width, height, rgba, alpha }: { width: number; height: number; rgba: Uint8Array; alpha: boolean }): Buffer {
  const channels = alpha ? 4 : 3
  const stride = width * channels + 1
  const rows = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) rows[y * stride + 1 + x * channels + c] = rgba[(y * width + x) * 4 + c]
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = alpha ? 6 : 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

async function render(win: BrowserWindow, job: Job): Promise<Uint8Array> {
  const src = `data:image/svg+xml;base64,${Buffer.from(job.svg).toString('base64')}`
  return win.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = ${JSON.stringify(src)}
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = ${job.width}
    canvas.height = ${job.height}
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, ${job.width}, ${job.height})
    return new Uint8Array(ctx.getImageData(0, 0, ${job.width}, ${job.height}).data.buffer)
  })()`)
}

async function main(): Promise<void> {
  app.dock?.hide()
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')
  for (const job of jobs) {
    const bytes = png({ width: job.width, height: job.height, rgba: await render(win, job), alpha: job.alpha })
    for (const out of job.out) {
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, bytes)
    }
  }
  console.log(`Wrote ${jobs.reduce((n, job) => n + job.out.length, 0)} images.`)
  app.quit()
}

app.whenReady().then(main)
