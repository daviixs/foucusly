import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;
export const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

/** Hash format: scrypt$N$r$p$saltB64$hashB64 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let devSecret: string | undefined;
export function resolveAuthSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.AUTH_SECRET?.trim();
  if (secret) {
    if (env.NODE_ENV === "production" && secret.length < 32)
      throw new Error("AUTH_SECRET must be at least 32 characters in production");
    return secret;
  }
  if (env.NODE_ENV === "production") throw new Error("AUTH_SECRET is required in production");
  devSecret ??= randomBytes(32).toString("hex");
  return devSecret;
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");
const sign = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest("base64url");
const HEADER = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));

export function signToken(profileId: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const payload = b64url(JSON.stringify({ sub: profileId, iat: nowSeconds, exp: nowSeconds + TOKEN_TTL_SECONDS }));
  return `${HEADER}.${payload}.${sign(`${HEADER}.${payload}`, secret)}`;
}

export function verifyToken(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== HEADER) return null;
  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`, secret));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { sub?: unknown; exp?: unknown };
    if (typeof payload.sub !== "string" || !payload.sub || typeof payload.exp !== "number" || payload.exp <= nowSeconds)
      return null;
    return payload.sub;
  } catch {
    return null;
  }
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}
