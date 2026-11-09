#!/usr/bin/env python3
"""Golden Hyperliquid signing vectors from the OFFICIAL Python SDK.

    python3 -m venv .venv && .venv/bin/pip install hyperliquid-python-sdk==0.24.0
    .venv/bin/python scripts/hl_vectors.py > enclave/core/tests/hl_vectors.json

The Rust enclave (enclave/core/tests/hl_vectors.rs) and the TypeScript client
(packages/shared/test/hl.test.ts) must reproduce every field byte for byte.
"""
import json
from importlib.metadata import version

import msgpack
from eth_account import Account
from eth_account.messages import encode_defunct
from hyperliquid.utils.signing import (
    action_hash,
    sign_withdraw_from_bridge_action,
    order_request_to_order_wire,
    order_wires_to_order_action,
    sign_agent,
    sign_l1_action,
)
from hyperliquid.utils.types import Cloid

# Fixed, worthless keys. Never fund these.
AGENT_KEY = "0x" + "11" * 32
USER_KEY = "0x" + "22" * 32

CASES = [
    # name, asset, is_buy, sz, px, cloid, nonce, mainnet
    ("close_long_btc_testnet", 3, False, 0.001, 74439.0, "0x" + "ab" * 16, 1762700000000, False),
    ("close_short_eth_mainnet", 1, True, 0.0123, 1891.4, "0x" + "01" * 16, 1762700000001, True),
    ("close_long_sol_testnet", 0, False, 12.5, 86.615, "0x00112233445566778899aabbccddeeff", 1762700000123, False),
    ("small_price_mainnet", 150, True, 1234.0, 0.001234, "0x" + "ff" * 16, 1762800000000, True),
    ("large_asset_index", 200, False, 3.0, 1.2345, "0x" + "7f" * 16, 18446744073709, False),
]


def l1_case(name, asset, is_buy, sz, px, cloid, nonce, mainnet):
    wallet = Account.from_key(AGENT_KEY)
    order = {
        "coin": "X",
        "is_buy": is_buy,
        "sz": sz,
        "limit_px": px,
        "order_type": {"limit": {"tif": "Ioc"}},
        "reduce_only": True,
        "cloid": Cloid.from_str(cloid),
    }
    action = order_wires_to_order_action([order_request_to_order_wire(order, asset)], None, "na")
    sig = sign_l1_action(wallet, action, None, nonce, None, mainnet)
    return {
        "name": name,
        "is_mainnet": mainnet,
        "nonce": nonce,
        "asset": asset,
        "is_buy": is_buy,
        "px": action["orders"][0]["p"],
        "sz": action["orders"][0]["s"],
        "cloid": cloid,
        "action_json": json.dumps(action, separators=(",", ":")),
        "msgpack_hex": msgpack.packb(action).hex(),
        "connection_id": "0x" + action_hash(action, None, nonce, None).hex(),
        "signature": {"r": "0x" + int(sig["r"], 16).to_bytes(32, "big").hex(), "s": "0x" + int(sig["s"], 16).to_bytes(32, "big").hex(), "v": sig["v"]},
    }


def approve_agent_case(mainnet):
    user = Account.from_key(USER_KEY)
    agent = Account.from_key(AGENT_KEY)
    action = {"type": "approveAgent", "agentAddress": agent.address, "agentName": "blindstop", "nonce": 1762700000000}
    sig = sign_agent(user, dict(action), mainnet)
    return {
        "is_mainnet": mainnet,
        "user": user.address,
        "agent_address": agent.address,
        "agent_name": "blindstop",
        "nonce": action["nonce"],
        "signature": {"r": "0x" + int(sig["r"], 16).to_bytes(32, "big").hex(), "s": "0x" + int(sig["s"], 16).to_bytes(32, "big").hex(), "v": sig["v"]},
    }


def withdraw_case(mainnet):
    user = Account.from_key(USER_KEY)
    action = {"type": "withdraw3", "destination": user.address, "amount": "12.5", "time": 1762700000000}
    signed_action = dict(action)
    sig = sign_withdraw_from_bridge_action(user, signed_action, mainnet)
    return {
        "is_mainnet": mainnet,
        "destination": user.address,
        "amount": "12.5",
        "time": 1762700000000,
        "signature": {"r": "0x" + int(sig["r"], 16).to_bytes(32, "big").hex(), "s": "0x" + int(sig["s"], 16).to_bytes(32, "big").hex(), "v": sig["v"]},
    }


def backstop_case():
    """The public backstop the user may place with their own key: reduce-only stop-market."""
    user = Account.from_key(USER_KEY)
    order = {
        "coin": "X",
        "is_buy": False,
        "sz": 0.01,
        "limit_px": 60000.0,
        "order_type": {"trigger": {"triggerPx": 66000.0, "isMarket": True, "tpsl": "sl"}},
        "reduce_only": True,
    }
    action = order_wires_to_order_action([order_request_to_order_wire(order, 3)], None, "na")
    nonce = 1762700000555
    sig = sign_l1_action(user, action, None, nonce, None, False)
    return {
        "action_json": json.dumps(action, separators=(",", ":")),
        "msgpack_hex": msgpack.packb(action).hex(),
        "nonce": nonce,
        "signature": {"r": "0x" + int(sig["r"], 16).to_bytes(32, "big").hex(), "s": "0x" + int(sig["s"], 16).to_bytes(32, "big").hex(), "v": sig["v"]},
    }


def personal_sign_case(message):
    user = Account.from_key(USER_KEY)
    signed = Account.sign_message(encode_defunct(text=message), USER_KEY)
    return {"message": message, "signer": user.address, "signature": "0x" + signed.signature.hex().removeprefix("0x")}


out = {
    "sdk": f"hyperliquid-python-sdk {version('hyperliquid-python-sdk')}",
    "agent_key": AGENT_KEY,
    "agent_address": Account.from_key(AGENT_KEY).address,
    "user_key": USER_KEY,
    "l1": [l1_case(*c) for c in CASES],
    "approve_agent": [approve_agent_case(False), approve_agent_case(True)],
    "withdraw": [withdraw_case(False), withdraw_case(True)],
    "backstop": backstop_case(),
    "personal_sign": [personal_sign_case("hello"), personal_sign_case("Blindstop: example binding\n\nline two")],
}
print(json.dumps(out, indent=2))
