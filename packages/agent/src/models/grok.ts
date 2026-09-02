import type { ModelAdapter, ModelRequest, ModelResponse } from './types.js'

export class GrokAdapter implements ModelAdapter {
  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (request.apiKey && !request.apiKey.startsWith('mock-')) {
      const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${request.apiKey}`
        },
        body: JSON.stringify({
          model: request.modelName || 'grok-beta',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt }
          ]
        })
      })

      if (!response.ok) {
        throw new Error(`Grok API error (${response.status}): ${await response.text()}`)
      }

      const data = (await response.json()) as { choices: Array<{ message: { content: string } }> }
      return {
        raw: data.choices?.[0]?.message?.content || '',
        provider: 'grok',
        model: request.modelName
      }
    }

    return {
      raw: JSON.stringify({
        action: 'HOLD',
        reasoning: 'Grok: Runway metrics verified safe.'
      }),
      provider: 'grok',
      model: request.modelName || 'grok-beta'
    }
  }
}
