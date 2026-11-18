const HOME = String.raw`\/(?:Users|home)\/[^/\s"]+`

export function home(text: string) {
  return text
    .replace(new RegExp(`"${HOME}"`, 'g'), '~')
    .replace(new RegExp(`"${HOME}\\/`, 'g'), '~/"')
    .replace(new RegExp(HOME, 'g'), '~')
}
