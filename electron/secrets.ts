/**
 * BYOK Anthropic API key storage, encrypted at rest via Electron safeStorage
 * (Keychain-backed on macOS, DPAPI on Windows, libsecret on Linux). The key
 * is never written to disk in plaintext; if OS-level encryption is
 * unavailable we refuse to store rather than degrade silently.
 */
import { safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

interface SecretsFile {
  anthropicApiKey?: string; // base64 of safeStorage ciphertext
}

function secretsPath(dataDir: string): string {
  return path.join(dataDir, "secrets.json");
}

function readSecrets(dataDir: string): SecretsFile {
  const p = secretsPath(dataDir);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as SecretsFile;
  } catch {
    return {}; // corrupt file: treat as no key rather than crashing boot
  }
}

export function loadApiKey(dataDir: string): string | null {
  const stored = readSecrets(dataDir).anthropicApiKey;
  if (!stored || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(stored, "base64"));
  } catch {
    return null; // e.g. Keychain entry lost; user re-enters the key
  }
}

export function saveApiKey(dataDir: string, key: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "OS-level encryption is unavailable; refusing to store the API key in plaintext."
    );
  }
  mkdirSync(dataDir, { recursive: true });
  const secrets = readSecrets(dataDir);
  secrets.anthropicApiKey = safeStorage.encryptString(key).toString("base64");
  writeFileSync(secretsPath(dataDir), JSON.stringify(secrets), { mode: 0o600 });
}

export function hasApiKey(dataDir: string): boolean {
  return loadApiKey(dataDir) !== null;
}
