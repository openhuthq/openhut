import { config } from './config.ts'

export const AGENTS_RANGE = '10.200.0.0'
export const agentSubnet = (net: number): string => `10.200.${net}`
export const agentApiUrl = (net: number): string => config.agentApi ?? `http://${agentSubnet(net)}.2:8642`
