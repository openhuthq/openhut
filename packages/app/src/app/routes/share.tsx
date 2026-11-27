import { useQuery } from '@tanstack/react-query'
import { Hut } from '@/components/hut'
import { ErrorNote } from '@/components/error-note'
import { KindTile, retryUnlessGone } from '@/features/artifacts/artifact-card'
import { SharedArtifact } from '@/features/artifacts/artifact'
import { NotesMarkdown, Viewer } from '@/features/artifacts/artifact-pane'
import { ChatMarkdown } from '@/features/threads/components/messages'
import { request, RequestError } from '@/lib/api-client'

export function SharePage({ token }: { token: string }) {
  const shared = useQuery({ queryKey: ['share', token], queryFn: () => request({ schema: SharedArtifact, path: `/api/share/${encodeURIComponent(token)}` }), retry: retryUnlessGone })
  const gone = shared.error instanceof RequestError && shared.error.status === 404
  const data = shared.data
  return <main className="flex h-dvh flex-col bg-card text-ink">
    <title>{data ? `${data.title} · OpenHut` : 'OpenHut'}</title>
    <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-hair px-4">
      {data && <KindTile kind={data.kind} title={data.title} small />}
      {data && <b className="min-w-0 truncate font-medium">{data.title}</b>}
      {data && <span className="shrink-0 text-[13px] text-mute phone:hidden">by {data.agentName}</span>}
      <a href="https://openhut.dev" target="_blank" rel="noreferrer" className="ml-auto flex shrink-0 items-center gap-1.5 text-[13px] text-mute no-underline hover:text-ink"><Hut className="size-5" />Made with OpenHut</a>
    </header>
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {data
        ? <NotesMarkdown value={ChatMarkdown}><Viewer view={data} /></NotesMarkdown>
        : <div className="grid size-full place-items-center p-6 text-center">{gone ? <p className="m-0 text-mute">This link doesn’t work anymore. Ask whoever sent it for a new one.</p> : <ErrorNote message={shared.error?.message} />}</div>}
    </div>
  </main>
}
