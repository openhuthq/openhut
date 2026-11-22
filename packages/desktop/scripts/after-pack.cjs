const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

module.exports = async ({ appOutDir, electronPlatformName, packager }) => {
  if (electronPlatformName === 'linux') execFileSync('chmod', ['-R', 'go-w', appOutDir])
  if (electronPlatformName !== 'darwin') return
  const signing = process.env.CSC_IDENTITY_AUTO_DISCOVERY !== 'false'
  const keychain = signing ? (await packager.codeSigningInfo.value)?.keychainFile : null
  const env = { ...process.env, ...(signing ? { PASSKEY_SIGN: '1' } : { PASSKEY_PROFILE: '' }), ...(keychain ? { PASSKEY_KEYCHAIN: keychain } : {}) }
  const helper = execFileSync(join(__dirname, '..', 'native', 'passkey', 'build.sh'), { env, encoding: 'utf8' }).trim().split('\n').at(-1)
  const into = join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'passkey', 'OpenHut Passkey.app')
  execFileSync('ditto', [helper, into])
}
