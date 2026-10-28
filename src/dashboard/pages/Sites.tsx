import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Area, Bar, ComposedChart, ResponsiveContainer, YAxis } from 'recharts';
import { navigate, useMe } from '../App';
import { Favicon } from '../components/Icons';
import { Logo } from '../components/Logo';
import { Modal } from '../components/Modal';
import { api, type Site, type SiteSummary } from '../lib/api';
import { fmtMoney, fmtNumber } from '../lib/format';

const PERIODS = [
  { id: '7d', label: 'last 7 days' },
  { id: '30d', label: 'last 30 days' },
  { id: '90d', label: 'last 90 days' },
  { id: '12m', label: 'last 12 months' },
] as const;
type PeriodId = (typeof PERIODS)[number]['id'];
const PERIOD_KEY = 'ml:sites-period';

function savedPeriod(): PeriodId {
  try {
    const v = localStorage.getItem(PERIOD_KEY);
    if (PERIODS.some((p) => p.id === v)) return v as PeriodId;
  } catch {
    /* storage unavailable */
  }
  return '30d';
}

/** "https://www.sunle.app/" → "sunle.app" */
const cleanName = (name: string) => name.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

/** Revenue per currency, largest first. */
function revenueByCurrency(sites: Site[]) {
  const m = new Map<string, { amount: number; decimals: number }>();
  for (const s of sites) {
    if (!s.summary) continue;
    const cur = m.get(s.summary.currency) ?? { amount: 0, decimals: s.summary.decimals };
    cur.amount += s.summary.revenue;
    m.set(s.summary.currency, cur);
  }
  return [...m.entries()].map(([currency, v]) => ({ currency, ...v })).sort((a, b) => b.amount - a.amount);
}

function moneyText(parts: { currency: string; amount: number; decimals: number }[]) {
  const nonZero = parts.filter((p) => p.amount !== 0);
  if (!nonZero.length) return fmtMoney(0, parts[0]?.currency ?? 'USD', 0);
  return nonZero.map((p) => fmtMoney(p.amount, p.currency, p.decimals, true)).join(' + ');
}

