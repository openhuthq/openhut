// Web app and GitHub links on openhut.dev: one anonymous event each to /api/events, which hands it to the Cloud. No cookies, no ids.
document.addEventListener('click', (e) => {
  const send = (name, properties) => navigator.sendBeacon('/api/events', JSON.stringify({ events: [{ name, properties, at: Date.now() }] }))
  const web = e.target.closest('a[href^="https://app.openhut.dev"]')
  if (web) return send('web_app_clicked', { location: web.dataset.location || 'other' })
  const gh = e.target.closest('a[href^="https://github.com/openhuthq/openhut"]')
  if (gh) send('github_clicked', { location: gh.dataset.location || 'other' })
})
