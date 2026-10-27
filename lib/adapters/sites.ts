/**
 * 站点适配数据层（PRD F1 / 4. 可维护性）。
 *
 * 只放「数据」：选择器与站点信息。解析逻辑统一在 index.ts，
 * 新增站点 = 加一条配置，不改逻辑（平台改版时只改这里）。
 */
export interface SiteAdapterConfig {
  id: string;
  name: string;
  /** content script 注入范围，需与 entrypoints/content.ts 的 matches 保持一致 */
  hostPatterns: string[];
  /** 评论容器选择器，按优先级从内到外 */
  commentSelectors: string[];
  /** 正文选择器（容器内），按优先级 */
  textSelectors: string[];
  /** 作者选择器（容器内），按优先级 */
  authorSelectors: string[];
  /** 评论操作栏（点赞/回复所在行）：入口按钮优先注入这里 */
  actionBarSelectors: string[];
  /** 回复编辑器（contenteditable 或 textarea） */
  replyBoxSelectors: string[];
  /** 打开回复编辑器的按钮：仅在用户点「填入回复框」时才点，绝不点发送 */
  replyOpenSelectors: string[];
  /** 讨论串中的评论项（用于 F6 上下文多轮） */
  threadItemSelectors: string[];
  /**
   * 只有命中这个 URL 模式才带上讨论串上下文。
   * 时间线首页里所有推文同父，按兄弟节点取「上文」会把不相干的推文塞进 Prompt。
   */
  threadContextPattern?: RegExp;
}

export const SITE_ADAPTERS: SiteAdapterConfig[] = [
  {
    id: 'x',
    name: 'X (Twitter)',
    hostPatterns: ['*://x.com/*'],
    commentSelectors: ['article[data-testid="tweet"]', 'article'],
    textSelectors: ['[data-testid="tweetText"]', '[lang]'],
    authorSelectors: ['[data-testid="User-Name"] span', '[data-testid="User-Name"]'],
    actionBarSelectors: ['[role="group"]'],
    replyBoxSelectors: [
      '[data-testid="tweetTextarea_0"]',
      '[data-testid^="tweetTextarea_"] div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
    ],
    replyOpenSelectors: ['[data-testid="reply"]'],
    threadItemSelectors: ['article[data-testid="tweet"]'],
    threadContextPattern: /\/status\/\d+/,
  },
  {
    id: 'weibo',
    name: '微博',
    hostPatterns: ['*://weibo.com/*', '*://*.weibo.com/*'],
    commentSelectors: [
      'article',
      '.card-wrap',
      '.woo-panel-main',
      '[class*="Feed_wrap"]',
      '[class*="detail_wbtext"]',
    ],
    textSelectors: [
      '.woo-font--content',
      '.detail_wbtext',
      '.weibo-text',
      '[class*="wbtext"]',
      '[class*="text"]',
    ],
    authorSelectors: [
      '.woo-font--title a',
      '.nick-name',
      '.W_autocut a',
      '[class*="nick"]',
      'header a',
    ],
    actionBarSelectors: ['footer', '[class*="toolbar"]', '[class*="oper"]'],
    replyBoxSelectors: [
      '.woo-textarea textarea',
      'textarea[placeholder*="评论"]',
      'textarea[placeholder*="说点什么"]',
      'div[contenteditable="true"][class*="textarea"]',
    ],
    replyOpenSelectors: ['a[href*="comment"]', '[class*="toolbar"] [class*="comment"]'],
    threadItemSelectors: ['article', '.card-wrap'],
    threadContextPattern: /weibo\.com\/\d+\/[A-Za-z0-9]{6,}|\/(detail|comment)\//,
  },
];

export function detectAdapter(url: string): SiteAdapterConfig | undefined {
  return SITE_ADAPTERS.find((adapter) => adapter.hostPatterns.some((pattern) => matchesHost(pattern, url)));
}

function matchesHost(pattern: string, url: string): boolean {
  const normalized = pattern.replace(/^\*:\/\//, 'https://').replace(/\/\*$/, '');
  try {
    const host = new URL(normalized).hostname.replace(/^\*\./, '');
    const target = new URL(url).hostname;
    return target === host || target.endsWith(`.${host}`);
  } catch {
    return false;
  }
}
