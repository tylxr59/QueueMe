import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export class SecretBox {
  private constructor(private readonly key: Buffer) {}

  static open(dataDir: string): SecretBox {
    const keyPath = path.join(dataDir, "master.key");
    let key: Buffer;
    if (fs.existsSync(keyPath)) {
      key = fs.readFileSync(keyPath);
    } else {
      key = randomBytes(32);
      fs.writeFileSync(keyPath, key, { mode: 0o600, flag: "wx" });
    }
    if (key.length !== 32) throw new Error("Invalid QueueMe master key");
    return new SecretBox(key);
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
  }

  decrypt(value: string): string {
    const [ivText, tagText, bodyText] = value.split(".");
    if (!ivText || !tagText || !bodyText) throw new Error("Invalid encrypted value");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(bodyText, "base64url")), decipher.final()]).toString("utf8");
  }
}

export async function hashPin(pin: string, salt = randomBytes(16).toString("base64url")) {
  const derived = (await scrypt(pin, salt, 64)) as Buffer;
  return { salt, hash: derived.toString("base64url") };
}

export async function verifyPin(pin: string, salt: string, expected: string) {
  const derived = (await scrypt(pin, salt, 64)) as Buffer;
  const expectedBuffer = Buffer.from(expected, "base64url");
  return derived.length === expectedBuffer.length && timingSafeEqual(derived, expectedBuffer);
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("base64url");
export const opaqueToken = () => randomBytes(32).toString("base64url");

