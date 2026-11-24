// Token Radar's model, radar-2: one sealed snapshot in, one ranked board out.
//
// The board covers the snapshot's whole watchlist, then adds the launch
// candidates the watchlist left out: pre-token protocols above the floor
// that pass the watchlist's own exclusion rule, and pre-token protocols
// below the floor. A protocol is a launch candidate when the snapshot
// records no token for it and it is not a wrapped, staked or bridged
// product of a token that already trades, not an exchange, and not a
// versioned pool of another protocol.
//
// Implied value is a comparable multiple, not a flat rate: every live
// protocol in the same category that already trades gives a market
// multiple (market cap over TVL); the category's multiple is the median
// of those, winsorized, shrunk toward the global median where the
// category has few comparables, and clamped. The value then follows the
// protocol's own figures only:
//
//   multiple   = shrink(median(live mcap / TVL in category), global)
//   base       = tvl_usd x multiple
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x 0.5
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365)
//   implied    = max(1, round(base x growthMult x maturity))
//
// No protocol name is ever special-cased: the same function scores every
// row, and the dashboard shows the multiple, its sample size and the
// comparables behind each row's number.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  shrink_k: number;
  multiple_cap: number;
  multiple_floor: number;
  winsor_low: number;
  winsor_high: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  shrink_k: 5,
  multiple_cap: 1.5,
  multiple_floor: 0.02,
  winsor_low: 0.01,
  winsor_high: 5.0,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** How many live comparables the detail view shows per category. */
export const COMPS_SHOWN = 5;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** Where a board row comes from: the watchlist, above its floor, or below it. */
export type Tier = 'watchlist' | 'beyond' | 'early';

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  tier: Tier;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_n: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  multiple_n: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  tier: Tier;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's comparable multiple, as the methodology shows it. */
export interface CategoryMultiple {
  category: string;
  n: number;
  median: number;
  multiple: number;
}

/** One live comparable behind a category's multiple. */
export interface Comparable {
  name: string;
  multiple: number;
  mcap_usd: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  beyond_size: number;
  live_size: number;
  total_implied_usd: number;
  global_multiple: number;
  multiples: CategoryMultiple[];
  comparables: Record<string, Comparable[]>;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted list of numbers. */
function medianOf(sorted: number[]): number {
  if (sorted.length === 0) return NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the watchlist's rule keeps out: exchanges and wrapped, staked or bridged products. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a protocol must not begin with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whole words that mark a wrapped, staked or bridged product of a token that trades. */
const WRAPPED_WORDS = /\b(wrapped|staked|staking|wrapper)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is a launch candidate under the watchlist's own
 * exclusion rule: pre-token, not an exchange, not a bridge or a staking
 * product, not a versioned pool, not a wrapped or staked product, and
 * not an exchange's own product.
 */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  const category = p.category ?? '';
  if (EXCLUDED_CATEGORIES.has(category)) return false;
  if (category.toLowerCase().includes('bridge')) return false;
  if (category.toLowerCase().includes('wrapper')) return false;
  if (category.toLowerCase() === 'otc marketplace') return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORDS.test(p.name)) return false;
  if (/\bexchange\b/i.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The live multiples behind every category, winsorized, with the global median. */
export interface Multiples {
  global: number;
  byCategory: Map<string, { n: number; median: number; multiple: number }>;
}

export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): Multiples {
  const perCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.category === 'CEX') continue;
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const raw = p.mcap_usd / p.tvl_usd;
    const winsorized = Math.min(model.winsor_high, Math.max(model.winsor_low, raw));
    const key = p.category ?? 'Other';
    const list = perCategory.get(key) ?? [];
    list.push(winsorized);
    perCategory.set(key, list);
    all.push(winsorized);
  }
  all.sort((a, b) => a - b);
  const global = medianOf(all);
  const byCategory = new Map<string, { n: number; median: number; multiple: number }>();
  for (const [category, values] of perCategory) {
    const sorted = [...values].sort((a, b) => a - b);
    const med = medianOf(sorted);
    const shrunk = (values.length * med + model.shrink_k * global) / (values.length + model.shrink_k);
    const multiple = Math.min(model.multiple_cap, Math.max(model.multiple_floor, shrunk));
    byCategory.set(category, { n: values.length, median: round4(med), multiple: round4(multiple) });
  }
  return { global: round4(global), byCategory };
}

/** The multiple one category's protocols are valued at. */
export function multipleFor(category: string | null, multiples: Multiples): { multiple: number; n: number } {
  const entry = multiples.byCategory.get(category ?? 'Other');
  if (entry === undefined) return { multiple: multiples.global, n: 0 };
  return { multiple: entry.multiple, n: entry.n };
}

/** The three multipliers and the implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples: Multiples,
): { implied: number; multiple: number; multipleN: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const { multiple, n } = multipleFor(protocol.category, multiples);
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, multiple, multipleN: n, growthPct, growthMult, maturityMult, age };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const multiples = categoryMultiples(snapshot, model);
  const chosen = new Map<string, { p: SnapshotProtocol; tier: Tier }>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, { p, tier: 'watchlist' });
  }
  // Beyond the watchlist: launch candidates above the floor the list left out.
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug)) continue;
    if (p.tvl_usd >= snapshot.floor_usd && isLaunchCandidate(p)) chosen.set(p.slug, { p, tier: 'beyond' });
  }
  // The early radar: launch candidates below the floor.
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug)) continue;
    if (p.tvl_usd < snapshot.floor_usd && isLaunchCandidate(p)) chosen.set(p.slug, { p, tier: 'early' });
  }

  const scored = [...chosen.values()].map(({ p, tier }) => {
    const v = impliedValue(p, snapshot.as_of, model, multiples);
    return { p, tier, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    tier: s.tier,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      multiple: s.multiple,
      multiple_n: s.multipleN,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Rough gas for one transaction on a chain, in whole dollars. */
