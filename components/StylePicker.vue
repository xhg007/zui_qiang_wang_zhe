<script setup lang="ts">
import { STYLES, type StyleId } from '@/lib/prompts/styles';

withDefaults(
  defineProps<{
    modelValue: StyleId;
    disabled?: boolean;
  }>(),
  { disabled: false },
);

const emit = defineEmits<{ 'update:modelValue': [value: StyleId] }>();
</script>

<template>
  <div class="ai-styles" role="group" aria-label="回复风格">
    <button
      v-for="style in STYLES"
      :key="style.id"
      type="button"
      class="ai-chip"
      :class="{ active: style.id === modelValue }"
      :title="style.description"
      :disabled="disabled"
      :aria-pressed="style.id === modelValue"
      @click="emit('update:modelValue', style.id)"
    >
      <span aria-hidden="true">{{ style.emoji }}</span>{{ style.name }}
    </button>
  </div>
</template>

<style scoped>
.ai-styles {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
