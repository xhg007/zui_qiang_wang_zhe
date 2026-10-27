import type { StyleId } from './prompts/styles';

/** 可读错误（code 用于 UI 分支，message 面向用户） */
export interface AppError {
  code:
    | 'NO_PROVIDER'
    | 'NO_BASE_URL'
    | 'NO_MODEL'
    | 'NO_KEY'
    | 'AUTH'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'RATE_LIMIT'
    | 'BAD_REQUEST'
    | 'SERVER'
    | 'TIMEOUT'
    | 'NETWORK'
    | 'PERMISSION'
    | 'ABORTED'
    | 'UNKNOWN';
  message: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

export interface GenerateResult {
  /** 已强制带 🤖 标识的草稿 */
  draft: string;
  style: StyleId;
  providerName: string;
  model: string;
  /** 耗时（毫秒），用于「≤15 秒」体验目标的自检 */
  elapsedMs: number;
  /** F9 识别出的语气标签（未开启或分析失败时为 null） */
  emotion?: string | null;
}

export interface TestConnectionResult {
  providerName: string;
  model: string;
  latencyMs: number;
  /** 模型返回的一句话，便于确认链路真的通了 */
  sample: string;
}

/** 上下文里的一轮发言（F6 多轮辩论） */
export interface DialogTurn {
  author?: string;
  text: string;
}

/** 生成请求的载荷（消息与流式通道共用） */
export interface GeneratePayload {
  text: string;
  author?: string;
  style: StyleId;
  /** 换风格重生成时的额外要求，可选 */
  previousDraft?: string;
  /** 讨论串上下文（F6），按时间正序 */
  context?: DialogTurn[];
}

/** 流式生成的端口名 */
export const STREAM_PORT = 'ai-stream';

export type StreamClientMessage = { type: 'generate'; payload: GeneratePayload };

export type StreamServerMessage =
  | { type: 'chunk'; delta: string }
  | { type: 'done'; data: GenerateResult }
  | { type: 'error'; error: AppError };

/** content / popup → background 的消息（生成走 port 流式通道，见 lib/stream.ts） */
export type BackgroundMessage =
  | {
      type: 'test-connection';
      payload: {
        providerId: string;
        model?: string;
        /** 未保存的 Key（用户刚粘贴、还没点保存时也能测试） */
        apiKey?: string;
        /** 自定义供应商的临时 base URL */
        baseUrl?: string;
      };
    }
  | { type: 'get-status' };

export interface StatusResult {
  configured: boolean;
  providerId: string | null;
  providerName: string | null;
  model: string | null;
}
