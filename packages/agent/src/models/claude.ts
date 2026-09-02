import type { ModelAdapter, ModelRequest, ModelResponse } from './types.js'

export class ClaudeAdapter implements ModelAdapter {
  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (request.apiKey && !request.apiKey.startsWith('mock-')) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': request.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: request.modelName || 'claude-3-7-sonnet-latest',
          max_tokens: 1024,
          system: request.systemPrompt,
          messages: [{ role: 'user', content: request.userPrompt }]
        })
      })

      if (!response.ok) {
        throw new Error(`Claude API error (${response.status}): ${await response.text()}`)
      }

      const data = (await response.json()) as { content: Array<{ text: string }> }
      return {
        raw: data.content?.[0]?.text || '',
        provider: 'claude',
        model: request.modelName
      }
    }

    // Offline / Demo fallback
    return {
      raw: request.userPrompt.includes('burn')
        ? JSON.stringify({
            action: 'TOP_UP',
            amountUSDFC: 7.5,
            reasoning: `Claude: Detected accelerating burn rate reducing effective runway to 2.1 days. Proposing 7.5 USDFC top up to extend runway to 33 days.`
          })
        : JSON.stringify({
            action: 'HOLD',
            reasoning: `Claude: Runway healthy and within policy thresholds.`
          }),
      provider: 'claude',
      model: request.modelName || 'claude-3-7-sonnet-latest'
    }
  }
}
