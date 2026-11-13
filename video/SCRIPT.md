# Blindstop demo film: narration (storyline A, "The note on the door")

Target 3:00. About 440 words at ~150 wpm. Voice: HeyGen "Craig - Warm & Approachable" (eae6fca42aae4b78b992533e96ab43c9). Regenerate with film/gen_vo.py.
Each block is one scene; the time is where it starts.

## 1 · The note (0:00)
Imagine taping a note to your front door that says: "If the price drops to sixty-six thousand, I'll sell everything."

## 2 · The crowd (0:08)
That's what a stop-loss looks like on Hyperliquid. Every order is public, so anyone can read your note. Tracking tools add up thousands of these notes and show exactly where the stops are bunched together. And when big traders can see a pile of stops, they push the price into it, set them all off, and buy back cheaper. It's called stop hunting, and the people it hurts are ordinary traders.

## 3 · The envelope (0:34)
Blindstop folds that note into a sealed envelope. Your stop-loss and take-profit never touch the public order book. Nobody can read them, not other traders, not us.

## 4 · Sign in and set up (0:46)
Here's how it works for you. Sign in with a NEAR wallet. Blindstop creates a separate trading wallet in your browser, and you add funds to it.

## 5 · Open a trade (0:58)
Open a trade right in the app. Pick a coin, long or short, an amount, and your leverage. Leverage is isolated, so you can't lose more than you put in.

## 6 · Hide the stop (1:10)
Now the important part. Type your stop-loss and take-profit, and press "Hide my stop". Your browser locks them in an envelope before anything leaves your computer. Only the sealed computer can open it. NEAR stores the envelope, which looks the same size whatever is inside.

## 7 · Nothing to see (1:32)
Now look at Hyperliquid's public list of your orders. Empty. There is nothing for anyone to aim at.

## 8 · Watching (1:40)
So who watches the price? A sealed computer: a secure enclave running on NEAR's OutLayer. Every three seconds it reads your envelope straight from NEAR, from two independent sources that must agree, so nobody can slip it a fake. It checks the live price, and waits. Even the people running it can't see inside.

## 9 · It fires (1:56)
When the price crosses your level, the enclave closes your position on Hyperliquid and signs a receipt. NEAR checks that signature before it records anything. Here is a real order, sealed in a browser, that the enclave opened and settled on NEAR testnet. And here is the full fire, run in simulation against the real enclave program.

## 10 · Safety net (2:20)
And if Blindstop is ever offline, you can add a safety net: a backup stop near your liquidation price, far away from your real one. You're never left unprotected.

## 11 · Proof (2:28)
After it closes, you can reveal what you sealed, and anyone can check it matches what NEAR stored from the start. Genuine.

## 12 · It holds up (2:38)
We attacked it ourselves: forged receipts, replayed orders, tampered envelopes, someone else's wallet. Every attack was refused. And the enclave can only close positions. It has no way to withdraw or move anyone's money.

## 13 · Claim (2:50)
Blindstop. Your stops, hidden until the moment they fire.

## 14 · End card (2:55)
Built on NEAR. Open source. Try it on testnet.
