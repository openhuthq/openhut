import { useState, type FormEvent, type ReactNode } from 'react'
import type { Install, Release } from '@jakebox/common/console/console.ts'
import { useInstalls, useReleases } from './api.ts'

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function App() {
  const [publishKey, setPublishKey] = useState('')
  const showInstalls = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPublishKey(String(new FormData(event.currentTarget).get('publishKey') ?? ''))
  }
  return <main className="panel">
    <div className="head"><span className="logo">J</span><h1>JakeBox console</h1></div>
    <section>
      <h2>Releases</h2>
      <Releases />
    </section>
    <section>
      <h2>Installs</h2>
      <form className="keyform" onSubmit={showInstalls}>
        <input name="publishKey" type="password" required autoComplete="off" aria-label="Publish key" placeholder="Publish key" />
        <button className="btn">Show installs</button>
      </form>
      {publishKey && <Installs publishKey={publishKey} />}
    </section>
  </main>
}

function Releases() {
  const releases = useReleases()
  if (releases.error) return <p className="err" role="alert">{releases.error.message}</p>
  if (!releases.data) return <p className="mute">Loading…</p>
  return <Table head={['Version', 'Build', 'Released', 'SHA-256', 'Download']} empty="No releases yet. scripts/release.sh registers one when CONSOLE_URL is set."
    rows={releases.data.data.map((release, index) => <ReleaseRow key={release.id} release={release} latest={index === 0} />)} />
}

function ReleaseRow({ release, latest }: { release: Release; latest: boolean }) {
  return <tr title={release.notes || undefined}>
    <td>{release.version}{latest && <span className="pill">Latest</span>}</td>
    <td className="mono">{release.build}</td>
    <td>{when.format(new Date(release.createdAt))}</td>
    <td className="mono" title={release.sha256}>{release.sha256.slice(0, 12)}…</td>
    <td><a href={release.url}>jakebox.tgz</a></td>
  </tr>
}

function Installs({ publishKey }: { publishKey: string }) {
  const installs = useInstalls(publishKey)
  if (installs.error) return <p className="err" role="alert">{installs.error.message}</p>
  if (!installs.data) return <p className="mute">Loading…</p>
  return <Table head={['Install', 'Version', 'Build', 'Last check-in', 'First seen']} empty="No install has checked in yet."
    rows={installs.data.data.map((install) => <InstallRow key={install.id} install={install} />)} />
}

function InstallRow({ install }: { install: Install }) {
  return <tr>
    <td className="mono" title={install.id}>{install.id.slice(0, 12)}…</td>
    <td>{install.version}</td>
    <td className="mono">{install.build}</td>
    <td>{when.format(new Date(install.lastCheckInAt))}</td>
    <td>{when.format(new Date(install.createdAt))}</td>
  </tr>
}

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[]; empty: string }) {
  if (!rows.length) return <div className="box empty">{empty}</div>
  return <div className="box"><table>
    <thead><tr>{head.map((title) => <th key={title}>{title}</th>)}</tr></thead>
    <tbody>{rows}</tbody>
  </table></div>
}
