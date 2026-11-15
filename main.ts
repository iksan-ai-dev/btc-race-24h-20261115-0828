// HourBreakout: a long-only 1-minute breakout bot for cbBTC/USDC.
//
// Idea: on 1-minute bars the pool's price is noisy (about 12 bps of 1-minute
// standard deviation on the dev window) and a full-size round trip costs
// roughly 40 bps once fees, slippage and price impact are counted, so the bot
// trades rarely, in a modest size, and only when the price proves a move:
//
//   - Entry: the close breaks above the highest close of the previous 60
//     minutes, and the 14-bar Wilder RSI is at most 70 (so it does not chase
//     a move that is already stretched). It buys 35% of its cash. A 35% stake
//     keeps the price impact of one leg near 5 bps instead of the ~15 bps a
//     full-size trade pays against this pool's depth, which is what makes
//     short breakout trades affordable at all.
//   - Exit, the whole position, whichever comes first:
//       * take profit: the position is worth 300 bps over its cost;
//       * overbought: the 14-bar RSI rises above 75 while holding, so the bot
//         banks the move instead of waiting for the trailing stop to fire
//         after the reversal;
//       * trailing stop: the close falls 50 bps below the highest close seen
//         since the entry;
//       * stale: the position has been held 120 bars without either of the
//         above firing.
//   - Every order caps its slippage at 100 bps past the close it was decided
//     on, so a fill into a sudden gap is refused and retried rather than
//     taken at any price.
//
// Everything is deterministic: float64 arithmetic on the closes, bigint
// arithmetic on money, no clock, no environment, no network, no randomness.
// The bot reads only the bars the harness sends it, one batch at a time, and
// answers every batch with exactly one reply through the vendor shim.

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Lookback for the breakout: the highest close of the previous N minutes. */
const BREAKOUT_BARS = 60;
/** Wilder RSI span, and the ceiling above which a breakout is not chased. */
const RSI_BARS = 14;
const RSI_MAX = 70;
/** Fraction of cash staked per entry, in percent. */
const STAKE_PCT = 35n;
/** Take profit, in bps over the position's cost (fees included). */
const TAKE_PROFIT_BPS = 300;
/** Trailing stop, in bps below the highest close since the entry. */
const TRAIL_BPS = 50;
/** Overbought exit: sell while holding when the 14-bar RSI rises above this. */
const RSI_EXIT_ABOVE = 75;
/** Stale exit: sell after this many bars held with no other exit firing. */
const MAX_HOLD_BARS = 120;
/** Slippage cap on every order, in bps past the deciding close. */
const MAX_SLIPPAGE_BPS = 100;

/** The closes seen so far, oldest first, in raw price units. */
const closes: number[] = [];
/** Wilder RSI state over the closes. */
let rsiGain: number | null = null;
let rsiLoss: number | null = null;
const rsiFirst: number[] = [];
/** Highest close since the current entry, in raw price units (0 when flat). */
let peakClose = 0;
/** Batches the current position has been held (0 when flat). */
let holdBars = 0;

function pushClose(close: number): void {
  const prev = closes.length > 0 ? closes[closes.length - 1]! : null;
  closes.push(close);
  if (prev !== null) {
    const change = close - prev;
    const up = change > 0 ? change : 0;
    const down = change < 0 ? -change : 0;
    if (rsiGain === null || rsiLoss === null) {
      rsiFirst.push(change);
      if (rsiFirst.length === RSI_BARS) {
        rsiGain = rsiFirst.reduce((a, x) => a + (x > 0 ? x : 0), 0) / RSI_BARS;
        rsiLoss = rsiFirst.reduce((a, x) => a + (x < 0 ? -x : 0), 0) / RSI_BARS;
      }
    } else {
      rsiGain = (rsiGain * (RSI_BARS - 1) + up) / RSI_BARS;
      rsiLoss = (rsiLoss * (RSI_BARS - 1) + down) / RSI_BARS;
    }
  }
}

function rsi(): number | null {
  if (rsiGain === null || rsiLoss === null) return null;
  const moved = rsiGain + rsiLoss;
  return moved === 0 ? 50 : (100 * rsiGain) / moved;
}

/** The highest close of the previous BREAKOUT_BARS closes, excluding the latest. */
function breakoutHigh(): number | null {
  if (closes.length <= BREAKOUT_BARS) return null;
  let high = closes[closes.length - BREAKOUT_BARS - 1]!;
  for (let i = closes.length - BREAKOUT_BARS; i < closes.length - 1; i++) {
    if (closes[i]! > high) high = closes[i]!;
  }
  return high;
}

await runBars({
  onBatch(state: BarsState, batch) {
    for (const bar of batch.bars) {
      if (bar.symbol === SYMBOL) pushClose(Number(bar.c));
    }
    if (state.warmingUp) return [];
    const held = state.positions.get(SYMBOL);
    const close = state.close(SYMBOL);
    if (close === null) return [];
    const closeNum = Number(close);

    if (held !== undefined) {
      if (closeNum > peakClose) peakClose = closeNum;
      holdBars += 1;
      const value = state.value(SYMBOL, held.qty);
      const takeProfit = value * 10000n >= held.cost * BigInt(10000 + TAKE_PROFIT_BPS);
      const trailed = BigInt(Math.trunc(closeNum)) * 10000n <= BigInt(Math.trunc(peakClose)) * BigInt(10000 - TRAIL_BPS);
      const overbought = rsi() !== null && rsi()! > RSI_EXIT_ABOVE;
      if (takeProfit || trailed || overbought || holdBars >= MAX_HOLD_BARS) {
        peakClose = 0;
        holdBars = 0;
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }

    peakClose = 0;
    holdBars = 0;
    const high = breakoutHigh();
    const r = rsi();
    if (high === null || r === null) return [];
    if (r > RSI_MAX) return [];
    if (closeNum <= high) return [];
    const stake = (state.cash * STAKE_PCT) / 100n;
    if (stake < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    const buy: BuyInput = { side: 'buy', symbol: SYMBOL, notional_quote_units: stake, max_slippage_bps: MAX_SLIPPAGE_BPS };
    return [buy];
  },
});
