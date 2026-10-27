import { describe, expect, it } from 'vitest';
import { toAppError } from './errors';

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe('toAppError', () => {
  it('401 → Key 错误', () => {
    const error = toAppError(httpError(401));
    expect(error.code).toBe('AUTH');
    expect(error.message).toContain('Key');
  });

  it('403 → 无权限', () => {
    expect(toAppError(httpError(403)).code).toBe('FORBIDDEN');
  });

  it('404 → 路径错误并提示 /v1', () => {
    const error = toAppError(httpError(404));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toContain('/v1');
  });

  it('429 → 限流 / 余额', () => {
    expect(toAppError(httpError(429)).code).toBe('RATE_LIMIT');
  });

  it('5xx → 服务端故障', () => {
    expect(toAppError(httpError(503)).code).toBe('SERVER');
  });

  it('超时错误被识别', () => {
    const timeout = Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });
    expect(toAppError(timeout).code).toBe('TIMEOUT');
  });

  it('网络错误被识别', () => {
    const network = Object.assign(new Error('fetch failed'), { name: 'APIConnectionError' });
    expect(toAppError(network).code).toBe('NETWORK');
  });

  it('未知错误也有可读文案', () => {
    const error = toAppError(new Error('boom'));
    expect(error.code).toBe('UNKNOWN');
    expect(error.message).toBe('boom');
  });
});
