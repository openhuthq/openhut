import { initLogger, log } from 'evlog'

initLogger({ env: { service: 'jakebox' }, pretty: process.stdout.isTTY === true, redact: true })

export { log }
