import { useState, useEffect } from 'react';
import { subscribeToWorkEntries, WorkEntry } from '@/lib/firestore';
import { format } from 'date-fns';
import { Link, useLocation } from 'wouter';
import { Search, Clock, Phone, CheckCircle2, BarChart2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useSettings } from '@/contexts/SettingsContext';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { formatCurrency } from '@/lib/format';
import { calendarDaysAgo } from '@/lib/utils';

function PendingSkeleton() {
  return (
    <div className="divide-y">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="p-4 md:p-6 flex flex-col md:flex-row gap-6">
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-4"><Skeleton className="h-5 w-36" /><Skeleton className="h-7 w-28 rounded" /></div>
            <div className="flex gap-3"><Skeleton className="h-5 w-20 rounded-full" /><Skeleton className="h-4 w-24" /></div>
          </div>
          <div className="flex items-center gap-4"><Skeleton className="h-7 w-20 rounded-full" /><Skeleton className="h-9 w-28 rounded" /></div>
        </div>
      ))}
    </div>
  );
}

export default function PendingWorkPage() {
  const [entries, setEntries] = useState<WorkEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const { categories } = useSettings();
  const [, setLocation] = useLocation();

  useEffect(() => {
    const unsubscribe = subscribeToWorkEntries((data) => {
      setEntries(data.filter(e => e.status === 'Pending'));
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const today = new Date();

  // Category summary (all pending entries, before search filter)
  const categorySummary = Object.entries(
    entries.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).sort((a, b) => b[1] - a[1]);

  const filteredEntries = entries
    .map(e => ({ ...e, daysPending: calendarDaysAgo(e.date) }))
    .filter(e => {
      const q = searchTerm.toLowerCase();
      const matchesSearch = !q || e.customerName.toLowerCase().includes(q) || e.mobile.includes(q);
      const matchesCategory = categoryFilter === 'All' || e.category === categoryFilter;
      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => b.daysPending - a.daysPending);

  const handleCategoryClick = (catName: string) => {
    setCategoryFilter(catName === categoryFilter ? 'All' : catName);
    // Scroll to the list
    window.scrollTo({ top: 400, behavior: 'smooth' });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-amber-700 flex items-center gap-2">
            <Clock className="h-6 w-6" />
            Pending Work
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {loading ? 'Loading...' : `${filteredEntries.length} pending ${filteredEntries.length === 1 ? 'entry' : 'entries'}`}
          </p>
        </div>
      </div>

      {/* ── CATEGORY SUMMARY ─────────────────────────────────────────── */}
      {!loading && categorySummary.length > 0 && (
        <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/20">
            <BarChart2 className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Pending by Category</span>
            <span className="text-xs text-muted-foreground ml-1">— click to filter</span>
          </div>
          <div className="p-3 flex flex-wrap gap-2">
            {categorySummary.map(([cat, count]) => {
              const isActive = categoryFilter === cat;
              const maxCount = categorySummary[0][1];
              const pct = Math.round((count / maxCount) * 100);
              return (
                <button
                  key={cat}
                  onClick={() => handleCategoryClick(cat)}
                  className={`group relative flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all text-sm
                    ${isActive
                      ? 'border-primary bg-primary/10 text-primary font-semibold shadow-sm'
                      : 'border-border hover:border-primary/40 hover:bg-muted/50'
                    }`}
                >
                  {/* mini bar indicator */}
                  <div className="flex items-end gap-0.5 h-4 shrink-0">
                    {[100, 70, 40].map((h, i) => (
                      <div
                        key={i}
                        className={`w-1 rounded-sm transition-colors ${isActive ? 'bg-primary' : 'bg-primary/30 group-hover:bg-primary/50'}`}
                        style={{ height: `${Math.round((h / 100) * Math.min(pct, 100))}%`, minHeight: '2px' }}
                      />
                    ))}
                  </div>
                  <span className="truncate max-w-[140px]">{cat}</span>
                  <Badge
                    className={`ml-auto text-xs shrink-0 ${isActive ? 'bg-primary text-primary-foreground' : 'bg-amber-100 text-amber-800 border-transparent'}`}
                  >
                    {count}
                  </Badge>
                </button>
              );
            })}
            {categoryFilter !== 'All' && (
              <button
                onClick={() => setCategoryFilter('All')}
                className="px-3 py-2 rounded-lg border border-dashed border-muted-foreground/40 text-xs text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-colors"
              >
                Clear filter ×
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── SEARCH & FILTER + LIST ────────────────────────────────────── */}
      <div className="bg-card border rounded-lg shadow-sm">
        <div className="p-4 border-b flex flex-col sm:flex-row gap-3 bg-muted/20">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or mobile..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-background"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-[200px] bg-background">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Categories</SelectItem>
              {categories.map(c => (
                <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="divide-y">
          {loading ? (
            <PendingSkeleton />
          ) : filteredEntries.length === 0 ? (
            <div className="p-16 text-center text-muted-foreground">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-50 text-green-600 mb-4">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <p className="text-lg font-medium">
                {entries.length === 0 ? 'No pending work!' : 'No results found'}
              </p>
              <p className="text-sm mt-1">
                {entries.length === 0
                  ? 'All work is completed — great job!'
                  : 'Try clearing your search or category filter'}
              </p>
            </div>
          ) : (
            filteredEntries.map(entry => {
              const isVeryUrgent = entry.daysPending > 7;
              const isUrgent = entry.daysPending >= 3 && entry.daysPending <= 7;
              return (
                <div
                  key={entry.id}
                  className={`p-4 md:p-6 flex flex-col md:flex-row gap-6 transition-colors
                    ${isVeryUrgent ? 'bg-red-50/40 hover:bg-red-50/70' : ''}
                    ${isUrgent ? 'bg-amber-50/40 hover:bg-amber-50/70' : ''}
                    ${!isVeryUrgent && !isUrgent ? 'hover:bg-muted/30' : ''}
                  `}
                >
                  <div className="flex-1 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                      <h3 className="font-bold text-lg">{entry.customerName}</h3>
                      <div className="flex items-center text-muted-foreground text-sm bg-background px-2 py-1 rounded border w-fit">
                        <Phone className="h-3 w-3 mr-1.5" />
                        {entry.mobile}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="secondary">{entry.category}</Badge>
                      <span className="text-muted-foreground">Added: {format(entry.date.toDate(), 'dd MMM yyyy')}</span>
                    </div>
                    {entry.workDetail && (
                      <p className="text-sm text-muted-foreground bg-muted/50 p-2 rounded line-clamp-2">{entry.workDetail}</p>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row md:flex-col justify-between items-end gap-4 min-w-[180px]">
                    <div className="w-full sm:w-auto md:w-full flex justify-between md:justify-end items-center gap-4">
                      <div className={`flex items-center gap-1.5 font-medium px-2.5 py-1 rounded-full text-xs border
                        ${isVeryUrgent ? 'text-red-700 bg-red-100 border-red-200' :
                          isUrgent ? 'text-amber-700 bg-amber-100 border-amber-200' :
                          entry.daysPending === 0 ? 'text-green-700 bg-green-100 border-green-200' :
                          'text-blue-700 bg-blue-100 border-blue-200'}`}>
                        <Clock className="h-3.5 w-3.5" />
                        {entry.daysPending > 0 ? `${entry.daysPending} days` : 'Today'}
                      </div>
                      {entry.dueAmount > 0 && (
                        <div className="text-right">
                          <span className="block text-xs text-red-500 font-medium">Due</span>
                          <span className="font-bold text-red-600 text-lg">{formatCurrency(entry.dueAmount)}</span>
                        </div>
                      )}
                    </div>
                    <Link href={`/work/${entry.id}/edit`} className="w-full sm:w-auto">
                      <Button className="w-full" variant={isVeryUrgent ? 'destructive' : 'default'}>
                        Update Status
                      </Button>
                    </Link>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
