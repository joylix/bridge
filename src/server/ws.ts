/**
 * WebSocket 传输层（M5）。
 *
 * 只负责：连接鉴权、协议校验、命令转发、订阅与受众过滤、心跳。
 * 业务状态变更必须走 `handleCommand`，并遵守 ADR-0006 的幂等与版本约束。
 *
 * 安全约束（ADR-0007）：
 * - 未通过 `authenticate` 的连接直接拒绝；
 * - 命令必须属于连接已加入的 Session/Table；
 * - 事件按订阅的 `audience` 与 `tableId` 过滤后再推送；
 * - 客户端“收到但隐藏”不算隔离。
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { ERROR_CODES, isAppError, type ErrorCode } from '../shared/errors';
import {
  PROTOCOL_VERSION,
  isCommandMessage,
  parseClientMessage,
  parseCommandPayload,
  type ClientMessage,
  type CommandMessage,
  type ServerMessage,
  type WireEventEnvelope,
} from '../shared/protocol';
import type { EventAudience } from '../domain/events/types';

export type WsRole = 'player' | 'spectator' | 'room_owner' | 'director' | 'admin';

export interface WsIdentity {
  userId: string;
  role: WsRole;
  /** 已加入的 Session；命令与订阅都必须命中。 */
  sessionIds: string[];
  /** 已加入或获准观战的 Table。 */
  tableIds: string[];
  seat?: 'N' | 'E' | 'S' | 'W';
}

export type SubscribeMessage = Extract<ClientMessage, { kind: 'subscribe' }>;

export interface CommandOutcome {
  seq?: number;
  result?: unknown;
}

export interface WsDeps {
  authenticate(request: IncomingMessage): Promise<WsIdentity | null> | WsIdentity | null;
  handleCommand(identity: WsIdentity, command: CommandMessage): Promise<CommandOutcome>;
  canSubscribe(identity: WsIdentity, subscription: SubscribeMessage): boolean;
  /** 心跳间隔；默认 30s。 */
  heartbeatMs?: number;
  /** 允许的 Origin；为空表示本机开发放行。 */
  allowedOrigins?: string[];
}

export interface WsServerHandle {
  wss: WebSocketServer;
  /** 按受众与会话/桌订阅过滤后推送；返回实际发送连接数。 */
  publish(event: WireEventEnvelope): number;
  close(): Promise<void>;
}

interface ClientState {
  identity: WsIdentity;
  subscriptions: SubscribeMessage[];
  /** 同一连接内按到达顺序串行处理，避免同一桌的写命令乱序。 */
  queue: Promise<void>;
}

/** 单连接订阅上限，防止客户端无限累积订阅对象。 */
export const MAX_SUBSCRIPTIONS = 32;

function subscriptionKey(subscription: SubscribeMessage): string {
  return JSON.stringify([
    subscription.sessionId,
    subscription.tableId ?? null,
    [...subscription.audiences].sort(),
  ]);
}

function rawToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function sendError(
  ws: WebSocket,
  code: ErrorCode,
  message: string,
  commandId?: string,
): void {
  send(ws, {
    kind: 'error',
    protocolVersion: PROTOCOL_VERSION,
    ...(commandId ? { commandId } : {}),
    code,
    message,
  });
}

function audienceMatches(subscription: SubscribeMessage, event: WireEventEnvelope): boolean {
  if (subscription.sessionId !== event.sessionId) return false;
  if (subscription.tableId && event.tableId && subscription.tableId !== event.tableId) return false;
  return subscription.audiences.some((audience) => event.audience.includes(audience));
}

