export function page(sentence: string): string {
  const text = sentence.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>OpenHut</title><body style="margin:0;display:grid;place-items:center;min-height:90vh;font:15px/1.5 -apple-system,system-ui,sans-serif;color:#0b0b0b;background:#fff"><p style="max-width:420px;padding:0 16px;text-align:center">${text}</p></body>`
}

export function posting({ url, field, value }: { url: string; field: string; value: string }): string {
  const attr = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
  return `<!doctype html><meta charset="utf-8"><title>OpenHut</title><form method="post" action="${attr(url)}"><input type="hidden" name="${attr(field)}" value="${attr(value)}"><noscript><button>Continue</button></noscript></form><script>document.forms[0].submit()</script>`
}
