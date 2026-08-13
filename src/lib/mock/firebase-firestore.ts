/**
 * In-memory mock of the subset of `firebase/firestore` used by this app.
 * Data is persisted to localStorage so the demo survives page reloads.
 *
 * This is aliased in vite.config.ts so `import ... from 'firebase/firestore'`
 * resolves here during demo mode.
 */

type Primitive = string | number | boolean | null;
type DocData = Record<string, any>;
type Listener = (docs: Array<{ id: string; data: DocData }>) => void;

const STORAGE_KEY = 'azaan_demo_firestore_v1';

// ─── Timestamp ──────────────────────────────────────────────────────────────
export class Timestamp {
  seconds: number;
  nanoseconds: number;
  constructor(seconds: number, nanoseconds: number = 0) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }
  static now(): Timestamp {
    return Timestamp.fromDate(new Date());
  }
  static fromDate(d: Date): Timestamp {
    const ms = d.getTime();
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }
  static fromMillis(ms: number): Timestamp {
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }
  toDate(): Date {
    return new Date(this.seconds * 1000 + this.nanoseconds / 1e6);
  }
  toMillis(): number {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
  }
  toJSON() {
    return { __ts: true, seconds: this.seconds, nanoseconds: this.nanoseconds };
  }
}

// Revive stored Timestamps from JSON
function reviveValue(v: any): any {
  if (v && typeof v === 'object') {
    if (v.__ts === true && typeof v.seconds === 'number') {
      return new Timestamp(v.seconds, v.nanoseconds ?? 0);
    }
    if (Array.isArray(v)) return v.map(reviveValue);
    const out: any = {};
    for (const k of Object.keys(v)) out[k] = reviveValue(v[k]);
    return out;
  }
  return v;
}

// ─── Storage ────────────────────────────────────────────────────────────────
type Store = Record<string /*collection*/, Record<string /*id*/, DocData>>;

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return reviveValue(JSON.parse(raw)) as Store;
  } catch {
    return {};
  }
}

let store: Store = loadStore();
const listeners = new Map<string /*key*/, Set<{ query: QueryRef | DocRef; cb: Function; onErr?: Function }>>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore quota errors
  }
}

function notifyCollection(collectionName: string) {
  const set = listeners.get(collectionName);
  if (!set) return;
  for (const l of set) {
    try {
      if ((l.query as any)._isDoc) {
        const d = l.query as DocRef;
        const data = store[d.collectionName]?.[d.id];
        l.cb({
          id: d.id,
          exists: () => data !== undefined,
          data: () => (data ? deepClone(data) : undefined),
        });
      } else {
        const q = l.query as QueryRef;
        const results = runQuery(q);
        const snapshot = makeQuerySnapshot(results);
        l.cb(snapshot);
      }
    } catch (err) {
      if (l.onErr) l.onErr(err);
    }
  }
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, val) => {
    if (val instanceof Timestamp) return val.toJSON();
    return val;
  }), (_k, val) => {
    if (val && typeof val === 'object' && val.__ts) return new Timestamp(val.seconds, val.nanoseconds ?? 0);
    return val;
  });
}

// ─── References ─────────────────────────────────────────────────────────────
export interface FirestoreDB { __isDb: true; }

class CollectionRef {
  _isCollection = true as const;
  constructor(public db: FirestoreDB, public name: string) {}
}

class DocRef {
  _isDoc = true as const;
  constructor(public db: FirestoreDB, public collectionName: string, public id: string) {}
}

interface WhereClause { field: string; op: string; value: any; }
interface OrderByClause { field: string; dir: 'asc' | 'desc'; }

class QueryRef {
  _isQuery = true as const;
  constructor(
    public db: FirestoreDB,
    public collectionName: string,
    public wheres: WhereClause[] = [],
    public orders: OrderByClause[] = [],
    public limitN: number | null = null,
  ) {}
}

// ─── Public API ─────────────────────────────────────────────────────────────
export function collection(db: FirestoreDB, name: string): CollectionRef {
  return new CollectionRef(db, name);
}

export function doc(dbOrColl: FirestoreDB | CollectionRef, ...segments: string[]): DocRef {
  if ((dbOrColl as CollectionRef)._isCollection) {
    const c = dbOrColl as CollectionRef;
    const id = segments[0] ?? genId();
    return new DocRef(c.db, c.name, id);
  }
  // doc(db, collectionName, docId, ...)
  const db = dbOrColl as FirestoreDB;
  if (segments.length < 2) {
    // treat first segment as collection with auto id
    return new DocRef(db, segments[0] ?? 'unknown', genId());
  }
  return new DocRef(db, segments[0], segments.slice(1).join('/'));
}

export function query(coll: CollectionRef, ...clauses: any[]): QueryRef {
  const q = new QueryRef(coll.db, coll.name);
  for (const c of clauses) {
    if (c && c.__kind === 'where') q.wheres.push({ field: c.field, op: c.op, value: c.value });
    else if (c && c.__kind === 'orderBy') q.orders.push({ field: c.field, dir: c.dir });
    else if (c && c.__kind === 'limit') q.limitN = c.n;
  }
  return q;
}

