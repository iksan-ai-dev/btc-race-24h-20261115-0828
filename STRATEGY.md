# HourBreakout — btc-race-24h-20261115-0828

## Strategi

Bot long-only untuk cbBTC/USDC pada bar 1 menit. Idenya: harga 1-menit sangat
berisik (simpangan baku ~12 bps per menit di dev window) dan satu round trip
ukuran penuh menelan ~40 bps setelah fee 4 bps + slippage 2 bps + price impact
(~15 bps per kaki pada kedalaman pool ini), jadi bot hanya trading jarang,
dengan ukuran sedang, dan hanya saat harga membuktikan adanya pergerakan.

### Entry

- Close menembus di atas close tertinggi 60 menit sebelumnya (Donchian
  breakout 60 bar).
- RSI Wilder 14 harus ≤ 70 — jangan mengejar pergerakan yang sudah terlalu
  panas.
- Beli 35% dari cash. Ukuran 35% menekan price impact satu kaki ke ~5 bps
  (bukan ~15 bps pada ukuran penuh), dan inilah yang membuat trade breakout
  pendek jadi terjangkau.

### Exit (jual seluruh posisi, mana yang terjadi dulu)

- **Take profit:** posisi bernilai +300 bps di atas cost (termasuk fee).
- **Trailing stop:** close turun 50 bps di bawah close tertinggi sejak entry.
- **Stale:** posisi dipegang 120 bar tanpa exit lain yang terpicu.

### Pengaman

- Setiap order memakai `max_slippage_bps: 100` — fill ke dalam gap mendadak
  ditolak dan dicoba lagi, bukan diambil pada harga berapa pun.
- Maksimal 1 posisi terbuka (satu-satunya aset di universe), maksimal 1 order
  per reply.
- Deterministik: aritmetika float64 atas closes, bigint atas uang, tanpa jam,
  tanpa environment, tanpa network, tanpa randomness. Seed tidak dipakai karena
  tidak ada unsur acak.

## Parameter

| Parameter | Nilai | Alasan |
|---|---|---|
| Breakout lookback | 60 bar | Cukup panjang untuk menyaring noise 1-menit, cukup pendek untuk menangkap swing intraday |
| RSI span / cap | 14 / ≤ 70 | Filter anti-chase; cap 70 memblokir entry saat overbought |
| Ukuran stake | 35% cash | Impact ~5 bps/kaki; kompromi antara biaya dan ukuran PnL |
| Take profit | +300 bps | Lebih besar dari biaya round trip (~20 bps pada ukuran ini) dengan margin lebar |
| Trailing stop | 50 bps | Memberi ruang pada noise 1-menit (~12 bps σ) sambil memotong tren berbalik |
| Max hold | 120 bar | Mengeluarkan posisi basi sebelum reversal menggerus profit |

## Validasi lokal (dev window, grade-local)

Dipilih setelah menguji beberapa varian pada backtest offline dengan model fill
yang sama dengan harness (fill di open bar berikutnya, fee 4 bps, slippage
2 bps, impact constant-product terhadap open depth):

- EMA-cross 8/21: −$127 s.d. −$151 (terlalu banyak whipsaw pada noise 1-menit).
- Bollinger/RSI mean-reversion: −$62 s.d. −$97.
- Donchian 60 + trailing 50 + TP 300, ukuran 25–35%: +$3 s.d. +$7.
- Varian terpilih (n=60, trail 50, TP 300, 35%, RSI ≤ 70, max hold 120):
  sekitar **+$7,3** pada backtest offline, 10 trade, max drawdown ~0,5%.
  Sensitivitas: sebagian besar tetangga parameter tetap positif (n=45: +$1,0;
  n=90: +$1,4; trail 60: +$5,9; trail 80: +$4,8; TP 400: +$5,3; ukuran 20%:
  +$4,6; ukuran 40%: +$8,1). Dev window sendiri adalah hari turun (−400 bps
  dari open ke close), jadi strategi yang tetap untung di sana adalah yang
  menangkap pantulan intraday, bukan yang sekadar hold.

Hasil akhir grade-local tercantum di laporan build (lihat README / hasil
grade-local).
