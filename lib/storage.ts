import { storage } from 'wxt/utils/storage';
import { CUSTOM_PROVIDER_ID, findPreset, type ProviderPreset } from './providers';
import type { PromptOverrides } from './prompts';

/**
 * 统一存储封装（PRD 3.2.5.3）。
 *
 * - `sync` 只放当前激活配置（体积小、跨设备同步）
 * - `local` 放各供应商 API Key 与自定义供应商（敏感 / 条目可能较多，禁止进 sync）
 */
export interface ActiveConfig {
  providerId: string | null;
  model: string;
}

export interface CustomProviderConfig {
  /** OpenAI 兼容 base URL，例如 https://your-host/v1 */
  baseUrl: string;
  /** 用户手填的模型名 */
  model: string;
}

/** 当前激活配置：供应商 id + 模型 */
export const activeConfigItem = storage.defineItem<ActiveConfig>('sync:activeConfig', {
  fallback: { providerId: null, model: '' },
});

/** 各供应商的 API Key，按供应商 id 独立存放（R3：互不覆盖） */
export const providerKeysItem = storage.defineItem<Record<string, string>>('local:providerKeys', {
  fallback: {},
});

/** 自定义供应商配置 */
export const customProviderItem = storage.defineItem<CustomProviderConfig>('local:customProvider', {
  fallback: { baseUrl: '', model: '' },
});

/** 上次使用的风格 */
export const preferredStyleItem = storage.defineItem<string>('local:preferredStyle', {
  fallback: 'rational',
});

/** 首次使用隐私告知是否已确认 */
export const privacyAckItem = storage.defineItem<boolean>('local:privacyAcknowledged', {
  fallback: false,
});

/** F9 情绪预分析开关 */
export const emotionAnalysisItem = storage.defineItem<boolean>('local:emotionAnalysis', {
  fallback: true,
});

/** F7 自定义 Prompt 模板 */
export const promptOverridesItem = storage.defineItem<PromptOverrides>('local:promptOverrides', {
  fallback: {},
});

/** 已授权过 host 权限的域名（自定义供应商测试连接前自检用） */
export const grantedOriginsItem = storage.defineItem<string[]>('local:grantedOrigins', {
  fallback: [],
});

export async function readKeys(): Promise<Record<string, string>> {
  return (await providerKeysItem.getValue()) ?? {};
}

export async function getKey(providerId: string): Promise<string> {
  const keys = await readKeys();
  return (keys[providerId] ?? '').trim();
}

export async function setKey(providerId: string, apiKey: string): Promise<void> {
  const keys = await readKeys();
  const trimmed = apiKey.trim();
  if (trimmed) keys[providerId] = trimmed;
  else delete keys[providerId];
  await providerKeysItem.setValue(keys);
}

/** 合并预设表与用户的自定义配置，得到某个供应商的实际可用信息。 */
export async function getProviderInfo(providerId: string): Promise<ProviderPreset | undefined> {
  const preset = findPreset(providerId);
  if (!preset) return undefined;
  if (providerId !== CUSTOM_PROVIDER_ID) return preset;

  const custom = await customProviderItem.getValue();
  return {
    ...preset,
    baseUrl: custom?.baseUrl?.trim() ?? '',
    models: custom?.model?.trim() ? [custom.model.trim()] : [],
    defaultModel: custom?.model?.trim() ?? '',
  };
}

export interface ResolvedProvider {
  provider: ProviderPreset;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export type ResolveFailure =
  | { reason: 'no-provider' }
  | { reason: 'no-base-url'; provider: ProviderPreset }
  | { reason: 'no-model'; provider: ProviderPreset }
  | { reason: 'no-key'; provider: ProviderPreset };

export type ResolveResult = { ok: true; value: ResolvedProvider } | ({ ok: false } & ResolveFailure);

/**
 * 解析当前激活配置（PRD 5.2 的 resolveActiveProvider）。
 * 失败时返回具体原因，交给 UI 引导用户补配置。
 */
export async function resolveActiveProvider(): Promise<ResolveResult> {
  const active = await activeConfigItem.getValue();
  const providerId = active?.providerId ?? null;
  if (!providerId) return { ok: false, reason: 'no-provider' };

  const provider = await getProviderInfo(providerId);
  if (!provider) return { ok: false, reason: 'no-provider' };

  const baseUrl = provider.baseUrl.trim();
  if (!baseUrl) return { ok: false, reason: 'no-base-url', provider };

  const model = (active?.model || provider.defaultModel).trim();
  if (!model) return { ok: false, reason: 'no-model', provider };

  const apiKey = await getKey(providerId);
  if (!apiKey) return { ok: false, reason: 'no-key', provider };

  return { ok: true, value: { provider, baseUrl, model, apiKey } };
}
