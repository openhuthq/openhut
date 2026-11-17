const { execFileSync } = require('node:child_process')

module.exports = ({ appOutDir, electronPlatformName }) => {
  if (electronPlatformName === 'linux') execFileSync('chmod', ['-R', 'go-w', appOutDir])
}
