/**
 * 牌室 HTTP 端点（SRS V0.7 3.1 / 3.2 / 4.1 / 4.3）。
 *
 * 当前切片：创建、公开列表、详情、加入 / 离开等候区、落座 / 离座、举手。
 * 私有牌室不出现在列表；非室主/非管理员/非成员访问统一 404。
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthService } from '../../auth/service';
import type { RoomService } from '../../rooms/service';
import { requireUser } from './authGuard';

export interface RoomRouteDeps {
  auth: AuthService;
  rooms: RoomService;
}

const roomNatureSchema = z.enum(['practice', 'casual', 'competitive']);
const seatSchema = z.enum(['N', 'E', 'S', 'W']);

const createRoomBody = z
  .object({
    name: z.string().min(1).max(128),
    roomNature: roomNatureSchema,
    gameplay: z.enum(['single', 'teams']),
    totalBoards: z.number().int().min(1).max(200).nullable().optional(),
    minHumans: z.number().int().min(1).max(4).optional(),
    aiDifficulty: z.enum(['easy', 'normal', 'expert']).optional(),
    disconnectPolicy: z.enum(['auto_ai', 'wait_owner']).optional(),
    spectatorsEnabled: z.boolean().optional(),
    chatEnabled: z.boolean().optional(),
    waitingLimit: z.number().int().min(1).max(100).optional(),
    isPrivate: z.boolean().optional(),
    password: z.string().min(1).max(64).optional(),
  })
  .strict();

const listRoomsQuery = z
  .object({
    roomNature: roomNatureSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

const roomIdParams = z.object({ roomId: z.uuid() }).strict();

const joinRoomBody = z.object({ password: z.string().min(1).max(64).optional() }).strict();

const seatBody = z
  .object({
    position: seatSchema,
    /** 室主 / 管理员拖拽他人时使用；缺省为自己落座。 */
    userId: z.uuid().optional(),
  })
  .strict();

const standBody = z.object({ userId: z.uuid().optional() }).strict();

const readyBody = z.object({ ready: z.boolean() }).strict();

export function registerRoomRoutes(app: FastifyInstance, deps: RoomRouteDeps): void {
  app.post('/api/v1/rooms', async (request, reply) => {
    const { account } = await requireUser(request, deps.auth);
    const body = createRoomBody.parse(request.body);
    const room = await deps.rooms.create(account, body);
    reply.code(201);
    return { room };
  });

  app.get('/api/v1/rooms', async (request) => {
    const { account } = await requireUser(request, deps.auth);
    const query = listRoomsQuery.parse(request.query);
    const rooms = await deps.rooms.list(
      { userId: account.userId, role: account.role },
      query,
    );
    return { rooms };
  });

  app.get('/api/v1/rooms/:roomId', async (request) => {
    const { account } = await requireUser(request, deps.auth);
    const { roomId } = roomIdParams.parse(request.params);
    const room = await deps.rooms.get({ userId: account.userId, role: account.role }, roomId);
    return { room };
  });

  app.post('/api/v1/rooms/:roomId/join', async (request) => {
    const { account } = await requireUser(request, deps.auth);
    const { roomId } = roomIdParams.parse(request.params);
    const body = joinRoomBody.parse(request.body ?? {});
    const room = await deps.rooms.join(account, roomId, body.password);
    return { room };
  });

  app.post('/api/v1/rooms/:roomId/leave', async (request, reply) => {
    const { account } = await requireUser(request, deps.auth);
    const { roomId } = roomIdParams.parse(request.params);
    await deps.rooms.leave(account, roomId);
    reply.code(204);
    return undefined;
  });

  app.post('/api/v1/rooms/:roomId/seat', async (request) => {
    const { account } = await requireUser(request, deps.auth);
    const { roomId } = roomIdParams.parse(request.params);
    const body = seatBody.parse(request.body);
    const room = await deps.rooms.takeSeat(account, roomId, body.position, body.userId);
    return { room };
  });

  app.post('/api/v1/rooms/:roomId/stand', async (request) => {
    const { account } = await requireUser(request, deps.auth);
    const { roomId } = roomIdParams.parse(request.params);
    const body = standBody.parse(request.body ?? {});
    const room = await deps.rooms.stand(account, roomId, body.userId);
    return { room };
  });

  app.post('/api/v1/rooms/:roomId/ready', async (request) => {
    const { account } = await requireUser(request, deps.auth);
    const { roomId } = roomIdParams.parse(request.params);
    const body = readyBody.parse(request.body);
    const room = await deps.rooms.setReady(account, roomId, body.ready);
    return { room };
  });
}
