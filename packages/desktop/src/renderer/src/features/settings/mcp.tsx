import { useQuery } from '@tanstack/react-query'
import { CommandLineIcon } from '@hugeicons/core-free-icons'
import { CopyButton } from '@/components/copy-button'
import { ErrorNote } from '@/components/error-note'
import { I, PILL } from '@/components/kit'
import { nameOf, useComputers } from '@/features/computers/api'
import { ComputerMark } from '@/features/settings/computers'
import { HERE, desktop, home } from '@/features/settings/desktop'
import { Row, Rows, Intro } from '@/features/settings/kit'
import { wordsOf } from '@/features/settings/command-words'

export function McpSettings() {
  const bridge = desktop?.mcp
  const computers = useComputers().data
  const commands = useQuery({ queryKey: ['mcp-commands'], queryFn: () => desktop?.mcpCommands?.() ?? [], enabled: !!desktop })
  return <>
    <Intro>Let Claude Code make agents and grant access for you. Run one of these once in a terminal.</Intro>
    {!desktop && <ErrorNote message="Open the OpenHut app on this computer to see this." />}
    <Rows>
      {commands.data?.map((each) => {
        const computer = computers?.find((one) => one.id === each.computer)
        return <Row key={each.computer} icon={computer ? <ComputerMark computer={computer} /> : <I icon={CommandLineIcon} size={20} className="text-hue-teal" />} title={nameOf({ computers, id: each.computer })}
          note={<><Mono text={each.command} />{each.computer !== 'local' && <span className="mt-1 block">Works while OpenHut is open on this {HERE}.</span>}</>}>
          <CopyButton text={each.command} label="Copy" plain className={PILL} />
        </Row>
      })}
      {bridge && <Row icon={<I icon={CommandLineIcon} size={20} className="text-hue-teal" />} title="Other apps" note={<><Mono text={bridge} /><span className="mt-1 block">Paste this path into any app that runs MCP servers.</span></>}><CopyButton text={bridge} label="Copy" plain className={PILL} /></Row>}
    </Rows>
  </>
}

function Mono({ text }: { text: string }) {
  return <code className="block font-mono text-[12px]/[16px]">{wordsOf(home(text)).map((word, index) => <span key={index}>{index > 0 && ' '}<span className="inline-block max-w-full [overflow-wrap:anywhere]">{word.replaceAll(' ', '\u00a0')}</span></span>)}</code>
}
