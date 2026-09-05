import type { ModelAdapter, ModelRequest, ModelResponse } from './types.js'

/**
 * Groq Free adapter — uses the Groq API (OpenAI-compatible) with openai/gpt-oss-120b.
 * Free tier, anyone can get a key at groq.com in under 30 seconds.
 */
export class GroqFreeAdapter implements ModelAdapter {
  private readonly baseUrl = 'https://api.groq.com/openai/v1'

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const modelName = request.modelName || 'openai/gpt-oss-120b'

    // Use FOURIER_GROQ_API_KEY if available, fall back to FOURIER_MODEL_API_KEY
    const apiKey = request.apiKey

    if (apiKey && !apiKey.startsWith('mock-')) {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelName,
          response_format: { type: 'json_object' },
          temperature: request.temperature ?? 0.3,
          max_tokens: 1024,
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt }
          ]
        })
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`Groq API error (${response.status}): ${errorBody}`)
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>
        model: string
        usage?: { total_tokens: number }
      }

      return {
        raw: data.choices?.[0]?.message?.content || '',
        provider: 'groq',
        model: data.model || modelName
      }
    }

    // Offline / Demo fallback — structured response for testing without a key
    return {
      raw: JSON.stringify({
        action: 'HOLD',
        reasoning: 'Groq (free tier): Storage account metrics within safe operating parameters. No action required.'
      }),
      provider: 'groq',
      model: modelName
    }
  }
}

/**
 * Groq Free adapter for conversational (non-JSON) responses.
 * Used by the ConversationEngine for natural language replies.
 */
export class GroqFreeConversationAdapter implements ModelAdapter {
  private readonly baseUrl = 'https://api.groq.com/openai/v1'

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const modelName = request.modelName || 'openai/gpt-oss-120b'
    const apiKey = request.apiKey

    if (apiKey && !apiKey.startsWith('mock-')) {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelName,
          temperature: request.temperature ?? 0.7,
          max_tokens: 1024,
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt }
          ]
        })
      })

      if (!response.ok) {
        throw new Error(`Groq API error (${response.status}): ${await response.text()}`)
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>
      }

      return {
        raw: data.choices?.[0]?.message?.content || '',
        provider: 'groq',
        model: modelName
      }
    }

    return {
      raw: 'I\'m running in offline mode without an API key. Configure your Groq API key (free at groq.com) in the FOURIER_GROQ_API_KEY environment variable to enable conversational features.',
      provider: 'groq',
      model: modelName
    }
  }
}
