import type { ModelAdapter, ModelRequest, ModelResponse } from './types.js'

export class MockAdapter implements ModelAdapter {
  constructor(private cannedResponse?: string) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    return {
      raw: this.cannedResponse || JSON.stringify({
        action: 'HOLD',
        reasoning: 'Mock adapter evaluated state.'
      }),
      provider: 'mock',
      model: request.modelName
    }
  }
}
