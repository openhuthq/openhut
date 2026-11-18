export { Invitation } from '@openhut/common/access/invitation.ts'

export function spaced(digits: string) {
  return `${digits.slice(0, 3)} ${digits.slice(3)}`
}

export function joinCommand(code: string) {
  return `curl -fsSL openhut.dev | sh -s -- join '${code.replaceAll("'", '')}'`
}
