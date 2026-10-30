// @vitest-environment node

import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from './app';
import {
  attachWebSocketServer,
  MAX_SUBSCRIPTIONS,
  type CommandOutcome,
  type WsDeps,
  type WsIdentity,
} from './ws';
import { ERROR_CODES } from '../shared/errors';
import { PROTOCOL_VERSION, type ServerMessage, type WireEventEnvelope } from '../shared/protocol';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SESSION_ID = '99999999-9999-4999-8999-999999999999';
const TABLE_ID = '22222222-2222-4222-8222-222222222222';
const BOARD_ID = '44444444-4444-4444-8444-444444444444';

const identity: WsIdentity = {
  userId: '55555555-5555-4555-8555-555555555555',
  role: 'player',
  sessionIds: [SESSION_ID],
  tableIds: [TABLE_ID],
  seat: 'N',
};

interface Harness {
  app: Awaited<ReturnType<typeof buildApp>>;
  handle: ReturnType<typeof attachWebSocketServer>;
  port: number;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()!;
    await cleanup();
  }
});

async function startServer(overrides: Partial<WsDeps> = {}): Promise<Harness> {
  const app = await buildApp();
  const handle = attachWebSocketServer(app, {
    authenticate: () => identity,
    handleCommand: async () => ({ seq: 1, result: { accepted: true } }),
    canSubscribe: () => true,
    heartbeatMs: 60_000,
    ...overrides,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const port = (app.server.address() as AddressInfo).port;
  cleanups.push(async () => {
    await app.close();
  });
  return { app, handle, port };
}

interface Queue {
  next(): Promise<ServerMessage>;
  expectSilence(ms?: number): Promise<void>;
}

function messageQueue(ws: WebSocket): Queue {
  const queue: ServerMessage[] = [];
  const waiters: Array<(message: ServerMessage) => void> = [];
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString()) as ServerMessage;
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  });
  return {
    next() {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('等待服务端消息超时')), 2000);
        waiters.push((message) => {
          clearTimeout(timer);
          resolve(message);
        });
      });
    },
    async expectSilence(ms = 150) {
      await new Promise((resolve) => setTimeout(resolve, ms));
      if (queue.length > 0) throw new Error(`预期无消息，实际收到 ${queue[0].kind}`);
    },
  };
}

async function connect(port: number, origin?: string): Promise<{ ws: WebSocket; queue: Queue }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin ? { origin } : undefined);
  const queue = messageQueue(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return { ws, queue };
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'command',
    protocolVersion: PROTOCOL_VERSION,
    commandId: 'cmd-00000001',
    type: 'auction.call',
    sessionId: SESSION_ID,
    tableId: TABLE_ID,
    expectedVersion: 0,
    payload: { position: 'N', call: { type: 'bid', level: 1, suit: 'NT' } },
    ...overrides,
  };
}

function wireEvent(overrides: Partial<WireEventEnvelope> = {}): WireEventEnvelope {
  return {
    eventId: '33333333-3333-4333-8333-333333333333',
    schemaVersion: '1.0',
    streamId: BOARD_ID,
    sessionId: SESSION_ID,
    tableId: TABLE_ID,
    seq: 1,
    type: 'auction.call',
    occurredAt: '2026-10-28T00:00:00Z',
    actor: { kind: 'player', seat: 'N' },
    audience: ['TABLE', 'DIRECTOR'],
    payload: { position: 'N', call: { type: 'pass' } },
    ...overrides,
  };
}

