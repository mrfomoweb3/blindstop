/** Turn whatever a wallet, NEAR or Hyperliquid threw into a sentence a person can act on. */
const RULES: [RegExp, string][] = [
  [/user (rejected|cancel|closed)|rejected by user|denied/i, "You cancelled it in your wallet. Nothing was changed."],
  [/too many active orders/i, "You've reached the limit of hidden stops for one account. Cancel one in History first."],
  [/paused/i, "Blindstop isn't accepting new stops for a moment. Your existing stops are still protected."],
  [/attach at least|not enough balance|NotEnoughBalance|LackBalance/i, "Your NEAR wallet needs a little more NEAR to cover the small storage deposit (about 0.01 NEAR, refunded later)."],
  [/only the order'?s owner/i, "Only the account that set this stop can change it."],
  [/not active/i, "This stop has already finished, so it can't be changed."],
  [/preimage does not match/i, "That doesn't match what was recorded, so it can't be proven."],
  [/reveal an order after it closes/i, "You can publish proof after the stop has finished."],
  [/wallets are still loading/i, "Your wallet is still loading. Try again in a second."],
  [/does not exist|User or API Wallet/i, "Hyperliquid doesn't know this wallet yet. Add funds to it first."],
  [/insufficient|not enough margin/i, "There isn't enough money in your trading wallet for that."],
  [/fetch|network|Failed to fetch|timeout/i, "We couldn't reach the network. Check your connection and try again."],
];

export function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  for (const [re, text] of RULES) if (re.test(msg)) return text;
  // Our own validation messages are already written for people.
  if (msg && msg.length < 140 && !/[{}[\]]|0x[0-9a-f]{8}|panicked|Error:/i.test(msg)) return msg;
  return "Something went wrong. Nothing was changed. Please try again.";
}
