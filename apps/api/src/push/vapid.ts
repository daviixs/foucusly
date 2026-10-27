import webpush from "web-push";
import { getConfigValue, putConfigValue, type AppDatabase } from "../db.js";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

const CONFIG_KEY = "web_push_vapid";

function parseKeys(raw: string | undefined): VapidKeys | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<VapidKeys>;
    if (typeof parsed.publicKey === "string" && typeof parsed.privateKey === "string") {
      return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
    }
  } catch { /* fall through to regeneration */ }
  return undefined;
}

export function getVapidKeys(db: AppDatabase): VapidKeys {
  const envPublic = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim();
  if (envPublic && envPrivate) return { publicKey: envPublic, privateKey: envPrivate };
  const stored = parseKeys(getConfigValue(db, CONFIG_KEY));
  if (stored) return stored;
  const generated = webpush.generateVAPIDKeys();
  const keys = { publicKey: generated.publicKey, privateKey: generated.privateKey };
  putConfigValue(db, CONFIG_KEY, JSON.stringify(keys));
  return keys;
}
