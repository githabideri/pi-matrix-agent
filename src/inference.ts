import type { AgentBackend, ChatMessage } from "./types.js";

export class SimpleInferenceBackend implements AgentBackend {
  private baseUrl: string;
  private model: string;
  private apiKey: string;
  private maxTokens: number;

  constructor(config: {
    baseUrl: string;
    model: string;
    apiKey: string;
    maxTokens?: number;
  }) {
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.maxTokens = config.maxTokens || 2048;
  }

  async prompt(_roomId: string, text: string): Promise<string> {
    const messages: ChatMessage[] = [{ role: "user", content: text }];

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        max_tokens: this.maxTokens,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Inference failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    // Handle both streaming and non-streaming responses
    if (data.choices && data.choices.length > 0) {
      return data.choices[0].message.content || "";
    }

    return "No response from model.";
  }
}
