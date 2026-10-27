import { storage } from 'wxt/utils/storage';

/**
 * 本地使用统计（PRD 8 成功指标的自查口径）。
 *
 * 只存在本机 storage.local，不上传、不采集任何内容；
 * 统计失败必须静默——它不能影响生成主流程。
 */
export interface UsageStats {
  /** 成功生成次数 */
  generateOk: number;
  /** 生成失败次数 */
  generateFail: number;
  /** 复制草稿次数（近似「编辑后复制率」的分子） */
  copied: number;
  /** 填入平台回复框次数 */
  filled: number;
  /** 成功生成累计耗时，用于算平均 */
  totalLatencyMs: number;
  /** 首次使用时间（毫秒时间戳） */
  firstUsedAt: number | null;
}

export const EMPTY_STATS: UsageStats = {
  generateOk: 0,
  generateFail: 0,
  copied: 0,
  filled: 0,
  totalLatencyMs: 0,
  firstUsedAt: null,
};

export const usageStatsItem = storage.defineItem<UsageStats>('local:usageStats', {
  fallback: EMPTY_STATS,
});

export type UsageEvent = 'generateOk' | 'generateFail' | 'copied' | 'filled';

/** 记录一次事件（内部吞掉异常） */
export async function trackEvent(event: UsageEvent, latencyMs?: number): Promise<void> {
  try {
    const current = (await usageStatsItem.getValue()) ?? EMPTY_STATS;
    const next: UsageStats = { ...current, firstUsedAt: current.firstUsedAt ?? Date.now() };

    if (event === 'generateOk') {
      next.generateOk += 1;
      next.totalLatencyMs += latencyMs ?? 0;
    } else if (event === 'generateFail') {
      next.generateFail += 1;
    } else if (event === 'copied') {
      next.copied += 1;
    } else {
      next.filled += 1;
    }

    await usageStatsItem.setValue(next);
  } catch {
    // 统计失败不影响使用
  }
}

/** 汇总成设置页直接可读的几个百分比 */
export function summarize(stats: UsageStats) {
  const attempts = stats.generateOk + stats.generateFail;
  return {
    attempts,
    successRate: attempts ? Math.round((stats.generateOk / attempts) * 100) : 0,
    avgLatencyMs: stats.generateOk ? Math.round(stats.totalLatencyMs / stats.generateOk) : 0,
    copyRate: stats.generateOk ? Math.round((stats.copied / stats.generateOk) * 100) : 0,
  };
}
