# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/wzqdurl/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/wzqdurl/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Entry for the [make.fun](https://make.fun/bounty/token-radar-01) competition
`token-radar-01`: a program that ranks the protocols in a sealed DefiLlama
snapshot by what their token launch would be worth, and a dashboard that
shows the board, the model behind it and a farm plan for every protocol.

## What it does

`main.ts` (Node 22, standard library only) reads the sealed snapshot from
`/input/snapshot.json`, scores every launch candidate, and writes:

- `/output/board.json` — 194 ranked rows
- `/output/data.js` — the same board for the dashboard
- `/output/dashboard/` — the static dashboard (index.html, app.css, app.js)
- `/output/screenshots/` — three screenshots of the dashboard
- `/output/dossier.json` — the summary the judge reads

## The model

Implied value is `TVL × category multiple × growth × maturity`.

The category multiple is the median market cap over TVL of the live
protocols in that category, winsorized to 0.01–5.0x, shrunk toward the
global median (0.19x) with 5 pseudo-observations, and clamped to 0.02–1.5x.
Growth is the seven-day change, clamped to −60%…+120% and weighted 0.5.
Maturity is 0.6–1.0 over three years since the protocol was first listed;
an unlisted age uses 365 days. No protocol name is special-cased: the same
function scores every row.

## The board

The watchlist is the floor: 40 protocols with at least $50M of TVL and no
token on record. The radar adds 17 launch candidates above that floor the
list left out (Sentora Curator at $2.76B of TVL and Polymarket International
are the largest) and 137 early ones below it, for 194 rows. Live protocols
— the ones that already trade — are set aside from the ranking, and their
market caps are what the comparables model learns from. Every row carries
an eight-step farm plan with a capital tier, a hold and a cost and time for
each step.

## Run it

```
node main.ts --input /path/to/snapshot.json
```

Or outside the grader, with the output in a local directory:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

The program runs twice with byte-identical output.

## License

MIT. See `LICENSE`.
