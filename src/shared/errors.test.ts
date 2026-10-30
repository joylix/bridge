import { describe, expect, it } from 'vitest';
import { AppError, ERROR_CODES, httpStatusFor, isAppError, toErrorEnvelope } from './errors';

describe('错误码与 HTTP 状态', () => {
  it('授权/冲突/限流映射稳定', () => {
    expect(httpStatusFor(ERROR_CODES.VALIDATION_FAILED)).toBe(400);
    expect(httpStatusFor(ERROR_CODES.BID_ILLEGAL)).toBe(400);
    expect(httpStatusFor(ERROR_CODES.AUTH_REQUIRED)).toBe(401);
    expect(httpStatusFor(ERROR_CODES.SCORE_EDIT_FORBIDDEN)).toBe(403);
    expect(httpStatusFor(ERROR_CODES.EXPORT_NOT_RELEASED)).toBe(403);
    expect(httpStatusFor(ERROR_CODES.NOT_FOUND)).toBe(404);
    expect(httpStatusFor(ERROR_CODES.USERNAME_TAKEN)).toBe(409);
    expect(httpStatusFor(ERROR_CODES.DIRECTOR_OP_CONFLICT)).toBe(409);
    expect(httpStatusFor(ERROR_CODES.CHAT_RATE_LIMITED)).toBe(429);
    expect(httpStatusFor(ERROR_CODES.INTERNAL_ERROR)).toBe(500);
  });

  it('AppError 保留 code 与 status', () => {
    const error = new AppError(ERROR_CODES.EXPORT_NOT_RELEASED, '该副尚未释放');
    expect(isAppError(error)).toBe(true);
    expect(error.status).toBe(403);
    expect(error.code).toBe('EXPORT_NOT_RELEASED');
  });
});

describe('错误信封', () => {
  it('已知错误按原码返回并带 requestId', () => {
    const { status, body } = toErrorEnvelope(
      new AppError(ERROR_CODES.FORBIDDEN, '无权操作'),
      'req-1',
    );
    expect(status).toBe(403);
    expect(body.error).toEqual({
      code: 'FORBIDDEN',
      message: '无权操作',
      requestId: 'req-1',
    });
  });

  it('未知异常不泄漏堆栈、SQL 或输入', () => {
    const { status, body } = toErrorEnvelope(
      new Error('duplicate key value violates unique constraint "accounts_email_uq"'),
      'req-2',
    );
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('服务器内部错误');
    expect(JSON.stringify(body)).not.toContain('accounts_email_uq');
    expect(JSON.stringify(body)).not.toContain('duplicate key');
  });
});
