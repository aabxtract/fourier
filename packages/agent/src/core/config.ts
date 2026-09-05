import { z } from 'zod'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import dotenv from 'dotenv'
import type { FourierConfig } from '../types.js'

// Load .env if present
dotenv.config()

export const ProviderSchema = z.enum(['claude', 'openai', 'grok', 'gemini', 'groq'])
export const RoleSchema = z.enum(['standalone', 'child', 'treasury'])
export const NetworkSchema = z.enum(['calibration', 'mainnet'])

export const FourierConfigSchema = z
  .object({
    agentId: z.string().min(1, 'agentId cannot be empty'),
    network: NetworkSchema,
    role: RoleSchema.default('standalone'),
    treasuryAgentId: z.string().nullable().default(null),
    walletAddress: z.string().optional(),
    model: z.object({
      provider: ProviderSchema,
      model: z.string().min(1, 'model name required')
    }),
    thresholds: z.object({
      warningRunwayDays: z.number().positive('warningRunwayDays must be positive'),
      actionRunwayDays: z.number().positive('actionRunwayDays must be positive'),
      maxAutoTopUpUSDFC: z.number().positive('maxAutoTopUpUSDFC must be positive')
    }),
    actions: z.object({
      topUpEnabled: z.boolean(),
      triageEnabled: z.boolean(),
      triageRequiresApproval: z.boolean()
    }),
    checkIntervalMinutes: z.number().min(1, 'checkIntervalMinutes must be at least 1'),
    delegationPollMinutes: z.number().min(1).optional()
  })
  .refine(
    cfg => cfg.thresholds.actionRunwayDays < cfg.thresholds.warningRunwayDays,
    {
      message: 'actionRunwayDays must be strictly less than warningRunwayDays',
      path: ['thresholds', 'actionRunwayDays']
    }
  )
  .refine(
    cfg => (cfg.role === 'child' ? typeof cfg.treasuryAgentId === 'string' && cfg.treasuryAgentId.trim().length > 0 : true),
    {
      message: 'treasuryAgentId is required when role is "child"',
      path: ['treasuryAgentId']
    }
  )

export function parseConfig(json: unknown): FourierConfig {
  return FourierConfigSchema.parse(json) as FourierConfig
}

export function loadConfigFile(filepath: string): FourierConfig {
  if (!existsSync(filepath)) {
    throw new Error(`Configuration file not found at: ${filepath}`)
  }
  const content = readFileSync(filepath, 'utf8')
  const parsed = JSON.parse(content)
  return parseConfig(parsed)
}

export interface EnvSecrets {
  walletPrivateKey?: string
  modelApiKey?: string
  groqApiKey?: string
  telegramBotToken?: string
  telegramChatId?: string
  discordWebhookUrl?: string
  discordBotToken?: string
  webhookUrl?: string
  rpcUrl?: string
  delegationUrl?: string
  dashboardToken?: string
  databaseUrl?: string
  viewUrl?: string
}

export function loadEnvSecrets(): EnvSecrets {
  return {
    walletPrivateKey: process.env.FOURIER_WALLET_PRIVATE_KEY,
    modelApiKey: process.env.FOURIER_MODEL_API_KEY,
    groqApiKey: process.env.FOURIER_GROQ_API_KEY,
    telegramBotToken: process.env.FOURIER_TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.FOURIER_TELEGRAM_CHAT_ID,
    discordWebhookUrl: process.env.FOURIER_DISCORD_WEBHOOK_URL,
    discordBotToken: process.env.FOURIER_DISCORD_BOT_TOKEN,
    webhookUrl: process.env.FOURIER_WEBHOOK_URL,
    rpcUrl: process.env.FOURIER_RPC_URL,
    delegationUrl: process.env.FOURIER_DELEGATION_URL,
    dashboardToken: process.env.FOURIER_DASHBOARD_TOKEN,
    databaseUrl: process.env.FOURIER_DATABASE_URL,
    viewUrl: process.env.FOURIER_VIEW_URL
  }
}
