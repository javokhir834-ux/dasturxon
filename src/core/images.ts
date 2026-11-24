// Mahsulot rasmi bazada data URL bo'lib saqlanadi, tashqariga /img/p/:id orqali (kesh bilan) beriladi.
import crypto from 'node:crypto';
import { db } from './db.ts';

const imgVer = (data: string) => crypto.createHash('md5').update(data).digest('hex').slice(0, 10);
export function imgRef(r: Record<string, any>) {
  const { image, ...rest } = r;
  return { ...rest, image: image ? `/img/p/${r.id}?v=${imgVer(image)}` : '' };
}
export function productImage(id: number): { type: string; data: Buffer } | null {
  const r = db.prepare('SELECT image FROM products WHERE id=?').get(id);
  const m = r?.image && /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(r.image);
  return m ? { type: m[1], data: Buffer.from(m[2], 'base64') } : null;
}
