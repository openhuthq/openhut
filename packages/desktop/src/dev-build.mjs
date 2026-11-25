export const DEV_NAME = 'OpenHut Dev'

export function devBuild({ packaged, name, testHome }) {
  return !packaged || name === DEV_NAME || Boolean(testHome)
}

export function devLabel(cloudUrl) {
  const { hostname } = new URL(cloudUrl)
  return ['127.0.0.1', 'localhost'].includes(hostname) ? 'Dev · local cloud' : `Dev · ${hostname}`
}
