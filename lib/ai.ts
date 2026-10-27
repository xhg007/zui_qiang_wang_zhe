import OpenAI from 'openai';
import { toAppError } from './errors';
import type { AppError } from './messaging';

/** 已翻译好的请求失败，抛出后由 background 直接回给 UI */
export class AppFailure extends Error {
  readonly appError: AppError;

  constructor(appError: AppError) {
    super(appError.message);
    this.name = 'AppFailure';
    this.appError = appError;
  }
}

export function isAppFailure(error: unknown): error is AppFailure {
  return error instanceof AppFailure;
}

/** AI 响应超时 30s（PRD 非功能需求） */
export const REQUEST_TIMEOUT_MS = 30_000;

export interface ChatOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: { role: 'system' | 'user'; content: string }[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

/**
 * 流式版本：逐块回调增量文本，返回完整内容。
 * 与 chatCompletion 共用同一套客户端配置与错误翻译。
 */
export async function chatCompletionStream(
  options: ChatOptions,
  onDelta: (delta: string) => void,
): Promise<string> {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseUrl,
    timeout: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    maxRetries: 0,
    dangerouslyAllowBrowser: true,
  });

  try {
    const stream = await client.chat.completions.create({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.8,
      max_tokens: options.maxTokens ?? 700,
      stream: true,
    });

    let content = '';
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        content += delta;
        onDelta(delta);
      }
    }

    if (!content.trim()) {
      throw new AppFailure({
        code: 'UNKNOWN',
        message: '供应商返回了空内容：请重试，或换一个模型。',
      });
    }
    return content;
  } catch (error) {
    if (isAppFailure(error)) throw error;
    throw new AppFailure(toAppError(error));
  }
}

/**
 * 唯一的网络出口：所有预设供应商与自定义供应商共用这一套 OpenAI 兼容调用（R6）。
 * 不做任何供应商分支判断。
 */
export async function chatCompletion(options: ChatOptions): Promise<string> {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseUrl,
    timeout: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    // 失败由 UI 提供「重试」按钮，SDK 内部不再重试，避免超时叠加
    maxRetries: 0,
    // 请求只发生在 background service worker；该开关兼容将来在页面上下文复用
    dangerouslyAllowBrowser: true,
  });

  try {
    const completion = await client.chat.completions.create({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 700,
      stream: false,
    });

    const content = completion.choices?.[0]?.message?.content;
    if (!content || !content.trim()) {
      throw new AppFailure({
        code: 'UNKNOWN',
        message: '供应商返回了空内容：请重试，或换一个模型。',
      });
    }
    return content;
  } catch (error) {
    if (isAppFailure(error)) throw error;
    throw new AppFailure(toAppError(error));
  }
}
