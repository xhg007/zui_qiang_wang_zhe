import type { BackgroundMessage, Result } from './messaging';

/** 所有 UI → background 的消息都走这里，统一处理「后台无响应」的情况 */
export async function sendToBackground<T>(message: BackgroundMessage): Promise<Result<T>> {
  try {
    const response = (await browser.runtime.sendMessage(message)) as Result<T> | undefined;
    if (!response) {
      return {
        ok: false,
        error: { code: 'UNKNOWN', message: '后台没有响应：请刷新页面后重试，若仍失败请重新加载扩展。' },
      };
    }
    return response;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: { code: 'UNKNOWN', message: `无法连接后台脚本（${detail}）：请刷新页面后重试。` },
    };
  }
}

export function openOptionsPage(): void {
  void browser.runtime.openOptionsPage();
}

/** 把 base URL 归一化为权限 origins 形式，例如 https://api.foo.com/v1 → https://api.foo.com/* */
export function originPatternOf(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `${url.origin}/*`;
  } catch {
    return null;
  }
}

/**
 * 动态申请自定义供应商域名的访问权限（PRD F8：不预占宽泛权限）。
 *
 * 注意：这里刻意在函数内**同步**发起 `permissions.request`，不做 contains 预检——
 * 中间插入 await 会丢掉用户手势，Chrome 会直接拒绝弹授权框。
 * 因此必须在点击回调里第一时间调用本函数。
 */
export function requestOriginPermission(baseUrl: string): Promise<boolean> {
  const pattern = originPatternOf(baseUrl);
  if (!pattern) return Promise.resolve(false);
  return browser.permissions.request({ origins: [pattern] }).catch(() => false);
}
