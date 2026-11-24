// Ilovani yig'ish: kontekst → modullar → HTTP server. Testlar va server.ts shu yerdan foydalanadi.
import { createCtx } from './core/context.ts';
import { initModules } from './modules/index.ts';
import { buildServer } from './core/web.ts';

export function buildApp() {
  const ctx = initModules(createCtx());
  return { app: buildServer(ctx), ctx };
}
