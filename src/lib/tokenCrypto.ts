import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";

function keyFromEnv(): Buffer | null {
  const raw = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length !== 32) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function encryptToken(plainText: string | null | undefined): string | null {
  if (!plainText) return null;
  const key = keyFromEnv();
  if (!key) return plainText;

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, encrypted]).toString("base64");
  return `${PREFIX}${payload}`;
}

export function decryptToken(cipherText: string | null | undefined): string | null {
  if (!cipherText) return null;
  if (!cipherText.startsWith(PREFIX)) return cipherText;
  const key = keyFromEnv();
  if (!key) return null;

  try {
    const payload = Buffer.from(cipherText.slice(PREFIX.length), "base64");
    const iv = payload.subarray(0, 12);
    const authTag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}
