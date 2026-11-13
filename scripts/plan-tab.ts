import { readdirSync, readFileSync } from 'node:fs'
import type { PhaseResults } from '../packages/e2e/src/e2e.ts'

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const CAPTIONS: Record<string, string> = {
  '01-agents.jpg': "Agents: the run's Dev agent, live container status",
  '02-dev.jpg': 'Dev: instructions, model, channels and its Orders DB grant',
  '03-orders-db.jpg': "Orders DB: the run's real gateway calls, allowed and failed",
  '05-connections.jpg': 'Connections: Orders DB connected',
  '06-admin.jpg': 'Admin: the seat set over the AI assistant connection (test mode), server healthy',
  '07-people.jpg': 'People: the owner, and the member who joined through an invite link',
}
const shots = process.argv[2]
if (!shots) throw new Error('Usage: node scripts/plan-tab.ts <folder of compressed jpgs> > tab.html')

const phases = ['main', 'after-upgrade', 'after-restart'].map((p): PhaseResults => JSON.parse(readFileSync(`packages/e2e/results/e2e-${p}.json`, 'utf8')))
const rows = phases.flatMap((p) => p.results.map((r) => ({ ...r, phase: p.phase })))
const passed = rows.filter((r) => r.pass).length
const plan = readFileSync('docs/verification-plan.md', 'utf8')
const notVerified = section('Not verified here')
  .split('\n')
  .filter((l) => /^\| (?!Item|---)/.test(l))
  .map((l) =>
    l
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean),
  )
const risks = section('Accepted risks')
  .split('\n')
  .filter((l) => l.startsWith('- '))
  .map((l) => l.slice(2))
const table = rows
  .map(
    (r) =>
      `<tr><td class="mono">${esc(r.id)}</td><td>${esc(r.check)}<div class="mute" style="font-size:12px">${esc(r.expected)}</div></td><td class="mono mute">${esc(r.phase)}</td><td>${badge(r.pass)}</td></tr>`,
  )
  .join('')
const imgs = readdirSync(shots)
  .filter((f) => CAPTIONS[f])
  .sort()
  .map(
    (f) =>
      `<figure style="margin:0"><img alt="${esc(CAPTIONS[f])}" style="width:100%;border-radius:8px;border:1px solid var(--hair)" src="data:image/jpeg;base64,${readFileSync(`${shots}/${f}`).toString('base64')}"><figcaption class="mute" style="font-size:12px;margin-top:6px">${esc(CAPTIONS[f])}</figcaption></figure>`,
  )
  .join('')
const signOff = plan.includes('**User sign-off on parity: pending.**') ? 'Mock-parity sign-off: pending.' : 'Mock-parity sign-off: recorded in the plan.'

console.log(`<section class="view" id="v-tests" hidden>
    <div class="docbody">
      <div class="blk"><h3>Final test plan, and the run that passed it</h3>
        <p><b>${passed}/${rows.length} checks passed</b> on ${esc(phases[0].at.slice(0, 10))} across three phases: a fresh install on a bare Linux server, an upgrade installed over it with the same command, and a server restart. Full plan: <code>docs/verification-plan.md</code>. Re-run everything with <code>npm run e2e</code>.</p>
        <pre class="code" style="margin:12px 0 0">curl -fsSL https://get.jakebox.dev | sh</pre>
        <p class="mute" style="margin:8px 0 0">The installer adds what's missing (Docker, gVisor, Node 22.18+), downloads JakeBox and Claude Code, and checks every download against a checksum written into the installer. It starts the firewall before Docker, agentd as root and the app as an unprivileged user, then prints a one-time link that signs up the owner; after that, people join by invite. In the test it ran against a bare <code>docker:dind</code> container, served from the Mac as a stand-in for <code>get.jakebox.dev</code>; a tampered download is refused first.</p>
      </div>
      <div class="cols">
        <div class="blk"><h3>Not verified here</h3><ul>${notVerified.map(([item, why, how]) => `<li><b>${md(item)}</b>: ${md(why)}. ${md(how)}</li>`).join('')}</ul></div>
        <div class="blk"><h3>Accepted risks in v1</h3><ul>${risks.map((r) => `<li>${md(r)}</li>`).join('')}</ul></div>
      </div>
      <div class="blk"><h3>Every check</h3><div class="tblwrap"><table class="tbl"><tr><th>ID</th><th>Check</th><th>Phase</th><th>Result</th></tr>${table}</table></div></div>
      <div class="blk"><h3>The real deployment, after the run</h3><p class="mute">Screenshots of this run's own server in Chrome, signed in with the run's generated owner account.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(420px,100%),1fr));gap:16px;margin-top:12px">${imgs}</div></div>
      <div class="blk"><h3>Pass criteria</h3><p>The run passes every check; the evidence matches the report; three reviewer agents, briefed only with the plan, the code and this evidence, return zero comments (a senior software engineer, a security / SRE reviewer, and a QA / verification reviewer); and the user signs off on mock parity. ${esc(signOff)}</p></div>
    </div>
  </section>`)

function section(title: string) {
  return plan.split(/^## /m).find((s) => s.startsWith(title)) ?? ''
}

function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c)
}

function md(s: string) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
}

function badge(ok: boolean) {
  return ok ? '<span class="status success">Pass</span>' : '<span class="status destructive">Fail</span>'
}
