import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import hl from "../../../enclave/core/tests/hl_vectors.json";
import { actionHash, backstopAction, marketOrderAction, updateLeverageAction, bytesToHex, formatDec, msgpack, parseDec, roundPerpPx, signApproveAgent, signL1Action, signWithdraw } from "../src/index.ts";

describe("Hyperliquid signing vs hyperliquid-python-sdk 0.24.0", () => {
  const agent = privateKeyToAccount(hl.agent_key as `0x${string}`);
  for (const c of hl.l1) {
    it(c.name, async () => {
      const action = JSON.parse(c.action_json);
      expect(bytesToHex(Uint8Array.from(msgpack(action)))).toBe(c.msgpack_hex);
      expect(`0x${bytesToHex(actionHash(action, c.nonce))}`).toBe(c.connection_id);
      const sig = await signL1Action(agent, action, c.nonce, c.is_mainnet ? "mainnet" : "testnet");
      expect(sig).toEqual(c.signature);
    });
  }
  for (const c of hl.approve_agent) {
    it(`approveAgent ${c.is_mainnet ? "mainnet" : "testnet"}`, async () => {
      const user = privateKeyToAccount(hl.user_key as `0x${string}`);
      const { signature } = await signApproveAgent(user, c.agent_address as `0x${string}`, c.agent_name, c.nonce, c.is_mainnet ? "mainnet" : "testnet");
      expect(signature).toEqual(c.signature);
    });
  }
  for (const c of hl.withdraw) {
    it(`withdraw ${c.is_mainnet ? "mainnet" : "testnet"}`, async () => {
      const user = privateKeyToAccount(hl.user_key as `0x${string}`);
      const { signature } = await signWithdraw(user, c.destination as `0x${string}`, c.amount, c.time, c.is_mainnet ? "mainnet" : "testnet");
      expect(signature).toEqual(c.signature);
    });
  }
  it("public backstop stop-market (user's own key)", async () => {
    const user = privateKeyToAccount(hl.user_key as `0x${string}`);
    const action = backstopAction({ asset: 3, closeIsBuy: false, triggerPx: "66000", limitPx: "60000", size: "0.01" });
    expect(JSON.stringify(action)).toBe(hl.backstop.action_json);
    expect(bytesToHex(Uint8Array.from(msgpack(action)))).toBe(hl.backstop.msgpack_hex);
    expect(await signL1Action(user, action, hl.backstop.nonce, "testnet")).toEqual(hl.backstop.signature);
  });
  it("trade panel: set leverage and open a market order (user's own key)", async () => {
    const user = privateKeyToAccount(hl.user_key as `0x${string}`);
    const lev = updateLeverageAction(3, false, 3);
    expect(JSON.stringify(lev)).toBe(hl.trading.update_leverage.action_json);
    expect(bytesToHex(Uint8Array.from(msgpack(lev)))).toBe(hl.trading.update_leverage.msgpack_hex);
    expect(await signL1Action(user, lev, hl.trading.update_leverage.nonce, "testnet")).toEqual(hl.trading.update_leverage.signature);
    const open = marketOrderAction({ asset: 3, isBuy: true, limitPx: "76000", size: "0.0007", reduceOnly: false });
    expect(JSON.stringify(open)).toBe(hl.trading.market_open.action_json);
    expect(bytesToHex(Uint8Array.from(msgpack(open)))).toBe(hl.trading.market_open.msgpack_hex);
    expect(await signL1Action(user, open, hl.trading.market_open.nonce, "testnet")).toEqual(hl.trading.market_open.signature);
  });
});

describe("price rounding mirrors the enclave", () => {
  const r = (s: string, d: number, dir: "down" | "up") => formatDec(roundPerpPx(parseDec(s), d, dir));
  it("matches enclave/core decimal tests", () => {
    expect(r("74439.09", 5, "down")).toBe("74439");
    expect(r("74439.09", 5, "up")).toBe("74440");
    expect(r("123456.7", 5, "up")).toBe("123457");
    expect(r("1891.4567", 4, "down")).toBe("1891.4");
    expect(r("86.6159", 2, "down")).toBe("86.615");
    expect(r("0.0012345678", 0, "down")).toBe("0.001234");
    expect(r("0.585941", 1, "up")).toBe("0.58595");
    expect(r("99999.5", 5, "up")).toBe("100000");
  });
});
