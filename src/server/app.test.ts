// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { AppError, ERROR_CODES } from '../shared/errors';

const FIXED_NOW = new Date('2026-10-28T12:00:00Z');

async function app() {
  return buildApp({ now: () => FIXED_NOW });
}

describe('服务端骨架', () => {
  it('healthz 返回服务名与权威时间', async () => {
    const server = await app();
    const response = await server.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      server: 'bridge-server',
      serverTime: '2026-10-28T12:00:00.000Z',
    });
    await server.close();
  });

  it('meta 暴露协议/记录/规则/IMP 版本', async () => {
    const server = await app();
    const response = await server.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      protocolVersion: '1.0',
      recordSchemaVersion: '1.1',
      eventSchemaVersion: '1.0',
      rulesVersion: 'wbf-laws-2017',
      impTableVersion: 'wbf-2017',
    });
    await server.close();
  });

  it('readyz 无依赖时 ok，注入检查失败时 503', async () => {
    const healthy = await app();
    expect((await healthy.inject({ url: '/readyz' })).statusCode).toBe(200);
    await healthy.close();

    const degraded = await buildApp({
      readiness: async () => ({ ok: false, checks: { database: 'unreachable' } }),
    });
    const response = await degraded.inject({ url: '/readyz' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'degraded',
      checks: { database: 'unreachable' },
    });
    await degraded.close();
  });

  it('未知路由返回统一 404 信封', async () => {
    const server = await app();
    const response = await server.inject({ url: '/api/v1/nope' });
    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBeTruthy();
    await server.close();
  });

  it('AppError 按状态返回，未知异常收敛为 INTERNAL_ERROR', async () => {
    const server = await app();
    server.get('/boom-app', async () => {
      throw new AppError(ERROR_CODES.EXPORT_NOT_RELEASED, '该副尚未释放');
    });
    server.get('/boom-unknown', async () => {
      throw new Error('relation "secret_table" does not exist');
    });

    const known = await server.inject({ url: '/boom-app' });
    expect(known.statusCode).toBe(403);
    expect(known.json().error.code).toBe('EXPORT_NOT_RELEASED');

    const unknown = await server.inject({ url: '/boom-unknown' });
    expect(unknown.statusCode).toBe(500);
    expect(unknown.json().error.code).toBe('INTERNAL_ERROR');
    expect(unknown.body).not.toContain('secret_table');
    await server.close();
  });

  it('回传安全的 x-request-id，拒绝注入的非法值', async () => {
    const server = await app();
    const good = await server.inject({
      url: '/healthz',
      headers: { 'x-request-id': 'req-safe-1' },
    });
    expect(good.headers['x-request-id']).toBe('req-safe-1');

    const bad = await server.inject({
      url: '/healthz',
      headers: { 'x-request-id': 'bad id with spaces' },
    });
    expect(bad.headers['x-request-id']).not.toBe('bad id with spaces');
    await server.close();
  });
});
