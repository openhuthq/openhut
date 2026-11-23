export const DEV_NAME = 'OpenHut Dev'

export function devBuild({ packaged, name, testHome }) {
  return !packaged || name === DEV_NAME || Boolean(testHome)
}

export function devCloud(env) {
  return {
    OPENHUT_CLOUD_URL: env.OPENHUT_CLOUD_URL || 'http://127.0.0.1:8790',
    OPENHUT_API_URL: env.OPENHUT_API_URL || 'http://127.0.0.1:8792',
  }
}

export function devLabel(cloudUrl) {
  const { hostname } = new URL(cloudUrl)
  return ['127.0.0.1', 'localhost'].includes(hostname) ? 'Dev · local cloud' : `Dev · ${hostname}`
}
