import { useState, useEffect } from 'react';
import { WorkEntry, subscribeToDeletedEntries, restoreWorkEntry } from '@/lib/firestore';
import { format } from 'date-fns';
import { Trash2, RotateCcw, PackageOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/format';

function StatusBadge({ status }: { status: WorkEntry['status'] }) {
  if (status === 'Completed') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
      Completed
    </span>
  );
  if (status === 'Rejected') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700 border border-red-200">
      Rejected
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">
      Pending
    </span>
  );
}

export default function DeletedItemsPage() {
  const [entries, setEntries] = useState<WorkEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const unsubscribe = subscribeToDeletedEntries((data) => {
      setEntries(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleRestore = async (entry: WorkEntry) => {
    if (!entry.id) return;
    setRestoringId(entry.id);
    try {
      await restoreWorkEntry(entry.id);
      toast({
        title: 'Entry Restored',
        description: `${entry.customerName} — ${entry.category} moved back to the active list.`,
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error restoring entry', description: err.message });
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl animate-fade-in-up">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" style={{ fontFamily: 'var(--app-font-display)' }}>
          <Trash2 className="h-5 w-5 text-muted-foreground" />
          Deleted Items
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Deleted entries are kept here safely. Restore any item to bring it back.
        </p>
      </div>

      {/* Info banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
        <PackageOpen className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
        <p><strong>Recycle Bin</strong> — Nothing here is permanently deleted. Click <strong>Restore</strong> to move it back to your active work list.</p>
      </div>

      <div className="bg-card border rounded-xl shadow-card overflow-hidden">
        {loading ? (
          <div className="divide-y">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-4 flex items-center gap-4">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-60" />
                </div>
                <Skeleton className="h-8 w-20 rounded-lg" />
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="p-16 text-center text-muted-foreground flex flex-col items-center">
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-4">
              <PackageOpen className="h-7 w-7 opacity-30" />
            </div>
            <p className="font-medium">Recycle bin is empty</p>
            <p className="text-xs mt-1">Deleted work entries will appear here</p>
          </div>
        ) : (
          <div className="divide-y">
            {entries.map(entry => (
              <div key={entry.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-muted/20 transition-colors">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm">{entry.customerName}</span>
                    <span className="text-xs text-muted-foreground font-mono">{entry.mobile}</span>
                    <StatusBadge status={entry.status} />
                  </div>
                  <div className="flex flex-wrap items-center gap-3 mt-1.5">
                    <Badge variant="secondary" className="font-normal text-xs py-0">{entry.category}</Badge>
                    <span className="text-xs text-muted-foreground">
                      Total: <span className="font-medium text-foreground">{formatCurrency(entry.totalAmount)}</span>
                    </span>
                    {entry.dueAmount > 0 && (
                      <span className="text-xs text-red-600 font-medium">Due: {formatCurrency(entry.dueAmount)}</span>
                    )}
                    <span className="text-xs text-muted-foreground">Work: {format(entry.date.toDate(), 'dd MMM yyyy')}</span>
                  </div>
                  {entry.deletedAt && (
                    <p className="text-xs text-muted-foreground mt-1">
                      🗑️ Deleted on {format(entry.deletedAt.toDate(), 'dd MMM yyyy, h:mm a')}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 shrink-0 rounded-xl border-primary/30 text-primary hover:bg-primary/5"
                  onClick={() => handleRestore(entry)}
                  disabled={restoringId === entry.id}>
                  <RotateCcw className={`h-3.5 w-3.5 ${restoringId === entry.id ? 'animate-spin' : ''}`} />
                  Restore
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {!loading && entries.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          {entries.length} deleted {entries.length === 1 ? 'entry' : 'entries'} — all recoverable
        </p>
      )}
    </div>
  );
}
