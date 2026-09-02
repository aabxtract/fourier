import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compilePolicy } from '../core/policy.js'

export async function policyCommand(action: string, filePath?: string) {
  if (action !== 'compile' || !filePath) {
    console.error('Usage: fourier policy compile <path-to-policy.txt>')
    process.exit(1)
  }

  const root = process.cwd()
  const rawPath = resolve(root, filePath)
  const content = readFileSync(rawPath, 'utf8')
  const compiled = compilePolicy(content)

  const outPath = resolve(root, 'fourier.policy.json')
  writeFileSync(outPath, JSON.stringify(compiled, null, 2) + '\n')

  console.log('--- Compiled Policy (Review) ---')
  console.log(JSON.stringify(compiled, null, 2))
  console.log(`\nSaved compiled policy to ${outPath}`)
}
