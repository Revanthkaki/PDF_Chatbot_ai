import Groq from "groq-sdk";
import type { ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";
import type { Content, FunctionCall, GenerateContentParameters } from "@google/genai";
import { toolDeclarations } from "./research";

export function groqMessages(contents: GenerateContentParameters["contents"]): ChatCompletionMessageParam[] {
  if (typeof contents === "string") return [{ role: "user", content: contents }];
  const messages: ChatCompletionMessageParam[] = [];
  const entries = (Array.isArray(contents) ? contents : [contents]) as Content[];
  for (const entry of entries) {
    const parts = entry.parts || [];
    const text = parts.map(part => part.text || "").join("\n");
    const calls = parts.flatMap(part => part.functionCall ? [part.functionCall] : []);
    const responses = parts.flatMap(part => part.functionResponse ? [part.functionResponse] : []);
    if (entry.role === "model") {
      messages.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls.map((call, index) => ({ id: call.id || `call_${messages.length}_${index}`, type: "function" as const, function: { name: call.name || "unknown", arguments: JSON.stringify(call.args || {}) } })) } : {}) });
    } else {
      for (const response of responses) {
        const lastAssistant = messages.findLast(message => message.role === "assistant");
        const call = lastAssistant?.role === "assistant" ? lastAssistant.tool_calls?.find(call => call.type === "function" && call.function.name === response.name) : undefined;
        messages.push({ role: "tool", tool_call_id: response.id || call?.id || "unknown", content: JSON.stringify(response.response || {}) });
      }
      if (text) messages.push({ role: "user", content: text });
    }
  }
  return messages;
}

export function groq() {
  if (!process.env.GROQ_API_KEY) throw new Error("Groq is not configured. Set GROQ_API_KEY in .env.local and restart the app.");
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY, baseURL: process.env.GROQ_BASE_URL || "https://api.groq.com", timeout: 90_000, maxRetries: 0 });
  const options = (input: GenerateContentParameters) => ({
    model: input.model,
    messages: groqMessages(input.contents),
    temperature: input.config?.temperature ?? 0,
    max_completion_tokens: input.config?.maxOutputTokens ?? 3000,
    ...(input.config?.responseMimeType === "application/json" ? { response_format: { type: "json_object" as const } } : {}),
    ...(input.config?.tools?.length ? { tools: toolDeclarations.map(tool => ({ type: "function" as const, function: { name: tool.name, description: tool.description, parameters: tool.parametersJsonSchema } })), tool_choice: "auto" as const } : {}),
  });
  return { models: {
    async generateContent(input: GenerateContentParameters) {
      const response = await client.chat.completions.create({ ...options(input), stream: false }, { signal: input.config?.abortSignal });
      const message = response.choices[0]?.message;
      const calls: FunctionCall[] = (message?.tool_calls || []).map(call => {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.function.arguments); } catch { args = { invalidArguments: true }; }
        return { id: call.id, name: call.function.name, args };
      });
      const content: Content = { role: "model", parts: [...(message?.content ? [{ text: message.content }] : []), ...calls.map(functionCall => ({ functionCall }))] };
      return { text: message?.content || "", functionCalls: calls, candidates: [{ content }] };
    },
    async generateContentStream(input: GenerateContentParameters) {
      const stream = await client.chat.completions.create({ ...options(input), stream: true }, { signal: input.config?.abortSignal });
      return (async function* () {
        for await (const chunk of stream) yield { text: chunk.choices[0]?.delta.content || "" };
      })();
    },
  } };
}