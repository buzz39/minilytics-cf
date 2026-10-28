import type { Site } from './env';
import { currencyDecimals } from './payments';
import { bucketLabels, bucketSql, resolveRange, tzOffset } from './lib/time';

/** Periods the websites overview offers. Each one charts in daily (or, for 12m, weekly) points. */
export const SUMMARY_PERIODS = ['7d', '30d', '90d', '12m'] as const;
export type SummaryPeriod = (typeof SUMMARY_PERIODS)[number];

export interface SiteSummary {
  visitors: number;
  revenue: number; // minor units of the site's currency
  currency: string;
  decimals: number;
  /** One point per day (week for 12m), oldest first: [visitors, revenue]. */
  series: [number, number][];
}

/**
 * Visitors and revenue over the period for every site, for the sparkline cards on the websites page.
 * Each site is bucketed in its own timezone; three small queries per site, all in one batch.
 */
export async function sitesSummary(db: D1Database, sites: Site[], period: SummaryPeriod, now = Date.now()) {
  const plans = sites.map((site) => {
    const range = resolveRange({ period }, site.timezone, site.created_at, now);
    const offset = tzOffset(site.timezone, range.to);
    return { site, range, offset, labels: bucketLabels(range, offset) };
  });
  const stmts = plans.flatMap(({ site, range, offset }) => [
    db
      .prepare(
        `SELECT ${bucketSql('started_at', range.granularity, offset)} AS b, COUNT(DISTINCT visitor_id) AS n
         FROM sessions WHERE site_id = ? AND started_at >= ? AND started_at < ? GROUP BY b`,
      )
      .bind(site.id, range.from, range.to),
    db
      .prepare('SELECT COUNT(DISTINCT visitor_id) AS n FROM sessions WHERE site_id = ? AND started_at >= ? AND started_at < ?')
      .bind(site.id, range.from, range.to),
    db
      .prepare(
        `SELECT ${bucketSql('ts', range.granularity, offset)} AS b, SUM(amount) AS n
         FROM payments WHERE site_id = ? AND ts >= ? AND ts < ? GROUP BY b`,
      )
      .bind(site.id, range.from, range.to),
  ]);
  const results = stmts.length ? await db.batch(stmts) : [];

  const out: Record<string, SiteSummary> = {};
  plans.forEach(({ site, labels }, i) => {
    const [daily, total, revenue] = results.slice(i * 3, i * 3 + 3);
    const v = new Map((daily.results as { b: string; n: number }[]).map((r) => [r.b, r.n]));
    const r = new Map((revenue.results as { b: string; n: number }[]).map((x) => [x.b, x.n]));
    out[site.id] = {
      visitors: (total.results[0] as { n: number } | undefined)?.n ?? 0,
      revenue: [...r.values()].reduce((a, b) => a + (b ?? 0), 0),
      currency: site.currency,
      decimals: currencyDecimals(site.currency),
      series: labels.map((b) => [v.get(b) ?? 0, r.get(b) ?? 0]),
    };
  });
  return out;
}
