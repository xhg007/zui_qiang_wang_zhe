/** 三种内置风格（PRD F3）。风格差异只体现在 Prompt 片段与展示元数据上。 */
export type StyleId = 'rational' | 'satire' | 'socratic';

export interface StyleMeta {
  id: StyleId;
  /** 展示名 */
  name: string;
  emoji: string;
  /** 一句话策略说明，展示给用户 */
  description: string;
  /** 写入 Prompt 的风格指令 */
  instruction: string;
}

export const STYLES: StyleMeta[] = [
  {
    id: 'rational',
    name: '理性反驳',
    emoji: '🧊',
    description: '识别逻辑漏洞与事实错误，冷静拆解',
    instruction:
      '先冷静指出对方论述中的逻辑漏洞或事实错误（例如以偏概全、偷换概念、诉诸人身、双重标准、把个例当通例），再给出你的判断和理由。语气克制、有依据，不嘲讽对方。',
  },
  {
    id: 'satire',
    name: '幽默反讽',
    emoji: '🎭',
    description: '轻松夸张语调揭露荒谬，玩梗不骂人',
    instruction:
      '用轻松、略带夸张的类比揭露对方论证的荒谬之处，可以玩梗、用反讽，但不骂人、不贬低对方人格。目标是让对方显得可笑，而不是让你显得愤怒。',
  },
  {
    id: 'socratic',
    name: '灵魂拷问',
    emoji: '🔥',
    description: '连续 2-3 个关键问题，引导对方自证',
    instruction:
      '不要长篇反驳。连续提出 2-3 个针对性强的问题，问题要具体、直指对方论据的薄弱处，引导对方自己补充证据或自相矛盾。语气平和，不要质问式攻击。',
  },
];

export const DEFAULT_STYLE: StyleId = 'rational';

export function findStyle(id: string | null | undefined): StyleMeta {
  return STYLES.find((style) => style.id === id) ?? STYLES[0] ?? {
    id: 'rational',
    name: '理性反驳',
    emoji: '🧊',
    description: '识别逻辑漏洞与事实错误，冷静拆解',
    instruction: '冷静指出对方论述中的逻辑漏洞或事实错误，再给出你的判断和理由。',
  };
}
