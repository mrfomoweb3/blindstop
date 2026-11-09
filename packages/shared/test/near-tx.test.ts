import { describe, expect, it } from "vitest";
import { base58Decode, base58Encode, parseNearSecretKey, publicKeyString, serializeTransaction, u128le } from "../src/index.ts";

describe("NEAR transaction encoding", () => {
  it("base58 round trips, including leading zeros", () => {
    for (const hex of ["00", "0000ff", "deadbeef", "00010203"]) {
      const b = Uint8Array.from(hex.match(/../g)!.map((x) => parseInt(x, 16)));
      expect(base58Decode(base58Encode(b))).toEqual(b);
    }
    expect(base58Encode(new Uint8Array(32))).toBe("11111111111111111111111111111111");
  });

  it("derives the public key from a near-cli secret", () => {
    // Fixed test seed 0x01…; its public key is derived, not stored.
    const seed = new Uint8Array(32).fill(1);
    const k1 = parseNearSecretKey("a.testnet", `ed25519:${base58Encode(seed)}`);
    const k2 = parseNearSecretKey("a.testnet", `ed25519:${base58Encode(new Uint8Array([...seed, ...k1.publicKey]))}`);
    expect(publicKeyString(k1)).toBe(publicKeyString(k2));
    expect(() => parseNearSecretKey("a", `ed25519:${base58Encode(new Uint8Array([...seed, ...new Uint8Array(32)]))}`)).toThrow();
  });

  it("lays out a FunctionCall transaction like nearcore", () => {
    const tx = serializeTransaction({
      signerId: "a",
      publicKey: new Uint8Array(32).fill(2),
      nonce: 5n,
      receiverId: "b",
      blockHash: new Uint8Array(32).fill(3),
      actions: [{ methodName: "m", args: Uint8Array.of(9), gas: 7n, depositYocto: 1n }],
    });
    const expected = [
      1, 0, 0, 0, 97, // signer "a"
      0, ...new Array(32).fill(2), // ed25519 key
      5, 0, 0, 0, 0, 0, 0, 0, // nonce
      1, 0, 0, 0, 98, // receiver "b"
      ...new Array(32).fill(3), // block hash
      1, 0, 0, 0, // one action
      2, 1, 0, 0, 0, 109, 1, 0, 0, 0, 9, 7, 0, 0, 0, 0, 0, 0, 0, ...u128le(1n),
    ];
    expect([...tx]).toEqual(expected);
  });
});
