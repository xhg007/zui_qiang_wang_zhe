<script setup lang="ts">
withDefaults(defineProps<{ showClose?: boolean }>(), { showClose: true });

const emit = defineEmits<{ accept: []; close: [] }>();
</script>

<template>
  <div class="msg out">
    <div class="ai-bubble out consent">
      <p>评论文本会发送至<b>你选择的 AI 供应商</b>处理，插件不设中转服务器、不采集浏览记录。</p>
      <p class="ai-muted">生成结果需要你审核后手动发送，插件不会替你发言。</p>
      <div class="consent-actions">
        <button type="button" class="ai-pill" @click="emit('accept')">我知道了，开始生成</button>
        <button v-if="showClose" type="button" class="ai-btn ghost small" @click="emit('close')">
          取消
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.msg {
  display: flex;
  justify-content: flex-end;
}

.consent {
  max-width: 94%;
  min-width: 62%;
}

.consent p {
  margin: 0 0 6px;
}

.consent p:last-of-type {
  margin-bottom: 9px;
}

.consent-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
