/**
 * 预设供应商数据表（纯数据，见 PRD 3.2.5.1 / 5.2）。
 *
 * 架构约束：所有供应商差异都收敛在这里。
 * 调用层对供应商无感知，禁止为单一供应商硬编码分支（R6）。
 * 新增供应商 = 往数组里加一条数据，不改任何逻辑。
 */
export interface ProviderPreset {
  /** 存储用的稳定标识，勿修改 */
  id: string;
  /** 显示名 */
  name: string;
  /** OpenAI 兼容 base URL，包含版本路径；用户不可见、不可编辑（自定义供应商除外） */
  baseUrl: string;
  /** 预置模型选项 */
  models: string[];
  /** 默认模型：切换供应商时自动联动 */
  defaultModel: string;
  /** Key 申请页直达链接 */
  keyUrl: string;
  /** 特殊提示文案（hint） */
  hint?: string;
  /** 用户可自行填写 baseUrl 与模型（自定义供应商） */
  custom?: boolean;
}

/** 自定义供应商的固定 id */
export const CUSTOM_PROVIDER_ID = 'custom';

export const PRESET_PROVIDERS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    defaultModel: 'deepseek-v4-flash',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    hint: '价格低、响应快。Key 在「API keys」页面创建，创建后只显示一次，请当场复制。',
  },
  {
    id: 'qwen',
    name: '通义千问（百炼）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-flash', 'qwen-plus', 'qwen-max'],
    defaultModel: 'qwen-plus',
    keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    hint: 'Key 与地域绑定：需要与开通服务时选择的「地域」保持一致，否则会报 401。',
  },
  {
    id: 'kimi',
    name: 'Kimi（Moonshot）',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k3.1-pro', 'kimi-k2.6'],
    defaultModel: 'kimi-k3.1-pro',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    hint: '保留余额提醒：控制台可查看剩余额度，额度用尽会返回 429。',
  },
  {
    id: 'glm',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-flash', 'glm-4.6'],
    defaultModel: 'glm-4-flash',
    keyUrl: 'https://bigmodel.cn/usercenter/apikeys',
    hint: 'glm-4-flash 有免费额度，适合先跑通流程再换更强模型。',
  },
  {
    id: 'siliconflow',
    name: '硅基流动（聚合）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3.2', 'zai-org/GLM-4.6'],
    defaultModel: 'deepseek-ai/DeepSeek-V3.2',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    hint: '聚合多家模型，一个 Key 通用。模型名带「组织前缀」，如 deepseek-ai/DeepSeek-V3.2。',
  },
  {
    id: CUSTOM_PROVIDER_ID,
    name: '自定义（OpenAI 兼容）',
    baseUrl: '',
    models: [],
    defaultModel: '',
    keyUrl: '',
    hint: '填入任意 OpenAI 兼容服务的接口地址（以 /v1 结尾）与模型名。保存时会请求该域名的访问权限。',
    custom: true,
  },
];

export function findPreset(id: string | null | undefined): ProviderPreset | undefined {
  if (!id) return undefined;
  return PRESET_PROVIDERS.find((provider) => provider.id === id);
}
