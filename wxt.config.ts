import { defineConfig } from 'wxt';
import { PRESET_PROVIDERS } from './lib/providers';

/**
 * 预设供应商域名 → manifest host_permissions。
 * 由 lib/providers.ts 派生，新增预设供应商时无需改这里（PRD 4. 权限最小化 / 5.2 可维护性）。
 * 自定义（OpenAI 兼容）供应商的域名不预先占用，运行时通过 chrome.permissions.request 申请。
 */
const presetHostPermissions = [
  ...new Set(
    PRESET_PROVIDERS.filter((provider) => provider.baseUrl).map(
      (provider) => `${new URL(provider.baseUrl).origin}/*`,
    ),
  ),
];

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'AI智怼助手',
    description:
      'AI 辅助网络辩论：选中评论即可生成有理有据的回复草稿，由你审核后手动发送，绝不自动发言。',
    permissions: ['storage'],
    host_permissions: presetHostPermissions,
    optional_host_permissions: ['https://*/*', 'http://*/*'],
  },
});
