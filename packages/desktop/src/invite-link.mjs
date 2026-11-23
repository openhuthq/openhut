const INVITE = /^https:\/\/openhut\.dev\/join(#(?:[A-Za-z0-9_-]{1,430}#)?[A-Za-z0-9_-]{8,64}\.[A-Za-z0-9_-]{43})$/

export function invitePath(text) {
  const hash = INVITE.exec(String(text ?? '').trim())?.[1]
  return hash ? `/join${hash}` : undefined
}
