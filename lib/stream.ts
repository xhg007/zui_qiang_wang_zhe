import {
  STREAM_PORT,
  type AppError,
  type GeneratePayload,
  type GenerateResult,
  type StreamClientMessage,
  type StreamServerMessage,
} from './messaging';

/** 长时间没有新片段就判定为卡住（毫秒） */
const IDLE_TIMEOUT_MS = 45_000;

export interface StreamHandlers {
  /** 收到一段增量文本 */
  onDelta: (delta: string) => void;
  /** 生成完成（data.draft 是清洗过、带 🤖 标识的最终稿） */
  onDone: (data: GenerateResult) => void;
  /** 失败或中断 */
  onError: (error: AppError) => void;
}

/**
 * 流式生成：通过 port 长连接接收逐字增量（PRD 待确认问题 3 的结论）。
 * 返回取消函数；取消不会再回调任何 handler。
 */
export function streamGenerate(payload: GeneratePayload, handlers: StreamHandlers): () => void {
  let port: ReturnType<typeof browser.runtime.connect> | undefined;
  let finished = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * 空闲看门狗：SDK 的 30s 超时只管到「请求建立」，流读到一半卡住不会触发，
   * 这里在长时间没有新片段时主动中止并给出可读提示。
   */
  const clearIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined;
  };
  const resetIdle = () => {
    clearIdle();
    idleTimer = setTimeout(() => {
      if (finished) return;
      finished = true;
      close();
      handlers.onError({
        code: 'TIMEOUT',
        message: '生成中途长时间没有新内容：连接可能已卡住，请重试或换一家供应商。',
      });
    }, IDLE_TIMEOUT_MS);
  };

  try {
    port = browser.runtime.connect({ name: STREAM_PORT });
  } catch {
    handlers.onError({ code: 'UNKNOWN', message: '无法连接后台脚本：请刷新页面后重试。' });
    return () => {};
  }

  const close = () => {
    if (!port) return;
    try {
      port.disconnect();
    } catch {
      // 端口已断开，忽略
    }
    port = undefined;
  };

  port.onMessage.addListener((message: StreamServerMessage) => {
    if (finished) return;
    if (message.type === 'chunk') {
      resetIdle();
      handlers.onDelta(message.delta);
      return;
    }
    finished = true;
    clearIdle();
    close();
    if (message.type === 'done') handlers.onDone(message.data);
    else handlers.onError(message.error);
  });

  port.onDisconnect.addListener(() => {
    if (finished) return;
    finished = true;
    clearIdle();
    port = undefined;
    handlers.onError({
      code: 'UNKNOWN',
      message: '生成中断：与后台的连接断开了，请重试。',
    });
  });

  port.postMessage({ type: 'generate', payload } satisfies StreamClientMessage);
  resetIdle();

  return () => {
    finished = true;
    clearIdle();
    close();
  };
}
