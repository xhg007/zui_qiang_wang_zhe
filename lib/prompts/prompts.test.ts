import { describe, expect, it } from 'vitest';
import {
  AI_MARK,
  DEFAULT_SYSTEM_HEAD,
  applyPromptVars,
  buildMessages,
  finalizeDraft,
  type PromptInput,
} from './index';
import { STYLES } from './styles';

const base: PromptInput = {
  text: '历史上从来没有靠讲道理解决',
  author: '夜航西飞',
  style: 'rational',
};

function systemOf(input: PromptInput = base): string {
  return buildMessages(input)[0]!.content;
}

function userOf(input: PromptInput = base): string {
  return buildMessages(input)[1]!.content;
}

describe('finalizeDraft', () => {
  it('强制加 🤖 前缀', () => {
    expect(finalizeDraft('你好')).toBe(`${AI_MARK} 你好`);
  });

  it('去掉代码块围栏与引号包裹', () => {
    expect(finalizeDraft('```text\n「你说得对」\n```')).toBe(`${AI_MARK} 你说得对`);
  });

  it('不重复添加模型自带的标识', () => {
    expect(finalizeDraft('🤖 已经带了')).toBe(`${AI_MARK} 已经带了`);
    expect(finalizeDraft('AI: 也带')).toBe(`${AI_MARK} 也带`);
  });
});

describe('applyPromptVars', () => {
  it('替换已知变量', () => {
    const out = applyPromptVars('给 @{{author}} 回复：{{text}}', {
      author: '夜航西飞',
      text: '原文',
    });
    expect(out).toBe('给 @夜航西飞 回复：原文');
  });

  it('未知变量原样保留', () => {
    expect(applyPromptVars('{{unknown}}', { author: 'x' })).toBe('{{unknown}}');
  });
});

describe('buildMessages', () => {
  it('系统提示始终包含硬约束', () => {
    expect(buildMessages(base)[0]!.role).toBe('system');
    expect(systemOf()).toContain('禁止脏话');
    expect(systemOf()).toContain(DEFAULT_SYSTEM_HEAD);
  });

  it('用户提示带对方昵称与原文', () => {
    expect(buildMessages(base)[1]!.role).toBe('user');
    expect(userOf()).toContain('夜航西飞');
    expect(userOf()).toContain('历史上从来没有靠讲道理解决');
  });

  it('有上下文时渲染「此前的讨论」', () => {
    const user = userOf({
      ...base,
      context: [
        { author: '甲', text: '第一轮' },
        { author: '乙', text: '第二轮' },
      ],
    });
    expect(user).toContain('此前的讨论');
    expect(user).toContain('1. @甲：第一轮');
    expect(user).toContain('2. @乙：第二轮');
  });

  it('情绪提示拼进提示词', () => {
    expect(userOf({ ...base, emotionNote: '对方在气头上，先降温' })).toContain(
      '对方语气与应对：对方在气头上，先降温',
    );
  });

  it('自定义 Prompt 生效但删不掉硬约束', () => {
    const input = {
      ...base,
      overrides: {
        rational: { system: '你是一位毒舌网友。', instruction: '用 {{author}} 的昵称称呼对方。' },
      },
    };
    expect(systemOf(input)).toContain('你是一位毒舌网友。');
    expect(systemOf(input)).toContain('禁止脏话');
    expect(userOf(input)).toContain('用 夜航西飞 的昵称称呼对方。');
  });

  it('三种风格都能生成完整消息', () => {
    for (const style of STYLES) {
      const messages = buildMessages({ ...base, style: style.id });
      expect(messages).toHaveLength(2);
      expect(messages[1]!.content).toContain(style.name);
    }
  });
});
