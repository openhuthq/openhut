import { PAGES, type Page } from './pages.ts'

const LOGO = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>'
const FAVICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#3b5de8" /><path d="M3 12h4l3-8 4 16 3-8h4" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>')}`
const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400..600&family=Geist+Mono:wght@400;500&display=swap'
const CSS = `
:root{
  color-scheme:light;
  --sidebar:oklch(96.2% .0025 290); --canvas:oklch(98.5% .0015 290); --card:#ffffff; --soft:oklch(0% 0 0 / .05); --mid:oklch(0% 0 0 / .15);
  --hair:oklch(0% 0 0 / .08); --ink:oklch(23.5% .0038 290); --mute:oklch(51.1% .0033 290); --tint:oklch(0% 0 0 / .04);
  --primary:oklch(54% .213 267.8);
  --sans:'Inter',ui-sans-serif,system-ui,sans-serif;
  --mono:'Geist Mono','Geist Mono Variable',ui-monospace,monospace;
}
*{box-sizing:border-box}
html,body{background:var(--sidebar);color:var(--ink);margin:0}
body{font-family:var(--sans);font-size:14px;font-weight:450;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--primary)}
:focus-visible{outline:2px solid var(--primary);outline-offset:2px;border-radius:6px}
.mute{color:var(--mute)}
.eyebrow{font-size:12px;text-transform:uppercase;color:var(--mute);font-weight:500;letter-spacing:.04em;margin:0 0 8px}
.app{display:grid;grid-template-columns:232px minmax(0,1fr);min-height:100vh;min-height:100dvh}
.side{position:sticky;top:0;height:100vh;height:100dvh;display:flex;flex-direction:column;padding:8px;gap:2px}
.side .eyebrow{margin:16px 8px 4px}
.team{height:48px;display:flex;align-items:center;gap:10px;padding:0 8px;color:var(--ink);text-decoration:none;font-size:15px;font-weight:500}
.logo{width:28px;height:28px;border-radius:6px;background:var(--primary);display:grid;place-items:center;flex:none}
.nav{display:flex;align-items:center;padding:0 8px;border-radius:6px;color:var(--ink);font-weight:500;font-size:13px;height:30px;text-decoration:none}
.nav:hover{background:var(--tint)}
.nav[aria-current="page"]{background:var(--soft)}
.panel{margin:8px 8px 8px 0;background:var(--canvas);border:1px solid var(--hair);border-radius:12px;min-width:0}
.ph{height:48px;border-bottom:1px solid var(--hair);display:flex;align-items:center;gap:6px;padding:0 16px}
.pb{padding:32px 24px 64px}
.wrap{max-width:768px;margin:0 auto}
h1{font-size:26px;font-weight:600;letter-spacing:-.02em;line-height:1.25;margin:0 0 8px;text-wrap:balance}
h2{font-size:16px;font-weight:500;margin:32px 0 8px}
p,ul,ol{margin:0 0 12px}
ul ul{margin:4px 0 0}
li+li{margin-top:4px}
.lead{font-size:15px;color:var(--mute)}
code{font-family:var(--mono);font-size:12px;background:var(--tint);border-radius:4px;padding:1px 4px}
pre{margin:0 0 12px;padding:12px 16px;border:1px solid var(--hair);border-radius:8px;background:var(--card);overflow:auto;font:12px/1.7 var(--mono)}
pre code{background:none;padding:0}
pre.cmd{margin:20px 0 12px;padding:14px 16px}
pre.cmd code{font-size:14px;user-select:all}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:8px;margin:32px 0}
.card{background:var(--card);border:1px solid var(--hair);border-radius:8px;padding:16px;display:flex;flex-direction:column;gap:10px}
.card .top{display:flex;gap:12px;align-items:center}
.card .name{font-weight:500}
.card p{margin:0;color:var(--mute)}
.tile{width:28px;height:28px;border-radius:8px;background:oklch(0% 0 0 / .05);box-shadow:inset 0 0 0 .5px oklch(0% 0 0 / .11);display:grid;place-items:center;flex:none}
@media (max-width:760px){
  .app{grid-template-columns:1fr}
  .side{position:static;height:auto;flex-direction:row;flex-wrap:wrap}
  .side .eyebrow{display:none}
  .team{width:100%}
  .panel{margin:0 8px 8px}
  .pb{padding:24px 16px 48px}
}
`

export const SITE = new Map(PAGES.map((page) => [page.path, render(page)]))

function render(page: Page) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${page.title}</title>
<meta name="description" content="${page.description}">
<link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${FONTS}">
<style>${CSS}</style>
</head>
<body>
<div class="app">
<nav class="side" aria-label="Site">
<a class="team" href="/"><span class="logo">${LOGO}</span>JakeBox</a>
${nav(page)}
</nav>
<main class="panel">
<header class="ph">${crumb(page)}</header>
<div class="pb"><article class="wrap">${page.body}
</article></div>
</main>
</div>
</body>
</html>
`
}

function nav(current: Page) {
  const links = PAGES.map((page) => `<a class="nav" href="${page.path}"${page === current ? ' aria-current="page"' : ''}>${page.nav}</a>`)
  return [links[0], '<p class="eyebrow">Docs</p>', ...links.slice(1)].join('\n')
}

function crumb(page: Page) {
  if (!page.path.startsWith('/docs/')) return `<span>${page.nav}</span>`
  return `<span class="mute">Docs</span><span class="mute">/</span><span>${page.nav}</span>`
}
