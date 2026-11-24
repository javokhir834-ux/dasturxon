// Modullar konteksti (Ctx). Har modul `export default function nom(ctx: Ctx)` — marshrutlarini `ctx.route(...)` bilan qo'shadi
// va boshqalarga kerak funksiyalarni qaytaradi (ctx.<nom> bo'lib saqlanadi). Tartib: src/modules/index.ts.
import type { IncomingMessage } from 'node:http';
import config from './config.ts';
import { db, hashPin, DATA_DIR, type Db } from './db.ts';
import { HttpError, fail, now, int, str, parse, z } from './http.ts';
import { ROLES, sessions, authUser, audit, tokHash, type User } from './auth.ts';
import { broadcast } from './realtime.ts';
import { imgRef } from './images.ts';

export interface HandlerArgs {
  req: IncomingMessage; url: URL; body: any; user: User; p: Record<string, string>;
}
export type Handler = (a: HandlerArgs) => unknown | Promise<unknown>;
export interface RouteDef { method: string; pattern: string; roles: readonly string[] | null; handler: Handler; bodyLimit?: number }

export const clientIp = (req: IncomingMessage) =>
  (config.TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';

export function createCtx() {
  const routes: RouteDef[] = [];
  /** Marshrut: roles=null — ochiq (o'zi tekshiradi), aks holda xodim tokeni va rol talab qilinadi */
  const route = (method: string, pattern: string, roles: readonly string[] | null, handler: Handler, opts: { bodyLimit?: number } = {}) =>
    routes.push({ method, pattern, roles, handler, ...opts });
  return {
    config, db, hashPin, DATA_DIR, routes, route, ROLES, HttpError, fail, now, int, str, parse, z,
    sessions, authUser, audit, tokHash, broadcast, imgRef, clientIp,
  } as BaseCtx & Record<string, any>;
}
interface BaseCtx {
  config: typeof config; db: Db; hashPin: typeof hashPin; DATA_DIR: string; routes: RouteDef[];
  route: (method: string, pattern: string, roles: readonly string[] | null, handler: Handler, opts?: { bodyLimit?: number }) => number;
  ROLES: typeof ROLES; HttpError: typeof HttpError; fail: typeof fail; now: typeof now; int: typeof int; str: typeof str; parse: typeof parse; z: typeof z;
  sessions: typeof sessions; authUser: typeof authUser; audit: typeof audit; tokHash: typeof tokHash; broadcast: typeof broadcast; imgRef: typeof imgRef;
  clientIp: typeof clientIp;
}
/** Modullar qaytargan funksiyalar (pos, office, staff, tenant, sync, delivery...) ham ctx da — hozircha `any` */
export type Ctx = BaseCtx & Record<string, any>;
