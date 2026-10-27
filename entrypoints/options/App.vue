<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { CUSTOM_PROVIDER_ID, PRESET_PROVIDERS, findPreset } from '@/lib/providers';
import {
  activeConfigItem,
  customProviderItem,
  emotionAnalysisItem,
  promptOverridesItem,
  readKeys,
  setKey,
} from '@/lib/storage';
import { DEFAULT_SYSTEM_HEAD, STYLES, type PromptOverrides, type StyleId } from '@/lib/prompts';
import { originPatternOf, requestOriginPermission, sendToBackground } from '@/lib/client';
import { EMPTY_STATS, summarize, usageStatsItem, type UsageStats } from '@/lib/metrics';
import type { TestConnectionResult } from '@/lib/messaging';

/**
 * 设置页（F5 / R1-R5）。
 * 关键行为：
 * - 切换供应商时三联动：默认模型、已存 Key、hint 同步更新（R2）
 * - 每个供应商的 Key 独立存储，互不覆盖（R3）
 * - 测试连接把失败原因翻译成可读文案（R4）
 * - Key 申请页新标签直达（R5）
 */
type Feedback = { status: 'idle' | 'running' | 'ok' | 'fail'; message: string };

const providerId = ref('');
const model = ref('');
const apiKey = ref('');
const customBaseUrl = ref('');
const customModel = ref('');
const storedKeys = ref<Record<string, string>>({});
const showKey = ref(false);
const emotionEnabled = ref(true);

const promptStyle = ref<StyleId>('rational');
const promptSystem = ref('');
const promptInstruction = ref('');
const promptSaved = ref('');
const overrides = ref<PromptOverrides>({});
const stats = ref<UsageStats>(EMPTY_STATS);
const statsSummary = computed(() => summarize(stats.value));

function applyPromptEditor() {
  const override = overrides.value[promptStyle.value];
  promptSystem.value = override?.system ?? '';
  promptInstruction.value = override?.instruction ?? '';
}

watch(promptStyle, applyPromptEditor);

let promptTimer: ReturnType<typeof setTimeout> | undefined;
function flashPrompt(message: string) {
  promptSaved.value = message;
  if (promptTimer) clearTimeout(promptTimer);
  promptTimer = setTimeout(() => (promptSaved.value = ''), 1800);
}

/** F7：保存当前风格的自定义 Prompt（留空则回落到默认） */
async function savePrompt() {
  const next: PromptOverrides = { ...overrides.value };
  const system = promptSystem.value.trim();
  const instruction = promptInstruction.value.trim();
  if (!system && !instruction) {
    delete next[promptStyle.value];
  } else {
    next[promptStyle.value] = {
      system: system || undefined,
      instruction: instruction || undefined,
    };
  }
  await promptOverridesItem.setValue(next).catch(() => {});
  overrides.value = next;
  flashPrompt('已保存');
}

/** F7：恢复该风格的默认模板 */
async function resetPrompt() {
  const next: PromptOverrides = { ...overrides.value };
  delete next[promptStyle.value];
  await promptOverridesItem.setValue(next).catch(() => {});
  overrides.value = next;
  applyPromptEditor();
  flashPrompt('已恢复默认');
}
const testFeedback = ref<Feedback>({ status: 'idle', message: '' });
const saveFeedback = ref<Feedback>({ status: 'idle', message: '' });

const providers = PRESET_PROVIDERS;
const provider = computed(() => findPreset(providerId.value));
const isCustom = computed(() => providerId.value === CUSTOM_PROVIDER_ID);
const effectiveModel = computed(() => (isCustom.value ? customModel.value : model.value).trim());
const effectiveBaseUrl = computed(() =>
  isCustom.value ? customBaseUrl.value.trim() : (provider.value?.baseUrl ?? '').trim(),
);
const keyUrl = computed(() => provider.value?.keyUrl ?? '');
const hasStoredKey = computed(() => !!storedKeys.value[providerId.value]);

