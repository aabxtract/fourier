import type { Provider } from '../types.js'
import type { ModelAdapter } from './types.js'
import { ClaudeAdapter } from './claude.js'
import { OpenAIAdapter } from './openai.js'
import { GeminiAdapter } from './gemini.js'
import { GrokAdapter } from './grok.js'
import { GroqFreeAdapter } from './groq-free.js'
import { MockAdapter } from './mock.js'

export * from './types.js'
export * from './claude.js'
export * from './openai.js'
export * from './gemini.js'
export * from './grok.js'
export * from './groq-free.js'
export * from './mock.js'

export function getModelAdapter(provider: Provider | 'mock', cannedResponse?: string): ModelAdapter {
  switch (provider) {
    case 'claude':
      return new ClaudeAdapter()
    case 'openai':
      return new OpenAIAdapter()
    case 'gemini':
      return new GeminiAdapter()
    case 'grok':
      return new GrokAdapter()
    case 'groq':
      return new GroqFreeAdapter()
    case 'mock':
    default:
      return new MockAdapter(cannedResponse)
  }
}

