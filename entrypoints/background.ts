import { chatCompletion, chatCompletionStream, isAppFailure } from '@/lib/ai';
import { EMOTION_ADVICE, analyzeEmotion } from '@/lib/emotion';
import { toAppError } from '@/lib/errors';
import { buildMessages, finalizeDraft, type ChatMessage } from '@/lib/prompts';
import type {
  AppError,
  BackgroundMessage,
  GeneratePayload,
  Result,
  StatusResult,
  StreamClientMessage,
  StreamServerMessage,
  TestConnectionResult,
} from '@/lib/messaging';
import { STREAM_PORT } from '@/lib/messaging';
import { CUSTOM_PROVIDER_ID } from '@/lib/providers';
import {
  activeConfigItem,
  emotionAnalysisItem,
  getKey,
  getProviderInfo,
  promptOverridesItem,
  resolveActiveProvider,
  type ResolvedProvider,
  type ResolveFailure,
} from '@/lib/storage';

/**
 * 唯一的网络请求点（PRD F2：规避 CORS）。
 * content script 与 popup 只收发消息，不直接调用供应商 API。
 */
export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isKnownMessage(message)) return;
    void handleMessage(message)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse(fail(toError(error))));
    // 异步回复
    return true;
  });

  // 流式生成：port 长连接（打字机效果）
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== STREAM_PORT) return;
    port.onMessage.addListener((message: StreamClientMessage) => {
      if (message?.type !== 'generate') return;
      void handleStreamGenerate(message.payload, port);
    });
  });
});

function isKnownMessage(message: unknown): message is BackgroundMessage {
  if (typeof message !== 'object' || message === null) return false;
  const type = (message as { type?: unknown }).type;
  return type === 'test-connection' || type === 'get-status';
}

async function handleMessage(message: BackgroundMessage): Promise<Result<unknown>> {
  switch (message.type) {
    case 'test-connection':
      return handleTestConnection(message.payload);
    case 'get-status':
      return { ok: true, data: await getStatus() };
    default:
      return fail({ code: 'UNKNOWN', message: '未知消息类型。' });
  }
}

function fail(error: AppError): { ok: false; error: AppError } {
  return { ok: false, error };
}

/** 配置缺失 → 可执行的中文提示（引导用户去设置页） */
function fromResolveFailure(failure: ResolveFailure): AppError {
  switch (failure.reason) {
    case 'no-provider':
      return {
        code: 'NO_PROVIDER',
        message: '还没有选择 AI 供应商：打开设置页选一家（或填自定义接口），粘贴 Key 后即可生成。',
      };
    case 'no-base-url':
      return {
        code: 'NO_BASE_URL',
        message: '自定义供应商的接口地址还是空的：请填写以 /v1 结尾的 OpenAI 兼容地址。',
      };
    case 'no-model':
      return { code: 'NO_MODEL', message: `「${failure.provider.name}」还没有选择模型，请到设置页选择。` };
    case 'no-key':
      return {
        code: 'NO_KEY',
        message: `「${failure.provider.name}」的 API Key 还没有填写：到设置页粘贴 Key 后点「测试连接」确认可用。`,
      };
  }
}

interface PreparedGeneration {
  messages: ChatMessage[];
  emotion: string | null;
}

/**
 * 生成前的共同准备：F9 语气分析 + F7 自定义 Prompt + 组装消息。
 * 语气分析失败不影响生成（analyzeEmotion 内部已降级为 null）。
 */
async function prepareGeneration(
  payload: GeneratePayload,
  resolved: ResolvedProvider,
): Promise<PreparedGeneration> {
  const text = payload.text.trim();
  let emotion: string | null = null;
  let emotionNote: string | undefined;

  if (await emotionAnalysisItem.getValue()) {
    const label = await analyzeEmotion({
      text,
      author: payload.author,
      apiKey: resolved.apiKey,
      baseUrl: resolved.baseUrl,
      model: resolved.model,
    });
    if (label) {
      emotion = label;
      emotionNote = EMOTION_ADVICE[label];
    }
  }

  return {
    emotion,
    messages: buildMessages({
      text,
      author: payload.author,
      style: payload.style,
      previousDraft: payload.previousDraft,
      context: payload.context,
      emotionNote,
      overrides: await promptOverridesItem.getValue(),
    }),
  };
}