onMounted(async () => {
  const [active, keys, custom] = await Promise.all([
    activeConfigItem.getValue(),
    readKeys(),
    customProviderItem.getValue(),
  ]);

  storedKeys.value = keys;
  customBaseUrl.value = custom?.baseUrl ?? '';
  customModel.value = custom?.model ?? '';
  emotionEnabled.value = await emotionAnalysisItem.getValue();
  overrides.value = await promptOverridesItem.getValue();
  applyPromptEditor();
  stats.value = await usageStatsItem.getValue();

  if (active?.providerId) {
    providerId.value = active.providerId;
    apiKey.value = keys[active.providerId] ?? '';
    const preset = findPreset(active.providerId);
    model.value = active.model || preset?.defaultModel || '';
  }
});

/** R2：切换供应商时模型 / Key / hint 三联动 */
function changeProvider(nextId: string) {
  providerId.value = nextId;
  testFeedback.value = { status: 'idle', message: '' };
  saveFeedback.value = { status: 'idle', message: '' };

  const preset = findPreset(nextId);
  apiKey.value = storedKeys.value[nextId] ?? '';
  model.value = nextId === CUSTOM_PROVIDER_ID ? customModel.value : (preset?.defaultModel ?? '');
}

function validate(): string | null {
  if (!providerId.value) return '请先选择一个供应商。';
  if (isCustom.value && !originPatternOf(customBaseUrl.value)) {
    return '接口地址无效：请填写完整 URL，例如 https://your-host/v1';
  }
  if (!effectiveModel.value) return '请选择或填写模型名。';
  if (!apiKey.value.trim()) return '请填写 API Key。';
  return null;
}

async function save() {
  const problem = validate();
  if (problem) {
    saveFeedback.value = { status: 'fail', message: problem };
    return;
  }

  // 必须在任何 await 之前同步发起权限申请，否则会丢失用户手势
  const permissionPromise = isCustom.value ? requestOriginPermission(effectiveBaseUrl.value) : null;
  saveFeedback.value = { status: 'running', message: '正在保存…' };

  if (permissionPromise && !(await permissionPromise)) {
    saveFeedback.value = {
      status: 'fail',
      message: '未授予该域名的访问权限，无法调用该接口。再次点保存可重新申请。',
    };
    return;
  }

  const id = providerId.value;
  const chosenModel = effectiveModel.value;

  try {
    await setKey(id, apiKey.value);
    if (isCustom.value) {
      await customProviderItem.setValue({ baseUrl: effectiveBaseUrl.value, model: chosenModel });
    }
    await activeConfigItem.setValue({ providerId: id, model: chosenModel });
    storedKeys.value = await readKeys();
    saveFeedback.value = {
      status: 'ok',
      message: `已保存并启用：${provider.value?.name ?? id} · ${chosenModel}`,
    };
  } catch (error) {
    saveFeedback.value = {
      status: 'fail',
      message: error instanceof Error ? `保存失败：${error.message}` : '保存失败。',
    };
  }
}

async function saveEmotion(value: boolean) {
  emotionEnabled.value = value;
  await emotionAnalysisItem.setValue(value).catch(() => {});
}

/** 重置本机使用统计 */
async function resetStats() {
  await usageStatsItem.setValue(EMPTY_STATS).catch(() => {});
  stats.value = { ...EMPTY_STATS };
}

async function testConnection() {
  const problem = validate();
  if (problem) {
    testFeedback.value = { status: 'fail', message: problem };
    return;
  }

  const permissionPromise = isCustom.value ? requestOriginPermission(effectiveBaseUrl.value) : null;
  testFeedback.value = { status: 'running', message: '正在发送一次最小请求…' };

  if (permissionPromise && !(await permissionPromise)) {
    testFeedback.value = {
      status: 'fail',
      message: '未授予该域名的访问权限，无法测试。再次点测试可重新申请。',
    };
    return;
  }

  const result = await sendToBackground<TestConnectionResult>({
    type: 'test-connection',
    payload: {
      providerId: providerId.value,
      model: effectiveModel.value,
      apiKey: apiKey.value.trim(),
      baseUrl: isCustom.value ? effectiveBaseUrl.value : undefined,
    },
  });

  if (result.ok) {
    testFeedback.value = {
      status: 'ok',
      message: `连接成功：${result.data.providerName} · ${result.data.model}，耗时 ${result.data.latencyMs} ms（返回：${result.data.sample}）。别忘了点「保存」。`,
    };
  } else {
    testFeedback.value = { status: 'fail', message: result.error.message };
  }
}
</script>

