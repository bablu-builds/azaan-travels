/**
 * Demo-mode bootstrap: seed a demo owner + demo staff account and populate
 * Firestore mock with realistic work entries, categories, and settings.
 * Runs only once (idempotent via a sentinel doc in the mock store).
 */
import { Timestamp, _getStore, _setStore } from './firebase-firestore';
import { _seedDemoUser, _autoSignIn, _currentUser, User } from './firebase-auth';

const SENTINEL_COLLECTION = '_demo_meta';
const SENTINEL_DOC = 'seeded';
const SEED_VERSION = 4;

export interface DemoCredentials {
  owner: { email: string; password: string };
  staff: { email: string; password: string };
}

export const DEMO_CREDS: DemoCredentials = {
  owner: { email: 'owner@demo.local', password: 'demo1234' },
  staff: { email: 'staff@demo.local', password: 'demo1234' },
};

function id() { return 'id_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

export function seedDemo(): { owner: User; staff: User; alreadySeeded: boolean } {
  // Always ensure demo users exist so users can log in with the shown creds.
  const owner = _seedDemoUser(DEMO_CREDS.owner.email, DEMO_CREDS.owner.password, 'Azaan Owner');
  const staff = _seedDemoUser(DEMO_CREDS.staff.email, DEMO_CREDS.staff.password, 'Ravi Staff');

  const store = _getStore();
  const already = store[SENTINEL_COLLECTION]?.[SENTINEL_DOC]?.version === SEED_VERSION;
  if (already) return { owner, staff, alreadySeeded: true };

  const now = Date.now();
  const tsFrom = (offsetDays: number) => Timestamp.fromMillis(now - offsetDays * 86400_000);

  // Users
  store['users'] = {
    [owner.uid]: {
      email: owner.email,
      displayName: owner.displayName,
      role: 'owner',
      createdAt: tsFrom(30),
    },
    [staff.uid]: {
      email: staff.email,
      displayName: staff.displayName,
      role: 'staff',
      createdAt: tsFrom(20),
      invitedBy: owner.email,
      canAccessFinancialServices: true,
    },
  };

  // Shop settings
  store['settings'] = {
    shopSettings: {
      shopName: 'AZAAN COMMUNICATION TOUR AND TRAVEL',
      address: 'Main Road, Near Bus Stand, Katihar, Bihar 854105',
      phone: '+91 90000 12345',
    },
    categoriesSeeded: { seededAt: tsFrom(30) },
  };

  // Categories
  const defaultCategories = [
    'PAN Card', 'Aadhar Card', 'Voter ID Card', 'Driving Licence (DL)', 'Ration Card',
    'Jati Praman Patra', 'Aay Praman Patra', 'Niwas Praman Patra',
    'Bijli Bill Payment', 'Pani Bill Payment', 'Bank Related Work', 'Insurance',
    'Railway/Bus Ticket Booking', 'Photocopy / Print / Photo', 'Other',
  ];
  store['categories'] = {};
  for (const name of defaultCategories) {
    store['categories'][id()] = { name };
  }

  // Work entries (variety of statuses and dates)
  const sample = [
    { customerName: 'Rahul Kumar',   mobile: '9876543210', category: 'PAN Card',              total: 200,  paid: 200,  status: 'Completed', addedBy: 'Azaan Owner', daysAgo: 0 },
    { customerName: 'Priya Sharma',  mobile: '9812345678', category: 'Aadhar Card',           total: 150,  paid: 100,  status: 'Pending',   addedBy: 'Ravi Staff',  daysAgo: 0 },
    { customerName: 'Amit Verma',    mobile: '9900112233', category: 'Driving Licence (DL)',  total: 1500, paid: 1000, status: 'Pending',   addedBy: 'Ravi Staff',  daysAgo: 1 },
    { customerName: 'Sunita Devi',   mobile: '9723456781', category: 'Ration Card',           total: 100,  paid: 100,  status: 'Completed', addedBy: 'Azaan Owner', daysAgo: 1 },
    { customerName: 'Manoj Singh',   mobile: '9871122334', category: 'Bijli Bill Payment',    total: 850,  paid: 850,  status: 'Completed', addedBy: 'Ravi Staff',  daysAgo: 2 },
    { customerName: 'Aisha Khan',    mobile: '9988776655', category: 'Voter ID Card',         total: 250,  paid: 0,    status: 'Pending',   addedBy: 'Azaan Owner', daysAgo: 2 },
    { customerName: 'Rohit Yadav',   mobile: '9812309876', category: 'Insurance',             total: 2400, paid: 2400, status: 'Completed', addedBy: 'Azaan Owner', daysAgo: 3 },
    { customerName: 'Neha Gupta',    mobile: '9765432109', category: 'Railway/Bus Ticket Booking', total: 950,  paid: 950,  status: 'Completed', addedBy: 'Ravi Staff',  daysAgo: 3 },
    { customerName: 'Vikram Prasad', mobile: '9711223344', category: 'Jati Praman Patra',     total: 120,  paid: 0,    status: 'Rejected',  addedBy: 'Ravi Staff',  daysAgo: 4, rejectionReason: 'Missing supporting documents' },
    { customerName: 'Farah Ansari',  mobile: '9099887766', category: 'Photocopy / Print / Photo', total: 80,   paid: 80,   status: 'Completed', addedBy: 'Ravi Staff',  daysAgo: 4 },
    { customerName: 'Deepak Mishra', mobile: '9012345678', category: 'Bank Related Work',     total: 300,  paid: 150,  status: 'Pending',   addedBy: 'Azaan Owner', daysAgo: 5 },
    { customerName: 'Kiran Rao',     mobile: '9345678901', category: 'Aay Praman Patra',      total: 130,  paid: 130,  status: 'Completed', addedBy: 'Azaan Owner', daysAgo: 6 },
    { customerName: 'Sameer Ali',    mobile: '9456789012', category: 'Niwas Praman Patra',    total: 140,  paid: 140,  status: 'Completed', addedBy: 'Ravi Staff',  daysAgo: 6 },
    { customerName: 'Anjali Jain',   mobile: '9567890123', category: 'PAN Card',              total: 200,  paid: 200,  status: 'Completed', addedBy: 'Azaan Owner', daysAgo: 7 },
    { customerName: 'Suresh Chandra',mobile: '9678901234', category: 'Pani Bill Payment',     total: 420,  paid: 420,  status: 'Completed', addedBy: 'Ravi Staff',  daysAgo: 8 },
  ];

  store['workEntries'] = {};
  for (const s of sample) {
    const createdAt = tsFrom(s.daysAgo);
    const due = s.status === 'Rejected' ? 0 : s.total - s.paid;
    const payments = s.paid > 0 ? [{
      amount: s.paid,
      paidAt: createdAt.toJSON(),
      addedBy: s.addedBy,
      paymentMode: 'Cash',
    }] : [];
    const entry: any = {
      customerName: s.customerName,
      mobile: s.mobile,
      category: s.category,
      workDetail: '',
      date: createdAt,
      totalAmount: s.total,
      paidAmount: s.paid,
      dueAmount: due,
      status: s.status,
      createdAt,
      payments,
      addedBy: s.addedBy,
    };
    if (s.status === 'Completed') entry.completedAt = createdAt;
    if (s.status === 'Rejected') {
      entry.rejectedAt = createdAt;
      entry.rejectionReason = (s as any).rejectionReason ?? 'Rejected';
    }
    store['workEntries'][id()] = entry;
  }

  // Financial services (owner-facing extras)
  store['aepsWithdrawals'] = {};
  const aepsSamples = [
    { customerName: 'Rahul Kumar', bankName: 'SBI',        amount: 5000, profitMargin: 30, daysAgo: 0, addedBy: 'Azaan Owner' },
    { customerName: 'Priya Sharma',bankName: 'HDFC Bank',  amount: 3000, profitMargin: 20, daysAgo: 1, addedBy: 'Ravi Staff'  },
    { customerName: 'Amit Verma',  bankName: 'PNB',        amount: 8000, profitMargin: 40, daysAgo: 3, addedBy: 'Azaan Owner' },
  ];
  for (const a of aepsSamples) {
    store['aepsWithdrawals'][id()] = {
      customerName: a.customerName, bankName: a.bankName,
      amount: a.amount, profitMargin: a.profitMargin,
      paymentMode: 'Cash', addedBy: a.addedBy,
      createdAt: tsFrom(a.daysAgo),
    };
  }

  store['electricRecharges'] = {};
  const elecSamples = [
    { customerName: 'Manoj Singh',  consumerNumber: '123456789', rechargeAmount: 500, profitMargin: 15, daysAgo: 1, addedBy: 'Ravi Staff'  },
    { customerName: 'Anjali Jain',  consumerNumber: '987654321', rechargeAmount: 1200,profitMargin: 25, daysAgo: 2, addedBy: 'Azaan Owner' },
  ];
  for (const e of elecSamples) {
    store['electricRecharges'][id()] = {
      customerName: e.customerName, consumerNumber: e.consumerNumber,
      rechargeAmount: e.rechargeAmount, profitMargin: e.profitMargin,
      paymentMode: 'Online', addedBy: e.addedBy,
      createdAt: tsFrom(e.daysAgo),
    };
  }

  store['moneyTransfers'] = {};
  const mtSamples = [
    { name: 'Sameer Ali',    mobileOrAccount: '9812309876', amount: 2000, profitMargin: 20, daysAgo: 1, addedBy: 'Azaan Owner' },
    { name: 'Deepak Mishra', mobileOrAccount: '9098765432', amount: 5000, profitMargin: 35, daysAgo: 2, addedBy: 'Ravi Staff'  },
  ];
  for (const m of mtSamples) {
    store['moneyTransfers'][id()] = {
      name: m.name, mobileOrAccount: m.mobileOrAccount,
      amount: m.amount, profitMargin: m.profitMargin,
      paymentMode: 'Cash', addedBy: m.addedBy,
      createdAt: tsFrom(m.daysAgo),
    };
  }

  // Quick Action Work — fast one-tap entries (no cost, amount == profit)
  store['quickActionWork'] = {};
  const quickSamples = [
    { category: 'Printout',     customerName: 'Walk-in',       amount: 20,  addedBy: 'Ravi Staff',  daysAgo: 0 },
    { category: 'Xerox',        customerName: undefined,       amount: 10,  addedBy: 'Ravi Staff',  daysAgo: 0 },
    { category: 'Lamination',   customerName: 'Sunita Devi',   amount: 30,  addedBy: 'Azaan Owner', daysAgo: 0 },
    { category: 'Photo Print',  customerName: 'Rahul Kumar',   amount: 40,  addedBy: 'Azaan Owner', daysAgo: 1 },
    { category: 'PVC',          customerName: 'Priya Sharma',  amount: 80,  addedBy: 'Ravi Staff',  daysAgo: 1 },
    { category: 'Print',        customerName: undefined,       amount: 25,  addedBy: 'Ravi Staff',  daysAgo: 2 },
    { category: 'Printout',     customerName: 'Amit Verma',    amount: 15,  addedBy: 'Azaan Owner', daysAgo: 2 },
    { category: 'Xerox',        customerName: 'Manoj Singh',   amount: 12,  addedBy: 'Ravi Staff',  daysAgo: 3 },
    { category: 'Other',        customerName: 'Aisha Khan',    amount: 50,  addedBy: 'Azaan Owner', daysAgo: 4 },
    { category: 'Lamination',   customerName: undefined,       amount: 25,  addedBy: 'Ravi Staff',  daysAgo: 5 },
  ];
  for (const q of quickSamples) {
    store['quickActionWork'][id()] = {
      category: q.category,
      ...(q.customerName ? { customerName: q.customerName } : {}),
      amount: q.amount,
      addedBy: q.addedBy,
      createdAt: tsFrom(q.daysAgo),
    };
  }

  // Sentinel
  store[SENTINEL_COLLECTION] = { [SENTINEL_DOC]: { version: SEED_VERSION, seededAt: Timestamp.now() } };

  _setStore(store);
  return { owner, staff, alreadySeeded: false };
}

/** Auto-sign-in as the demo owner unless a user is already signed in. */
export function autoSignInIfNeeded(owner: User): void {
  if (_currentUser()) return;
  _autoSignIn(owner);
}