type RuntimePort = Parameters<Parameters<typeof browser.runtime.onConnect.addListener>[0]>[0];

/** 流式生成：把增量文本通过 port 推给页面 / 弹窗，结束再发终稿 */
async function handleStreamGenerate(payload: GeneratePayload, port: RuntimePort): Promise<void> {
  const send = (message: StreamServerMessage) => {
    try {
      port.postMessage(message);
    } catch {
      // 端口已关闭（用户关掉页面或面板），忽略
    }
  };

  const text = payload.text?.trim();
  if (!text) {
    send({
      type: 'error',
      error: { code: 'BAD_REQUEST', message: '没有可分析的文本：请先选中一条评论。' },
    });
    return;
  }

  const resolved = await resolveActiveProvider();
  if (!resolved.ok) {
    send({ type: 'error', error: fromResolveFailure(resolved) });
    return;
  }

  const resolvedValue = resolved.value;
  const startedAt = Date.now();

  try {
    const prepared = await prepareGeneration(payload, resolvedValue);
    const raw = await chatCompletionStream(
      {
        apiKey: resolvedValue.apiKey,
        baseUrl: resolvedValue.baseUrl,
        model: resolvedValue.model,
        messages: prepared.messages,
        temperature: 0.8,
        maxTokens: 700,
      },
      (delta) => send({ type: 'chunk', delta }),
    );

    send({
      type: 'done',
      data: {
        draft: finalizeDraft(raw),
        style: payload.style,
        providerName: resolvedValue.provider.name,
        model: resolvedValue.model,
        elapsedMs: Date.now() - startedAt,
        emotion: prepared.emotion,
      },
    });
  } catch (error) {
    send({ type: 'error', error: toError(error) });
  }
}

async function handleTestConnection(payload: {
  providerId: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}): Promise<Result<TestConnectionResult>> {
  const provider = await getProviderInfo(payload.providerId);
  if (!provider) return fail({ code: 'NO_PROVIDER', message: '供应商不存在，请重新选择。' });

  const baseUrl = (payload.baseUrl?.trim() || provider.baseUrl).trim();
  if (!baseUrl) {
    return fail({ code: 'NO_BASE_URL', message: '接口地址为空：请填写以 /v1 结尾的 OpenAI 兼容地址。' });
  }

  const active = await activeConfigItem.getValue();
  const model = (payload.model?.trim() || active?.model || provider.defaultModel).trim();
  if (!model) return fail({ code: 'NO_MODEL', message: '模型名为空：请先填写模型名。' });

  const apiKey = (payload.apiKey?.trim() || (await getKey(payload.providerId))).trim();
  if (!apiKey) return fail({ code: 'NO_KEY', message: 'API Key 为空：请先粘贴 Key。' });

  const startedAt = Date.now();
  try {
    const sample = await chatCompletion({
      apiKey,
      baseUrl,
      model,
      messages: [
        {
          role: 'user',
          content: '这是一次连接测试，请只回复四个字：连接成功',
        },
      ],
      temperature: 0,
      maxTokens: 24,
    });

    return {
      ok: true,
      data: {
        providerName: provider.name,
        model,
        latencyMs: Date.now() - startedAt,
        sample: sample.trim().slice(0, 40),
      },
    };
  } catch (error) {
    return fail(toError(error));
  }
}

async function getStatus(): Promise<StatusResult> {
  const resolved = await resolveActiveProvider();
  if (resolved.ok) {
    return {
      configured: true,
      providerId: resolved.value.provider.id,
      providerName: resolved.value.provider.name,
      model: resolved.value.model,
    };
  }

  if (resolved.reason === 'no-key' || resolved.reason === 'no-model' || resolved.reason === 'no-base-url') {
    return {
      configured: false,
      providerId: resolved.provider.id,
      providerName: resolved.provider.name,
      model: resolved.provider.id === CUSTOM_PROVIDER_ID ? null : resolved.provider.defaultModel,
    };
  }

  return { configured: false, providerId: null, providerName: null, model: null };
}

function toError(error: unknown): AppError {
  if (isAppFailure(error)) return error.appError;
  return toAppError(error);
}