export function attachWebSocketServer(
  app: FastifyInstance,
  deps: WsDeps,
): WsServerHandle {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const clients = new Map<WebSocket, ClientState>();
  const heartbeatMs = deps.heartbeatMs ?? 30_000;
  const allowedOrigins = deps.allowedOrigins ?? [];

  function originAllowed(request: IncomingMessage): boolean {
    if (allowedOrigins.length === 0) return true;
    const origin = request.headers.origin;
    return typeof origin === 'string' && allowedOrigins.includes(origin);
  }

  function setupConnection(ws: WebSocket, identity: WsIdentity): void {
    let alive = true;
    const state: ClientState = { identity, subscriptions: [], queue: Promise.resolve() };
    clients.set(ws, state);

    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, heartbeatMs);

    ws.on('pong', () => {
      alive = true;
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(ws);
    });

    ws.on('error', () => {
      clearInterval(heartbeat);
      clients.delete(ws);
      ws.terminate();
    });

    send(ws, {
      kind: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      connectionId: randomUUID(),
      serverTime: new Date().toISOString(),
    });

    ws.on('message', (data) => {
      const raw = rawToString(data);
      // 串行化：上一条消息处理完成后再处理下一条，保证同一连接的命令顺序。
      state.queue = state.queue
        .then(() => handleMessage(ws, state, raw))
        .catch(() => undefined);
    });
  }

  async function handleMessage(ws: WebSocket, state: ClientState, raw: string): Promise<void> {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      sendError(ws, ERROR_CODES.VALIDATION_FAILED, '消息必须是合法 JSON');
      ws.close(1008, 'INVALID_JSON');
      return;
    }

    const parsed = parseClientMessage(parsedJson);
    if (!parsed.ok) {
      sendError(ws, parsed.code, parsed.message);
      ws.close(1008, 'PROTOCOL_VIOLATION');
      return;
    }

    const message = parsed.value;
    if (message.kind === 'ping') {
      send(ws, {
        kind: 'pong',
        protocolVersion: PROTOCOL_VERSION,
        serverTime: new Date().toISOString(),
      });
      return;
    }

    if (message.kind === 'subscribe') {
      if (!state.identity.sessionIds.includes(message.sessionId)) {
        sendError(ws, ERROR_CODES.FORBIDDEN, '无权订阅该盘');
        return;
      }
      if (message.tableId && !state.identity.tableIds.includes(message.tableId)) {
        sendError(ws, ERROR_CODES.FORBIDDEN, '无权订阅该桌');
        return;
      }
      if (!deps.canSubscribe(state.identity, message)) {
        sendError(ws, ERROR_CODES.CHAT_AUDIENCE_FORBIDDEN, '无权订阅该受众频道');
        return;
      }
      const key = subscriptionKey(message);
      const duplicate = state.subscriptions.some(
        (subscription) => subscriptionKey(subscription) === key,
      );
      if (!duplicate) {
        if (state.subscriptions.length >= MAX_SUBSCRIPTIONS) {
          sendError(ws, ERROR_CODES.VALIDATION_FAILED, '订阅数量超过上限');
          return;
        }
        state.subscriptions.push(message);
      }
      send(ws, {
        kind: 'subscribed',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: message.sessionId,
        ...(message.tableId ? { tableId: message.tableId } : {}),
        audiences: message.audiences,
      });
      return;
    }

    if (!isCommandMessage(message)) return;

    if (!state.identity.sessionIds.includes(message.sessionId)) {
      sendError(ws, ERROR_CODES.FORBIDDEN, '无权操作该盘', message.commandId);
      return;
    }
    if (message.tableId && !state.identity.tableIds.includes(message.tableId)) {
      sendError(ws, ERROR_CODES.FORBIDDEN, '无权操作该桌', message.commandId);
      return;
    }

    const payload = parseCommandPayload(message);
    if (!payload.ok) {
      sendError(ws, payload.code, payload.message, message.commandId);
      return;
    }

    try {
      const outcome = await deps.handleCommand(state.identity, message);
      send(ws, {
        kind: 'ack',
        protocolVersion: PROTOCOL_VERSION,
        commandId: message.commandId,
        ...(outcome.seq !== undefined ? { seq: outcome.seq } : {}),
        ...(outcome.result !== undefined ? { result: outcome.result } : {}),
      });
    } catch (error) {
      if (isAppError(error)) {
        sendError(ws, error.code, error.message, message.commandId);
      } else {
        sendError(ws, ERROR_CODES.INTERNAL_ERROR, '服务器内部错误', message.commandId);
      }
    }
  }

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    let url: URL;
    try {
      url = new URL(request.url ?? '/', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== '/ws' || !originAllowed(request)) {
      socket.destroy();
      return;
    }
    void Promise.resolve(deps.authenticate(request))
      .then((identity) => {
        if (!identity) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => setupConnection(ws, identity));
      })
      .catch(() => socket.destroy());
  };

  app.server.on('upgrade', onUpgrade);

  let closed = false;
  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    app.server.off('upgrade', onUpgrade);
    for (const ws of clients.keys()) ws.terminate();
    clients.clear();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }

  app.addHook('onClose', async () => {
    await close();
  });

  return {
    wss,
    publish(event) {
      let sent = 0;
      for (const [ws, state] of clients) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        if (!state.subscriptions.some((subscription) => audienceMatches(subscription, event))) {
          continue;
        }
        try {
          send(ws, { kind: 'event', protocolVersion: PROTOCOL_VERSION, event });
          sent += 1;
        } catch {
          // 发送失败视为连接不可用：终止并移除，避免污染后续广播。
          clients.delete(ws);
          ws.terminate();
        }
      }
      return sent;
    },
    close,
  };
}

/** 供测试/后续命令层复用：事件受众是否允许该订阅。 */
export function subscriptionAllows(
  subscription: SubscribeMessage,
  eventAudiences: EventAudience[],
): boolean {
  return subscription.audiences.some((audience) => eventAudiences.includes(audience));
}
