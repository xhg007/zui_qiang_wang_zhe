<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import DraftPanel from './DraftPanel.vue';
import {
  SITE_ADAPTERS,
  collectThreadContext,
  fillReplyBox,
  resolveCommentContext,
  supportsThreadContext,
  type CommentContext,
  type CommentTarget,
} from '@/lib/adapters';
import { ENTRY_CLICK_EVENT } from '@/lib/injector';

/**
 * 页面内交互层：两条触发路径
 * 1. 每条评论操作栏里的「AI 回复」按钮（注入器）
 * 2. 选中文本后浮出的小按钮
 * 都只负责打开草稿面板，不发网络请求，也不发送任何内容。
 */
const pending = ref<CommentContext | null>(null);
const active = ref<CommentContext | null>(null);
const panelOpen = ref(false);
const trigger = ref<{ left: number; top: number } | null>(null);
const toast = ref('');

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let stopEntry: (() => void) | undefined;
/** 打开面板前的焦点元素，关闭时归还，避免键盘用户丢失位置 */
let lastFocused: HTMLElement | null = null;

const triggerStyle = computed(() =>
  trigger.value ? { left: `${trigger.value.left}px`, top: `${trigger.value.top}px` } : undefined,
);

function showToast(message: string) {
  toast.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ''), 2800);
}

function hideTrigger() {
  trigger.value = null;
  pending.value = null;
}

function openPanelWith(context: CommentContext) {
  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  active.value = context;
  panelOpen.value = true;
  trigger.value = null;
  pending.value = null;
  window.getSelection()?.removeAllRanges();
}

function closePanel() {
  panelOpen.value = false;
  active.value = null;
  const target = lastFocused;
  lastFocused = null;
  if (target?.isConnected) target.focus({ preventScroll: true });
}

/** Esc 关闭面板；焦点在输入框里时交给浏览器处理，避免打字时误关 */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !panelOpen.value) return;
  const tag = (document.activeElement?.tagName ?? '').toLowerCase();
  if (tag === 'textarea' || tag === 'input') return;
  event.stopPropagation();
  closePanel();
}

function captureSelection() {
  if (panelOpen.value) return;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.toString().trim()) {
    hideTrigger();
    return;
  }

  const context = resolveCommentContext(selection);
  if (!context) {
    hideTrigger();
    return;
  }

  pending.value = context;
  const { rect } = context;
  const width = 108;
  trigger.value = {
    left: Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8)),
    top: Math.max(8, rect.top - 42),
  };
}

function scheduleCapture() {
  // 等浏览器把选区更新完再读
  window.setTimeout(captureSelection, 10);
}

/**
 * 一键填入平台回复框（用户手势内触发）。
 * 只会写入文本，绝不点击发送；找不到编辑器时回退为复制。
 */
async function handleFill(payload: { text: string }) {
  const result = await fillReplyBox(payload.text);
  if (result.ok) {
    showToast('已填入回复框 · 请你检查后手动点发送');
    closePanel();
    return;
  }

  try {
    await navigator.clipboard.writeText(payload.text);
    showToast('当前页面没找到回复框，已复制到剪贴板');
  } catch {
    showToast('没找到回复框，请手动复制草稿内容');
  }
}

onMounted(() => {
  document.addEventListener('mouseup', scheduleCapture);
  document.addEventListener('keyup', scheduleCapture);
  window.addEventListener('scroll', hideTrigger, true);
  window.addEventListener('resize', hideTrigger);
  window.addEventListener('keydown', onKeydown, true);

  stopEntry = () => window.removeEventListener(ENTRY_CLICK_EVENT, handleEntryClick);
  window.addEventListener(ENTRY_CLICK_EVENT, handleEntryClick);
});

/** 评论内「AI 回复」按钮：直接把该评论带进面板并自动生成 */
function handleEntryClick(event: Event) {
  const target = (event as CustomEvent<CommentTarget>).detail;
  if (!target) return;
  const adapter = SITE_ADAPTERS.find((item) => item.id === target.siteId);
  openPanelWith({
    text: target.text,
    author: target.author,
    siteId: target.siteId,
    rect: new DOMRect(0, 0, 0, 0),
    // 时间线首页不带上下文（会把无关推文当成「此前的讨论」）
    context:
      adapter && supportsThreadContext(adapter) ? collectThreadContext(target, 4, adapter) : [],
  });
}

onBeforeUnmount(() => {
  document.removeEventListener('mouseup', scheduleCapture);
  document.removeEventListener('keyup', scheduleCapture);
  window.removeEventListener('scroll', hideTrigger, true);
  window.removeEventListener('resize', hideTrigger);
  window.removeEventListener('keydown', onKeydown, true);
  stopEntry?.();
  if (toastTimer) clearTimeout(toastTimer);
});
</script>

<template>
  <div class="ai-root overlay">
    <DraftPanel
      v-if="panelOpen && active"
      :text="active.text"
      :author="active.author"
      :context="active.context"
      show-fill
      @close="closePanel"
      @fill="handleFill"
    />

    <button
      v-else-if="trigger"
      type="button"
      class="trigger"
      :style="triggerStyle"
      title="用 AI 生成一段回复草稿"
      @mousedown.prevent
      @click="openPanelWith(pending!)"
    >
      AI 回复
    </button>

    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
}

.trigger {
  position: fixed;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  font-family: var(--ai-font);
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #ff4d6d 0%, #ff8a5b 100%);
  border: none;
  border-radius: 999px;
  box-shadow: 0 8px 20px -8px rgba(255, 77, 109, 0.95);
  cursor: pointer;
  animation: ai-pop-in 0.14s var(--ai-ease);
}

.trigger:hover {
  filter: brightness(1.07);
}

.overlay > :deep(.panel) {
  position: fixed;
  right: 20px;
  bottom: 20px;
  pointer-events: auto;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  padding: 9px 16px;
  font-family: var(--ai-font);
  font-size: 12.5px;
  font-weight: 600;
  color: #fff;
  background: rgba(22, 22, 26, 0.9);
  border-radius: 999px;
  box-shadow: 0 10px 28px -12px rgba(0, 0, 0, 0.6);
  white-space: nowrap;
  animation: ai-pop-in 0.16s var(--ai-ease);
  pointer-events: none;
}
</style>
