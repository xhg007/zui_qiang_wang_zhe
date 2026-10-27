<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ConsentBubble from './ConsentBubble.vue';
import DraftComposer from './DraftComposer.vue';
import { openOptionsPage } from '@/lib/client';
import { trackEvent } from '@/lib/metrics';
import { streamGenerate } from '@/lib/stream';
import type { AppError, GenerateResult } from '@/lib/messaging';
import { AI_MARK, STYLES } from '@/lib/prompts';
import { DEFAULT_STYLE, type StyleId } from '@/lib/prompts/styles';
import { preferredStyleItem, privacyAckItem } from '@/lib/storage';

const props = withDefaults(
  defineProps<{
    /** 待反驳的评论文本 */
    text: string;
    /** 对方昵称 */
    author?: string;
    showClose?: boolean;
    /** 是否显示「填入回复框」（仅页面内可用） */
    showFill?: boolean;
    /** 预置草稿：有值时直接展示，不自动生成（预览 / 重放用） */
    initialDraft?: string;
    /** 情绪预分析结果（F9） */
    emotion?: string | null;
    /** 讨论串上下文（F6） */
    context?: { author?: string; text: string }[];
    /** 覆盖隐私确认状态（预览 / 测试用，正常运行时留空读存储） */
    consentAcknowledged?: boolean;
  }>(),
  {
    showClose: true,
    showFill: false,
    emotion: null,
    context: undefined,
    consentAcknowledged: undefined,
  },
);

const emit = defineEmits<{
  close: [];
  fill: [payload: { text: string }];
}>();

const SETUP_CODES: AppError['code'][] = ['NO_PROVIDER', 'NO_KEY', 'NO_MODEL', 'NO_BASE_URL'];

const ready = ref(false);
const style = ref<StyleId>(DEFAULT_STYLE);
const draft = ref(props.initialDraft ?? '');
const loading = ref(false);
const error = ref<AppError | null>(null);
const meta = ref<Pick<GenerateResult, 'providerName' | 'model' | 'elapsedMs'> | null>(null);
const privacyAck = ref(false);
const copied = ref(false);
const emotionLabel = ref(props.emotion ?? '');
/** 上一版草稿：重新生成 / 换风格前的稿子，可一键恢复 */
const previousDraft = ref('');
const draftEl = ref<HTMLTextAreaElement | null>(null);

let copiedTimer: ReturnType<typeof setTimeout> | undefined;
let cancelStream: (() => void) | undefined;
let rafId: number | undefined;

const initial = computed(() => props.author?.trim()?.slice(0, 1) || '评');
const charCount = computed(() => draft.value.replace(/^🤖\s*/u, '').length);
const needsSetup = computed(() => !!error.value && SETUP_CODES.includes(error.value.code));
const hasDraft = computed(() => !!props.initialDraft || !!draft.value);

onMounted(async () => {
  try {
    const [savedStyle, ack] = await Promise.all([
      preferredStyleItem.getValue(),
      privacyAckItem.getValue(),
    ]);
    if (savedStyle && STYLES.some((item) => item.id === savedStyle)) {
      style.value = savedStyle as StyleId;
    }
    privacyAck.value = props.consentAcknowledged ?? !!ack;
  } catch {
    // 没有扩展存储环境（预览页）时按默认值继续
    privacyAck.value = props.consentAcknowledged ?? false;
  } finally {
    ready.value = true;
  }
  void nextTick(autoSize);
  if (privacyAck.value && !props.initialDraft && props.consentAcknowledged === undefined) {
    void generate();
  }
});

