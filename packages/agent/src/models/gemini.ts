import type { ModelAdapter, ModelRequest, ModelResponse } from './types.js'

export class GeminiAdapter implements ModelAdapter {
  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (request.apiKey && !request.apiKey.startsWith('mock-')) {
      const model = request.modelName || 'gemini-1.5-pro'
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${request.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${request.systemPrompt}\n\n${request.userPrompt}` }] }],
            generationConfig: { responseMimeType: 'application/json' }
          })
        }
      )

      if (!response.ok) {
        throw new Error(`Gemini API error (${response.status}): ${await response.text()}`)
      }

      const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
      return { raw: rawText, provider: 'gemini', model }
    }

    return {
      raw: JSON.stringify({
        action: 'HOLD',
        reasoning: 'Gemini: Storage runway evaluated and holding within safety parameters.'
      }),
      provider: 'gemini',
      model: request.modelName || 'gemini-1.5-pro'
    }
  }
}
