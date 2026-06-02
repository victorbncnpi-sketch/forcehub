// api/_redis.js — Cliente Upstash Redis compartilhado.
// Arquivos com prefixo "_" não viram rotas na Vercel (apenas utilitário).
import { Redis } from "@upstash/redis";

let client = null;

export function getRedis() {
  if (client) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  client = new Redis({ url, token });
  return client;
}
