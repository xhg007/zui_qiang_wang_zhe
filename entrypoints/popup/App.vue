<script setup lang="ts">
import { onMounted, ref } from 'vue';
import DraftPanel from '@/components/DraftPanel.vue';
import { openOptionsPage, sendToBackground } from '@/lib/client';
import type { StatusResult } from '@/lib/messaging';

/**
 * popup：粘贴文本快速生成（F1 的第二种触发方式）。
 * 页面内选区捕捉由 content script 负责；这里不直接调用供应商 API。
 */
const status = ref<StatusResult | null>(null);
const text = ref('');
const author = ref('');
const started = ref(false);
const runId = ref(0);

onMounted(async () => {
  const result = await sendToBackground<StatusResult>({ type: 'get-status' });
  status.value = result.ok
    ? result.data
    : { configured: false, providerId: null, providerName: null, model: null };
});

function start() {
  if (!text.value.trim()) return;
  runId.value += 1;
  started.value = true;
}
</script>

<template>
  <main class="ai-root popup">
    <header class="head">
      <span class="ai-avatar sm">AI</span>
      <div class="who">
        <strong>AI 智怼助手</strong>
        <span v-if="status?.configured" class="sub">{{ status.providerName }} · {{ status.model }}</span>
        <span v-else class="sub">还没配好供应商</span>
      </div>
      <span class="ai-spacer" />
      <button type="button" class="ai-icon-btn" title="打开设置" aria-label="打开设置" @click="openOptionsPage">
        ⚙
      </button>
    </header>

    <div v-if="status && !status.configured" class="ai-warn setup">
      <span>还没有可用的 AI 供应商，配好 Key 就能开始生成。</span>
      <button type="button" class="ai-btn small" @click="openOptionsPage">去配置</button>
    </div>

    <template v-if="!started">
      <div class="field">
        <label class="ai-label" for="text">粘贴对方评论</label>
        <textarea
          id="text"
          v-model="text"
          class="ai-textarea"
          rows="5"
          placeholder="也可以回到 X / 微博，在评论上点「AI 回复」"
        />
      </div>

      <div class="field">
        <label class="ai-label" for="author">对方昵称（可选）</label>
        <input id="author" v-model="author" class="ai-input" placeholder="例如 某某观察" />
      </div>

      <button
        type="button"
        class="ai-pill wide"
        :disabled="!text.trim() || !status?.configured"
        @click="start"
      >
        生成草稿
      </button>
      <p class="tip ai-muted">
        生成后需你自己审核并手动复制发送，插件不会替你发言；草稿开头固定带 AI 标识。
      </p>
    </template>

    <template v-else>
      <DraftPanel
        :key="runId"
        :text="text"
        :author="author.trim() || undefined"
        :show-close="false"
      />
      <button type="button" class="ai-btn ghost small back" @click="started = false">
        返回修改文本
      </button>
    </template>
  </main>
</template>

<style scoped>
.popup {
  display: flex;
  flex-direction: column;
  gap: 11px;
}

.head {
  display: flex;
  align-items: center;
  gap: 9px;
}

.who {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
}

.who strong {
  font-size: 14px;
  font-weight: 700;
}

.who .sub {
  font-size: 11px;
  color: var(--ai-fg-mute);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 240px;
}

.setup {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
}

.field {
  display: flex;
  flex-direction: column;
}

.ai-pill.wide {
  width: 100%;
  padding: 10px 16px;
  font-size: 13.5px;
}

.tip {
  margin: 0;
  font-size: 11px;
  line-height: 1.55;
}

.back {
  align-self: center;
}

:deep(.panel) {
  width: 100%;
  max-height: none;
  padding: 0;
  border: none;
  box-shadow: none;
  background: transparent;
}
</style>
