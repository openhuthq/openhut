import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'

const { values: args } = parseArgs({ options: { days: { type: 'string', default: '2' }, workflow: { type: 'string', default: 'desktop.yml' }, branch: { type: 'string' } } })
type Job = { name: string; conclusion: string | null; created_at: string; started_at: string; completed_at: string | null }
type Run = { id: number; head_branch: string; event: string; conclusion: string | null; created_at: string; updated_at: string }

const gh = <T>(path: string): T => JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', path], { encoding: 'utf8', maxBuffer: 1 << 28 })) as T
const repo = execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { encoding: 'utf8' }).trim()
const since = new Date(Date.now() - Number(args.days) * 86_400_000).toISOString().slice(0, 10)
const runs = gh<{ workflow_runs: Run[] }[]>(`repos/${repo}/actions/workflows/${args.workflow}/runs?per_page=100&created=>=${since}${args.branch ? `&branch=${args.branch}` : ''}`)
  .flatMap((page) => page.workflow_runs).filter((run) => run.conclusion && run.conclusion !== 'skipped')
const minutes = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 60_000
const pct = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(1) : '-'
}

const jobs = new Map<string, { pass: number[]; fail: number[]; queue: number[] }>()
const gate: number[] = []
for (const run of runs) {
  const list = gh<{ jobs: Job[] }[]>(`repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`).flatMap((page) => page.jobs)
  for (const job of list) {
    if (!job.completed_at || job.conclusion === 'skipped' || job.conclusion === 'cancelled') continue
    const entry = jobs.get(job.name) ?? { pass: [], fail: [], queue: [] }
    entry[job.conclusion === 'success' ? 'pass' : 'fail'].push(minutes(job.started_at, job.completed_at))
    entry.queue.push(minutes(job.created_at, job.started_at))
    jobs.set(job.name, entry)
  }
  const done = list.find((job) => job.name === 'gate' && job.conclusion === 'success')
  if (done?.completed_at && run.event === 'push' && run.head_branch !== 'main') gate.push(minutes(run.created_at, done.completed_at))
}

console.log(`${args.workflow} since ${since}: ${runs.length} runs, ${runs.filter((run) => run.conclusion === 'success').length} passed, ${runs.filter((run) => run.conclusion === 'failure').length} failed, ${runs.filter((run) => run.conclusion === 'cancelled').length} cancelled`)
console.log('job'.padEnd(28), 'pass p50  p90 | fail p50  p90 | queue p50  p90 | pass rate')
for (const [name, { pass, fail, queue }] of [...jobs].sort()) {
  console.log(name.padEnd(28), `${pct(pass, 0.5).padStart(8)} ${pct(pass, 0.9).padStart(4)} | ${pct(fail, 0.5).padStart(8)} ${pct(fail, 0.9).padStart(4)} | ${pct(queue, 0.5).padStart(9)} ${pct(queue, 0.9).padStart(4)} | ${pass.length}/${pass.length + fail.length}`)
}
if (gate.length) console.log(`PR gate (push to green gate, branches): p50 ${pct(gate, 0.5)} min, p90 ${pct(gate, 0.9)} min over ${gate.length} runs`)
