/**
 * ECIES to the enclave, mirroring `enclave/core/src/seal.rs`:
 *   shared   = X25519(eph_sk, enclave_pk)
 *   key      = HKDF-SHA256(salt = eph_pk, ikm = shared, info = "blindstop:v1:seal")
 *   envelope = eph_pk ‖ nonce(12) ‖ ChaCha20-Poly1305(key, nonce, pad256(order), aad)
 *   aad      = contract_id ‖ 0x00 ‖ owner ‖ 0x00 ‖ commitment
 */
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { randomBytes } from "@noble/hashes/utils";
import { concatBytes, utf8 } from "./bytes.ts";
import { commitmentOf, encodeOrder, pad, PADDED_LEN, type SealedOrder } from "./order.ts";

export const SEAL_INFO = utf8("blindstop:v1:seal");
export const ENVELOPE_LEN = 32 + 12 + PADDED_LEN + 16;

export function aad(contractId: string, owner: string, commitment: Uint8Array): Uint8Array {
  return concatBytes(utf8(contractId), Uint8Array.of(0), utf8(owner), Uint8Array.of(0), commitment);
}

function isAllZero(b: Uint8Array): boolean {
  return b.every((x) => x === 0);
}

export function sealPadded(
  enclavePub: Uint8Array,
  padded: Uint8Array,
  aadBytes: Uint8Array,
  ephSecret: Uint8Array = randomBytes(32),
  nonce: Uint8Array = randomBytes(12),
): Uint8Array {
  if (enclavePub.length !== 32) throw new Error("enclave key must be 32 bytes");
  if (padded.length !== PADDED_LEN) throw new Error("plaintext must be padded to 256 bytes");
  const ephPub = x25519.getPublicKey(ephSecret);
  const shared = x25519.getSharedSecret(ephSecret, enclavePub);
  if (isAllZero(shared)) throw new Error("low-order enclave key");
  const key = hkdf(sha256, shared, ephPub, SEAL_INFO, 32);
  const ct = chacha20poly1305(key, nonce, aadBytes).encrypt(padded);
  const out = concatBytes(ephPub, nonce, ct);
  if (out.length !== ENVELOPE_LEN) throw new Error("envelope length");
  return out;
}

export function openEnvelope(enclaveSecret: Uint8Array, envelope: Uint8Array, aadBytes: Uint8Array): Uint8Array {
  if (envelope.length !== ENVELOPE_LEN) throw new Error("envelope has the wrong length");
  const ephPub = envelope.subarray(0, 32);
  const nonce = envelope.subarray(32, 44);
  const shared = x25519.getSharedSecret(enclaveSecret, ephPub);
  if (isAllZero(shared)) throw new Error("low-order ephemeral key");
  const key = hkdf(sha256, shared, ephPub, SEAL_INFO, 32);
  return chacha20poly1305(key, nonce, aadBytes).decrypt(envelope.subarray(44));
}

export interface SealedResult {
  /** borsh plaintext, kept locally for a later reveal */
  plaintext: Uint8Array;
  commitment: Uint8Array;
  envelope: Uint8Array;
}

/** Everything the browser does before `place_order`. */
export function sealOrder(order: SealedOrder, enclavePub: Uint8Array, contractId: string, owner: string): SealedResult {
  const plaintext = encodeOrder(order);
  const commitment = commitmentOf(plaintext);
  const envelope = sealPadded(enclavePub, pad(plaintext), aad(contractId, owner, commitment));
  return { plaintext, commitment, envelope };
}