export function where(field: string, op: string, value: any) {
  return { __kind: 'where', field, op, value };
}

export function orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
  return { __kind: 'orderBy', field, dir };
}

export function limit(n: number) {
  return { __kind: 'limit', n };
}

export function arrayUnion(...values: any[]) {
  return { __kind: 'arrayUnion', values };
}

export async function runTransaction(
  _db: FirestoreDB,
  callback: (transaction: {
    get: (ref: DocRef) => Promise<ReturnType<typeof makeDocSnapshot>>;
    set: (ref: DocRef, data: DocData, options?: { merge?: boolean }) => void;
    update: (ref: DocRef, data: DocData) => void;
  }) => Promise<any>,
) {
  const pending: Array<{ type: 'set' | 'update'; ref: DocRef; data: DocData; options?: { merge?: boolean } }> = [];
  const transaction = {
    get: async (ref: DocRef) => makeDocSnapshot(ref),
    set: (ref: DocRef, data: DocData, options?: { merge?: boolean }) => {
      pending.push({ type: 'set', ref, data, options });
    },
    update: (ref: DocRef, data: DocData) => {
      pending.push({ type: 'update', ref, data });
    },
  };
  const result = await callback(transaction);
  const touched = new Set<string>();
  for (const op of pending) {
    if (op.type === 'set') {
      if (!store[op.ref.collectionName]) store[op.ref.collectionName] = {};
      const next = stripUndefined(op.data);
      store[op.ref.collectionName][op.ref.id] = op.options?.merge
        ? { ...store[op.ref.collectionName][op.ref.id], ...next }
        : next;
    } else {
      const existing = store[op.ref.collectionName]?.[op.ref.id];
      if (existing) store[op.ref.collectionName][op.ref.id] = applyFieldValues(existing, stripUndefined(op.data));
    }
    touched.add(op.ref.collectionName);
  }
  persist();
  touched.forEach(notifyCollection);
  return result;
}

function applyFieldValues(target: DocData, updates: DocData): DocData {
  const out = { ...target };
  for (const [k, v] of Object.entries(updates)) {
    if (v && typeof v === 'object' && v.__kind === 'arrayUnion') {
      const existing = Array.isArray(out[k]) ? out[k] : [];
      out[k] = [...existing, ...v.values];
    } else {
      out[k] = v;
    }
  }
  return out;
}

function getFieldValue(obj: DocData, field: string): any {
  if (field.includes('.')) {
    return field.split('.').reduce((acc, p) => (acc ? acc[p] : undefined), obj as any);
  }
  return obj[field];
}

