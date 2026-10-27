import { beforeEach, describe, expect, it } from 'vitest';
import {
  collectThreadContext,
  fillReplyBox,
  resolveCommentFromElement,
  supportsThreadContext,
} from './index';
import { SITE_ADAPTERS } from './sites';

const xAdapter = SITE_ADAPTERS.find((item) => item.id === 'x')!;
const weiboAdapter = SITE_ADAPTERS.find((item) => item.id === 'weibo')!;

/** happy-dom 里所有元素尺寸为 0，可见性判断需要手动给一个矩形 */
function mockRect(element: Element) {
  element.getBoundingClientRect = () =>
    ({
      width: 120,
      height: 24,
      top: 0,
      left: 0,
      bottom: 24,
      right: 120,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

function tweet(author: string, text: string): string {
  return `
    <article data-testid="tweet">
      <div data-testid="User-Name"><span>${author}</span><span>@handle</span></div>
      <div data-testid="tweetText" lang="zh">${text}</div>
      <div role="group"><span>12</span><span>3</span></div>
    </article>`;
}

describe('站点适配层', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('从评论元素解析正文与昵称', () => {
    document.body.innerHTML = tweet('夜航西飞', '这个观点根本站不住脚');
    const article = document.querySelector('article')!;
    const target = resolveCommentFromElement(article, xAdapter);

    expect(target?.text).toContain('这个观点根本站不住脚');
    expect(target?.author).toBe('夜航西飞');
    expect(target?.siteId).toBe('x');
  });

  it('非评论元素返回 null（不会乱命中）', () => {
    document.body.innerHTML = '<div>随便一段文字，长度够但不属于评论结构</div>';
    expect(resolveCommentFromElement(document.querySelector('div')!, xAdapter)).toBeNull();
  });

  it('讨论串上下文只取当前评论之前的最多 N 条', () => {
    document.body.innerHTML = `<div>${tweet('甲', '第一条发言')}${tweet('乙', '第二条发言')}${tweet('丙', '第三条发言')}</div>`;
    const items = Array.from(document.querySelectorAll('article'));
    const target = resolveCommentFromElement(items[2]!, xAdapter)!;

    const context = collectThreadContext(target, 4, xAdapter);
    expect(context).toHaveLength(2);
    expect(context[0]?.text).toContain('第一条发言');
    expect(context[1]?.author).toBe('乙');
  });

  it('第一条评论没有上文', () => {
    document.body.innerHTML = `<div>${tweet('甲', '只有这一条')}</div>`;
    const target = resolveCommentFromElement(document.querySelector('article')!, xAdapter)!;
    expect(collectThreadContext(target, 4, xAdapter)).toHaveLength(0);
  });

  it('supportsThreadContext 只认详情页 URL', () => {
    expect(supportsThreadContext(xAdapter, 'https://x.com/someone/status/1234567890')).toBe(true);
    expect(supportsThreadContext(xAdapter, 'https://x.com/home')).toBe(false);
    expect(supportsThreadContext(weiboAdapter, 'https://weibo.com/1234567890/N8abcdEFG')).toBe(true);
    expect(supportsThreadContext(weiboAdapter, 'https://weibo.com/')).toBe(false);
  });

  it('fillReplyBox 写入 textarea（微博形态）', async () => {
    document.body.innerHTML = '<textarea placeholder="写评论..."></textarea>';
    const box = document.querySelector('textarea')!;
    mockRect(box);

    const result = await fillReplyBox('🤖 测试草稿正文', weiboAdapter);
    expect(result).toEqual({ ok: true });
    expect(box.value).toBe('🤖 测试草稿正文');
  });

  it('fillReplyBox 写入 contenteditable（X 形态）', async () => {
    document.body.innerHTML =
      '<div data-testid="tweetTextarea_0" contenteditable="true" role="textbox"></div>';
    const box = document.querySelector('[data-testid="tweetTextarea_0"]') as HTMLElement;
    mockRect(box);

    const result = await fillReplyBox('🤖 测试草稿正文', xAdapter);
    expect(result).toEqual({ ok: true });
    expect(box.textContent).toContain('🤖 测试草稿正文');
  });

  it('找不到编辑器时返回 no-box（由 UI 回退复制）', async () => {
    document.body.innerHTML = '<div>没有任何编辑器</div>';
    const result = await fillReplyBox('内容', xAdapter);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no-box');
  });
});
