/** Small byte helpers and a minimal Borsh writer/reader for the fixed Blindstop structs. */

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error("invalid hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

export function bytesToBase64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

export class BorshWriter {
  private chunks: Uint8Array[] = [];
  u8(v: number): this {
    if (!Number.isInteger(v) || v < 0 || v > 0xff) throw new Error(`u8 out of range: ${v}`);
    this.chunks.push(Uint8Array.of(v));
    return this;
  }
  u16(v: number): this {
    if (!Number.isInteger(v) || v < 0 || v > 0xffff) throw new Error(`u16 out of range: ${v}`);
    this.chunks.push(Uint8Array.of(v & 0xff, v >> 8));
    return this;
  }
  u32(v: number): this {
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new Error(`u32 out of range: ${v}`);
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    this.chunks.push(b);
    return this;
  }
  u64(v: bigint): this {
    if (v < 0n || v > 0xffffffffffffffffn) throw new Error(`u64 out of range: ${v}`);
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, v, true);
    this.chunks.push(b);
    return this;
  }
  fixed(b: Uint8Array, len: number): this {
    if (b.length !== len) throw new Error(`expected ${len} bytes, got ${b.length}`);
    this.chunks.push(b);
    return this;
  }
  string(s: string): this {
    const b = utf8(s);
    this.u32(b.length);
    this.chunks.push(b);
    return this;
  }
  bytes(): Uint8Array {
    return concatBytes(...this.chunks);
  }
}

export class BorshReader {
  private o = 0;
  constructor(private readonly b: Uint8Array) {}
  private take(n: number): Uint8Array {
    if (this.o + n > this.b.length) throw new Error("borsh: unexpected end of input");
    const out = this.b.subarray(this.o, this.o + n);
    this.o += n;
    return out;
  }
  u8(): number {
    return this.take(1)[0]!;
  }
  u16(): number {
    const t = this.take(2);
    return t[0]! | (t[1]! << 8);
  }
  u32(): number {
    const t = this.take(4);
    return new DataView(t.buffer, t.byteOffset, 4).getUint32(0, true);
  }
  u64(): bigint {
    const t = this.take(8);
    return new DataView(t.buffer, t.byteOffset, 8).getBigUint64(0, true);
  }
  fixed(n: number): Uint8Array {
    return this.take(n).slice();
  }
  string(): string {
    const n = this.u32();
    return new TextDecoder("utf-8", { fatal: true }).decode(this.take(n));
  }
  end(): void {
    if (this.o !== this.b.length) throw new Error("borsh: trailing bytes");
  }
}