function compareValues(a: any, b: any): number {
  if (a instanceof Timestamp) a = a.toMillis();
  if (b instanceof Timestamp) b = b.toMillis();
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function matchesWhere(data: DocData, w: WhereClause): boolean {
  const val = getFieldValue(data, w.field);
  switch (w.op) {
    case '==': return val === w.value;
    case '!=': return val !== w.value;
    case '<': return compareValues(val, w.value) < 0;
    case '<=': return compareValues(val, w.value) <= 0;
    case '>': return compareValues(val, w.value) > 0;
    case '>=': return compareValues(val, w.value) >= 0;
    case 'in': return Array.isArray(w.value) && w.value.includes(val);
    case 'array-contains': return Array.isArray(val) && val.includes(w.value);
    default: return true;
  }
}

function runQuery(q: QueryRef): Array<{ id: string; data: DocData }> {
  const coll = store[q.collectionName] ?? {};
  let entries = Object.entries(coll).map(([id, data]) => ({ id, data: deepClone(data) }));
  for (const w of q.wheres) entries = entries.filter(e => matchesWhere(e.data, w));
  for (const o of [...q.orders].reverse()) {
    entries.sort((a, b) => {
      const cmp = compareValues(getFieldValue(a.data, o.field), getFieldValue(b.data, o.field));
      return o.dir === 'desc' ? -cmp : cmp;
    });
  }
  if (q.limitN !== null) entries = entries.slice(0, q.limitN);
  return entries;
}

function makeQuerySnapshot(results: Array<{ id: string; data: DocData }>) {
  const docs = results.map(r => ({
    id: r.id,
    exists: () => true,
    data: () => r.data,
  }));
  return {
    empty: docs.length === 0,
    size: docs.length,
    docs,
    forEach: (cb: (d: any) => void) => docs.forEach(cb),
  };
}

function makeDocSnapshot(ref: DocRef) {
  const data = store[ref.collectionName]?.[ref.id];
  return {
    id: ref.id,
    exists: () => data !== undefined,
    data: () => (data ? deepClone(data) : undefined),
  };
}

export async function getDoc(ref: DocRef) {
  const data = store[ref.collectionName]?.[ref.id];
  return {
    id: ref.id,
    exists: () => data !== undefined,
    data: () => (data ? deepClone(data) : undefined),
  };
}

export async function getDocs(q: QueryRef | CollectionRef) {
  const qq = (q as CollectionRef)._isCollection
    ? new QueryRef((q as CollectionRef).db, (q as CollectionRef).name)
    : (q as QueryRef);
  return makeQuerySnapshot(runQuery(qq));
}

export async function setDoc(ref: DocRef, data: DocData, options?: { merge?: boolean }) {
  if (!store[ref.collectionName]) store[ref.collectionName] = {};
  const cleaned = stripUndefined(data);
  if (options?.merge) {
    const existing = store[ref.collectionName][ref.id] ?? {};
    store[ref.collectionName][ref.id] = { ...existing, ...cleaned };
  } else {
    store[ref.collectionName][ref.id] = cleaned;
  }
  persist();
  notifyCollection(ref.collectionName);
}

export async function addDoc(coll: CollectionRef, data: DocData) {
  const id = genId();
  if (!store[coll.name]) store[coll.name] = {};
  store[coll.name][id] = stripUndefined(data);
  persist();
  notifyCollection(coll.name);
  return new DocRef(coll.db, coll.name, id);
}

export async function updateDoc(ref: DocRef, updates: DocData) {
  const existing = store[ref.collectionName]?.[ref.id];
  if (!existing) return;
  store[ref.collectionName][ref.id] = applyFieldValues(existing, stripUndefined(updates));
  persist();
  notifyCollection(ref.collectionName);
}

export async function deleteDoc(ref: DocRef) {
  if (store[ref.collectionName]) {
    delete store[ref.collectionName][ref.id];
    persist();
    notifyCollection(ref.collectionName);
  }
}

export function onSnapshot(
  refOrQuery: DocRef | QueryRef | CollectionRef,
  onNextOrOptions: any,
  onErrOrNext?: any,
  maybeErr?: any,
) {
  // Handle (ref, options, onNext, onError) form
  let onNext: Function; let onErr: Function | undefined;
  if (typeof onNextOrOptions === 'function') {
    onNext = onNextOrOptions;
    onErr = typeof onErrOrNext === 'function' ? onErrOrNext : undefined;
  } else {
    onNext = onErrOrNext;
    onErr = maybeErr;
  }

  let queryRef: DocRef | QueryRef;
  if ((refOrQuery as CollectionRef)._isCollection) {
    const c = refOrQuery as CollectionRef;
    queryRef = new QueryRef(c.db, c.name);
  } else {
    queryRef = refOrQuery as DocRef | QueryRef;
  }

  const collectionName = (queryRef as any)._isDoc
    ? (queryRef as DocRef).collectionName
    : (queryRef as QueryRef).collectionName;

  if (!listeners.has(collectionName)) listeners.set(collectionName, new Set());
  const entry = { query: queryRef, cb: onNext, onErr };
  listeners.get(collectionName)!.add(entry);

  // Fire immediately with current data
  Promise.resolve().then(() => {
    try {
      if ((queryRef as any)._isDoc) {
        const d = queryRef as DocRef;
        const data = store[d.collectionName]?.[d.id];
        onNext({
          id: d.id,
          exists: () => data !== undefined,
          data: () => (data ? deepClone(data) : undefined),
        });
      } else {
        const results = runQuery(queryRef as QueryRef);
        onNext(makeQuerySnapshot(results));
      }
    } catch (err) {
      if (onErr) onErr(err);
    }
  });

  return () => {
    listeners.get(collectionName)?.delete(entry);
  };
}

export function writeBatch(_db: FirestoreDB) {
  const ops: Array<{ type: 'set' | 'update' | 'delete'; ref: DocRef; data?: DocData }> = [];
  return {
    set(ref: DocRef, data: DocData) { ops.push({ type: 'set', ref, data }); return this; },
    update(ref: DocRef, data: DocData) { ops.push({ type: 'update', ref, data }); return this; },
    delete(ref: DocRef) { ops.push({ type: 'delete', ref }); return this; },
    async commit() {
      const touched = new Set<string>();
      for (const op of ops) {
        if (op.type === 'set') {
          if (!store[op.ref.collectionName]) store[op.ref.collectionName] = {};
          store[op.ref.collectionName][op.ref.id] = stripUndefined(op.data!);
        } else if (op.type === 'update') {
          const existing = store[op.ref.collectionName]?.[op.ref.id];
          if (existing) store[op.ref.collectionName][op.ref.id] = applyFieldValues(existing, stripUndefined(op.data!));
        } else if (op.type === 'delete') {
          delete store[op.ref.collectionName]?.[op.ref.id];
        }
        touched.add(op.ref.collectionName);
      }
      persist();
      touched.forEach(t => notifyCollection(t));
    },
  };
}

export function getFirestore(_app?: any): FirestoreDB {
  return { __isDb: true } as FirestoreDB;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function stripUndefined(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Timestamp) return obj;
  if (Array.isArray(obj)) return obj.map(stripUndefined);
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = stripUndefined(v);
  }
  return out;
}

function genId(): string {
  return 'id_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ─── Demo seeding ───────────────────────────────────────────────────────────
export function _getStore(): Store { return store; }
export function _setStore(next: Store): void { store = next; persist(); }
export function _reload(): void { store = loadStore(); }
