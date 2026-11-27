import { cli, errorText } from '../util.ts'

export const hostIp = (net: number): string => `10.200.${net}.1`
export const agentIp = (net: number): string => `10.200.${net}.2`

export async function freshNetwork({ id, net }: { id: string; net: number }): Promise<void> {
  await cli('network', 'rm', `ag-${id}`).catch(() => undefined)
  const create = () => cli('network', 'create', '--subnet', subnetOf(net), '--gateway', hostIp(net), '--label', `openhut.agent=${id}`, `ag-${id}`)
  await create().catch(async (err: unknown) => {
    if (!/overlap/i.test(errorText(err))) throw err
    await dropUnused(subnetOf(net))
    return create()
  })
}

function subnetOf(net: number): string {
  return `10.200.${net}.0/24`
}

async function dropUnused(subnet: string): Promise<void> {
  for (const name of (await cli('network', 'ls', '--filter', 'name=ag-', '--format', '{{.Name}}')).split('\n').filter(Boolean)) {
    const used = await cli('network', 'inspect', '--format', '{{range .IPAM.Config}}{{.Subnet}}{{end}}', name).catch(() => '')
    if (used === subnet) await cli('network', 'rm', name).catch(() => undefined)
  }
}
