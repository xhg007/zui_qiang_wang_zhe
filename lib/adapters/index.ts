import { detectAdapter, type SiteAdapterConfig } from './sites';

export * from './sites';

/** 捕获到的评论上下文 */
export interface CommentContext {
  /** 评论文本（优先整条评论，解析失败时回退为选中文本） */
  text: string;
  /** 发布者昵称，用于 Prompt 代称 */
  author?: string;
  /** 站点标识 */
  siteId: string;
  /** 触发位置，用于定位悬浮按钮 */
  rect: DOMRect;
  /** 讨论串上下文（F6），按时间正序 */
  context?: ThreadTurn[];
}

/** 从 DOM 元素解析出的评论（注入按钮 / F6 上下文用） */
export interface CommentTarget {
  element: Element;
  text: string;
  author?: string;
  siteId: string;
}

/** 讨论串里的一轮发言（F6） */
export interface ThreadTurn {
  author?: string;
  text: string;
}

export type FillResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'no-box' | 'write-failed' };

function closestBySelectors(node: Node | null, selectors: string[]): Element | null {
  let current: Element | null = node instanceof Element ? node : (node?.parentElement ?? null);
  for (let depth = 0; current && depth < 30; depth += 1) {
    for (const selector of selectors) {
      try {
        if (current.matches(selector)) return current;
      } catch {
        // 平台改版可能让选择器语法失效，忽略即可
      }
    }
    current = current.parentElement;
  }
  return null;
}

function firstText(container: Element, selectors: string[]): string {
  for (const selector of selectors) {
    let el: Element | null = null;
    try {
      el = container.querySelector(selector);
    } catch {
      continue;
    }
    const text = el?.textContent?.trim();
    if (text && text.length > 0) return text;
  }
  return '';
}

/** 去掉昵称里附带的 @handle、时间等噪声 */
function cleanupAuthor(raw: string): string {
  const firstLine = raw
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('@'));
  return (firstLine ?? '').replace(/^@/, '').slice(0, 40);
}

function fallbackContainer(node: Node | null): Element | null {
  let current: Element | null = node instanceof Element ? node : (node?.parentElement ?? null);
  for (let depth = 0; current && depth < 6; depth += 1) {
    const text = current.textContent?.trim() ?? '';
    if (text.length >= 20 && text.length <= 3000) return current;
    current = current.parentElement;
  }
  return null;
}

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function textOf(container: Element, adapter: SiteAdapterConfig): string {
  return (
    firstText(container, adapter.textSelectors) ||
    (container as HTMLElement).innerText?.trim() ||
    ''
  );
}

/**
 * 解析当前选区所属的评论（F1 的选中触发）。
 * 只在能确定站点时工作；未知站点返回 null，避免在不支持的页面乱弹按钮。
 */
export function resolveCommentContext(selection: Selection | null): CommentContext | null {
  const selectedText = selection?.toString().trim() ?? '';
  if (!selection || selection.rangeCount === 0) return null;

  const adapter = detectAdapter(location.href);
  if (!adapter) return null;

  const range = selection.getRangeAt(0);
  const anchorNode = range.commonAncestorContainer;
  const container =
    closestBySelectors(anchorNode, adapter.commentSelectors) ?? fallbackContainer(anchorNode);

  const rect = range.getBoundingClientRect();

  if (!container) {
    if (selectedText.length < 4) return null;
    return { text: selectedText, siteId: adapter.id, rect };
  }

  const text = textOf(container, adapter) || selectedText;
  if (!text || text.length < 4) return null;

  const author = cleanupAuthor(firstText(container, adapter.authorSelectors));

  return {
    text: text.slice(0, 4000),
    author: author || undefined,
    siteId: adapter.id,
    rect,
  };
}

/** 从任意元素向上解析出它所属的评论（评论内注入按钮用） */
export function resolveCommentFromElement(
  element: Element,
  adapterOverride?: SiteAdapterConfig,
): CommentTarget | null {
  const adapter = adapterOverride ?? detectAdapter(location.href);
  if (!adapter) return null;

  const container = closestBySelectors(element, adapter.commentSelectors);
  if (!container) return null;

  const text = textOf(container, adapter);
  if (!text || text.length < 4) return null;

  const author = cleanupAuthor(firstText(container, adapter.authorSelectors));

  return {
    element: container,
    text: text.slice(0, 4000),
    author: author || undefined,
    siteId: adapter.id,
  };
}

