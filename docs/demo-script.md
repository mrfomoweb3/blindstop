# Demo script (2:00)

Use a liquid coin (BTC or ETH), a realistic size, and a take-profit just above mark so the fire happens on camera.

| Time | Screen | Say |
|---|---|---|
| 0:00–0:20 | A Hyperliquid tracker's stop/liquidation cluster view; then `curl …/info frontendOpenOrders` for a wallet with a native stop, showing `triggerPx` | "Every stop on Hyperliquid is public. Trackers map where they cluster, and people hunt them." |
| 0:20–0:40 | `/app`: connect NEAR, create the trading wallet, download the backup; funding step; approve the watcher | "A fresh trading wallet, funded privately. The watcher is approved as an agent: it can trade, it cannot withdraw." |
| 0:40–1:05 | Seal a take-profit just above mark. Then the terminal: `frontendOpenOrders` → `[]`. Then NEAR explorer: `place_order` with 316 bytes of ciphertext and a commitment | "The level is sealed to an enclave. Hyperliquid's book has nothing. NEAR has only ciphertext." |
| 1:05–1:35 | Price crosses; position closes on Hyperliquid; `/app/orders` turns Fired with the fill price; the `record_fire` tx on NEAR; `/watcher` heartbeat | "The enclave saw the cross, closed reduce-only, and signed a report that NEAR verified." |
| 1:35–1:50 | `/app/orders` → Reveal → `/verify`: commitment matches; "fired N min after it was committed"; then "Tamper one byte": no match | "Anyone can check the level existed before the move." |
| 1:50–2:00 | Landing hero | "Gloam hides who you are. Blindstop hides where your stops are." |

Before recording: keeper running (`/watcher` green), trading wallet holding an open position, `frontendOpenOrders` empty (turn off the public backstop for the demo, or explain it).
