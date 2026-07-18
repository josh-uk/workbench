import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
} from "node:crypto";
import { promisify } from "node:util";

import { z } from "zod";

import { ExportDomainError } from "@/features/exports/domain";

const deriveKey = promisify(scrypt);

const encryptedPayloadSchema = z
  .object({
    algorithm: z.literal("aes-256-gcm"),
    kdf: z.literal("scrypt"),
    salt: z.base64(),
    iv: z.base64(),
    authTag: z.base64(),
    ciphertext: z.base64(),
  })
  .strict();

export async function encryptExportPayload(
  plaintext: Uint8Array,
  password: string,
) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = (await deriveKey(password, salt, 32)) as Buffer;
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.from(
    JSON.stringify({
      algorithm: "aes-256-gcm",
      kdf: "scrypt",
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    }),
  );
}

export async function decryptExportPayload(
  payload: Uint8Array,
  password: string,
) {
  try {
    const envelope = encryptedPayloadSchema.parse(
      JSON.parse(Buffer.from(payload).toString("utf8")),
    );
    const salt = Buffer.from(envelope.salt, "base64");
    const iv = Buffer.from(envelope.iv, "base64");
    const key = (await deriveKey(password, salt, 32)) as Buffer;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
  } catch {
    throw new ExportDomainError(
      "The archive password is incorrect or the encrypted payload is damaged.",
      "EXPORT_DECRYPT_FAILED",
    );
  }
}
