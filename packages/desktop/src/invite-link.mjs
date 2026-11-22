const INVITE = /^https:\/\/openhut\.dev\/join#[A-Za-z0-9_-]{8,64}\.[A-Za-z0-9_-]{43}$/

export function inviteLink(text) {
  const link = String(text ?? '').trim()
  return INVITE.test(link) ? link : null
}
