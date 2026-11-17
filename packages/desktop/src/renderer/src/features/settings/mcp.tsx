import { useQuery } from '@tanstack/react-query'
import { CommandLineIcon } from '@hugeicons/core-free-icons'
import { CopyButton } from '@/components/copy-button'
import { ErrorNote } from '@/components/error-note'
import { I, PILL, Section } from '@/components/kit'
import { nameOf, useComputers } from '@/features/computers/api'
import { HERE, desktop } from '@/features/settings/desktop'
import { Command, Row, Rows, Intro } from '@/features/settings/kit'

export function McpSettings() {
  const bridge = desktop?.mcp
  const computers = useComputers().data
  const commands = useQuery({ queryKey: ['mcp-commands'], queryFn: () => desktop?.mcpCommands?.() ?? [], enabled: !!desktop })
  return <>
    <Intro>Let your own AI make agents and grant access for you. Run one of these once in your terminal for Claude Code.</Intro>
    {!desktop && <ErrorNote message="Open the OpenHut app on this computer to see this." />}
    {commands.data?.map((each) => <Section key={each.computer} title={each.computer === 'local' ? `On this ${HERE}` : nameOf({ computers, id: each.computer })}>
      <div className="flex flex-col gap-1.5 px-2.5">
        <Command text={each.command} />
        {each.computer !== 'local' && <p className="m-0 text-[13px] text-mute">It goes through this Mac, so it works while OpenHut is open here.</p>}
      </div>
    </Section>)}
    {bridge && <Rows>
      <Row icon={<I icon={CommandLineIcon} size={20} className="text-hue-teal" />} title="Other apps" note="Any MCP app: add a stdio server that runs the same bridge."><CopyButton text={bridge} label="Copy path" className={PILL} /></Row>
    </Rows>}
  </>
}
