import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/**
 * Minimal .env line store used by interactive setup (`fourier setup` and
 * `fourier init`). Creates the file if missing, upserts individual keys in
 * place, and never touches unrelated lines.
 */

export function upsertEnvLine(file: string, key: string, value: string): void {
  const line = `${key}=${value}`
  let content = ''
  if (existsSync(file)) {
    content = readFileSync(file, 'utf8')
    const re = new RegExp(`^${key}=.*$`, 'm')
    if (re.test(content)) {
      content = content.replace(re, line)
      writeFileSync(file, content)
      return
    }
  } else {
    content = '# Fourier agent environment\n'
  }
  if (content.length > 0 && !content.endsWith('\n')) content += '\n'
  content += `${line}\n`
  writeFileSync(file, content)
}

export function readEnvValue(file: string, key: string): string | null {
  if (!existsSync(file)) return null
  const match = readFileSync(file, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
  const value = match?.[1]?.trim()
  return value ? value : null
}
