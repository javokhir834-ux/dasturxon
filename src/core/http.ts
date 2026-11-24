// HTTP yordamchilari: xato turi, kirish ma'lumotlarini tekshirish (int/str va Zod), vaqt.
import { z } from 'zod';

export class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}
/** Xato bilan to'xtatish: handler ichida `fail(404, 'Topilmadi')` */
export const fail = (status: number, msg: string): never => { throw new HttpError(status, msg); };
export const now = () => new Date().toISOString();

export const int = (v: unknown, name: string, { min = 0, max = 1e12 } = {}): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `${name} noto'g'ri`);
  return n;
};
export const str = (v: unknown, name: string, { max = 200, required = true } = {}): string => {
  const s = v == null ? '' : String(v).trim();
  if (required && !s) fail(400, `${name} kiritilmagan`);
  if (s.length > max) fail(400, `${name} juda uzun`);
  return s;
};

/**
 * Zod sxemasi bilan tekshirish (yangi kod uchun tavsiya): `const b = parse(OrderBody, body)`.
 * Xato bo'lsa 400 va o'zbekcha xabar qaytadi. Maydon nomini `.describe('Telefon')` bilan bering.
 */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (r.success) return r.data;
  const i = r.error.issues[0];
  const field = i.path.join('.') || "Ma'lumot";
  fail(400, `${field}: ${i.code === 'invalid_type' && i.input === undefined ? 'kiritilmagan' : "noto'g'ri"}`);
  throw new Error('unreachable');
}
export { z };
