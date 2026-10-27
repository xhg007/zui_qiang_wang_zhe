import { findStyle, type StyleId } from './styles';

export * from './styles';

/** F7：单个风格的自定义 Prompt（留空则用默认） */
export interface StylePromptOverride {
  /** 系统提示的「角色 / 口吻」部分；硬性约束始终由程序追加，不可删 */
  system?: string;
  /** 风格指令，替换默认的策略描述 */
  instruction?: string;
}

export type PromptOverrides = Partial<Record<StyleId, StylePromptOverride>>;

/** 默认系统提示中可被用户编辑的部分（角色设定） */
export const DEFAULT_SYSTEM_HEAD = `你是一位中文辩论助理，帮用户写一段站得住脚的公开回复，而不是替用户发泄情绪。`;

/**
 * 所有风格共用的硬约束（PRD 3.2 F2&F3），产品底线。
 * 始终由程序追加在系统提示末尾：即使用户自定义了 Prompt，也不能删掉。
 */
const HARD_CONSTRAINTS = `硬性约束（全部必须遵守）：
1. 禁止脏话、侮辱、人身攻击、贬低对方人格或智力；禁止任何种族、性别、地域、职业、疾病、残障相关的歧视内容。
2. 只针对观点与论据本身，不评价发言者的人格、身份、动机。
3. 正文长度 100-200 个汉字；不要分段过多（最多两段），不要用标题、列表标记或 Markdown 代码块。
4. 不要编造可核查的具体数据、文献、法条、时间点。不确定的事实用「据我了解」「这一点需要你补充来源」这类表述。
5. 只输出回复正文，不要输出解释、前言、括号说明或「以下是我的回复」之类的话。
6. 不要在正文开头添加任何机器人标识，标识由程序统一添加。`;

export interface PromptInput {
  /** 对方发言原文 */
  text: string;
  /** 对方昵称，用于代称；缺失时用「对方」 */
  author?: string;
  style: StyleId;
  /** 上一版草稿：同风格重生成时提醒模型换个角度 */
  previousDraft?: string;
  /** 讨论串上下文（F6），按时间正序 */
  context?: { author?: string; text: string }[];
  /** F9：情绪分析给出的应对策略 */
  emotionNote?: string;
  /** F7：用户自定义的模板 */
  overrides?: PromptOverrides;
}

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/** 把讨论串渲染成 Prompt 片段；没有上下文时返回空串 */
function renderContext(context?: { author?: string; text: string }[]): string {
  if (!context?.length) return '';
  const lines = context
    .map((turn, index) => `${index + 1}. ${turn.author ? `@${turn.author}` : '对方'}：${turn.text}`)
    .join('\n');
  return `此前的讨论（按时间正序，只用来理解语境，不必逐条回应）：
${lines}

`;
}

/** 支持 {{author}} / {{text}} / {{styleName}} / {{context}} 四个变量 */
export function applyPromptVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    key in vars ? vars[key]! : whole,
  );
}

export function buildMessages({
  text,
  author,
  style,
  previousDraft,
  context,
  emotionNote,
  overrides,
}: PromptInput): ChatMessage[] {
  const meta = findStyle(style);
  const speaker = author?.trim() || '对方';
  const contextText = renderContext(context);

  const vars: Record<string, string> = {
    author: speaker,
    text: text.trim(),
    styleName: meta.name,
    context: contextText.trim(),
  };

  const override = overrides?.[style];
  const systemHead = applyPromptVars(override?.system?.trim() || DEFAULT_SYSTEM_HEAD, vars);
  const instruction = applyPromptVars(override?.instruction?.trim() || meta.instruction, vars);

  const rewriteHint = previousDraft?.trim()
    ? `

上一版草稿（仅供参考，请换一个角度重写，不要重复它的句子）：
"""
${previousDraft.trim()}
"""`
    : '';

  const userPrompt = `${contextText}对方的发言（发布者：${speaker}）：
"""
${text.trim()}
"""

请按「${meta.name}」风格写一段回复。
风格要求：${instruction}${rewriteHint}${emotionNote ? `\n对方语气与应对：${emotionNote}` : ''}

再次提醒：正文 100-200 个汉字，只输出正文。`;

  return [
    { role: 'system', content: `${systemHead}\n\n${HARD_CONSTRAINTS}` },
    { role: 'user', content: userPrompt },
  ];
}

/** AI 生成标识：默认开启且不可关闭（PRD 9.2 结论），由程序强制前置。 */
export const AI_MARK = '🤖';

/** 清洗模型输出并强制添加 🤖 标识。 */
export function finalizeDraft(raw: string): string {
  let body = raw.trim();
  // 去掉模型可能包起来的代码块围栏
  body = body.replace(/^```[a-z]*\s*/i, '').replace(/```$/i, '').trim();
  // 去掉模型自己加的引号包裹
  body = body.replace(/^["“「](.*)["”」]$/s, '$1').trim();
  // 去掉模型自行添加的标识，统一由程序加
  body = body.replace(/^(🤖|\[AI\]|AI\s*[:：])/u, '').trim();

  return `${AI_MARK} ${body}`;
}
