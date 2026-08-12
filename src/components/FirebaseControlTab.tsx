/**
 * Firebase Control Tab — owner-only diagnostic and export panel.
 * Shows connection status, collection counts, data export, and permission health.
 */
import { useState, useEffect } from 'react';
import {
  collection, getCountFromServer, getDocs, query, orderBy,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, Wifi, WifiOff, Database, Download, ShieldCheck, ShieldAlert,
  RefreshCw, AlertTriangle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface CollectionStat {
  name: string;
  label: string;
  count: number | null;
  error: string | null;
}

const COLLECTIONS = [
  { name: 'workEntries', label: 'Work Entries' },
  { name: 'workAdjustments', label: 'Work Adjustments' },
  { name: 'transactions', label: 'Transactions' },
  { name: 'users', label: 'Users' },
  { name: 'categories', label: 'Categories' },
  { name: 'config', label: 'Configuration' },
];

export default function FirebaseControlTab() {
  const { toast } = useToast();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [stats, setStats] = useState<CollectionStat[]>([]);
  const [scanning, setScanning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [permissionErrors, setPermissionErrors] = useState<string[]>([]);

  const runScan = async () => {
    if (!db) { setConnected(false); return; }
    setScanning(true);
    setPermissionErrors([]);

    const errors: string[] = [];
    const results: CollectionStat[] = [];

    for (const col of COLLECTIONS) {
      try {
        const snap = await getCountFromServer(collection(db, col.name));
        results.push({ name: col.name, label: col.label, count: snap.data().count, error: null });
      } catch (err: any) {
        const msg = err.code === 'permission-denied'
          ? 'Permission denied'
          : err.message ?? 'Unknown error';
        if (err.code === 'permission-denied') errors.push(col.label);
        results.push({ name: col.name, label: col.label, count: null, error: msg });
      }
    }

    setStats(results);
    setPermissionErrors(errors);
    setConnected(results.some(r => r.count !== null));
    setScanning(false);
  };

  useEffect(() => { runScan(); }, []);

  const handleExport = async () => {
    if (!db) return;
    setExporting(true);
    try {
      const exportData: Record<string, unknown[]> = {};
      for (const col of COLLECTIONS) {
        try {
          const snap = await getDocs(query(collection(db, col.name)));
          exportData[col.name] = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
        } catch {
          exportData[col.name] = [];
        }
      }

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `azaan-csc-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Export complete', description: 'Data downloaded as JSON.' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Export failed', description: err.message });
    } finally {
      setExporting(false);
    }
  };

  const totalRecords = stats.reduce((s, r) => s + (r.count ?? 0), 0);

  return (
    <div className="space-y-5">
      {/* Connection Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            {connected === null ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : connected ? (
              <Wifi className="h-4 w-4 text-emerald-500" />
            ) : (
              <WifiOff className="h-4 w-4 text-destructive" />
            )}
            Firebase Connection
          </CardTitle>
          <CardDescription>Live status of your Firestore database connection.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            {connected === null ? (
              <Badge variant="secondary">Checking…</Badge>
            ) : connected ? (
              <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Connected</Badge>
            ) : (
              <Badge variant="destructive">Disconnected</Badge>
            )}
            <Button variant="outline" size="sm" onClick={runScan} disabled={scanning} className="gap-1.5">
              {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Collection Stats */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            Collection Summary
            {stats.length > 0 && !scanning && (
              <Badge variant="secondary" className="ml-auto text-xs font-normal">
                {totalRecords.toLocaleString()} total records
              </Badge>
            )}
          </CardTitle>
          <CardDescription>Document count per Firestore collection.</CardDescription>
        </CardHeader>
        <CardContent>
          {scanning ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Counting documents…
            </div>
          ) : stats.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data yet. Click Refresh.</p>
          ) : (
            <div className="border rounded-xl divide-y overflow-hidden">
              {stats.map(s => (
                <div key={s.name} className="px-4 py-3 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{s.label}</span>
                  {s.error ? (
                    <span className="text-xs text-destructive flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> {s.error}
                    </span>
                  ) : (
                    <Badge variant="secondary">{s.count?.toLocaleString() ?? '—'}</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Permission Check */}
      {permissionErrors.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-4 w-4" />
              Permission Errors Detected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              The following collections returned <code className="bg-muted px-1 rounded text-xs">permission-denied</code>. Your Firestore security rules may be missing or outdated.
            </p>
            <ul className="space-y-1">
              {permissionErrors.map(c => (
                <li key={c} className="text-sm text-destructive flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {c}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground mt-3">
              Fix: deploy the updated <code className="bg-muted px-1 rounded">firestore.rules</code> file via Firebase CLI: <code className="bg-muted px-1 rounded">firebase deploy --only firestore:rules</code>
            </p>
          </CardContent>
        </Card>
      )}

      {permissionErrors.length === 0 && connected && !scanning && (
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3 text-emerald-800">
              <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" />
              <p className="text-sm font-medium">All collections accessible — no permission errors.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Export */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="h-4 w-4 text-primary" />
            Data Backup / Export
          </CardTitle>
          <CardDescription>
            Download all Firestore data as a JSON file for backup or migration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleExport} disabled={exporting || !connected} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exporting ? 'Exporting…' : 'Export All Data (JSON)'}
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
             Exports: Work Entries, Adjustments, Transactions, Users, Categories, and Configuration.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