/**
 * 收集同一讨论串中、当前评论之前的若干轮发言（F6）。
 * 找不到同级的其它评论时返回空数组，生成时自然退化为单轮。
 */
export function collectThreadContext(
  target: CommentTarget,
  limit = 4,
  adapterOverride?: SiteAdapterConfig,
): ThreadTurn[] {
  const adapter = adapterOverride ?? detectAdapter(location.href);
  const parent = target.element.parentElement;
  if (!adapter || !parent) return [];

  let items: Element[] = [];
  try {
    items = Array.from(parent.querySelectorAll(adapter.threadItemSelectors.join(',')));
  } catch {
    return [];
  }

  const index = items.indexOf(target.element);
  if (index <= 0) return [];

  return items
    .slice(Math.max(0, index - limit), index)
    .map((element) => ({
      author: cleanupAuthor(firstText(element, adapter.authorSelectors)) || undefined,
      text: textOf(element, adapter)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 400),
    }))
    .filter((turn) => turn.text.length >= 4);
}

function findReplyBox(adapter: SiteAdapterConfig): HTMLElement | null {
  for (const selector of adapter.replyBoxSelectors) {
    let nodes: HTMLElement[] = [];
    try {
      nodes = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(isVisible);
    } catch {
      continue;
    }
    // 通常最新打开的编辑器在最后
    const candidate = nodes[nodes.length - 1];
    if (candidate) return candidate;
  }
  return null;
}

function waitForReplyBox(adapter: SiteAdapterConfig, timeoutMs = 1600): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      const box = findReplyBox(adapter);
      if (box) return resolve(box);
      if (Date.now() - startedAt >= timeoutMs) return resolve(null);
      setTimeout(tick, 120);
    };
    tick();
  });
}

/** 用平台组件能感知的方式写入文本（不触发发送） */
function writeToBox(box: HTMLElement, text: string): boolean {
  if (box instanceof HTMLTextAreaElement || box instanceof HTMLInputElement) {
    const proto =
      box instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    box.focus();
    setter?.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new Event('change', { bubbles: true }));
    return box.value === text;
  }

  if (box.isContentEditable) {
    box.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(box);
    selection?.removeAllRanges();
    selection?.addRange(range);
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch {
      inserted = false;
    }
    if (!inserted) {
      box.textContent = text;
      box.dispatchEvent(
        new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }),
      );
    }
    return (box.textContent ?? '').includes(text.slice(0, 12));
  }

  return false;
}

/**
 * 把草稿填入平台的回复框（用户点「填入回复框」时调用）。
 *
 * 合规边界：只会打开回复编辑器并写入文本，**绝不点击发送按钮**。
 * 找不到编辑器时返回 no-box，由 UI 回退到复制。
 */
export async function fillReplyBox(
  text: string,
  adapterOverride?: SiteAdapterConfig,
): Promise<FillResult> {
  const adapter = adapterOverride ?? detectAdapter(location.href);
  if (!adapter) return { ok: false, reason: 'unsupported' };
  if (!text.trim()) return { ok: false, reason: 'write-failed' };

  let box = findReplyBox(adapter);
  if (!box) {
    const opener = adapter.replyOpenSelectors
      .flatMap((selector) => {
        try {
          return Array.from(document.querySelectorAll<HTMLElement>(selector));
        } catch {
          return [];
        }
      })
      .find(isVisible);
    opener?.click();
    box = await waitForReplyBox(adapter);
  }

  if (!box) return { ok: false, reason: 'no-box' };
  if (!writeToBox(box, text)) return { ok: false, reason: 'write-failed' };
  // 填入后把编辑器带回视野（长页面里回复框常在下方）
  try {
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } catch {
    box.scrollIntoView();
  }
  return { ok: true };
}

export function adapterForCurrentSite(): SiteAdapterConfig | undefined {
  return detectAdapter(location.href);
}

/**
 * 当前页面是否值得带讨论串上下文（F6）。
 *
 * 时间线首页里所有推文同父，按兄弟节点取「上文」会把不相干的推文塞进 Prompt；
 * 只有推文详情页 / 微博正文页才真的是同一串对话。
 */
export function supportsThreadContext(
  adapterOverride?: SiteAdapterConfig,
  url = location.href,
): boolean {
  const adapter = adapterOverride ?? detectAdapter(url);
  if (!adapter?.threadContextPattern) return false;
  return adapter.threadContextPattern.test(url);
}