export function Sites() {
  const { me } = useMe();
  const [sites, setSites] = useState<Site[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [period, setPeriod] = useState<PeriodId>(savedPeriod);

  useEffect(() => {
    let live = true;
    api<Site[]>(`/api/sites?period=${period}`).then((s) => {
      if (!live) return;
      setSites(s);
      if (!s.length) setAdding(true);
    });
    return () => {
      live = false;
    };
  }, [period]);

  function choosePeriod(p: PeriodId) {
    setPeriod(p);
    try {
      localStorage.setItem(PERIOD_KEY, p);
    } catch {
      /* storage unavailable */
    }
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    window.dispatchEvent(new Event('ml:logout'));
  }

  const totals = useMemo(() => {
    if (!sites?.length) return null;
    const money = revenueByCurrency(sites);
    // Sum the sites' series point by point, aligned on the most recent point (timezones can shift the count by one).
    const len = Math.max(...sites.map((s) => s.summary?.series.length ?? 0));
    const main = money[0]?.currency;
    const series: [number, number][] = Array.from({ length: len }, () => [0, 0]);
    for (const s of sites) {
      const pts = s.summary?.series ?? [];
      pts.forEach(([v, r], i) => {
        const j = len - pts.length + i;
        series[j][0] += v;
        if (s.summary?.currency === main) series[j][1] += r;
      });
    }
    return {
      visitors: sites.reduce((a, s) => a + (s.summary?.visitors ?? 0), 0),
      online: sites.reduce((a, s) => a + (s.online ?? 0), 0),
      money,
      series,
    };
  }, [sites]);

  const firstName = me.user?.name?.split(' ')[0];
  const periodLabel = PERIODS.find((p) => p.id === period)!.label;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
      <div className="flex items-center justify-between gap-2">
        <Logo />
        <div className="flex items-center gap-2">
          {me.hosted && me.user && (
            <button className="hidden items-center gap-2 rounded-xl px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 sm:flex" onClick={() => navigate('/billing')} title="Plan & billing">
              {me.user.avatar ? <img src={me.user.avatar} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" /> : null}
              {me.user.email}
            </button>
          )}
          <button className="btn" onClick={logout}>
            Log out
          </button>
          <button className="btn-dark" onClick={() => setAdding(true)}>
            + Add website
          </button>
        </div>
      </div>

      <p className="mt-10 text-lg leading-relaxed text-stone-500 sm:text-xl">
        {firstName ? `Hey ${firstName}, you` : 'You'} got{' '}
        <b className="font-semibold text-ink">{totals ? fmtNumber(totals.visitors) : '…'} visitors</b> and made{' '}
        <b className="font-semibold text-ink">{totals ? moneyText(totals.money) : '…'}</b> in the{' '}
        {/* The visible label sizes the control; the native select sits invisibly on top so it stays keyboard and touch friendly. */}
        <span className="group relative inline-flex items-center gap-1 whitespace-nowrap border-b border-dashed border-stone-400 font-semibold text-ink focus-within:border-ink hover:border-ink">
          {periodLabel}
          <span className="text-xs text-stone-400 group-hover:text-ink">▾</span>
          <select
            aria-label="Period"
            value={period}
            onChange={(e) => choosePeriod(e.target.value as PeriodId)}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            {PERIODS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </span>
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {!sites &&
          [0, 1, 2].map((i) => (
            <div key={i} className="card h-[214px] animate-pulse p-5">
              <div className="h-5 w-40 rounded bg-stone-100" />
              <div className="mt-6 h-24 rounded bg-stone-50" />
            </div>
          ))}

        {sites && sites.length > 1 && totals && (
          <SiteCard
            icon={<FaviconStack domains={sites.map((s) => s.domain)} />}
            title={`All ${sites.length} websites`}
            online={totals.online}
            series={totals.series}
            visitors={totals.visitors}
            revenue={moneyText(totals.money)}
            periodLabel={periodLabel}
          />
        )}

        {sites?.map((s) => (
          <SiteCard
            key={s.id}
            onClick={() => navigate(`/site/${s.id}`)}
            icon={<Favicon domain={s.domain} size={22} />}
            title={cleanName(s.name) || s.domain}
            online={s.online ?? 0}
            series={s.summary?.series ?? []}
            visitors={s.summary?.visitors ?? 0}
            revenue={s.summary ? fmtMoney(s.summary.revenue, s.summary.currency, s.summary.decimals, true) : '…'}
            periodLabel={periodLabel}
          />
        ))}

        {sites && !sites.length && (
          <div className="card col-span-full p-10 text-center text-stone-500">No websites yet. Add your first one to get a tracking snippet.</div>
        )}
      </div>
      <AddSite open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function SiteCard(props: {
  icon: ReactNode;
  title: string;
  online: number;
  series: [number, number][];
  visitors: number;
  revenue: string;
  periodLabel: string;
  onClick?: () => void;
}) {
  const { icon, title, online, series, visitors, revenue, periodLabel, onClick } = props;
  const body = (
    <>
      <div className="flex items-center gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center">{icon}</span>
        <span className="min-w-0 flex-1 truncate font-semibold">{title}</span>
        {online > 0 && (
          <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-emerald-600" title={`${online} online now`}>
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            {online}
          </span>
        )}
      </div>
      <Sparkline series={series} />
      <div className="mt-3 text-sm text-stone-500" title={periodLabel}>
        <b className="font-semibold text-ink">{fmtNumber(visitors)}</b> visitors <span className="px-1 text-stone-300">•</span>
        <b className="font-semibold text-ink">{revenue}</b> revenue
      </div>
    </>
  );
  const cls = 'card flex flex-col p-5 text-left';
  return onClick ? (
    <button onClick={onClick} className={`${cls} transition hover:-translate-y-0.5 hover:shadow-md`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Visitors as a smooth line over revenue bars, no axes: a shape to scan, details live in each site's dashboard. */
function Sparkline({ series }: { series: [number, number][] }) {
  const data = useMemo(() => series.map(([v, r]) => ({ v, r })), [series]);
  const hasRevenue = data.some((d) => d.r > 0);
  const hasVisitors = data.some((d) => d.v > 0);
  if (!data.length) return <div className="mt-4 h-24" />;
  return (
    <div className="relative mt-4 h-24">
      {!hasVisitors && !hasRevenue && (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-stone-400">No visitors yet</span>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 2, bottom: 2, left: 2 }} barCategoryGap="20%">
          <defs>
            <linearGradient id="spark-vis" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8dbdf0" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#8dbdf0" stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis yAxisId="v" hide domain={[0, (max: number) => Math.max(max, 1) * 1.08]} />
          {/* Revenue bars use the lower ~70% so the visitor line stays readable above them. */}
          <YAxis yAxisId="r" hide domain={[0, (max: number) => Math.max(max, 1) * 1.4]} />
          {hasRevenue && <Bar yAxisId="r" dataKey="r" fill="#e07b5f" radius={[2, 2, 0, 0]} maxBarSize={10} isAnimationActive={false} />}
          <Area
            yAxisId="v"
            type="monotone"
            dataKey="v"
            stroke={hasVisitors ? '#7cb1ea' : '#e7e5e4'}
            strokeWidth={2}
            fill="url(#spark-vis)"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function FaviconStack({ domains }: { domains: string[] }) {
  const shown = domains.slice(0, 3);
  return (
    <span className="relative block h-6 w-6">
      {shown.map((d, i) => (
        <span
          key={d + i}
          className="absolute rounded-md bg-white ring-2 ring-white"
          style={{ left: i * 4, top: i * 4, zIndex: shown.length - i, transform: `scale(${1 - i * 0.12})` }}
        >
          <Favicon domain={d} size={16} />
        </span>
      ))}
    </span>
  );
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'SGD', 'JPY', 'BRL'];

function AddSite({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [domain, setDomain] = useState('');
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [currency, setCurrency] = useState('USD');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const site = await api<Site>('/api/sites', { method: 'POST', json: { domain, name, timezone, currency } });
      navigate(`/site/${site.id}/settings`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a website" width="max-w-md">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Domain</label>
          <input className="input" placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} autoFocus />
          <p className="mt-1 text-xs text-stone-500">Subdomains (app.example.com) are tracked under the same site.</p>
        </div>
        <div>
          <label className="label">Name</label>
          <input className="input" placeholder="My SaaS" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Timezone</label>
            <input className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </div>
          <div>
            <label className="label">Revenue currency</label>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-dark w-full" disabled={!domain}>
          Add website
        </button>
      </form>
    </Modal>
  );
}
