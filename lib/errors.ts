import type { AppError } from './messaging';

/** 把 HTTP 状态码翻译成用户能看懂的中文（PRD R4） */
function fromStatus(status: number): AppError {
  switch (status) {
    case 400:
      return {
        code: 'BAD_REQUEST',
        message: '请求被拒绝（400）：通常是模型名不被支持，或参数超出模型限制。请检查模型名。',
      };
    case 401:
      return {
        code: 'AUTH',
        message: 'Key 无效或已过期（401）：请到供应商控制台重新复制 API Key，注意不要带空格或引号。',
      };
    case 403:
      return {
        code: 'FORBIDDEN',
        message: 'Key 无权访问该模型（403）：可能未开通该模型，或 Key 与地域不匹配。',
      };
    case 404:
      return {
        code: 'NOT_FOUND',
        message: '接口路径不存在（404）：base URL 可能少了 /v1 或填错了。预设供应商请勿手改地址。',
      };
    case 422:
      return { code: 'BAD_REQUEST', message: '请求参数不被接受（422）：请检查模型名是否正确。' };
    case 429:
      return {
        code: 'RATE_LIMIT',
        message: '请求过于频繁或额度不足（429）：请稍后再试，或到供应商控制台确认余额。',
      };
    default:
      break;
  }

  if (status === 408 || status === 504) {
    return { code: 'TIMEOUT', message: '供应商响应超时，请稍后重试或换一家供应商。' };
  }
  if (status >= 500) {
    return {
      code: 'SERVER',
      message: `供应商服务端出错（${status}）：这通常是对方临时故障，稍后重试即可。`,
    };
  }
  return { code: 'UNKNOWN', message: `请求失败（HTTP ${status}）。` };
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

function nameOf(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error) {
    return String((error as { name?: unknown }).name ?? '');
  }
  return '';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}

/** 任意异常 → 可读错误 */
export function toAppError(error: unknown): AppError {
  const status = statusOf(error);
  if (status) return fromStatus(status);

  const name = nameOf(error);
  const message = messageOf(error);

  if (name === 'APIConnectionTimeoutError' || /timed? ?out/i.test(message)) {
    return { code: 'TIMEOUT', message: '请求超过 30 秒未返回：请重试，或换一家响应更快的供应商。' };
  }
  if (name === 'APIUserAbortError' || /aborted/i.test(message)) {
    return { code: 'ABORTED', message: '请求已取消。' };
  }
  if (
    name === 'APIConnectionError' ||
    /fetch failed|failed to fetch|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|certificate/i.test(
      message,
    )
  ) {
    return {
      code: 'NETWORK',
      message: '无法连接到供应商服务器：请检查网络或代理，自定义供应商还需确认域名权限已授予。',
    };
  }
  if (/permission|host_permissions/i.test(message)) {
    return {
      code: 'PERMISSION',
      message: '缺少该域名的访问权限：请在设置页重新保存并允许访问该域名。',
    };
  }

  return { code: 'UNKNOWN', message: message || '未知错误，请重试。' };
}
