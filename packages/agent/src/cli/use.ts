import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { FourierConfig, Provider } from '../types.js'

export async function useCommand(provider: string) {
  const root = process.cwd()
  const configPath = resolve(root, 'fourier.config.json')

  const validProviders: Provider[] = ['claude', 'openai', 'grok', 'gemini', 'groq']
  if (!validProviders.includes(provider as Provider)) {
    console.error(`Invalid provider: ${provider}. Supported: ${validProviders.join(', ')}`)
    process.exit(1)
  }

  let config: FourierConfig
  if (existsSync(configPath)) {
    config = JSON.parse(readFileSync(configPath, 'utf8')) as FourierConfig
  } else {
    config = {
      agentId: 'fourier-local',
      network: 'calibration',
      role: 'standalone',
      treasuryAgentId: null,
      model: { provider: provider as Provider, model: provider },
      thresholds: { warningRunwayDays: 7, actionRunwayDays: 3, maxAutoTopUpUSDFC: 5 },
      actions: { topUpEnabled: true, triageEnabled: false, triageRequiresApproval: true },
      checkIntervalMinutes: 30
    }
  }

  config.model.provider = provider as Provider
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
  console.log(`Active AI provider set to: ${provider}`)
}
