import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  WorkEntry, subscribeToWorkEntries,
  AepsWithdrawal, subscribeToAepsWithdrawals,
  ElectricRecharge, subscribeToElectricRecharges,
  MoneyTransfer, subscribeToMoneyTransfers,
  QuickActionEntry, subscribeToQuickActions,
  FlightBooking, subscribeToFlightBookings,
} from '@/lib/firestore';
import { useAuth } from '@/contexts/AuthContext';
import {
  startOfDay, endOfDay, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, subDays, subMonths,
  isWithinInterval, format, eachDayOfInterval, isSameDay,
} from 'date-fns';
import { formatCurrency } from '@/lib/format';
import { resolveStatus } from '@/lib/payments';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  ShieldCheck, TrendingUp, IndianRupee, Download, Search,
  CalendarIcon, ChevronUp, ChevronDown, ChevronsUpDown,
  AlertTriangle, X, Banknote, Wifi, Users, ChevronRight,
  LayoutDashboard, Briefcase, BarChart3, Info,
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts';
import type { DateRange } from 'react-day-picker';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type PresetKey    = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'lastMonth' | 'custom';
type SortDir      = 'asc' | 'desc' | null;
type TabKey       = 'overview' | 'work' | 'financial' | 'staff';
type FinancialKey = 'aeps' | 'recharge' | 'transfer' | 'quick' | 'flight';

interface DateRangeState { from: Date; to: Date; preset: PresetKey; }

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildPreset(key: Exclude<PresetKey, 'custom'>): { from: Date; to: Date } {
  const now = new Date();
  switch (key) {
    case 'today':      return { from: startOfDay(now), to: endOfDay(now) };
    case 'yesterday': { const y = subDays(now, 1); return { from: startOfDay(y), to: endOfDay(y) }; }
    case 'thisWeek':   return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
    case 'thisMonth':  return { from: startOfMonth(now), to: endOfMonth(now) };
    case 'lastMonth': { const lm = subMonths(now, 1); return { from: startOfMonth(lm), to: endOfMonth(lm) }; }
  }
}

