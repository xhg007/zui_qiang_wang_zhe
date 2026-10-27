import { createApp } from 'vue';
import ContentOverlay from '@/components/ContentOverlay.vue';
import { startEntryButtons } from '@/lib/injector';
import '../assets/theme.css';

/**
 * 页面内交互入口（F1）。
 *
 * 三件事：给每条评论注入「AI 回复」入口、捕获选中文本、渲染草稿面板。
 * 不直接调用任何供应商 API，也没有「自动发送」逻辑：填入回复框后仍需用户自己点发送。
 *
 * matches 需与 lib/adapters/sites.ts 的 hostPatterns 保持一致。
 */
export default defineContentScript({
  matches: ['*://x.com/*', '*://*.weibo.com/*', '*://weibo.com/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'ai-debate-helper',
      position: 'overlay',
      zIndex: 2147483000,
      anchor: 'body',
      append: 'last',
      onMount: (container) => {
        const app = createApp(ContentOverlay);
        app.mount(container);
        return app;
      },
      onRemove: (app) => app?.unmount(),
    });

    ui.mount();

    const stopEntryButtons = startEntryButtons();
    ctx.onInvalidated(() => {
      stopEntryButtons();
      ui.remove();
    });
  },
});
