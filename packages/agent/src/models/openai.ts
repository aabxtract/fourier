import type { ModelAdapter, ModelRequest, ModelResponse } from './types.js'

export class OpenAIAdapter implements ModelAdapter {
  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (request.apiKey && !request.apiKey.startsWith('mock-')) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${request.apiKey}`
        },
        body: JSON.stringify({
          model: request.modelName || 'gpt-4o',
          ...(request.responseFormat === 'json' ? { response_format: { type: 'json_object' as const } } : {}),
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt }
          ]
        })
      })

      if (!response.ok) {
        throw new Error(`OpenAI API error (${response.status}): ${await response.text()}`)
      }

      const data = (await response.json()) as { choices: Array<{ message: { content: string } }> }
      return {
        raw: data.choices?.[0]?.message?.content || '',
        provider: 'openai',
        model: request.modelName
      }
    }

    // Offline / Demo fallback
    return {
      raw: request.userPrompt.includes('budget') || request.userPrompt.includes('triage')
        ? JSON.stringify({
            action: 'TRIAGE',
            rankedDatasetIds: ['build-cache', 'audit-archive'],
            reasoning: `OpenAI: Storage funds low at 0.7 USDFC. Recommending triage of non-essential datasets according to compiled policy priority.`
          })
        : JSON.stringify({
            action: 'HOLD',
            reasoning: `OpenAI: Storage account metrics are stable within policy parameters.`
          }),
      provider: 'openai',
      model: request.modelName || 'gpt-4o'
    }
  }
}