function gasUsd(chain: string): number {
  if (chain === 'Ethereum') return 8;
  if (chain === 'Solana') return 0.05;
  const cheap = new Set([
    'Base',
    'Arbitrum',
    'Optimism',
    'Ink',
    'Blast',
    'Mode',
    'Linea',
    'Scroll',
    'zkSync Era',
    'Mantle',
    'Unichain',
    'Soneium',
    'Abstract',
    'Polygon',
    'BNB',
    'Binance',
    'Avalanche',
    'Tron',
  ]);
  if (cheap.has(chain)) return 0.5;
  return 1;
}

/** Gas as words: cents stay cents, dollars stay dollars. */
function gasWords(usd: number): string {
  if (usd < 0.1) return 'a few cents of gas';
  if (usd < 1) return `about $${usd.toFixed(2)} of gas`;
  return `about $${usd} of gas`;
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield') && !c.includes('aggregator')) return `Deposit $${capital} of USDC into ${name}'s highest-yield vault on ${chain} and let it compound.`;
  if (c.includes('yield aggregator')) return `Deposit $${capital} of USDC into ${name}'s best vault on ${chain} and keep the shares.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and hold the position.`;
  if (c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('farm')) return `Deposit $${capital} of USDC into ${name}'s farm on ${chain} and keep the position open.`;
  if (c.includes('chain') && !c.includes('cross')) return `Bridge $${capital} of USDC to ${name}'s network and deposit it in its flagship app.`;
  if (c.includes('index')) return `Buy $${capital} of the ${name} index on ${chain} and hold it.`;
  if (c.includes('privacy')) return `Deposit $${capital} into ${name}'s private pool on ${chain} and keep the position open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second feature to use, so the position shows more than one kind of activity. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const small = Math.max(10, Math.round(capital / 5));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $${small} against the supply, then repay it within the week to activate both sides of the position.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Swap $${small} through the main pool once to register trading activity beside the liquidity.`;
  if (c.includes('yield')) return `Claim or compound the yield once so the position shows harvest activity.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge and open a fresh one, to show continued use of the market.`;
  if (c.includes('prediction')) return `Settle the first market and place a second position on another outcome.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit into a second vault with a different risk profile, so the wallet shows range.`;
  if (c.includes('stable')) return `Swap $${small} of the stable asset in and out once to register use.`;
  if (c.includes('rwa')) return `Hold the yield asset through one distribution cycle before touching it.`;
  if (c.includes('insurance')) return `File a test quote for a second cover amount, without buying, to register the wallet.`;
  if (c.includes('basis')) return `Top the vault up by $${small} once, after the first week, to show an ongoing position.`;
  if (c.includes('restak')) return `Restake the receipt token once through the same app.`;
  if (c.includes('farm')) return `Harvest the farm rewards once and restake them into the same farm.`;
  if (c.includes('chain') && !c.includes('cross')) return `Use a second app on the same network once, such as a swap or a vote.`;
  if (c.includes('index')) return `Rebalance the index holding once, to show the wallet is active.`;
  if (c.includes('privacy')) return `Withdraw a small amount through the private pool once, to complete a full cycle.`;
  return `Use a second feature of the app once, such as a swap or a vote, so the wallet shows more than a deposit.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a
 * time. The plan is derived from the protocol's own record (category,
 * chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasUsd(chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gasWords(gas)}`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, capital, chain),
      cost: gasWords(gas),
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `${gasWords(gas)} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page from its official site and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Check every contract address against the protocol's own docs before you approve it, approve only the amount you use, and revoke approvals you no longer need.`,
      cost: 'nothing',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    multiple_n: row.model.multiple_n,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    tier: row.tier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const multiples = categoryMultiples(snapshot, model);
  const early = board.filter((r) => r.tier === 'early').length;
  const beyond = board.filter((r) => r.tier === 'beyond').length;
  const multiplesList: CategoryMultiple[] = [...multiples.byCategory.entries()]
    .map(([category, v]) => ({ category, n: v.n, median: v.median, multiple: v.multiple }))
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  const comparables: Record<string, Comparable[]> = {};
  for (const [category] of multiples.byCategory) {
    const comps = snapshot.protocols
      .filter((p) => !isPreToken(p) && (p.category ?? 'Other') === category && p.mcap_usd !== null && p.tvl_usd > 0)
      .map((p) => ({ name: p.name, multiple: round4(p.mcap_usd! / p.tvl_usd), mcap_usd: p.mcap_usd }))
      .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
      .slice(0, COMPS_SHOWN);
    if (comps.length > 0) comparables[category] = comps;
  }
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    beyond_size: beyond,
    live_size: live.length,
    total_implied_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    global_multiple: multiples.global,
    multiples: multiplesList,
    comparables,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
