import { chatCompletion } from './ai';

/** 可识别的语气标签 */
export const EMOTION_LABELS = ['愤怒', '讽刺', '挑衅', '焦虑', '说理', '煽动', '其他'] as const;

export type EmotionLabel = (typeof EMOTION_LABELS)[number];

/** 每种语气对应的应对策略，直接拼进 Prompt（PRD F9） */
export const EMOTION_ADVICE: Record<EmotionLabel, string> = {
  愤怒: '对方正在气头上：先承认其情绪里合理的部分，再回到事实与论据，绝不对骂。',
  讽刺: '对方在阴阳怪气：不要接梗对喷，用平静的追问把话题拉回证据。',
  挑衅: '对方在激将：不要被带节奏，只回应观点本身，不评价人。',
  焦虑: '对方在担忧：先回应担忧本身，再纠正其中的事实错误。',
  说理: '对方在讲道理：正面回应论据，给出你的依据与推理。',
  煽动: '对方在带节奏：指出论证缺口，避免被卷入群体情绪。',
  其他: '保持克制，围绕事实与逻辑回应。',
};

const CLASSIFY_PROMPT = `判断下面这段中文发言的主导语气，只输出一个词，不要标点、不要解释。
候选：${EMOTION_LABELS.join('、')}
无法判断时输出：其他`;

export interface EmotionInput {
  text: string;
  author?: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * 生成前的轻量语气分类（F9）。
 * 失败一律返回 null：分析只是增强，绝不能因为它失败就挡住生成。
 */
export async function analyzeEmotion(input: EmotionInput): Promise<EmotionLabel | null> {
  try {
    const raw = await chatCompletion({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      model: input.model,
      messages: [
        { role: 'system', content: CLASSIFY_PROMPT },
        {
          role: 'user',
          content: `${input.author ? `发布者：${input.author}\n` : ''}${input.text.slice(0, 800)}`,
        },
      ],
      temperature: 0,
      maxTokens: 12,
      timeoutMs: 10_000,
    });

    const cleaned = raw.replace(/[\s"'“”「」【】。，,.]/g, '');
    const hit = EMOTION_LABELS.find((label) => cleaned.includes(label));
    return hit ?? (cleaned.length > 0 ? '其他' : null);
  } catch {
    return null;
  }
}
