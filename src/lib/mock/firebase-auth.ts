/**
 * Mock of `firebase/auth` — implements just the surface used by this app.
 * Persists a single logged-in user in localStorage for the demo.
 */

const USERS_KEY = 'azaan_demo_users_v1';
const CURRENT_KEY = 'azaan_demo_currentUid_v1';

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
}

interface StoredUser {
  uid: string;
  email: string;
  password: string;
  displayName: string;
}

function loadUsers(): Record<string, StoredUser> {
  try { return JSON.parse(localStorage.getItem(USERS_KEY) || '{}'); } catch { return {}; }
}
function saveUsers(map: Record<string, StoredUser>) {
  localStorage.setItem(USERS_KEY, JSON.stringify(map));
}

function loadCurrent(): User | null {
  try {
    const uid = localStorage.getItem(CURRENT_KEY);
    if (!uid) return null;
    const users = loadUsers();
    const u = Object.values(users).find(x => x.uid === uid);
    if (!u) return null;
    return { uid: u.uid, email: u.email, displayName: u.displayName };
  } catch { return null; }
}
function saveCurrent(u: User | null) {
  if (u) localStorage.setItem(CURRENT_KEY, u.uid);
  else localStorage.removeItem(CURRENT_KEY);
}

// ─── Auth object ────────────────────────────────────────────────────────────
class AuthImpl {
  currentUser: User | null = loadCurrent();
  private _listeners: Array<(u: User | null) => void> = [];

  _notify() {
    for (const cb of this._listeners) cb(this.currentUser);
  }
  _setUser(u: User | null) {
    this.currentUser = u;
    saveCurrent(u);
    this._notify();
  }
  _addListener(cb: (u: User | null) => void) {
    this._listeners.push(cb);
    Promise.resolve().then(() => cb(this.currentUser));
    return () => {
      const i = this._listeners.indexOf(cb);
      if (i >= 0) this._listeners.splice(i, 1);
    };
  }
}

const globalAuth = new AuthImpl();

// A secondary auth registry keyed by app name (used by createStaffAccount)
const secondaryAuths = new Map<string, AuthImpl>();

export function getAuth(app?: any): AuthImpl {
  if (app && app._name && app._name !== '[DEFAULT]') {
    let a = secondaryAuths.get(app._name);
    if (!a) { a = new AuthImpl(); secondaryAuths.set(app._name, a); }
    return a;
  }
  return globalAuth;
}

// ─── Persistence (no-op) ────────────────────────────────────────────────────
export const browserSessionPersistence = { type: 'SESSION' };
export const browserLocalPersistence = { type: 'LOCAL' };
export const indexedDBLocalPersistence = { type: 'INDEXED_DB' };
export async function setPersistence(_auth: AuthImpl, _p: any) { /* no-op */ }

// ─── onAuthStateChanged ─────────────────────────────────────────────────────
export function onAuthStateChanged(auth: AuthImpl, cb: (u: User | null) => void) {
  return auth._addListener(cb);
}

// ─── Sign-in / sign-up ──────────────────────────────────────────────────────
function genUid() { return 'uid_' + Math.random().toString(36).slice(2, 12); }

export async function signInWithEmailAndPassword(auth: AuthImpl, email: string, password: string) {
  const users = loadUsers();
  const found = Object.values(users).find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!found) {
    const err: any = new Error('There is no user record corresponding to this identifier.');
    err.code = 'auth/user-not-found';
    throw err;
  }
  if (found.password !== password) {
    const err: any = new Error('The password is invalid.');
    err.code = 'auth/wrong-password';
    throw err;
  }
  const user: User = { uid: found.uid, email: found.email, displayName: found.displayName };
  auth._setUser(user);
  return { user };
}

export async function createUserWithEmailAndPassword(auth: AuthImpl, email: string, password: string) {
  const users = loadUsers();
  if (Object.values(users).some(u => u.email.toLowerCase() === email.toLowerCase())) {
    const err: any = new Error('The email address is already in use by another account.');
    err.code = 'auth/email-already-in-use';
    throw err;
  }
  const uid = genUid();
  const displayName = email.split('@')[0];
  users[uid] = { uid, email, password, displayName };
  saveUsers(users);
  const user: User = { uid, email, displayName };
  auth._setUser(user);
  return { user };
}

export async function signOut(auth: AuthImpl) {
  auth._setUser(null);
}

export async function sendPasswordResetEmail(_auth: AuthImpl, _email: string) {
  // Demo: no email is sent; just resolve.
  return;
}

// ─── Email link (passwordless) — minimal stubs ──────────────────────────────
export function isSignInWithEmailLink(_auth: AuthImpl, _url: string): boolean {
  return false;
}
export async function signInWithEmailLink(_auth: AuthImpl, _email: string, _url: string) {
  const err: any = new Error('Email link sign-in is disabled in demo mode.');
  err.code = 'auth/operation-not-allowed';
  throw err;
}
export async function sendSignInLinkToEmail(_auth: AuthImpl, _email: string, _opts: any) {
  const err: any = new Error('Email link sign-in is disabled in demo mode.');
  err.code = 'auth/operation-not-allowed';
  throw err;
}

// ─── Demo bootstrap ─────────────────────────────────────────────────────────
export function _seedDemoUser(email: string, password: string, displayName: string): User {
  const users = loadUsers();
  let existing = Object.values(users).find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!existing) {
    const uid = genUid();
    existing = { uid, email, password, displayName };
    users[uid] = existing;
    saveUsers(users);
  }
  return { uid: existing.uid, email: existing.email, displayName: existing.displayName };
}
export function _autoSignIn(user: User) {
  globalAuth._setUser(user);
}
export function _currentUser(): User | null {
  return globalAuth.currentUser;
}
