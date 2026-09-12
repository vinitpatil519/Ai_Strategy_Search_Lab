# AI Strategy Search Lab

A quantitative research console that discovers trading strategies by algorithmic search, validates them out of sample, and explains where their returns came from. Everything runs locally in the browser — no API keys, no backend, no language model in the loop.

The "AI" here is search, not inference: a genetic algorithm over a rule grammar, a Gaussian hidden Markov model for regime detection, k-means and t-SNE for structure discovery.

<img width="1915" height="972" alt="image" src="https://github.com/user-attachments/assets/ddba1577-b918-4079-81bb-4400f7f8261f" />
<img width="1911" height="971" alt="image" src="https://github.com/user-attachments/assets/6e22e181-fdfe-4e47-88e5-035d8ce1274a" />
<img width="1917" height="970" alt="image" src="https://github.com/user-attachments/assets/ce05ebc5-5264-4034-b3e9-386c8bb86c79" />
<img width="1917" height="973" alt="image" src="https://github.com/user-attachments/assets/d82c16db-7888-473c-9730-6527fd4cf4f0" />



## What it does

1. **Generates** thousands of rule-based strategies across five families (trend, breakout, mean reversion, carry, volatility), each with its own parameter schema and risk genes.
2. **Backtests** every candidate with a single-pass, path-dependent engine: one-bar execution lag, ATR stops and targets filled intrabar, vol-target position sizing, and costs charged on every change in exposure.
3. **Evolves** the population with tournament selection, blended crossover, gaussian parameter mutation and fresh random immigrants each generation. Fitness is measured on the in-sample window only.
4. **Validates** survivors on a held-out window plus expanding walk-forward folds, so the leaderboard separates in-sample fit from out-of-sample behaviour.
5. **Detects regimes** by fitting a diagonal-covariance Gaussian HMM (Baum-Welch with scaled forward-backward, Viterbi decoding) to benchmark descriptors, then scores each strategy inside each state.
6. **Clusters** the survivors: risk/return metrics plus a coarse behavioural signature, standardized, embedded with exact t-SNE and partitioned by k-means with silhouette-based model selection.

## Stack

| Concern | Implementation |
| --- | --- |
| Framework | Next.js 15 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS |
| State | Zustand |
| Compute | Hand-written TypeScript engine in a Web Worker |
| Charts | Hand-built inline SVG (no charting dependency) |
| Hosting | Static export from `next build`, deploys to Vercel free tier |

The entire numerical stack — indicators, backtester, metrics, genetic search, HMM, k-means, t-SNE — is written from scratch in `src/lib/engine`. There are no Python services, no native dependencies and no runtime API calls, which is what makes the whole thing deployable as static output and runnable offline.

## Running locally

```bash
npm install
npm run dev          # http://localhost:3000
```

Other scripts:

```bash
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run smoke        # headless run of the whole pipeline, prints the numbers
```

`npm run smoke` is the fastest way to sanity-check the engine after changing anything numerical: it generates a universe, fits the regime model, runs a short search and prints the survivors, clusters and a single-strategy inspection.

## Deploying to Vercel

The app is a static Next.js build with no server dependencies:

```bash
git init && git add -A && git commit -m "feat: AI strategy search lab"
git remote add origin <your-repo>
git push -u origin main
```

Then import the repository on Vercel and accept the defaults (framework preset: Next.js, build command `next build`). No environment variables are needed. Because all compute happens in the visitor's browser, there are no serverless function limits to work around — a 2,000-backtest run takes a few seconds on the client and costs nothing to host.

## Project layout

```
src/
  app/                    Next.js entry, global styles
  components/
    charts/               SVG chart primitives (line, heatmap, scatter, minis)
    panels/               Screen-level panels, one per tab
    ui/                   Buttons, sliders, panels, stats
  lib/
    engine/               The whole numerical stack (no React imports)
      market.ts           Synthetic cross-asset universe generator
      csv.ts              CSV import, universe serialization
      indicators.ts       SMA/EMA/RSI/ATR/Donchian/z-score kernels
      context.ts          Indicator cache shared across a run
      families.ts         Parameter schemas per strategy family
      genome.ts           Random draw, mutation, crossover, repair, description
      signals.ts          The rule engine: genome to target exposure
      backtest.ts         Path-dependent execution, stops, costs, trades
      metrics.ts          Sharpe, Sortino, Calmar, ulcer, regime-masked stats
      features.ts         Feature extraction for clustering
      kmeans.ts           k-means++ with silhouette model selection
      tsne.ts             Exact t-SNE
      hmm.ts              Gaussian HMM: Baum-Welch, Viterbi, regime labelling
      search.ts           Orchestration: GA loop, walk-forward, clustering
    store.ts              Zustand store, worker orchestration
    palette.ts, format.ts Display layer
  worker/                 Worker entry and message protocol
scripts/engine-smoke.ts   Headless pipeline check
```

## The screens

- **Overview** — run summary, convergence trace, top survivor equity against the benchmark, family performance, regime timeline, cluster digest.
- **Leaderboard** — sortable survivor table with in-sample versus out-of-sample metrics, robustness, turnover and an inline equity sparkline. Filter by family or cluster.
- **Clusters** — the t-SNE map with cluster hulls, cluster cards with family mix, member list and an equity overlay.
- **Regimes** — benchmark with regime shading, per-state statistics, and the regime atlas heatmap (strategies or families against regimes).
- **Strategy** — one strategy in full: compiled rules in plain English, full-history equity against benchmark and buy-and-hold, drawdown, walk-forward folds, Sharpe by regime, monthly return calendar, trade blotter, and an in-sample/out-of-sample metric table.
- **Editor** — hand-edit any genome (family, instrument, side, rule parameters, risk genes) and re-score it against the same split the search used.
- **Data** — the universe being traded, its fitted regimes, per-instrument statistics, and CSV import for real history.

Keyboard: `1`–`7` switch tabs, `R` starts a run, `B` toggles the configuration rail.

## Methodology notes

**No look-ahead.** Signals are evaluated at a bar's close and the resulting exposure is held over the *next* bar. Donchian channels are compared against levels from the prior bar. The first 260 bars of every series are reserved for indicator warm-up and are never scored.

**Honest out-of-sample numbers.** Fitness during the search only ever sees the in-sample window. The held-out window is scored once, after the search finishes. The leaderboard shows both, plus the decay between them, because the gap is the most informative number on the screen.

**Costs are charged on turnover.** Every change in exposure pays `costBps + slippageBps` on the traded amount, including the exposure changes caused by vol-target re-sizing. Position re-sizing is deliberately throttled (20% tolerance band) so sizing does not manufacture a trade on every bar.

**Regimes are sticky by construction.** An unconstrained HMM fit on daily data flips states every couple of weeks, which makes a regime atlas meaningless. A Dirichlet pseudo-count on the transition diagonal pushes the fit toward month-scale states, matching how regimes are actually discussed.

**Clustering is behavioural, not just statistical.** The feature matrix combines out-of-sample metrics with the strategy's compounded return in each of twelve equal sub-periods, so two strategies land together when they make money at the same times — which is what you need if you are selecting for diversification rather than for ranking.

**What this is not.** The default universe is simulated, not real. The generator is built to contain trends, crashes, chop and volatility clustering so the families have something genuine to find, but a strategy that works here has not been validated on real markets. Import a CSV for that. Nothing in this repository is investment advice.
#   A i _ S t r a t e g y _ S e a r c h _ L a b 
 
 