<template>
  <main class="ai-root page">
    <header class="page-header">
      <span class="ai-avatar">AI</span>
      <div class="head-text">
        <h1>设置</h1>
        <p class="ai-muted">
          三步配置：选供应商 → 粘 API Key → 测试连接。切换时模型与 Key 自动联动，Key 只存本机。
        </p>
      </div>
    </header>

    <section class="ai-card block">
      <h2>AI 供应商</h2>

      <div class="field">
        <label class="ai-label" for="provider">供应商</label>
        <select
          id="provider"
          class="ai-select"
          :value="providerId"
          @change="changeProvider(($event.target as HTMLSelectElement).value)"
        >
          <option value="" disabled>请选择供应商</option>
          <option v-for="item in providers" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
      </div>

      <p v-if="provider?.hint" class="ai-warn hint">{{ provider.hint }}</p>

      <div v-if="isCustom" class="field">
        <label class="ai-label" for="base-url">接口地址（base URL）</label>
        <input
          id="base-url"
          v-model="customBaseUrl"
          class="ai-input"
          spellcheck="false"
          placeholder="https://your-host/v1"
        />
        <p class="ai-muted field-tip">
          仅支持 OpenAI 兼容协议（/chat/completions）。保存或测试时会弹出该域名的访问授权。
        </p>
      </div>
      <p v-else-if="provider" class="ai-muted field-tip">
        接口地址由产品内置，无需填写：<code>{{ provider.baseUrl }}</code>
      </p>

      <div class="field">
        <label class="ai-label" for="model">模型</label>
        <select
          v-if="!isCustom"
          id="model"
          v-model="model"
          class="ai-select"
          :disabled="!provider"
        >
          <option v-for="item in provider?.models ?? []" :key="item" :value="item">
            {{ item }}
          </option>
        </select>
        <input
          v-else
          id="model"
          v-model="customModel"
          class="ai-input"
          spellcheck="false"
          placeholder="例如 deepseek-chat"
        />
      </div>

      <div class="field">
        <label class="ai-label" for="api-key">API Key</label>
        <div class="ai-row">
          <input
            id="api-key"
            v-model="apiKey"
            class="ai-input"
            :type="showKey ? 'text' : 'password'"
            autocomplete="off"
            spellcheck="false"
            placeholder="粘贴该供应商的 API Key"
          />
          <button type="button" class="ai-btn small" @click="showKey = !showKey">
            {{ showKey ? '隐藏' : '显示' }}
          </button>
        </div>
        <p v-if="keyUrl" class="field-tip">
          <a :href="keyUrl" target="_blank" rel="noopener noreferrer">
            → 去申请 / 查看 API Key（新标签页打开）
          </a>
        </p>
        <p v-if="hasStoredKey" class="ai-muted field-tip">
          这家供应商已存过 Key，切回来会自动填入，不会被其它供应商覆盖。
        </p>
      </div>

      <div class="ai-row actions">
        <button
          type="button"
          class="ai-btn"
          :disabled="testFeedback.status === 'running'"
          @click="testConnection"
        >
          {{ testFeedback.status === 'running' ? '测试中…' : '测试连接' }}
        </button>
        <button type="button" class="ai-pill" :disabled="saveFeedback.status === 'running'" @click="save">
          保存
        </button>
      </div>

      <p v-if="testFeedback.status === 'ok'" class="ai-success">{{ testFeedback.message }}</p>
      <p v-else-if="testFeedback.status === 'fail'" class="ai-error">{{ testFeedback.message }}</p>
      <p v-else-if="testFeedback.message" class="ai-muted field-tip">{{ testFeedback.message }}</p>

      <p v-if="saveFeedback.status === 'ok'" class="ai-success">{{ saveFeedback.message }}</p>
      <p v-else-if="saveFeedback.status === 'fail'" class="ai-error">{{ saveFeedback.message }}</p>
      <p v-else-if="saveFeedback.message" class="ai-muted field-tip">{{ saveFeedback.message }}</p>
    </section>

    <section class="ai-card block">
      <h2>生成选项</h2>
      <label class="switch">
        <input
          type="checkbox"
          :checked="emotionEnabled"
          @change="saveEmotion(($event.target as HTMLInputElement).checked)"
        />
        <span>生成前先分析对方语气（多一次轻量请求，约 1-2 秒）</span>
      </label>
      <p class="ai-muted field-tip">
        开启后草稿上方会显示识别到的语气（愤怒 / 讽刺 / 挑衅 …），并据此调整反驳策略。
      </p>
    </section>

    <section class="ai-card block">
      <h2>使用统计（仅本机）</h2>
      <div class="stats">
        <div class="stat"><span>成功生成</span><b>{{ stats.generateOk }} 次</b></div>
        <div class="stat"><span>成功率</span><b>{{ statsSummary.successRate }}%</b></div>
        <div class="stat">
          <span>平均耗时</span><b>{{ (statsSummary.avgLatencyMs / 1000).toFixed(1) }}s</b>
        </div>
        <div class="stat"><span>复制率</span><b>{{ statsSummary.copyRate }}%</b></div>
        <div class="stat"><span>填入回复框</span><b>{{ stats.filled }} 次</b></div>
      </div>
      <p class="ai-muted field-tip">
        数据只写在浏览器本机，用于自查 PRD 指标（生成 ≤15 秒、编辑后复制率 ≥60%），不会上传到任何服务器。
      </p>
      <div class="ai-row actions">
        <button type="button" class="ai-btn" @click="resetStats">重置统计</button>
      </div>
    </section>

    <section class="ai-card block">
      <h2>Prompt 模板（高级）</h2>
      <div class="field">
        <label class="ai-label" for="prompt-style">风格</label>
        <select id="prompt-style" v-model="promptStyle" class="ai-select">
          <option v-for="item in STYLES" :key="item.id" :value="item.id">
            {{ item.emoji }} {{ item.name }}
          </option>
        </select>
      </div>
      <div class="field">
        <label class="ai-label" for="prompt-system">系统提示（角色与口吻）</label>
        <textarea
          id="prompt-system"
          v-model="promptSystem"
          class="ai-textarea"
          rows="3"
          :placeholder="DEFAULT_SYSTEM_HEAD"
        />
      </div>
      <div class="field">
        <label class="ai-label" for="prompt-instruction">风格指令</label>
        <textarea
          id="prompt-instruction"
          v-model="promptInstruction"
          class="ai-textarea"
          rows="4"
          :placeholder="STYLES.find((item) => item.id === promptStyle)?.instruction ?? ''"
        />
      </div>
      <p v-pre class="ai-muted field-tip">
        可用变量：{{author}} 对方昵称、{{text}} 评论原文、{{styleName}} 风格名、{{context}}
        上文。留空即用默认；禁止脏话与歧视等硬约束始终由程序追加，不可删除。
      </p>
      <div class="ai-row actions">
        <button type="button" class="ai-btn" @click="resetPrompt">恢复默认</button>
        <button type="button" class="ai-pill" @click="savePrompt">保存 Prompt</button>
        <span v-if="promptSaved" class="save-tip">{{ promptSaved }}</span>
      </div>
    </section>

    <section class="ai-card block">
      <h2>隐私与合规</h2>
      <ul class="list ai-muted">
        <li>评论文本只会发送给你选择的 AI 供应商，插件不设任何中转服务器。</li>
        <li>API Key 仅存本机 storage.local，不使用云同步；源码零硬编码密钥。</li>
        <li>生成的草稿固定带 🤖 标识声明 AI 生成，默认开启且不可关闭。</li>
        <li>插件没有「自动发送」能力，也不会调用平台发布接口或模拟点击发送按钮。</li>
        <li>
          权限最小化：仅声明 5 家预设供应商域名与 x.com / weibo.com；自定义供应商的域名在保存时按需申请。
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.hint {
  margin: 0;
  font-size: 12px;
}

code {
  font-family: var(--ai-mono);
  font-size: 12px;
}
</style>
