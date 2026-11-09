/**
 * The browser vault: the trading wallet's key and the plaintext of your sealed orders, kept
 * in IndexedDB and encrypted at rest with AES-GCM under a key derived from your passphrase
 * (PBKDF2-SHA256, 600k iterations). Nothing here is ever sent anywhere.
 */
import { base64ToBytes, bytesToBase64, bytesToHex, hexToBytes } from "@blindstop/shared";

const DB = "blindstop";
const STORE = "kv";
const ITERATIONS = 600_000;

export interface Sealed {
  v: 1;
  iv: string;
  ct: string;
}

export interface WalletRecord {
  v: 1;
  address: `0x${string}`;
  salt: string;
  iterations: number;
  key: Sealed;
  createdAt: number;
}

export interface LocalOrder {
  contract: string;
  owner: string;
  commitment: string;
  /** base64 borsh plaintext — needed to reveal */
  plaintext: string;
  orderId: string | null;
  network: "mainnet" | "testnet";
  coin: string;
  side: "long" | "short";
  kind: "stop_loss" | "take_profit";
  triggerPx: string;
  size: string;
  slippageBps: number;
  createdAt: number;
  keyEpoch: number;
  placeTx: string | null;
}

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = f(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const get = <T>(k: string) => tx<T | undefined>("readonly", (s) => s.get(k) as IDBRequest<T | undefined>);
const put = (k: string, v: unknown) => tx("readwrite", (s) => s.put(v, k));
const del = (k: IDBValidKey) => tx("readwrite", (s) => s.delete(k));
const keys = () => tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys());

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function seal(key: CryptoKey, data: Uint8Array, aad: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) }, key, data as BufferSource),
  );
  return { v: 1, iv: bytesToBase64(iv), ct: bytesToBase64(ct) };
}

async function open(key: CryptoKey, s: Sealed, aad: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(s.iv) as BufferSource, additionalData: new TextEncoder().encode(aad) },
      key,
      base64ToBytes(s.ct) as BufferSource,
    ),
  );
}

export async function loadWalletRecord(): Promise<WalletRecord | undefined> {
  return get<WalletRecord>("wallet");
}

export async function createWallet(privateKey: `0x${string}`, address: `0x${string}`, passphrase: string): Promise<CryptoKey> {
  if (passphrase.length < 10) throw new Error("use a passphrase of at least 10 characters");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const rec: WalletRecord = {
    v: 1,
    address,
    salt: bytesToBase64(salt),
    iterations: ITERATIONS,
    key: await seal(key, hexToBytes(privateKey), `wallet:${address.toLowerCase()}`),
    createdAt: Date.now(),
  };
  await put("wallet", rec);
  return key;
}

export async function unlockWallet(passphrase: string): Promise<{ key: CryptoKey; privateKey: `0x${string}`; address: `0x${string}` }> {
  const rec = await loadWalletRecord();
  if (!rec) throw new Error("no trading wallet in this browser");
  const key = await deriveKey(passphrase, base64ToBytes(rec.salt), rec.iterations);
  try {
    const pk = await open(key, rec.key, `wallet:${rec.address.toLowerCase()}`);
    return { key, privateKey: `0x${bytesToHex(pk)}`, address: rec.address };
  } catch {
    throw new Error("wrong passphrase");
  }
}

const orderKey = (contract: string, commitment: string) => `order:${contract}:${commitment}`;

export async function saveOrder(key: CryptoKey, o: LocalOrder): Promise<void> {
  const k = orderKey(o.contract, o.commitment);
  await put(k, await seal(key, new TextEncoder().encode(JSON.stringify(o)), k));
}

export async function listOrders(key: CryptoKey, contract: string): Promise<LocalOrder[]> {
  const out: LocalOrder[] = [];
  for (const k of await keys()) {
    if (typeof k !== "string" || !k.startsWith(`order:${contract}:`)) continue;
    const s = await get<Sealed>(k);
    if (!s) continue;
    try {
      out.push(JSON.parse(new TextDecoder().decode(await open(key, s, k))) as LocalOrder);
    } catch {
      /* written under another passphrase: skip */
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getPref<T>(name: string): Promise<T | undefined> {
  return get<T>(`pref:${name}`);
}

export async function setPref(name: string, value: unknown): Promise<void> {
  await put(`pref:${name}`, value);
}

/** Everything needed to restore this browser: the encrypted wallet and every encrypted order. */
export async function exportBackup(): Promise<Blob> {
  const entries: Record<string, unknown> = {};
  for (const k of await keys()) {
    if (typeof k === "string" && (k === "wallet" || k.startsWith("order:"))) entries[k] = await get(k);
  }
  const doc = { app: "blindstop", v: 1, exportedAt: new Date().toISOString(), note: "Encrypted with your passphrase. Without it this file is useless.", entries };
  return new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
}

export async function importBackup(file: File): Promise<number> {
  const doc = JSON.parse(await file.text()) as { app?: string; v?: number; entries?: Record<string, unknown> };
  if (doc.app !== "blindstop" || doc.v !== 1 || !doc.entries) throw new Error("not a Blindstop backup");
  let n = 0;
  for (const [k, v] of Object.entries(doc.entries)) {
    if (k === "wallet" || k.startsWith("order:")) {
      await put(k, v);
      n++;
    }
  }
  return n;
}

export async function forgetEverything(): Promise<void> {
  for (const k of await keys()) await del(k);
}
