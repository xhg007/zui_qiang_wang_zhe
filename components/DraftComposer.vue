<script setup lang="ts">
import StylePicker from './StylePicker.vue';
import type { StyleId } from '@/lib/prompts/styles';

withDefaults(
  defineProps<{
    styleId: StyleId;
    loading: boolean;
    hasDraft: boolean;
    hasPrevious: boolean;
    copied: boolean;
    showFill: boolean;
  }>(),
  { showFill: false },
);

const emit = defineEmits<{
  'update:styleId': [value: StyleId];
  regenerate: [];
  copy: [];
  restore: [];
  fill: [];
}>();
</script>

<template>
  <footer class="composer">
    <StylePicker
      :model-value="styleId"
      :disabled="loading"
      @update:model-value="(value) => emit('update:styleId', value)"
    />

    <div class="actions">
      <button
        type="button"
        class="ai-icon-btn"
        title="重新生成"
        aria-label="重新生成"
        :disabled="loading"
        @click="emit('regenerate')"
      >
        ↻
      </button>
      <button
        type="button"
        class="ai-icon-btn"
        :title="copied ? '已复制' : '复制草稿'"
        :aria-label="copied ? '已复制' : '复制草稿'"
        :disabled="!hasDraft"
        @click="emit('copy')"
      >
        {{ copied ? '✓' : '⧉' }}
      </button>
      <button
        v-if="hasPrevious"
        type="button"
        class="ai-icon-btn"
        title="恢复上一版草稿"
        aria-label="恢复上一版草稿"
        :disabled="loading"
        @click="emit('restore')"
      >
        ↩
      </button>

      <span class="ai-spacer" />

      <button
        v-if="showFill && hasDraft"
        type="button"
        class="ai-pill"
        :disabled="loading"
        @click="emit('fill')"
      >
        填入回复框
      </button>
      <button
        v-else-if="hasDraft"
        type="button"
        class="ai-pill"
        :disabled="loading"
        @click="emit('copy')"
      >
        {{ copied ? '已复制 ✓' : '复制草稿' }}
      </button>
      <button v-else type="button" class="ai-pill" :disabled="loading" @click="emit('regenerate')">
        生成草稿
      </button>
    </div>

    <p class="foot-note">复制后请自行核对事实并手动发送</p>
  </footer>
</template>

<style scoped>
.composer {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding-top: 9px;
  border-top: 1px solid var(--ai-border);
}

.actions {
  display: flex;
  align-items: center;
  gap: 7px;
}

.foot-note {
  margin: 0;
  font-size: 10.5px;
  color: var(--ai-fg-mute);
  text-align: center;
}
</style>