function inRange(d: Date, from: Date, to: Date) {
  return isWithinInterval(d, { start: from, end: to });
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV export
// ─────────────────────────────────────────────────────────────────────────────

type CsvValue = string | number | null | undefined;

function downloadCSV(filename: string, rows: ReadonlyArray<ReadonlyArray<CsvValue>>): void {
  const csv = rows
    .map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sorting
// ─────────────────────────────────────────────────────────────────────────────

function useSortState(initialCol: string) {
  const [col, setCol] = useState<string>(initialCol);
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const toggle = useCallback((newCol: string) => {
    if (col === newCol) { setDir(d => d === 'asc' ? 'desc' : 'asc'); }
    else { setCol(newCol); setDir('desc'); }
  }, [col]);
  return { col, dir, toggle, getDir: (c: string): SortDir => col === c ? dir : null };
}

function sortRows<T>(rows: T[], col: string, dir: 'asc' | 'desc', getValue: (r: T, col: string) => string | number): T[] {
  return [...rows].sort((a, b) => {
    const av = getValue(a, col), bv = getValue(b, col);
    const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
    return dir === 'asc' ? cmp : -cmp;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared UI atoms
// ─────────────────────────────────────────────────────────────────────────────

function SortIcon({ dir }: { dir: SortDir }) {
  if (dir === 'asc')  return <ChevronUp   className="h-3.5 w-3.5 ml-1 inline" />;
  if (dir === 'desc') return <ChevronDown className="h-3.5 w-3.5 ml-1 inline" />;
  return <ChevronsUpDown className="h-3.5 w-3.5 ml-1 inline opacity-40" />;
}

function StatusBadge({ status }: { status: WorkEntry['status'] }) {
  const cls: Record<WorkEntry['status'], string> = {
    Completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    Pending:   'bg-amber-100 text-amber-700 border-amber-200',
    Rejected:  'bg-red-100 text-red-700 border-red-200',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls[status]}`}>{status}</span>;
}

function makeTh(sort: ReturnType<typeof useSortState>) {
  return function Th({ col, label, align = 'left' }: { col: string; label: string; align?: 'left' | 'right' }) {
    return (
      <TableHead
        className={`cursor-pointer select-none whitespace-nowrap ${align === 'right' ? 'text-right' : ''} hover:text-foreground transition-colors`}
        onClick={() => sort.toggle(col)}
      >
        {label}<SortIcon dir={sort.getDir(col)} />
      </TableHead>
    );
  };
}

function StatCards({ items }: { items: { label: string; value: string; sub?: string; cls?: string; info?: string }[] }) {
  const cols = items.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-4';
  return (
    <div className={`grid gap-3 ${cols}`}>
      {items.map(s => (
        <Card key={s.label}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-1 mb-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{s.label}</p>
              {s.info && (
                <span title={s.info} className="cursor-help">
                  <Info className="h-3 w-3 text-muted-foreground/60" />
                </span>
              )}
            </div>
            <p className={`text-xl font-semibold ${s.cls ?? ''}`}>{s.value}</p>
            {s.sub && <p className="text-xs text-muted-foreground mt-0.5">{s.sub}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Work entry helpers
// ─────────────────────────────────────────────────────────────────────────────

function getWorkChallan(e: WorkEntry): number {
  return (e.challanAmount ?? 0) + (e.netAdjustmentChallan ?? 0);
}

function isOnline(mode: string | undefined): boolean {
  return mode === 'Online';
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily trend builder
// ─────────────────────────────────────────────────────────────────────────────

function buildDailyTrend(
  entries: { ts: Date; value: number }[],
  from: Date,
  to: Date,
): { date: string; value: number }[] {
  let days: Date[] = [];
  try { days = eachDayOfInterval({ start: from, end: to }); } catch { return []; }
  if (days.length > 90) {
    const map: Record<string, number> = {};
    entries.forEach(e => { const k = format(e.ts, 'dd MMM'); map[k] = (map[k] ?? 0) + e.value; });
    return Object.entries(map).map(([date, value]) => ({ date, value: Math.round(value) }));
  }
  return days.map(day => ({
    date: format(day, 'dd MMM'),
    value: Math.round(entries.filter(e => isSameDay(e.ts, day)).reduce((s, e) => s + e.value, 0)),
  }));
}

function DailyTrendChart({ data, color, label }: { data: { date: string; value: number }[]; color: string; label: string }) {
  const hasData = data.some(d => d.value > 0);
  if (!hasData) return (
    <div className="flex flex-col items-center justify-center h-36 text-muted-foreground">
      <TrendingUp className="h-7 w-7 mb-2 opacity-20" />
      <p className="text-sm">No data in this period.</p>
    </div>
  );
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v: number) => [formatCurrency(v), label]} />
        <Bar dataKey="value" name={label} radius={[3, 3, 0, 0]}>
          {data.map((_, i) => <Cell key={i} fill={color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Date Range Filter (shown at top of page, single for all tabs)
// ─────────────────────────────────────────────────────────────────────────────

const PRESETS: { key: Exclude<PresetKey, 'custom'>; label: string }[] = [
  { key: 'today',     label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'thisWeek',  label: 'This Week' },
  { key: 'thisMonth', label: 'This Month' },
  { key: 'lastMonth', label: 'Last Month' },
];

function DateRangeFilter({ value, onChange }: { value: DateRangeState; onChange: (v: DateRangeState) => void }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<DateRange | undefined>({ from: value.from, to: value.to });

  const applyPreset = (key: Exclude<PresetKey, 'custom'>) => {
    const { from, to } = buildPreset(key);
    onChange({ from, to, preset: key }); setOpen(false);
  };
  const applyCustom = () => {
    if (!pending?.from || !pending?.to) return;
    onChange({ from: startOfDay(pending.from), to: endOfDay(pending.to), preset: 'custom' }); setOpen(false);
  };
  const customLabel = value.preset === 'custom'
    ? `${format(value.from, 'dd MMM')} – ${format(value.to, 'dd MMM yyyy')}`
    : 'Custom';

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {PRESETS.map(p => (
        <Button key={p.key} size="sm" variant={value.preset === p.key ? 'default' : 'outline'} className="h-9 text-sm rounded-lg px-3" onClick={() => applyPreset(p.key)}>
          {p.label}
        </Button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant={value.preset === 'custom' ? 'default' : 'outline'} className="h-9 text-sm rounded-lg gap-1.5 px-3">
            <CalendarIcon className="h-3.5 w-3.5" />{customLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-4" align="end">
          <Calendar mode="range" selected={pending} onSelect={setPending} numberOfMonths={2} disabled={(d: Date) => d > new Date()} />
          <div className="flex justify-end mt-3">
            <Button size="sm" onClick={applyCustom} disabled={!pending?.from || !pending?.to}>Apply</Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Source colors
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE_COLORS: Record<string, string> = {
  Work:             '#4f46e5',
  AEPS:             '#10b981',
  Recharge:         '#f59e0b',
  Transfer:         '#8b5cf6',
  'Quick Work':     '#06b6d4',
  'Flight Booking': '#f43f5e',
};

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1 — Overview
// ─────────────────────────────────────────────────────────────────────────────

const PIE_COLORS = { Cash: '#10b981', Online: '#3b82f6' };

function OverviewTab({
  work, aeps, recharge, transfer, quick, flight, dateRange,
}: {
  work: WorkEntry[]; aeps: AepsWithdrawal[]; recharge: ElectricRecharge[];
  transfer: MoneyTransfer[]; quick: QuickActionEntry[]; flight: FlightBooking[]; dateRange: DateRangeState;
}) {
  const activeWork     = work.filter(e => e.status !== 'Rejected');
  const workCollected  = activeWork.reduce((s, e) => s + e.paidAmount, 0);
  const workChallan    = activeWork.reduce((s, e) => s + getWorkChallan(e), 0);
  const workProfit     = workCollected - workChallan;

  const aepsPaid       = aeps.filter(e => resolveStatus(e.paymentStatus) === 'paid');
  const rechargePaid   = recharge.filter(e => resolveStatus(e.paymentStatus) === 'paid');
  const transferPaid   = transfer.filter(e => resolveStatus(e.paymentStatus) === 'paid');
  const quickPaid      = quick.filter(e => resolveStatus(e.paymentStatus) === 'paid');
  const flightPaid     = flight.filter(e => resolveStatus(e.paymentStatus) === 'paid');

  const aepsProfit     = aepsPaid.reduce((s, e) => s + e.profitMargin, 0);
  const rechargeProfit = rechargePaid.reduce((s, e) => s + e.profitMargin, 0);
  const transferProfit = transferPaid.reduce((s, e) => s + e.profitMargin, 0);
  const quickEarned    = quickPaid.reduce((s, e) => s + e.amount, 0);
  const flightProfit   = flightPaid.reduce((s, e) => s + e.profitMargin, 0);

  const workDue     = activeWork.reduce((s, e) => s + Math.max(0, e.dueAmount), 0);
  const totalDue    = workDue
    + aeps.filter(e => resolveStatus(e.paymentStatus) === 'pending').reduce((s, e) => s + e.amount, 0)
    + recharge.filter(e => resolveStatus(e.paymentStatus) === 'pending').reduce((s, e) => s + e.rechargeAmount, 0)
    + transfer.filter(e => resolveStatus(e.paymentStatus) === 'pending').reduce((s, e) => s + e.amount, 0)
    + quick.filter(e => resolveStatus(e.paymentStatus) === 'pending').reduce((s, e) => s + e.amount, 0)
    + flight.filter(e => resolveStatus(e.paymentStatus) === 'pending').reduce((s, e) => s + e.amountCharged, 0);
  const totalCredit = activeWork.reduce((s, e) => s + (e.dueAmount < 0 ? -e.dueAmount : 0), 0);

  const profitSources = [
    { label: 'Work',           profit: workProfit,     sub: `${formatCurrency(workCollected)} − ${formatCurrency(workChallan)} challan` },
    ...(aepsProfit     !== 0 ? [{ label: 'AEPS',           profit: aepsProfit,     sub: `${aepsPaid.length} transactions` }]    : []),
    ...(rechargeProfit !== 0 ? [{ label: 'Recharge',       profit: rechargeProfit, sub: `${rechargePaid.length} transactions` }] : []),
    ...(transferProfit !== 0 ? [{ label: 'Transfer',       profit: transferProfit, sub: `${transferPaid.length} transactions` }] : []),
    ...(quickEarned    !== 0 ? [{ label: 'Quick Work',     profit: quickEarned,    sub: `${quickPaid.length} transactions` }]    : []),
    ...(flightPaid.length > 0 ? [{ label: 'Flight Booking', profit: flightProfit, sub: `${flightPaid.length} bookings` }]       : []),
  ];
  const totalProfit = profitSources.reduce((s, src) => s + src.profit, 0);
  const breakdownData = profitSources.map(s => ({ name: s.label, profit: Math.round(s.profit) }));

  const trendData = useMemo(() => buildDailyTrend(
    activeWork.map(e => ({ ts: e.date.toDate(), value: e.paidAmount - getWorkChallan(e) })),
    dateRange.from, dateRange.to,
  ), [activeWork, dateRange]);

  // Cash vs Online calculation
  const cashOnlineRows = useMemo(() => {
    const calc = (items: { mode: string | undefined; amount: number }[]) => {
      let cash = 0, online = 0;
      items.forEach(({ mode, amount }) => { if (isOnline(mode)) online += amount; else cash += amount; });
      return { cash, online };
    };
    const wt = calc(activeWork.map(e => ({ mode: e.paymentMode, amount: e.paidAmount })));
    const at = calc(aepsPaid.map(e => ({ mode: e.paymentMode, amount: e.profitMargin })));
    const rt = calc(rechargePaid.map(e => ({ mode: e.paymentMode, amount: e.profitMargin })));
    const tt = calc(transferPaid.map(e => ({ mode: e.paymentMode, amount: e.profitMargin })));
    const qt = calc(quickPaid.map(e => ({ mode: e.paymentMode, amount: e.amount })));
    const ft = calc(flight.map(e => ({ mode: undefined as string | undefined, amount: e.profitMargin })));
    return [
      { module: 'Work',           ...wt, total: wt.cash + wt.online },
      { module: 'AEPS',           ...at, total: at.cash + at.online },
      { module: 'Recharge',       ...rt, total: rt.cash + rt.online },
      { module: 'Money Transfer', ...tt, total: tt.cash + tt.online },
      { module: 'Quick Work',     ...qt, total: qt.cash + qt.online },
      { module: 'Flight Booking', ...ft, total: ft.cash + ft.online },
    ].filter(r => r.cash !== 0 || r.online !== 0 || r.total !== 0);
  }, [activeWork, aepsPaid, rechargePaid, transferPaid, quickPaid, flight]);

  const grandCash   = cashOnlineRows.reduce((s, r) => s + r.cash, 0);
  const grandOnline = cashOnlineRows.reduce((s, r) => s + r.online, 0);
  const grandTotal  = grandCash + grandOnline;
  const pieData = [{ name: 'Cash', value: grandCash }, { name: 'Online', value: grandOnline }].filter(d => d.value > 0);

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total Profit</CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">{formatCurrency(totalProfit)}</div>
            <p className="text-xs text-muted-foreground mt-1">Paid entries only — pending dues not included</p>
            <div className="mt-2 space-y-1">
              {profitSources.map(src => (
                <div key={src.label} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ background: SOURCE_COLORS[src.label] ?? '#94a3b8' }} />
                    <span className="text-muted-foreground">{src.label}</span>
                  </span>
                  <span className="font-medium tabular-nums">{formatCurrency(src.profit)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Work Earnings</CardTitle>
            <IndianRupee className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-700">{formatCurrency(workCollected)}</div>
            <p className="text-xs text-muted-foreground mt-1">{activeWork.length} entries (amount collected)</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Outstanding Due</CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totalDue > 0 ? 'text-amber-700' : 'text-muted-foreground'}`}>{formatCurrency(totalDue)}</div>
            {totalCredit > 0
              ? <p className="text-xs text-emerald-700 mt-1 font-medium">+ {formatCurrency(totalCredit)} overpaid</p>
              : totalDue === 0 && <p className="text-xs text-muted-foreground mt-1">All cleared</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Challan Cost</CardTitle>
            <IndianRupee className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(workChallan)}</div>
            <p className="text-xs text-muted-foreground mt-1">Govt fees (deducted from profit)</p>
          </CardContent>
        </Card>
      </div>

      {/* Profit by source chart */}
      {breakdownData.some(d => d.profit > 0) && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Earnings by Service</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(160, breakdownData.length * 44)}>
              <BarChart data={breakdownData} layout="vertical" margin={{ top: 0, right: 16, left: 16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `₹${Number(v).toLocaleString('en-IN')}`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={90} />
                <Tooltip formatter={(v: number) => [formatCurrency(v), 'Earnings']} />
                <Bar dataKey="profit" radius={[0, 4, 4, 0]}>
                  {breakdownData.map(d => <Cell key={d.name} fill={SOURCE_COLORS[d.name] ?? '#94a3b8'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Daily work profit trend */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Daily Work Profit</CardTitle></CardHeader>
        <CardContent>
          {!trendData.some(d => d.value !== 0) ? (
            <div className="flex flex-col items-center justify-center h-36 text-muted-foreground">
              <TrendingUp className="h-7 w-7 mb-2 opacity-20" />
              <p className="text-sm">No work entries in this period.</p>
            </div>
          ) : trendData.length <= 2 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={trendData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [formatCurrency(v), 'Earnings']} />
                <Bar dataKey="value" fill="#4f46e5" name="Earnings" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trendData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [formatCurrency(v), 'Earnings']} />
                <Line type="monotone" dataKey="value" stroke="#4f46e5" strokeWidth={2} dot={trendData.length <= 14} name="Earnings" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Cash vs Online section */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Banknote className="h-4 w-4 text-emerald-600" />
          Cash vs Online Breakdown
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <Card className="border-emerald-200 bg-emerald-50/50">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cash Collected</CardTitle>
              <Banknote className="h-4 w-4 text-emerald-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-700">{formatCurrency(grandCash)}</div>
              {grandTotal > 0 && <p className="text-xs text-muted-foreground mt-1">{Math.round((grandCash / grandTotal) * 100)}% of total</p>}
            </CardContent>
          </Card>
          <Card className="border-blue-200 bg-blue-50/50">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Online Collected</CardTitle>
              <Wifi className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-700">{formatCurrency(grandOnline)}</div>
              {grandTotal > 0 && <p className="text-xs text-muted-foreground mt-1">{Math.round((grandOnline / grandTotal) * 100)}% of total</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total</CardTitle>
              <IndianRupee className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">{formatCurrency(grandTotal)}</div>
              <p className="text-xs text-muted-foreground mt-1">Combined across all sources</p>
            </CardContent>
          </Card>
        </div>
        {grandTotal > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Cash vs Online Chart</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {pieData.map(d => <Cell key={d.name} fill={PIE_COLORS[d.name as keyof typeof PIE_COLORS] ?? '#94a3b8'} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => [formatCurrency(v)]} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Service-wise Split</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {cashOnlineRows.map(r => (
                    <div key={r.module} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                      <span className="font-medium">{r.module}</span>
                      <div className="flex gap-3 text-xs">
                        <span className="text-emerald-700">Cash: {formatCurrency(r.cash)}</span>
                        <span className="text-blue-700">Online: {formatCurrency(r.online)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2 — Work (Work entries + Category breakdown combined)
// ─────────────────────────────────────────────────────────────────────────────

function WorkTab({ work }: { work: WorkEntry[] }) {
  const [search, setSearch]           = useState('');
  const [showCategory, setShowCategory] = useState(false);
  const sort = useSortState('date');
  const Th = makeTh(sort);

  const active   = work.filter(e => e.status !== 'Rejected');
  const rejected = work.filter(e => e.status === 'Rejected');
  const totalCollected = active.reduce((s, e) => s + e.paidAmount, 0);
  const totalChallan   = active.reduce((s, e) => s + getWorkChallan(e), 0);
  const totalRefund    = rejected.reduce((s, e) => s + (e.refundAmount ?? 0), 0);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return work.filter(e => !search || e.customerName.toLowerCase().includes(q) || e.category.toLowerCase().includes(q) || (e.mobile ?? '').includes(q));
  }, [work, search]);

  const getValue = useCallback((e: WorkEntry, col: string): string | number => {
    switch (col) {
      case 'date':     return e.date.toMillis();
      case 'customer': return e.customerName;
      case 'category': return e.category;
      case 'total':    return e.totalAmount;
      case 'challan':  return getWorkChallan(e);
      case 'paid':     return e.paidAmount;
      case 'due':      return e.dueAmount;
      case 'status':   return e.status;
      default:         return 0;
    }
  }, []);

  const sorted = useMemo(() => sortRows(filtered, sort.col, sort.dir, getValue), [filtered, sort.col, sort.dir, getValue]);

  // Category aggregation
  const catRows = useMemo(() => {
    const map: Record<string, { category: string; count: number; collected: number; challan: number; netProfit: number }> = {};
    active.forEach(e => {
      const cat = e.category === 'Other' && e.otherCategory ? e.otherCategory : e.category;
      if (!map[cat]) map[cat] = { category: cat, count: 0, collected: 0, challan: 0, netProfit: 0 };
      map[cat].count++; map[cat].collected += e.paidAmount;
      map[cat].challan += getWorkChallan(e); map[cat].netProfit += e.paidAmount - getWorkChallan(e);
    });
    return Object.values(map).sort((a, b) => b.netProfit - a.netProfit);
  }, [active]);

  const exportCSV = () => {
    downloadCSV(`work-report-${format(new Date(), 'yyyy-MM-dd')}.csv`, [
      ['Date', 'Customer', 'Mobile', 'Category', 'Total Amount', 'Challan', 'Paid', 'Due', 'Status', 'Added By'],
      ...sorted.map(e => [
        format(e.date.toDate(), 'dd/MM/yyyy'), e.customerName, e.mobile,
        e.category === 'Other' && e.otherCategory ? e.otherCategory : e.category,
        String(e.totalAmount), String(getWorkChallan(e)), String(e.paidAmount), String(e.dueAmount), e.status, e.addedBy ?? '',
      ]),
    ]);
  };

  return (
    <div className="space-y-5">
      <StatCards items={[
        { label: 'Total Entries',    value: String(active.length), info: 'All entries excluding rejected' },
        { label: 'Amount Collected', value: formatCurrency(totalCollected), cls: 'text-emerald-700', info: 'Amount actually collected from customers (dues not included)' },
        { label: 'Challan Cost',     value: formatCurrency(totalChallan),   cls: 'text-slate-600', info: 'Govt fees deducted from profit' },
        { label: 'Net Profit',       value: formatCurrency(totalCollected - totalChallan), cls: 'text-primary font-bold', info: 'Amount collected minus challan cost = actual profit' },
      ]} />

      {rejected.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm">
          <X className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold text-red-700">Rejected/Refunded: </span>
            <span className="text-red-600">{rejected.length} entries</span>
            {totalRefund > 0 && <span className="text-red-600"> · {formatCurrency(totalRefund)} refunded</span>}
            <p className="text-xs text-red-500 mt-0.5">Not included in the totals above.</p>
          </div>
        </div>
      )}

      {/* Search + Export */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by customer or category…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-10" />
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 h-10" onClick={exportCSV}><Download className="h-4 w-4" /> CSV Download</Button>
      </div>

      {/* Mobile card list */}
      <div className="block sm:hidden space-y-2">
        {sorted.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">{search ? `No entries matching "${search}".` : 'No entries in this period.'}</div>
        ) : sorted.map(e => {
          const cat = e.category === 'Other' && e.otherCategory ? e.otherCategory : e.category;
          const due = e.dueAmount;
          return (
            <Card key={e.id} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="font-semibold text-sm">{e.customerName}</div>
                    <div className="text-xs text-muted-foreground">{format(e.date.toDate(), 'dd MMM yyyy')} · {cat}</div>
                  </div>
                  <StatusBadge status={e.status} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs mt-2">
                  <div><div className="text-muted-foreground">Collected</div><div className="font-semibold text-emerald-700">{formatCurrency(e.paidAmount)}</div></div>
                  <div><div className="text-muted-foreground">Challan</div><div className="font-semibold">{getWorkChallan(e) > 0 ? formatCurrency(getWorkChallan(e)) : '—'}</div></div>
                  <div><div className="text-muted-foreground">Due</div><div className={`font-semibold ${due > 0 ? 'text-amber-700' : ''}`}>{due > 0 ? formatCurrency(due) : '—'}</div></div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Desktop table */}
      <Card className="hidden sm:block">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <Th col="date" label="Date" /><Th col="customer" label="Customer" /><Th col="category" label="Category" />
                <Th col="total" label="Total" align="right" /><Th col="challan" label="Challan" align="right" />
                <Th col="paid" label="Collected" align="right" /><Th col="due" label="Due" align="right" /><Th col="status" label="Status" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">{search ? `No entries matching "${search}".` : 'No entries in this period.'}</TableCell></TableRow>
              ) : sorted.map(e => {
                const due = e.dueAmount;
                const cat = e.category === 'Other' && e.otherCategory ? e.otherCategory : e.category;
                return (
                  <TableRow key={e.id} className="hover:bg-muted/30">
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{format(e.date.toDate(), 'dd MMM yyyy')}</TableCell>
                    <TableCell className="font-medium max-w-[160px] truncate">{e.customerName}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs font-normal whitespace-nowrap">{cat}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(e.totalAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-500">{getWorkChallan(e) > 0 ? formatCurrency(getWorkChallan(e)) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700 font-medium">{formatCurrency(e.paidAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {due > 0 ? <span className="text-amber-700 font-medium">{formatCurrency(due)}</span>
                        : due < 0 ? <span className="text-emerald-700 text-xs">+{formatCurrency(-due)}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell><StatusBadge status={e.status} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {sorted.length > 0 && <div className="px-4 py-2 border-t text-xs text-muted-foreground">{sorted.length} entries{search ? ` (filtered)` : ''}</div>}
      </Card>

      {/* Category breakdown (collapsible) */}
      <Card>
        <button
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors"
          onClick={() => setShowCategory(v => !v)}
        >
          <span className="font-semibold text-sm">Category-wise Breakdown</span>
          {showCategory ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {showCategory && (
          <div className="border-t">
            {catRows.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">No category data in this period.</div>
            ) : (
              <div className="divide-y">
                {catRows.map(r => (
                  <div key={r.category} className="flex items-center justify-between px-4 py-3 hover:bg-muted/20">
                    <div>
                      <div className="font-medium text-sm">{r.category}</div>
                      <div className="text-xs text-muted-foreground">{r.count} entries</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-sm text-primary">{formatCurrency(r.netProfit)} profit</div>
                      <div className="text-xs text-muted-foreground">{formatCurrency(r.collected)} collected · {r.challan > 0 ? `${formatCurrency(r.challan)} challan` : 'no challan'}</div>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between px-4 py-3 bg-muted/20 font-semibold text-sm">
                  <span>Total ({catRows.reduce((s, r) => s + r.count, 0)} entries)</span>
                  <span className="text-primary">{formatCurrency(catRows.reduce((s, r) => s + r.netProfit, 0))} profit</span>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3 — Financial Services (chip selector)
// ─────────────────────────────────────────────────────────────────────────────

function AepsSection({ entries, dateRange }: { entries: AepsWithdrawal[]; dateRange: DateRangeState }) {
  const [search, setSearch] = useState('');
  const sort = useSortState('date');
  const Th = makeTh(sort);
  const paid        = entries.filter(e => resolveStatus(e.paymentStatus) === 'paid');
  const totalAmount = paid.reduce((s, e) => s + e.amount, 0);
  const totalProfit = paid.reduce((s, e) => s + e.profitMargin, 0);
  const trendData   = useMemo(() => buildDailyTrend(paid.map(e => ({ ts: e.createdAt.toDate(), value: e.profitMargin })), dateRange.from, dateRange.to), [paid, dateRange]);
  const filtered    = useMemo(() => { const q = search.toLowerCase(); return entries.filter(e => !search || (e.customerName ?? '').toLowerCase().includes(q) || e.bankName.toLowerCase().includes(q)); }, [entries, search]);
  const getValue    = useCallback((e: AepsWithdrawal, col: string): string | number => { switch (col) { case 'date': return e.createdAt.toMillis(); case 'customer': return e.customerName ?? ''; case 'bank': return e.bankName; case 'amount': return e.amount; case 'profit': return e.profitMargin; default: return 0; } }, []);
  const sorted      = useMemo(() => sortRows(filtered, sort.col, sort.dir, getValue), [filtered, sort.col, sort.dir, getValue]);
  const exportCSV   = () => downloadCSV(`aeps-${format(new Date(), 'yyyy-MM-dd')}.csv`, [['Date','Customer','Bank','Amount','Profit'], ...sorted.map(e => [format(e.createdAt.toDate(),'dd/MM/yyyy'),e.customerName ?? '',e.bankName,String(e.amount),String(e.profitMargin)])]);

  return (
    <div className="space-y-4">
      <StatCards items={[
        { label: 'Total Withdrawals', value: String(entries.length) },
        { label: 'Total Amount',      value: formatCurrency(totalAmount), cls: 'text-emerald-700', info: "Customer's own money — not shop earnings" },
        { label: 'Shop Earnings',     value: formatCurrency(totalProfit), cls: 'text-primary font-bold', info: 'Fee earned on each withdrawal' },
      ]} />
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Daily Profit</CardTitle></CardHeader><CardContent><DailyTrendChart data={trendData} color="#10b981" label="Earnings" /></CardContent></Card>
      <div className="flex flex-col sm:flex-row gap-2 justify-between">
        <div className="relative flex-1 max-w-sm"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search by customer or bank…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-10" /></div>
        <Button variant="outline" size="sm" className="gap-1.5 h-10" onClick={exportCSV}><Download className="h-4 w-4" /> CSV Download</Button>
      </div>
      {/* Mobile cards */}
      <div className="block sm:hidden space-y-2">
        {sorted.length === 0 ? <div className="text-center py-8 text-muted-foreground text-sm">No data in this period.</div>
          : sorted.map(e => (
            <Card key={e.id}><CardContent className="p-4">
              <div className="flex justify-between items-start">
                <div><div className="font-semibold text-sm">{e.customerName}</div><div className="text-xs text-muted-foreground">{format(e.createdAt.toDate(),'dd MMM yyyy')} · {e.bankName}</div></div>
                <div className="text-right"><div className="font-semibold text-sm text-emerald-700">{formatCurrency(e.profitMargin)}</div><div className="text-xs text-muted-foreground">Amount: {formatCurrency(e.amount)}</div></div>
              </div>
            </CardContent></Card>
          ))}
      </div>
      {/* Desktop table */}
      <Card className="hidden sm:block"><div className="overflow-x-auto"><Table><TableHeader><TableRow><Th col="date" label="Date"/><Th col="customer" label="Customer"/><Th col="bank" label="Bank"/><Th col="amount" label="Amount" align="right"/><Th col="profit" label="Earnings" align="right"/></TableRow></TableHeader><TableBody>{sorted.length===0?<TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">No data in this period.</TableCell></TableRow>:sorted.map(e=><TableRow key={e.id} className="hover:bg-muted/30"><TableCell className="text-xs text-muted-foreground whitespace-nowrap">{format(e.createdAt.toDate(),'dd MMM yyyy')}</TableCell><TableCell className="font-medium">{e.customerName}</TableCell><TableCell className="text-muted-foreground">{e.bankName}</TableCell><TableCell className="text-right tabular-nums font-medium">{formatCurrency(e.amount)}</TableCell><TableCell className="text-right tabular-nums text-emerald-700 font-semibold">{formatCurrency(e.profitMargin)}</TableCell></TableRow>)}</TableBody></Table></div>{sorted.length>0&&<div className="px-4 py-2 border-t text-xs text-muted-foreground">{sorted.length} transactions</div>}</Card>
    </div>
  );
}

function RechargeSection({ entries, dateRange }: { entries: ElectricRecharge[]; dateRange: DateRangeState }) {
  const [search, setSearch] = useState('');
  const sort = useSortState('date');
  const Th = makeTh(sort);
  const paid        = entries.filter(e => resolveStatus(e.paymentStatus) === 'paid');
  const totalAmount = paid.reduce((s, e) => s + e.rechargeAmount, 0);
  const totalProfit = paid.reduce((s, e) => s + e.profitMargin, 0);
  const trendData   = useMemo(() => buildDailyTrend(paid.map(e => ({ ts: e.createdAt.toDate(), value: e.profitMargin })), dateRange.from, dateRange.to), [paid, dateRange]);
  const filtered    = useMemo(() => { const q = search.toLowerCase(); return entries.filter(e => !search || (e.customerName ?? '').toLowerCase().includes(q) || e.consumerNumber.includes(q)); }, [entries, search]);
  const getValue    = useCallback((e: ElectricRecharge, col: string): string | number => { switch (col) { case 'date': return e.createdAt.toMillis(); case 'customer': return e.customerName ?? ''; case 'consumer': return e.consumerNumber; case 'amount': return e.rechargeAmount; case 'profit': return e.profitMargin; default: return 0; } }, []);
  const sorted      = useMemo(() => sortRows(filtered, sort.col, sort.dir, getValue), [filtered, sort.col, sort.dir, getValue]);
  const exportCSV   = () => downloadCSV(`recharge-${format(new Date(), 'yyyy-MM-dd')}.csv`, [['Date','Customer','Consumer No','Recharge Amt','Profit'], ...sorted.map(e => [format(e.createdAt.toDate(),'dd/MM/yyyy'),e.customerName ?? '',e.consumerNumber,String(e.rechargeAmount),String(e.profitMargin)])]);

  return (
    <div className="space-y-4">
      <StatCards items={[
        { label: 'Total Recharges',  value: String(entries.length) },
        { label: 'Total Recharged',  value: formatCurrency(totalAmount), cls: 'text-emerald-700', info: "Customer's electricity recharge amount" },
        { label: 'Shop Earnings',    value: formatCurrency(totalProfit), cls: 'text-primary font-bold', info: 'Fee earned on each recharge' },
      ]} />
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Daily Profit</CardTitle></CardHeader><CardContent><DailyTrendChart data={trendData} color="#f59e0b" label="Earnings" /></CardContent></Card>
      <div className="flex flex-col sm:flex-row gap-2 justify-between">
        <div className="relative flex-1 max-w-sm"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search by customer or consumer no…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-10" /></div>
        <Button variant="outline" size="sm" className="gap-1.5 h-10" onClick={exportCSV}><Download className="h-4 w-4" /> CSV Download</Button>
      </div>
      <div className="block sm:hidden space-y-2">
        {sorted.length === 0 ? <div className="text-center py-8 text-muted-foreground text-sm">No data in this period.</div>
          : sorted.map(e => (<Card key={e.id}><CardContent className="p-4"><div className="flex justify-between items-start"><div><div className="font-semibold text-sm">{e.customerName}</div><div className="text-xs text-muted-foreground">{format(e.createdAt.toDate(),'dd MMM yyyy')} · {e.consumerNumber}</div></div><div className="text-right"><div className="font-semibold text-sm text-emerald-700">{formatCurrency(e.profitMargin)}</div><div className="text-xs text-muted-foreground">{formatCurrency(e.rechargeAmount)}</div></div></div></CardContent></Card>))}
      </div>
      <Card className="hidden sm:block"><div className="overflow-x-auto"><Table><TableHeader><TableRow><Th col="date" label="Date"/><Th col="customer" label="Customer"/><Th col="consumer" label="Consumer No"/><Th col="amount" label="Recharge Amt" align="right"/><Th col="profit" label="Earnings" align="right"/></TableRow></TableHeader><TableBody>{sorted.length===0?<TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">No data in this period.</TableCell></TableRow>:sorted.map(e=><TableRow key={e.id} className="hover:bg-muted/30"><TableCell className="text-xs text-muted-foreground whitespace-nowrap">{format(e.createdAt.toDate(),'dd MMM yyyy')}</TableCell><TableCell className="font-medium">{e.customerName}</TableCell><TableCell className="text-muted-foreground font-mono text-sm">{e.consumerNumber}</TableCell><TableCell className="text-right tabular-nums font-medium">{formatCurrency(e.rechargeAmount)}</TableCell><TableCell className="text-right tabular-nums text-emerald-700 font-semibold">{formatCurrency(e.profitMargin)}</TableCell></TableRow>)}</TableBody></Table></div>{sorted.length>0&&<div className="px-4 py-2 border-t text-xs text-muted-foreground">{sorted.length} transactions</div>}</Card>
    </div>
  );
}

function TransferSection({ entries, dateRange }: { entries: MoneyTransfer[]; dateRange: DateRangeState }) {
  const [search, setSearch] = useState('');
  const sort = useSortState('date');
  const Th = makeTh(sort);
  const paid        = entries.filter(e => resolveStatus(e.paymentStatus) === 'paid');
  const totalAmount = paid.reduce((s, e) => s + e.amount, 0);
  const totalProfit = paid.reduce((s, e) => s + e.profitMargin, 0);
  const trendData   = useMemo(() => buildDailyTrend(paid.map(e => ({ ts: e.createdAt.toDate(), value: e.profitMargin })), dateRange.from, dateRange.to), [paid, dateRange]);
  const filtered    = useMemo(() => { const q = search.toLowerCase(); return entries.filter(e => !search || e.name.toLowerCase().includes(q) || e.mobileOrAccount.includes(q)); }, [entries, search]);
  const getValue    = useCallback((e: MoneyTransfer, col: string): string | number => { switch (col) { case 'date': return e.createdAt.toMillis(); case 'name': return e.name; case 'account': return e.mobileOrAccount; case 'amount': return e.amount; case 'profit': return e.profitMargin; default: return 0; } }, []);
  const sorted      = useMemo(() => sortRows(filtered, sort.col, sort.dir, getValue), [filtered, sort.col, sort.dir, getValue]);
  const exportCSV   = () => downloadCSV(`transfer-${format(new Date(), 'yyyy-MM-dd')}.csv`, [['Date','Name','Mobile/Account','Amount','Profit'], ...sorted.map(e => [format(e.createdAt.toDate(),'dd/MM/yyyy'),e.name,e.mobileOrAccount,String(e.amount),String(e.profitMargin)])]);

  return (
    <div className="space-y-4">
      <StatCards items={[
        { label: 'Total Transfers',   value: String(entries.length) },
        { label: 'Total Transferred', value: formatCurrency(totalAmount), cls: 'text-emerald-700', info: "Customer's money that was transferred" },
        { label: 'Shop Earnings',     value: formatCurrency(totalProfit), cls: 'text-primary font-bold', info: 'Fee earned on each transfer' },
      ]} />
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Daily Profit</CardTitle></CardHeader><CardContent><DailyTrendChart data={trendData} color="#8b5cf6" label="Earnings" /></CardContent></Card>
      <div className="flex flex-col sm:flex-row gap-2 justify-between">
        <div className="relative flex-1 max-w-sm"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search by name or account…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-10" /></div>
        <Button variant="outline" size="sm" className="gap-1.5 h-10" onClick={exportCSV}><Download className="h-4 w-4" /> CSV Download</Button>
      </div>
      <div className="block sm:hidden space-y-2">
        {sorted.length === 0 ? <div className="text-center py-8 text-muted-foreground text-sm">No data in this period.</div>
          : sorted.map(e => (<Card key={e.id}><CardContent className="p-4"><div className="flex justify-between items-start"><div><div className="font-semibold text-sm">{e.name}</div><div className="text-xs text-muted-foreground">{format(e.createdAt.toDate(),'dd MMM yyyy')} · {e.mobileOrAccount}</div></div><div className="text-right"><div className="font-semibold text-sm text-emerald-700">{formatCurrency(e.profitMargin)}</div><div className="text-xs text-muted-foreground">{formatCurrency(e.amount)}</div></div></div></CardContent></Card>))}
      </div>
      <Card className="hidden sm:block"><div className="overflow-x-auto"><Table><TableHeader><TableRow><Th col="date" label="Date"/><Th col="name" label="Name"/><Th col="account" label="Mobile/Account"/><Th col="amount" label="Amount" align="right"/><Th col="profit" label="Earnings" align="right"/></TableRow></TableHeader><TableBody>{sorted.length===0?<TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">No data in this period.</TableCell></TableRow>:sorted.map(e=><TableRow key={e.id} className="hover:bg-muted/30"><TableCell className="text-xs text-muted-foreground whitespace-nowrap">{format(e.createdAt.toDate(),'dd MMM yyyy')}</TableCell><TableCell className="font-medium">{e.name}</TableCell><TableCell className="text-muted-foreground font-mono text-sm">{e.mobileOrAccount}</TableCell><TableCell className="text-right tabular-nums font-medium">{formatCurrency(e.amount)}</TableCell><TableCell className="text-right tabular-nums text-emerald-700 font-semibold">{formatCurrency(e.profitMargin)}</TableCell></TableRow>)}</TableBody></Table></div>{sorted.length>0&&<div className="px-4 py-2 border-t text-xs text-muted-foreground">{sorted.length} transactions</div>}</Card>
    </div>
  );
}

function QuickSection({ entries }: { entries: QuickActionEntry[] }) {
  const sort = useSortState('count');
  const Th = makeTh(sort);
  const paid       = entries.filter(e => resolveStatus(e.paymentStatus) === 'paid');
  const grandTotal = paid.reduce((s, e) => s + e.amount, 0);
  const rows       = useMemo(() => { const map: Record<string, { category: string; count: number; total: number }> = {}; paid.forEach(e => { if (!map[e.category]) map[e.category] = { category: e.category, count: 0, total: 0 }; map[e.category].count++; map[e.category].total += e.amount; }); return Object.values(map); }, [paid]);
  const getValue   = useCallback((r: { category: string; count: number; total: number }, col: string): string | number => { switch (col) { case 'category': return r.category; case 'count': return r.count; case 'total': return r.total; default: return 0; } }, []);
  const sorted     = useMemo(() => sortRows(rows, sort.col, sort.dir, getValue), [rows, sort.col, sort.dir, getValue]);
  const exportCSV  = () => downloadCSV(`quick-work-${format(new Date(), 'yyyy-MM-dd')}.csv`, [['Category','Count','Total (₹)'], ...sorted.map(r => [r.category, String(r.count), String(r.total)])]);

  return (
    <div className="space-y-4">
      <StatCards items={[
        { label: 'Total Jobs',    value: String(entries.length) },
        { label: 'Paid Jobs',     value: String(paid.length) },
        { label: 'Total Earnings', value: formatCurrency(grandTotal), cls: 'text-primary font-bold', info: 'Amount earned from Quick Work' },
      ]} />
      <div className="flex justify-end"><Button variant="outline" size="sm" className="gap-1.5 h-10" onClick={exportCSV}><Download className="h-4 w-4" /> CSV Download</Button></div>
      {/* Mobile: category cards */}
      <div className="block sm:hidden space-y-2">
        {sorted.length === 0 ? <div className="text-center py-8 text-muted-foreground text-sm">No data in this period.</div>
          : sorted.map(r => (<Card key={r.category}><CardContent className="p-4 flex justify-between items-center"><div><div className="font-semibold text-sm">{r.category}</div><div className="text-xs text-muted-foreground">{r.count} entries</div></div><div className="font-semibold text-emerald-700">{formatCurrency(r.total)}</div></CardContent></Card>))}
      </div>
      <Card className="hidden sm:block"><div className="overflow-x-auto"><Table><TableHeader><TableRow><Th col="category" label="Category"/><Th col="count" label="Count" align="right"/><Th col="total" label="Total" align="right"/></TableRow></TableHeader><TableBody>{sorted.length===0?<TableRow><TableCell colSpan={3} className="text-center py-10 text-muted-foreground">No data in this period.</TableCell></TableRow>:sorted.map(r=><TableRow key={r.category} className="hover:bg-muted/30"><TableCell className="font-medium">{r.category}</TableCell><TableCell className="text-right tabular-nums">{r.count}</TableCell><TableCell className="text-right tabular-nums text-emerald-700 font-semibold">{formatCurrency(r.total)}</TableCell></TableRow>)}</TableBody></Table></div>{sorted.length>0&&<div className="px-4 py-3 border-t bg-muted/20 flex justify-between text-sm font-semibold"><span>Total ({paid.length})</span><span className="text-primary">{formatCurrency(grandTotal)}</span></div>}</Card>
    </div>
  );
}

function FlightSection({ entries, dateRange }: { entries: FlightBooking[]; dateRange: DateRangeState }) {
  const [search, setSearch] = useState('');
  const sort = useSortState('date');
  const Th = makeTh(sort);
  const paid          = entries.filter(e => resolveStatus(e.paymentStatus) === 'paid');
  const pending       = entries.filter(e => resolveStatus(e.paymentStatus) === 'pending');
  const totalProfit   = paid.reduce((s, e) => s + e.profitMargin, 0);
  const totalCharged  = paid.reduce((s, e) => s + e.amountCharged, 0);
  const pendingAmount = pending.reduce((s, e) => s + e.amountCharged, 0);
  const trendData   = useMemo(() => buildDailyTrend(paid.map(e => ({ ts: e.createdAt.toDate(), value: e.profitMargin })), dateRange.from, dateRange.to), [paid, dateRange]);
  const filtered    = useMemo(() => { const q = search.toLowerCase(); return entries.filter(e => !search || (e.customerName ?? '').toLowerCase().includes(q) || e.flightFrom.toLowerCase().includes(q) || e.flightTo.toLowerCase().includes(q)); }, [entries, search]);
  const getValue    = useCallback((e: FlightBooking, col: string): string | number => { switch (col) { case 'date': return e.createdAt.toMillis(); case 'customer': return e.customerName ?? ''; case 'from': return e.flightFrom; case 'to': return e.flightTo; case 'boarding': return e.boardingDate; case 'fare': return e.actualFare; case 'charged': return e.amountCharged; case 'profit': return e.profitMargin; default: return 0; } }, []);
  const sorted      = useMemo(() => sortRows(filtered, sort.col, sort.dir, getValue), [filtered, sort.col, sort.dir, getValue]);
  const exportCSV   = () => downloadCSV(`flight-${format(new Date(), 'yyyy-MM-dd')}.csv`, [['Date','Customer','From','To','Boarding','Actual Fare','Charged','Profit','Added By'], ...sorted.map(e => [format(e.createdAt.toDate(),'dd/MM/yyyy HH:mm'),e.customerName ?? '',e.flightFrom,e.flightTo,e.boardingDate,String(e.actualFare),String(e.amountCharged),String(e.profitMargin),e.addedBy ?? ''])]);

  return (
    <div className="space-y-4">
      <StatCards items={[
        { label: 'Total Bookings',  value: String(entries.length), sub: pending.length > 0 ? `${paid.length} paid · ${pending.length} pending` : undefined },
        { label: 'Total Charged',   value: formatCurrency(totalCharged), cls: 'text-emerald-700', info: 'Amount charged for paid bookings only' },
        { label: 'Shop Earnings',   value: formatCurrency(totalProfit),  cls: 'text-primary font-bold', info: 'Charged minus Actual Fare = actual profit (paid only)' },
        ...(pendingAmount > 0 ? [{ label: 'Pending Dues', value: formatCurrency(pendingAmount), cls: 'text-amber-700', info: 'Amount still owed by customers with Due payment mode' }] : []),
      ]} />
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Daily Profit</CardTitle></CardHeader><CardContent><DailyTrendChart data={trendData} color="#f43f5e" label="Earnings" /></CardContent></Card>
      <div className="flex flex-col sm:flex-row gap-2 justify-between">
        <div className="relative flex-1 max-w-sm"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search by customer or route…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-10" /></div>
        <Button variant="outline" size="sm" className="gap-1.5 h-10" onClick={exportCSV}><Download className="h-4 w-4" /> CSV Download</Button>
      </div>
      <div className="block sm:hidden space-y-2">
        {sorted.length === 0 ? <div className="text-center py-8 text-muted-foreground text-sm">No data in this period.</div>
          : sorted.map(e => (<Card key={e.id}><CardContent className="p-4"><div className="flex justify-between items-start mb-1"><div><div className="font-semibold text-sm">{e.customerName}</div><div className="text-xs text-muted-foreground">{e.flightFrom} → {e.flightTo} · {e.boardingDate ? format(new Date(e.boardingDate+'T00:00:00'),'dd MMM') : '—'}</div></div><div className="text-right"><div className="font-semibold text-sm text-emerald-700">{formatCurrency(e.profitMargin)}</div><div className="text-xs text-muted-foreground">Charged: {formatCurrency(e.amountCharged)}</div></div></div></CardContent></Card>))}
      </div>
      <Card className="hidden sm:block"><div className="overflow-x-auto"><Table><TableHeader><TableRow><Th col="date" label="Date"/><Th col="customer" label="Customer"/><Th col="from" label="From"/><Th col="to" label="To"/><Th col="boarding" label="Boarding"/><Th col="fare" label="Actual Fare" align="right"/><Th col="charged" label="Charged" align="right"/><Th col="profit" label="Earnings" align="right"/></TableRow></TableHeader><TableBody>{sorted.length===0?<TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">No data in this period.</TableCell></TableRow>:sorted.map(e=><TableRow key={e.id} className="hover:bg-muted/30"><TableCell className="text-xs text-muted-foreground whitespace-nowrap">{format(e.createdAt.toDate(),'dd MMM yyyy')}</TableCell><TableCell className="font-medium">{e.customerName}</TableCell><TableCell className="text-muted-foreground">{e.flightFrom}</TableCell><TableCell className="text-muted-foreground">{e.flightTo}</TableCell><TableCell className="text-muted-foreground whitespace-nowrap">{e.boardingDate?format(new Date(e.boardingDate+'T00:00:00'),'dd MMM yyyy'):'—'}</TableCell><TableCell className="text-right tabular-nums">{formatCurrency(e.actualFare)}</TableCell><TableCell className="text-right tabular-nums">{formatCurrency(e.amountCharged)}</TableCell><TableCell className="text-right tabular-nums text-emerald-700 font-semibold">{formatCurrency(e.profitMargin)}</TableCell></TableRow>)}</TableBody></Table></div>{sorted.length>0&&<div className="px-4 py-2 border-t text-xs text-muted-foreground">{sorted.length} bookings</div>}</Card>
    </div>
  );
}

const FINANCIAL_CHIPS: { key: FinancialKey; label: string; color: string }[] = [
  { key: 'aeps',     label: 'AEPS',     color: '#10b981' },
  { key: 'recharge', label: 'Recharge', color: '#f59e0b' },
  { key: 'transfer', label: 'Transfer', color: '#8b5cf6' },
  { key: 'quick',    label: 'Quick Work',color: '#06b6d4' },
  { key: 'flight',   label: 'Flight',   color: '#f43f5e' },
];

function FinancialTab({
  aeps, recharge, transfer, quick, flight, dateRange,
}: {
  aeps: AepsWithdrawal[]; recharge: ElectricRecharge[];
  transfer: MoneyTransfer[]; quick: QuickActionEntry[]; flight: FlightBooking[];
  dateRange: DateRangeState;
}) {
  const [active, setActive] = useState<FinancialKey>('aeps');

  // Summary totals for chip badges
  const summaries: Record<FinancialKey, number> = {
    aeps:     aeps.filter(e => resolveStatus(e.paymentStatus) === 'paid').reduce((s, e) => s + e.profitMargin, 0),
    recharge: recharge.filter(e => resolveStatus(e.paymentStatus) === 'paid').reduce((s, e) => s + e.profitMargin, 0),
    transfer: transfer.filter(e => resolveStatus(e.paymentStatus) === 'paid').reduce((s, e) => s + e.profitMargin, 0),
    quick:    quick.filter(e => resolveStatus(e.paymentStatus) === 'paid').reduce((s, e) => s + e.amount, 0),
    flight:   flight.filter(e => resolveStatus(e.paymentStatus) === 'paid').reduce((s, e) => s + e.profitMargin, 0),
  };

  return (
    <div className="space-y-5">
      {/* Chip selector */}
      <div className="flex flex-wrap gap-2">
        {FINANCIAL_CHIPS.map(chip => (
          <button
            key={chip.key}
            onClick={() => setActive(chip.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-all ${
              active === chip.key
                ? 'text-white border-transparent shadow-sm'
                : 'bg-card text-foreground border-border hover:border-muted-foreground'
            }`}
            style={active === chip.key ? { backgroundColor: chip.color, borderColor: chip.color } : {}}
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: chip.color }} />
            {chip.label}
            {summaries[chip.key] > 0 && (
              <span className={`text-xs tabular-nums ${active === chip.key ? 'text-white/80' : 'text-muted-foreground'}`}>
                {formatCurrency(summaries[chip.key])}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Section content */}
      {active === 'aeps'     && <AepsSection     entries={aeps}     dateRange={dateRange} />}
      {active === 'recharge' && <RechargeSection entries={recharge} dateRange={dateRange} />}
      {active === 'transfer' && <TransferSection entries={transfer} dateRange={dateRange} />}
      {active === 'quick'    && <QuickSection    entries={quick} />}
      {active === 'flight'   && <FlightSection   entries={flight}   dateRange={dateRange} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 4 — Staff-wise Profit
// ─────────────────────────────────────────────────────────────────────────────

interface StaffStat {
  name: string;
  workCount: number;   workProfit: number;   workDue: number;
  aepsCount: number;   aepsProfit: number;
  rechargeCount: number; rechargeProfit: number;
  transferCount: number; transferProfit: number;
  quickCount: number;  quickProfit: number;
  flightCount: number; flightProfit: number; flightDue: number;
  totalEntries: number;
  totalProfit: number;
  totalDue: number;
}

function StaffTab({
  work, aeps, recharge, transfer, quick, flight, isOwner, currentDisplayName,
}: {
  work: WorkEntry[]; aeps: AepsWithdrawal[]; recharge: ElectricRecharge[];
  transfer: MoneyTransfer[]; quick: QuickActionEntry[]; flight: FlightBooking[];
  isOwner: boolean; currentDisplayName: string;
}) {
  const [expandedName, setExpandedName] = useState<string | null>(null);

  const staffStats = useMemo<StaffStat[]>(() => {
    const map = new Map<string, StaffStat>();

    const ensure = (name: string) => {
      if (!map.has(name)) map.set(name, {
        name, workCount: 0, workProfit: 0, workDue: 0,
        aepsCount: 0, aepsProfit: 0, rechargeCount: 0, rechargeProfit: 0,
        transferCount: 0, transferProfit: 0, quickCount: 0, quickProfit: 0,
        flightCount: 0, flightProfit: 0, flightDue: 0, totalEntries: 0, totalProfit: 0, totalDue: 0,
      });
      return map.get(name)!;
    };

    // Work entries (non-rejected, paid portion)
    work.filter(e => e.status !== 'Rejected').forEach(e => {
      const s = ensure(e.addedBy || 'Unknown');
      const profit = e.paidAmount - getWorkChallan(e);
      s.workCount++;
      s.workProfit += profit;
      s.workDue += Math.max(0, e.dueAmount);
    });

    // AEPS (paid only)
    aeps.filter(e => resolveStatus(e.paymentStatus) === 'paid').forEach(e => {
      const s = ensure(e.addedBy || 'Unknown');
      s.aepsCount++;
      s.aepsProfit += e.profitMargin;
    });

    // Recharge (paid only)
    recharge.filter(e => resolveStatus(e.paymentStatus) === 'paid').forEach(e => {
      const s = ensure(e.addedBy || 'Unknown');
      s.rechargeCount++;
      s.rechargeProfit += e.profitMargin;
    });

    // Transfer (paid only)
    transfer.filter(e => resolveStatus(e.paymentStatus) === 'paid').forEach(e => {
      const s = ensure(e.addedBy || 'Unknown');
      s.transferCount++;
      s.transferProfit += e.profitMargin;
    });

    // Quick Work (paid only)
    quick.filter(e => resolveStatus(e.paymentStatus) === 'paid').forEach(e => {
      const s = ensure(e.addedBy || 'Unknown');
      s.quickCount++;
      s.quickProfit += e.amount;
    });

    // Flight Booking (paid only — same pattern as other services)
    flight.filter(e => resolveStatus(e.paymentStatus) === 'paid').forEach(e => {
      const s = ensure(e.addedBy || 'Unknown');
      s.flightCount++;
      s.flightProfit += e.profitMargin;
    });

    // Flight Booking — track pending dues per staff
    flight.filter(e => resolveStatus(e.paymentStatus) === 'pending').forEach(e => {
      const s = ensure(e.addedBy || 'Unknown');
      s.flightDue += e.amountCharged;
    });

    // Compute totals
    map.forEach(s => {
      s.totalEntries = s.workCount + s.aepsCount + s.rechargeCount + s.transferCount + s.quickCount + s.flightCount;
      s.totalProfit  = s.workProfit + s.aepsProfit + s.rechargeProfit + s.transferProfit + s.quickProfit + s.flightProfit;
      s.totalDue     = s.workDue + s.flightDue;
    });

    return Array.from(map.values()).sort((a, b) => b.totalProfit - a.totalProfit);
  }, [work, aeps, recharge, transfer, quick, flight]);

  // Role-based filter: staff only sees own card
  const visibleStats = isOwner ? staffStats : staffStats.filter(s => s.name === currentDisplayName);

  if (visibleStats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
        <Users className="h-10 w-10 opacity-20" />
        <p className="text-sm">No entries in this period.</p>
      </div>
    );
  }

  const breakdown = (s: StaffStat) => [
    { label: 'Work',    count: s.workCount,     profit: s.workProfit,     color: SOURCE_COLORS['Work'] },
    { label: 'AEPS',   count: s.aepsCount,     profit: s.aepsProfit,     color: SOURCE_COLORS['AEPS'] },
    { label: 'Recharge', count: s.rechargeCount, profit: s.rechargeProfit, color: SOURCE_COLORS['Recharge'] },
    { label: 'Transfer', count: s.transferCount, profit: s.transferProfit, color: SOURCE_COLORS['Transfer'] },
    { label: 'Quick',  count: s.quickCount,    profit: s.quickProfit,    color: SOURCE_COLORS['Quick Work'] },
    { label: 'Flight', count: s.flightCount,   profit: s.flightProfit,   color: SOURCE_COLORS['Flight Booking'] },
  ].filter(b => b.count > 0);

  return (
    <div className="space-y-4">
      {!isOwner && (
        <div className="flex items-center gap-2 rounded-lg border bg-blue-50 px-4 py-3 text-sm text-blue-700">
          <Info className="h-4 w-4 shrink-0" />
          <span>Showing your own performance only.</span>
        </div>
      )}
      {isOwner && (
        <p className="text-xs text-muted-foreground">
          {visibleStats.length} staff members · Sorted by highest earners · Paid entries only
        </p>
      )}

      {visibleStats.map((s, idx) => (
        <Card key={s.name} className={idx === 0 && isOwner ? 'border-primary/30 bg-primary/5' : ''}>
          {/* Card header — tappable to expand */}
          <button
            className="w-full text-left px-5 py-4 hover:bg-muted/20 transition-colors"
            onClick={() => setExpandedName(expandedName === s.name ? null : s.name)}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 font-bold text-white text-sm ${idx === 0 && isOwner ? 'bg-primary' : 'bg-slate-400'}`}>
                  {s.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-sm flex items-center gap-2">
                    {s.name}
                    {idx === 0 && isOwner && <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">Top Performer</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{s.totalEntries} entries</div>
                </div>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right">
                  <div className="font-bold text-base text-emerald-700">{formatCurrency(s.totalProfit)}</div>
                  <div className="text-xs text-muted-foreground">earnings</div>
                </div>
                {s.totalDue > 0 && (
                  <div className="text-right">
                    <div className="font-semibold text-sm text-amber-700">{formatCurrency(s.totalDue)}</div>
                    <div className="text-xs text-muted-foreground">due</div>
                  </div>
                )}
                <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expandedName === s.name ? 'rotate-90' : ''}`} />
              </div>
            </div>
          </button>

          {/* Expanded source breakdown */}
          {expandedName === s.name && (
            <div className="border-t px-5 py-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Source-wise Breakdown</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {breakdown(s).map(b => (
                  <div key={b.label} className="rounded-lg border p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ background: b.color }} />
                      <span className="text-xs font-medium text-muted-foreground">{b.label}</span>
                    </div>
                    <div className="font-semibold text-sm">{formatCurrency(b.profit)}</div>
                    <div className="text-xs text-muted-foreground">{b.count} entries</div>
                  </div>
                ))}
              </div>
              {s.totalDue > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  <span className="text-amber-700">{formatCurrency(s.totalDue)} outstanding dues</span>
                </div>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

const MAIN_TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'overview',   label: 'Overview',          icon: LayoutDashboard },
  { key: 'work',       label: 'Work',               icon: Briefcase },
  { key: 'financial',  label: 'Financial Services', icon: BarChart3 },
  { key: 'staff',      label: 'Staff',              icon: Users },
];

export default function ReportsPage() {
  const { isOwner, displayName } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  const [workEntries,     setWorkEntries]     = useState<WorkEntry[]>([]);
  const [aepsEntries,     setAepsEntries]     = useState<AepsWithdrawal[]>([]);
  const [rechargeEntries, setRechargeEntries] = useState<ElectricRecharge[]>([]);
  const [transferEntries, setTransferEntries] = useState<MoneyTransfer[]>([]);
  const [quickEntries,    setQuickEntries]    = useState<QuickActionEntry[]>([]);
  const [flightEntries,   setFlightEntries]   = useState<FlightBooking[]>([]);
  const [loading, setLoading] = useState(true);

  const [dateRange, setDateRange] = useState<DateRangeState>(() => {
    const { from, to } = buildPreset('thisMonth');
    return { from, to, preset: 'thisMonth' };
  });

  useEffect(() => {
    let resolved = 0;
    const done = () => { if (++resolved === 6) setLoading(false); };
    const u1 = subscribeToWorkEntries(d => { setWorkEntries(d); done(); });
    const u2 = subscribeToAepsWithdrawals(d => { setAepsEntries(d); done(); });
    const u3 = subscribeToElectricRecharges(d => { setRechargeEntries(d); done(); });
    const u4 = subscribeToMoneyTransfers(d => { setTransferEntries(d); done(); });
    const u5 = subscribeToQuickActions(d => { setQuickEntries(d); done(); }, () => done());
    const u6 = subscribeToFlightBookings(d => { setFlightEntries(d); done(); });
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); };
  }, []);

  // Filter every collection to the selected date range
  const fw = useMemo(() => workEntries    .filter(e => inRange(e.date.toDate(),      dateRange.from, dateRange.to)), [workEntries,     dateRange]);
  const fa = useMemo(() => aepsEntries    .filter(e => inRange(e.createdAt.toDate(), dateRange.from, dateRange.to)), [aepsEntries,     dateRange]);
  const fr = useMemo(() => rechargeEntries.filter(e => inRange(e.createdAt.toDate(), dateRange.from, dateRange.to)), [rechargeEntries, dateRange]);
  const ft = useMemo(() => transferEntries.filter(e => inRange(e.createdAt.toDate(), dateRange.from, dateRange.to)), [transferEntries, dateRange]);
  const fq = useMemo(() => quickEntries   .filter(e => inRange(e.createdAt.toDate(), dateRange.from, dateRange.to)), [quickEntries,    dateRange]);
  const ff = useMemo(() => flightEntries  .filter(e => inRange(e.createdAt.toDate(), dateRange.from, dateRange.to)), [flightEntries,   dateRange]);

  // Access guard — owner only (Staff tab has internal role-based filter)
  if (!isOwner) return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
      <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
        <ShieldCheck className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold">Access Restricted</h2>
      <p className="text-muted-foreground max-w-xs">Reports are only visible to the Owner.</p>
    </div>
  );

  if (loading) return (
    <div className="space-y-6 max-w-6xl">
      <Skeleton className="h-8 w-48" />
      <div className="flex gap-2">{[0,1,2,3].map(i => <Skeleton key={i} className="h-12 flex-1 rounded-xl" />)}</div>
      <div className="flex gap-2 flex-wrap">{[0,1,2,3,4].map(i => <Skeleton key={i} className="h-9 w-24 rounded-lg" />)}</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{[0,1,2,3].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );

  // Compute export all CSV
  const exportAll = () => {
    const label = PRESETS.find(p => p.key === dateRange.preset)?.label ?? `${format(dateRange.from,'dd MMM')}–${format(dateRange.to,'dd MMM yyyy')}`;
    downloadCSV(`full-report-${format(new Date(), 'yyyy-MM-dd')}.csv`, [
      [`AZAAN CSC — Full Report (${label})`],
      [],
      ['=== WORK ENTRIES ==='],
      ['Date','Customer','Category','Total','Challan','Paid','Due','Status','Added By'],
      ...fw.map(e => [format(e.date.toDate(),'dd/MM/yyyy'),e.customerName,e.category,String(e.totalAmount),String(getWorkChallan(e)),String(e.paidAmount),String(e.dueAmount),e.status,e.addedBy??'']),
      [],
      ['=== AEPS ==='],
      ['Date','Customer','Bank','Amount','Profit','Added By'],
      ...fa.map(e => [format(e.createdAt.toDate(),'dd/MM/yyyy'),e.customerName,e.bankName,String(e.amount),String(e.profitMargin),e.addedBy??'']),
      [],
      ['=== RECHARGE ==='],
      ['Date','Customer','Consumer No','Recharge Amt','Profit','Added By'],
      ...fr.map(e => [format(e.createdAt.toDate(),'dd/MM/yyyy'),e.customerName,e.consumerNumber,String(e.rechargeAmount),String(e.profitMargin),e.addedBy??'']),
      [],
      ['=== TRANSFER ==='],
      ['Date','Name','Account','Amount','Profit','Added By'],
      ...ft.map(e => [format(e.createdAt.toDate(),'dd/MM/yyyy'),e.name,e.mobileOrAccount,String(e.amount),String(e.profitMargin),e.addedBy??'']),
      [],
      ['=== QUICK WORK ==='],
      ['Date','Category','Amount','Status','Added By'],
      ...fq.map(e => [format(e.createdAt.toDate(),'dd/MM/yyyy'),e.category,String(e.amount),resolveStatus(e.paymentStatus),e.addedBy??'']),
      [],
      ['=== FLIGHT BOOKINGS ==='],
      ['Date','Customer','From','To','Boarding','Actual Fare','Charged','Profit','Added By'],
      ...ff.map(e => [format(e.createdAt.toDate(),'dd/MM/yyyy'),e.customerName,e.flightFrom,e.flightTo,e.boardingDate,String(e.actualFare),String(e.amountCharged),String(e.profitMargin),e.addedBy]),
    ]);
  };

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Page header with Export */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--app-font-display)' }}>Reports</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Earnings, collections and service analytics</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 h-10 shrink-0" onClick={exportAll}>
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">Download All (CSV)</span>
          <span className="sm:hidden">Export</span>
        </Button>
      </div>

      {/* Global date range filter — applies to ALL tabs */}
      <div className="rounded-xl border bg-card p-3">
        <p className="text-xs text-muted-foreground mb-2 font-medium">Select period (applies to all tabs):</p>
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      {/* 4 main tab buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {MAIN_TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1 sm:gap-2 px-3 py-3 rounded-xl border font-medium text-sm transition-all ${
                activeTab === tab.key
                  ? 'bg-primary text-white border-primary shadow-sm'
                  : 'bg-card text-muted-foreground border-border hover:border-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'overview'  && <OverviewTab    work={fw} aeps={fa} recharge={fr} transfer={ft} quick={fq} flight={ff} dateRange={dateRange} />}
      {activeTab === 'work'      && <WorkTab         work={fw} />}
      {activeTab === 'financial' && <FinancialTab    aeps={fa} recharge={fr} transfer={ft} quick={fq} flight={ff} dateRange={dateRange} />}
      {activeTab === 'staff'     && <StaffTab        work={fw} aeps={fa} recharge={fr} transfer={ft} quick={fq} flight={ff} isOwner={isOwner} currentDisplayName={displayName} />}
    </div>
  );
}
