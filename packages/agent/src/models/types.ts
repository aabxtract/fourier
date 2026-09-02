export interface ModelRequest {
  systemPrompt: string
  userPrompt: string
  modelName: string
  apiKey?: string
  temperature?: number
}

export interface ModelResponse {
  raw: string
  provider: string
  model: string
}

export interface ModelAdapter {
  complete(request: ModelRequest): Promise<ModelResponse>
}