describe('WebSocket 协议', () => {
  it('连接后发送 hello，合法命令返回 ack', async () => {
    const { handle, port } = await startServer();
    const { ws, queue } = await connect(port);

    const hello = await queue.next();
    expect(hello.kind).toBe('hello');
    if (hello.kind === 'hello') expect(hello.protocolVersion).toBe(PROTOCOL_VERSION);

    ws.send(JSON.stringify(command()));
    const ack = await queue.next();
    expect(ack.kind).toBe('ack');
    if (ack.kind === 'ack') {
      expect(ack.commandId).toBe('cmd-00000001');
      expect(ack.seq).toBe(1);
    }
    expect(handle.wss.clients.size).toBe(1);
    ws.close();
  });

  it('payload 非法时返回 VALIDATION_FAILED，连接保持可用', async () => {
    const { port } = await startServer();
    const { ws, queue } = await connect(port);
    await queue.next(); // hello

    ws.send(
      JSON.stringify(
        command({ type: 'play.card', payload: { position: 'N', card: 52 } }),
      ),
    );
    const error = await queue.next();
    expect(error.kind).toBe('error');
    if (error.kind === 'error') expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);

    ws.send(JSON.stringify(command()));
    const ack = await queue.next();
    expect(ack.kind).toBe('ack');
    ws.close();
  });

  it('拒绝其他 Session 的命令', async () => {
    const { port } = await startServer();
    const { ws, queue } = await connect(port);
    await queue.next(); // hello

    ws.send(JSON.stringify(command({ sessionId: OTHER_SESSION_ID })));
    const error = await queue.next();
    expect(error.kind).toBe('error');
    if (error.kind === 'error') expect(error.code).toBe(ERROR_CODES.FORBIDDEN);
    ws.close();
  });

  it('订阅后只推送匹配受众的事件', async () => {
    const { handle, port } = await startServer();
    const { ws, queue } = await connect(port);
    await queue.next(); // hello

    ws.send(
      JSON.stringify({
        kind: 'subscribe',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: SESSION_ID,
        tableId: TABLE_ID,
        audiences: ['TABLE'],
      }),
    );
    const subscribed = await queue.next();
    expect(subscribed.kind).toBe('subscribed');

    expect(handle.publish(wireEvent({ audience: ['DIRECTOR'] }))).toBe(0);
    await queue.expectSilence();

    expect(handle.publish(wireEvent())).toBe(1);
    const event = await queue.next();
    expect(event.kind).toBe('event');
    if (event.kind === 'event') {
      expect(event.event.eventId).toBe('33333333-3333-4333-8333-333333333333');
    }
    ws.close();
  });

  it('命令处理器抛 AppError 时返回稳定错误码', async () => {
    const { port } = await startServer({
      handleCommand: async (): Promise<CommandOutcome> => {
        const { AppError } = await import('../shared/errors');
        throw new AppError(ERROR_CODES.DIRECTOR_OP_CONFLICT, '裁判操作冲突');
      },
    });
    const { ws, queue } = await connect(port);
    await queue.next(); // hello

    ws.send(JSON.stringify(command({ type: 'director.cancel', payload: { reason: '测试' } })));
    const error = await queue.next();
    expect(error.kind).toBe('error');
    if (error.kind === 'error') {
      expect(error.code).toBe(ERROR_CODES.DIRECTOR_OP_CONFLICT);
      expect(error.commandId).toBe('cmd-00000001');
    }
    ws.close();
  });

  it('重复订阅幂等，不会重复推送', async () => {
    const { handle, port } = await startServer();
    const { ws, queue } = await connect(port);
    await queue.next(); // hello

    const subscribe = {
      kind: 'subscribe',
      protocolVersion: PROTOCOL_VERSION,
      sessionId: SESSION_ID,
      tableId: TABLE_ID,
      audiences: ['TABLE'],
    };
    ws.send(JSON.stringify(subscribe));
    expect((await queue.next()).kind).toBe('subscribed');
    ws.send(JSON.stringify(subscribe));
    expect((await queue.next()).kind).toBe('subscribed');

    expect(handle.publish(wireEvent())).toBe(1);
    expect((await queue.next()).kind).toBe('event');
    await queue.expectSilence();
    ws.close();
  });

  it('订阅数量超过上限时拒绝新增', async () => {
    const tableIds = Array.from({ length: MAX_SUBSCRIPTIONS + 1 }, () => randomUUID());
    const wideIdentity: WsIdentity = { ...identity, tableIds };
    const { port } = await startServer({ authenticate: () => wideIdentity });
    const { ws, queue } = await connect(port);
    await queue.next(); // hello

    for (const tableId of tableIds) {
      ws.send(
        JSON.stringify({
          kind: 'subscribe',
          protocolVersion: PROTOCOL_VERSION,
          sessionId: SESSION_ID,
          tableId,
          audiences: ['TABLE'],
        }),
      );
    }

    const kinds: string[] = [];
    const codes: string[] = [];
    for (let index = 0; index < tableIds.length; index += 1) {
      const message = await queue.next();
      kinds.push(message.kind);
      if (message.kind === 'error') codes.push(message.code);
    }
    expect(kinds.filter((kind) => kind === 'subscribed')).toHaveLength(MAX_SUBSCRIPTIONS);
    expect(kinds.filter((kind) => kind === 'error')).toHaveLength(1);
    expect(codes).toEqual([ERROR_CODES.VALIDATION_FAILED]);
    ws.close();
  });

  it('同一连接的命令串行处理，ack 顺序与到达顺序一致', async () => {
    const { port } = await startServer({
      handleCommand: async (_identity, message): Promise<CommandOutcome> => {
        if (message.commandId === 'cmd-00000001') {
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
        return { seq: 1 };
      },
    });
    const { ws, queue } = await connect(port);
    await queue.next(); // hello

    ws.send(JSON.stringify(command({ commandId: 'cmd-00000001' })));
    ws.send(JSON.stringify(command({ commandId: 'cmd-00000002' })));

    const first = await queue.next();
    const second = await queue.next();
    expect(first.kind).toBe('ack');
    expect(second.kind).toBe('ack');
    if (first.kind === 'ack' && second.kind === 'ack') {
      expect([first.commandId, second.commandId]).toEqual(['cmd-00000001', 'cmd-00000002']);
    }
    ws.close();
  });

  it('Origin 不在白名单时拒绝升级', async () => {
    const { port } = await startServer({ allowedOrigins: ['https://bridge.example'] });
    await expect(connect(port, 'https://evil.example')).rejects.toThrow();
  });
});
