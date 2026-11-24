function words(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function readable({ body, name }: { body: string; name: string }) {
  const content = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trimStart()
  const heading = /^#{1,6}\s+(.*)\r?\n?/.exec(content)
  return heading && words(heading[1]) === words(name) ? content.slice(heading[0].length).trimStart() : content
}
