export function page(sentence: string, { title, back }: { title?: string; back?: string } = {}): string {
  const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
  const heading = title ? `<h1 style="margin:0 0 8px;font-size:22px;line-height:1.25;font-weight:600">${escape(title)}</h1>` : ''
  const button = back ? `<a href="${escape(back)}" style="display:inline-block;margin-top:20px;padding:10px 20px;border-radius:10px;background:#0b0b0b;color:#fff;text-decoration:none;font-weight:500">Open OpenHut</a>` : ''
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>OpenHut</title><body style="margin:0;display:grid;place-items:center;min-height:90vh;font:15px/1.5 -apple-system,system-ui,sans-serif;color:#0b0b0b;background:#fff"><main style="max-width:420px;padding:0 16px;text-align:center"><p style="margin:0 0 20px;font-weight:600;letter-spacing:-.01em">OpenHut</p>${heading}<p style="margin:0;color:#45464a">${escape(sentence)}</p>${button}</main></body>`
}

export function posting({ url, field, value }: { url: string; field: string; value: string }): string {
  const attr = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
  return `<!doctype html><meta charset="utf-8"><title>OpenHut</title><form method="post" action="${attr(url)}"><input type="hidden" name="${attr(field)}" value="${attr(value)}"><noscript><button>Continue</button></noscript></form><script>document.forms[0].submit()</script>`
}