/** 草稿气泡随内容长高，避免在气泡内出现滚动条把内容裁掉 */
function autoSize() {
  const el = draftEl.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 300)}px`;
}

/**
 * 流式时每个 delta 都会改 draft，直接用 nextTick 会每块文字强制重排；
 * 用 rAF 合并成每帧最多一次。
 */
function scheduleAutoSize() {
  if (rafId !== undefined) return;
  rafId = requestAnimationFrame(() => {
    rafId = undefined;
    autoSize();
  });
}

watch(draft, () => void nextTick(scheduleAutoSize));

/**
 * 生成草稿（F2 / 流式）：通过 port 接收增量文本，边生成边显示。
 * previousDraft 用于「重新生成」时提醒模型换个角度。
 */
function generate(options: { previousDraft?: string } = {}) {
  if (!props.text.trim()) {
    error.value = { code: 'BAD_REQUEST', message: '没有可分析的文本：请先选中一条评论。' };
    return;
  }

  cancelStream?.();
  if (draft.value.trim()) previousDraft.value = draft.value;
  loading.value = true;
  error.value = null;
  draft.value = '';
  meta.value = null;

  cancelStream = streamGenerate(
    {
      text: props.text,
      author: props.author,
      style: style.value,
      previousDraft: options.previousDraft,
      context: props.context,
    },
    {
      onDelta: (delta) => {
        draft.value = draft.value ? `${draft.value}${delta}` : `${AI_MARK} ${delta}`;
      },
      onDone: (data: GenerateResult) => {
        loading.value = false;
        draft.value = data.draft;
        void trackEvent('generateOk', data.elapsedMs);
        if (data.emotion) emotionLabel.value = data.emotion;
        meta.value = {
          providerName: data.providerName,
          model: data.model,
          elapsedMs: data.elapsedMs,
        };
        cancelStream = undefined;
      },
      onError: (err) => {
        loading.value = false;
        error.value = err;
        void trackEvent('generateFail');
        cancelStream = undefined;
      },
    },
  );
}

/** 换风格即换风格重生成（F4） */
function changeStyle(next: StyleId) {
  if (style.value === next) return;
  style.value = next;
  void preferredStyleItem.setValue(next).catch(() => {});
  if (privacyAck.value && (draft.value || error.value)) {
    void generate({ previousDraft: draft.value || undefined });
  }
}

function regenerate() {
  void generate({ previousDraft: draft.value || undefined });
}

/** 恢复上一版草稿（与当前版互换，可来回切） */
function restorePrevious() {
  if (!previousDraft.value) return;
  const current = draft.value;
  draft.value = previousDraft.value;
  previousDraft.value = current;
}

async function acknowledgePrivacy() {
  privacyAck.value = true;
  await privacyAckItem.setValue(true).catch(() => {});
  void generate();
}

/** 只做复制，绝不自动发送（PRD F4 合规核心） */
async function copyDraft() {
  if (!draft.value) return;
  try {
    await navigator.clipboard.writeText(draft.value);
    copied.value = true;
    void trackEvent('copied');
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = false), 1800);
  } catch {
    error.value = { code: 'UNKNOWN', message: '复制失败：请手动选中草稿内容后按 Ctrl+C。' };
  }
}

function fillIntoPage() {
  if (!draft.value) return;
  void trackEvent('filled');
  emit('fill', { text: draft.value });
}

onBeforeUnmount(() => {
  cancelStream?.();
  if (rafId !== undefined) cancelAnimationFrame(rafId);
  if (copiedTimer) clearTimeout(copiedTimer);
});
</script>

<template>
  <div class="panel ai-card ai-root" role="dialog" aria-label="AI 回复草稿" aria-modal="false">
    <header class="head">
      <span class="ai-avatar">AI</span>
      <div class="who">
        <strong>AI 辩论搭子</strong>
        <span class="sub">
          <template v-if="meta">{{ meta.providerName }} · {{ meta.model }}</template>
          <template v-else>帮你想，不替你发</template>
        </span>
      </div>
      <span class="ai-spacer" />
      <span class="ai-dot" :class="{ busy: loading }" />
      <button
        v-if="showClose"
        type="button"
        class="ai-icon-btn"
        title="关闭（不会发送任何内容）"
        aria-label="关闭"
        @click="emit('close')"
      >
        ✕
      </button>
    </header>

    <div v-if="ready" class="thread">
      <div class="msg in">
        <span class="ai-avatar sm peer">{{ initial }}</span>
        <div class="ai-bubble in">
          <span class="peer-name">{{ author ? `@${author}` : '对方' }}</span>
          <p class="peer-text">{{ text }}</p>
        </div>
      </div>

      <p v-if="emotionLabel" class="sys-note">已识别对方语气：{{ emotionLabel }}，已调整策略</p>
      <p v-if="context?.length" class="sys-note">已带上 {{ context.length }} 轮上文</p>

      <ConsentBubble
        v-if="!privacyAck"
        :show-close="showClose"
        @accept="acknowledgePrivacy"
        @close="emit('close')"
      />

      <template v-else>
        <div class="msg out">
          <div class="ai-bubble out reply">
            <div v-if="error" class="err">
              <p class="err-text">{{ error.message }}</p>
              <div class="err-actions">
                <button type="button" class="ai-btn small" @click="regenerate">重试</button>
                <button v-if="needsSetup" type="button" class="ai-btn small" @click="openOptionsPage">
                  打开设置
                </button>
              </div>
            </div>

            <template v-else>
              <p v-if="loading && !draft" class="typing">正在写<span class="cursor">▍</span></p>
              <textarea
                v-else-if="draft"
                ref="draftEl"
                v-model="draft"
                class="draft-input"
                rows="3"
                spellcheck="false"
                aria-label="回复草稿，可直接编辑"
                placeholder="草稿会显示在这里，可直接编辑"
                :disabled="loading"
                @input="autoSize"
              />
              <p v-else class="empty-hint">还没有草稿，点下面的「生成草稿」开始</p>
              <span v-if="hasDraft" class="bubble-meta">
                {{ charCount }} 字 · 可直接改
                <template v-if="meta"> · {{ (meta.elapsedMs / 1000).toFixed(1) }}s</template>
              </span>
            </template>
          </div>
        </div>
      </template>
    </div>

    <DraftComposer
      v-if="ready && privacyAck"
      :style-id="style"
      :loading="loading"
      :has-draft="hasDraft"
      :has-previous="!!previousDraft"
      :copied="copied"
      :show-fill="showFill"
      @update:style-id="changeStyle"
      @regenerate="regenerate"
      @copy="copyDraft"
      @restore="restorePrevious"
      @fill="fillIntoPage"
    />
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 400px;
  max-width: calc(100vw - 28px);
  max-height: 78vh;
  padding: 12px 12px 10px;
  animation: ai-pop-in 0.18s var(--ai-ease);
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
  font-size: 13.5px;
  font-weight: 700;
}

.who .sub {
  font-size: 11px;
  color: var(--ai-fg-mute);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 210px;
}

.thread {
  display: flex;
  flex-direction: column;
  gap: 9px;
  max-height: 46vh;
  padding: 2px 2px 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.msg {
  display: flex;
  align-items: flex-start;
  gap: 7px;
}

.msg.in {
  justify-content: flex-start;
}

.msg.out {
  justify-content: flex-end;
}

.ai-avatar.peer {
  align-items: center;
  justify-content: center;
  margin-top: 1px;
  background: var(--ai-surface-2);
  color: var(--ai-fg-soft);
  font-weight: 700;
  box-shadow: none;
}

.ai-bubble.in {
  max-width: 88%;
}

.typing,
.empty-hint {
  margin: 0;
  color: var(--ai-fg-mute);
  font-size: 13px;
}

.empty-hint {
  padding: 6px 0 2px;
}

.peer-name {
  display: block;
  margin-bottom: 2px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ai-fg-mute);
}

.peer-text {
  margin: 0;
  max-height: 120px;
  overflow-y: auto;
}

.ai-bubble.out {
  max-width: 94%;
  min-width: 62%;
}

.reply {
  width: 100%;
}

.draft-input {
  display: block;
  width: 100%;
  min-height: 92px;
  padding: 0;
  font-family: inherit;
  font-size: 13.5px;
  line-height: 1.65;
  color: inherit;
  background: transparent;
  border: none;
  outline: none;
  resize: vertical;
}

.cursor {
  animation: ai-blink 0.9s step-end infinite;
}

.sys-note {
  align-self: center;
  margin: 0;
  padding: 3px 10px;
  font-size: 11px;
  color: var(--ai-fg-mute);
  background: var(--ai-surface);
  border-radius: var(--ai-pill);
}

.err-text {
  margin: 0 0 7px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--ai-danger);
  white-space: pre-wrap;
}

.err-actions {
  display: flex;
  gap: 7px;
}
</style>
