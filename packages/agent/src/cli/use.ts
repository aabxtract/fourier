import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { FourierConfig, Provider } from '../types.js'

/** Sensible default model per provider — `fourier use` switches both. */
export const DEFAULT_MODELS: Record<Provider, string> = {
  claude: 'claude-3-7-sonnet-latest',
  openai: 'gpt-4o',
  gemini: 'gemini-1.5-pro',
  grok: 'grok-beta',
  groq: 'llama-3.1-8b-instant'
}

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
      model: { provider: provider as Provider, model: DEFAULT_MODELS[provider as Provider] },
      thresholds: { warningRunwayDays: 7, actionRunwayDays: 3, maxAutoTopUpUSDFC: 5 },
      actions: { topUpEnabled: true, triageEnabled: false, triageRequiresApproval: true },
      checkIntervalMinutes: 30
    }
  }

  // Switch BOTH provider and a valid default model — a stale model name from
  // the previous provider would be rejected by the new one.
  const previous = config.model.provider
  const changed = previous !== provider
  config.model.provider = provider as Provider
  config.model.model = DEFAULT_MODELS[provider as Provider]

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
  console.log(`Active AI provider set to: ${provider} (${DEFAULT_MODELS[provider as Provider]})`)
  if (changed) {
    console.log(`Model reset to the ${provider} default — override it in fourier.config.json if needed.`)
  }
}
