import { detectAdapter, type SiteAdapterConfig } from './adapters/sites';
import { resolveCommentFromElement, type CommentTarget } from './adapters';

/**
 * 评论内入口按钮注入器（PRD F1 的第二种触发方式：不再需要先选中文本）。
 *
 * 设计要点：
 * - 只往页面里塞一个小胶囊按钮，不改动评论本身的 DOM 结构；
 * - 按钮样式全部 `!important` + `all: initial`，不继承平台 CSS，明暗主题下都清晰；
 * - MutationObserver + 去重标记，适配无限滚动与虚拟列表；
 * - 点击只做「打开草稿面板」，不发网络请求、不碰发送按钮。
 */
const BUTTON_CLASS = 'ai-duel-entry';
const MARK_ATTR = 'data-ai-duel-entry';
const STYLE_ID = 'ai-duel-entry-style';

/**
 * 跨模块 / 跨 chunk 的点击通知。
 *
 * 用 DOM 自定义事件而不是模块级 Set：打包时 ContentOverlay 与注入器可能被拆进不同的
 * chunk，模块级集合会出现两份互不相通的副本，导致点击无反应。
 */
export const ENTRY_CLICK_EVENT = 'ai-duel:entry-click';

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.${BUTTON_CLASS}{all:initial!important;display:inline-flex!important;align-items:center!important;gap:4px!important;box-sizing:border-box!important;height:24px!important;margin:0!important;padding:0 10px!important;border:none!important;border-radius:999px!important;cursor:pointer!important;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif!important;font-size:12px!important;font-weight:700!important;line-height:1!important;letter-spacing:.2px!important;color:#fff!important;background:linear-gradient(135deg,#ff4d6d 0%,#ff8a5b 100%)!important;box-shadow:0 4px 12px -6px rgba(255,77,109,.9)!important;white-space:nowrap!important;vertical-align:middle!important;text-transform:none!important;transition:filter .15s ease,transform .12s ease!important;}
.${BUTTON_CLASS}:hover{filter:brightness(1.08)!important;}
.${BUTTON_CLASS}:active{transform:scale(.96)!important;}
.${BUTTON_CLASS}:disabled{opacity:.6!important;cursor:progress!important;}
.${BUTTON_CLASS}:focus-visible{outline:2px solid #ff4d6d!important;outline-offset:2px!important;}
`;
  (document.head ?? document.documentElement).append(style);
}

function pickActionBar(comment: Element, selectors: string[]): Element | null {
  for (const selector of selectors) {
    let nodes: Element[] = [];
    try {
      nodes = Array.from(comment.querySelectorAll(selector)).filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    } catch {
      continue;
    }
    const candidate = nodes[nodes.length - 1];
    if (candidate) return candidate;
  }
  return null;
}

function createButton(comment: Element, adapter: SiteAdapterConfig): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = BUTTON_CLASS;
  button.textContent = 'AI 回复';
  button.title = '用 AI 生成这段评论的回复草稿（不会自动发送）';
  button.setAttribute('aria-label', 'AI 回复');

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const target = resolveCommentFromElement(comment, adapter);
    if (!target) return;
    window.dispatchEvent(new CustomEvent<CommentTarget>(ENTRY_CLICK_EVENT, { detail: target }));
  });

  // 防止平台把按下事件当作卡片点击
  button.addEventListener('mousedown', (event) => event.stopPropagation());
  button.addEventListener('pointerdown', (event) => event.stopPropagation());

  return button;
}

function inject(comment: Element, adapter: SiteAdapterConfig): boolean {
  const button = createButton(comment, adapter);
  const bar = pickActionBar(comment, adapter.actionBarSelectors);
  if (bar) {
    bar.append(button);
  } else {
    button.style.margin = '6px 0 0 auto';
    comment.append(button);
  }

  comment.setAttribute(MARK_ATTR, '1');
  return true;
}

/** 扫描某个子树（首次传 document，之后只传新增节点），给未标记的评论补按钮 */
function scanIn(adapter: SiteAdapterConfig, root: ParentNode): void {
  const selector = adapter.commentSelectors.join(',');
  let candidates: Element[] = [];
  try {
    if (root instanceof Element && root.matches(selector)) candidates.push(root);
    candidates = candidates.concat(Array.from(root.querySelectorAll(selector)));
  } catch {
    return;
  }

  for (const element of candidates) {
    if (element.hasAttribute(MARK_ATTR)) continue;
    const target = resolveCommentFromElement(element, adapter);
    // resolveCommentFromElement 会向上找容器；只处理正好是容器的元素，避免重复
    if (!target || target.element !== element) {
      element.setAttribute(MARK_ATTR, 'skip');
      continue;
    }
    inject(element, adapter);
  }
}

/**
 * 启动注入器：返回停止函数（页面卸载或扩展失效时清理）。
 * adapterOverride 仅用于本地预览/测试，正常运行时自动按当前站点探测。
 */
export function startEntryButtons(adapterOverride?: SiteAdapterConfig): () => void {
  const adapter = adapterOverride ?? detectAdapter(location.href);
  if (!adapter) return () => {};

  ensureStyle();
  scanIn(adapter, document);

  /**
   * 之后只处理新增子树：X 的列表很长，每次变更都全页重扫代价太高。
   * 80ms 合并一批，滚动加载时按钮仍然几乎即时出现。
   */
  const pendingRoots = new Set<Element>();
  let scheduled: number | undefined;

  const flush = () => {
    scheduled = undefined;
    const roots = Array.from(pendingRoots);
    pendingRoots.clear();
    for (const root of roots) {
      if (root.isConnected) scanIn(adapter, root);
    }
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (node.nodeType === Node.ELEMENT_NODE) pendingRoots.add(node as Element);
      }
    }
    if (pendingRoots.size === 0) return;
    if (scheduled !== undefined) window.clearTimeout(scheduled);
    scheduled = window.setTimeout(flush, 80);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    if (scheduled !== undefined) window.clearTimeout(scheduled);
    for (const button of Array.from(document.querySelectorAll(`.${BUTTON_CLASS}`))) {
      button.remove();
    }
    for (const marked of Array.from(document.querySelectorAll(`[${MARK_ATTR}]`))) {
      marked.removeAttribute(MARK_ATTR);
    }
    document.getElementById(STYLE_ID)?.remove();
  };
}
