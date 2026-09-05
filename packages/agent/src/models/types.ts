export interface ModelRequest {
  systemPrompt: string
  userPrompt: string
  modelName: string
  apiKey?: string
  temperature?: number
  /**
   * 'json' — structured output mode (decision contracts).
   * 'text' — freeform natural language (conversational chat).
   * Default: text.
   */
  responseFormat?: 'json' | 'text'
}

export interface ModelResponse {
  raw: string
  provider: string
  model: string
}

export interface ModelAdapter {
  complete(request: ModelRequest): Promise<ModelResponse>
}
