import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function jsonOrUndefined(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

export function errorText(e: unknown) {
  const stderr = isRecord(e) ? e.stderr : undefined
  if (typeof stderr === 'string' && stderr.trim()) return stderr.trim()
  return e instanceof Error ? e.message : String(e)
}

export const EXEC = { maxBuffer: 16 << 20, timeout: 60_000 }

const exec = promisify(execFile)

export async function cli(...args: string[]): Promise<string> {
  return (await exec('docker', args, EXEC)).stdout.trim()
}
