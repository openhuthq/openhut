const RESERVED = /[\s"'\\><~|&;$*?#()`]/
const CARRIED = (arg) => arg === '--no-sandbox' || arg.startsWith('--password-store=')

export function linkHandler({ exec, argv, scheme }) {
  const args = [exec, ...argv.filter(CARRIED)].map(execArg).join(' ')
  return `[Desktop Entry]\nType=Application\nName=OpenHut\nExec=${args} %U\nTerminal=false\nNoDisplay=true\nMimeType=x-scheme-handler/${scheme};\n`
}

function execArg(arg) {
  const value = arg.replaceAll('%', '%%')
  if (!RESERVED.test(value)) return value
  return `"${value.replace(/["`$\\]/g, (char) => `\\${char}`)}"`.replaceAll('\\', '\\\\')
}
