# Replit Agent Prompt — New Firebase Project + New Repo, Clean Schema (No Migration Yet)

Copy-paste ye poora prompt Replit Agent me. Ye same website/UI/features rakhega, sirf backend database schema naya aur clean banayega, naye Firebase account aur naye GitHub repo ke saath. Purane database ka data migrate NAHI hoga is step me — wo baad me alag se hoga.

---

## PROMPT (Replit Agent ko dena hai)

```
CONTEXT:
This is an existing CSC (Common Service Center) shop management web app called
"Azaan CSC". The current codebase, UI, features, and business logic are already
correct and must NOT change in behavior. What we are doing in this task is
setting up a BRAND NEW backend for it — a fresh Firebase project and a fresh
GitHub repository — with a cleaner Firestore schema. This is a rebuild of the
data layer only, not a redesign of the app.

STRICT SCOPE — READ CAREFULLY:
1. Do NOT touch, read from, or write to the old/existing Firebase project.
2. Do NOT write or run any data migration script in this task. No data will be
   copied from the old database. The new Firestore collections start empty.
   Migration is a separate task that will happen later — do not attempt it,
   do not build tooling for it, do not ask me to run it.
3. Do NOT change the UI, page layout, component structure, styling, routes,
   or user-facing features. The website must look and behave exactly the same
   to an end user. Only the Firestore schema, the data-access layer
   (firestore.ts / lib files), security rules, and Firebase config change.
4. Create a NEW GitHub repository (separate from the old one) and push this
   codebase to it. Do not modify or push to the old repo.
5. Set up a NEW Firebase project (new project, new Firestore database, new
   Auth instance, new config keys) — this will run on a different Firebase
   account/project than the current one. Store the new Firebase config in
   environment variables / secrets, not hardcoded in source.

STEP 1 — NEW FIREBASE PROJECT
- Guide me to create a brand-new Firebase project (new project ID, separate
  from the existing one).
- Enable Firestore (production mode) and Firebase Authentication (Email/Password,
  same auth method as the current app uses).
- Generate a new Firebase web app config (apiKey, authDomain, projectId,
  storageBucket, messagingSenderId, appId) and store these as environment
  secrets (e.g. VITE_FIREBASE_API_KEY, etc. — match whatever naming convention
  the current codebase already uses for its Firebase env vars).
- Do NOT reuse any of the old project's credentials.

STEP 2 — NEW GITHUB REPO
- Initialize a new git repository for this project (do not push to or reuse
  the old repo's remote).
- Push the full current codebase (with the schema changes from Step 3 applied)
  to this new repo under my GitHub account.
- Keep commit history clean; a single "Initial commit: new schema + new
  Firebase backend" style commit (or a few logical commits) is fine.

STEP 3 — CLEAN FIRESTORE SCHEMA (implement exactly this structure)

Replace the current schema's redundant collections with this structure:

  users               (unchanged — uid, email, role, staffId, isActive, permissions map)
  workEntries         (unchanged — customerName, category, totalAmount, paidAmount,
                        dueAmount, payments[], documents[], receivings[], status,
                        isDeleted, createdAt, addedBy)
  workAdjustments     (unchanged — entryId FK, amountChange, challanChange, reason)
  categories          (unchanged fields, BUT: before creating a new category doc,
                        the write function MUST query for an existing doc with the
                        same name and reuse/reject instead of creating a duplicate.
                        Remove the old deduplicateCategories()/deleteCategoriesByName()
                        cleanup functions entirely — they should no longer be needed.)
  transactions        (NEW — replaces the 5 old collections: aepsWithdrawals,
                        electricRecharges, moneyTransfers, flightBookings,
                        quickActionWork)
      fields:
        id
        type: "aeps" | "recharge" | "transfer" | "flight" | "quickWork"
        customerName
        amount
        profitMargin
        paymentStatus
        paymentMode
        settledVia
        settledBy
        settledAt
        createdAt
        addedBy
        isDeleted
        details: { }   // type-specific fields go here, e.g.
                        //   aeps      -> { bankName, aadhaarLast4 }
                        //   recharge  -> { consumerNumber, provider }
                        //   transfer  -> { recipientName, transferMode }
                        //   flight    -> { pnr, actualFare, amountCharged }
                        //   quickWork -> { category }
  config              (NEW — replaces the old "settings" collection, which mixed
                        a config doc and an unrelated sentinel doc together)
      config/shop     -> shop settings doc (whatever shopSettings currently holds)
      config/meta     -> sentinel/seed flags (whatever categoriesSeeded currently holds)

  REMOVE ENTIRELY: the old `paymentHistory` collection. Settlement data
  (settledVia, settledAt, settledBy) now lives directly on the `workEntries`
  doc and on each `transactions` doc — do not maintain a separate settlement
  log collection.

STEP 3B — ID SYSTEM (important — implement exactly this)

Current app problem: every doc's ID is just Firestore's random auto-generated
ID (e.g. "aB3xK9pQZ..."), and other collections reference it via a plain
string field (e.g. `entryId` in workAdjustments) with NO enforcement — if a
wrong ID is ever written, Firestore won't catch it, it just becomes a silently
broken reference. There is also no human-readable number for staff/customers
to refer to an entry by (like an invoice number).

In the new database, implement TWO layers of ID:

1. PRIMARY KEY / FOREIGN KEY (internal, unchanged behavior):
   - Keep using Firestore's own auto-generated document ID (`addDoc` /
     `doc().id`) as the true primary key for every collection
     (workEntries, workAdjustments, transactions, categories, users).
   - Any doc that needs to reference another doc (e.g. workAdjustments →
     workEntries, or a future note/attachment → its parent) stores that
     parent's Firestore doc ID in a clearly named field (`entryId`,
     `workEntryId`, etc.) — same pattern as today, just consistently named.
   - Before writing a doc that contains a reference field like `entryId`,
     validate (in code) that the referenced parent doc actually exists
     before saving, instead of trusting the caller blindly. This prevents
     the silent-broken-reference problem from the old app.

2. HUMAN-READABLE DISPLAY ID (NEW — does not exist in the old app):
   - Add a short, sequential, human-friendly number to every `workEntries`
     doc and every `transactions` doc, e.g.:
       workEntries   -> entryNumber:  "WRK-2026-00001"
       transactions  -> entryNumber:  "AEPS-2026-00001" / "RCG-2026-00001" /
                         "TRF-2026-00001" / "FLT-2026-00001" / "QW-2026-00001"
                         (prefix depends on `type`)
   - Generate this number using a Firestore transaction against a counter
     doc stored in `config/counters` (e.g. fields like `workEntries_2026`,
     `aeps_2026`, etc.), so numbers increment atomically and never collide
     even with concurrent writes from multiple staff members at once.
     Reset the counter per calendar year (the "2026" segment in the number).
   - `entryNumber` is for display/search only (shown in the UI, used for
     searching/filtering by staff) — it is NOT used as the Firestore doc ID
     and NOT used as the foreign key in reference fields. The Firestore
     auto-ID remains the real primary key everywhere internally.
   - Add a Firestore index / basic search so staff can look up an entry by
     typing its `entryNumber` in the existing search UI.

STEP 4 — REFACTOR DATA-ACCESS LAYER
- Rewrite the Firestore access functions (in lib/firestore.ts or equivalent)
  to match the new schema:
  - One generic set of functions for `transactions`
    (createTransaction, subscribeTransactions, settleTransaction, deleteTransaction)
    parameterized by `type`, instead of 5 near-duplicate sets of functions.
  - Any UI component/page currently calling the old aeps/recharge/transfer/
    flight/quickWork-specific functions should now call the generic
    transactions functions with the appropriate `type` filter, and read/write
    the module-specific fields via `details`.
  - Update all TypeScript types/interfaces to match the new schema.
  - Update `settings` references to the new `config/shop` and `config/meta`
    docs.
- Do not change what the UI displays or how it behaves — only which
  collection/function it reads from and how the data is shaped internally.

STEP 5 — SECURITY RULES & INDEXES
- Update firestore.rules for the new collection names (`transactions`,
  `config`) and remove rules referencing the deleted collections
  (aepsWithdrawals, electricRecharges, moneyTransfers, flightBookings,
  quickActionWork, paymentHistory, settings).
- Update firestore.indexes.json for any composite indexes needed by the new
  `transactions` collection (e.g. queries filtering by `type` + `isDeleted` +
  `createdAt`, or by `type` + `paymentStatus`).
- Deploy these rules and indexes to the NEW Firebase project only.

STEP 6 — VERIFY (empty-database smoke test)
- Since the new Firestore database starts empty, verify the app boots
  correctly against it: sign-up/login flow creates a `users` doc correctly,
  categories can be created without duplicates, a work entry can be created
  and shows up correctly, and each transaction type (aeps/recharge/transfer/
  flight/quickWork) can be created, settled, and soft-deleted correctly
  through the UI.
- Confirm no code path still references the old collection names or the old
  Firebase project's config.
- Confirm each new workEntries and transactions doc gets a correct, unique,
  sequential `entryNumber` (per the counter system in Step 3B), even when
  creating multiple entries quickly in a row (test for collisions/skips).
- Confirm searching by `entryNumber` in the UI finds the right entry.

STEP 7 — DO NOT DO YET
- Do not migrate any data from the old Firebase project.
- Do not delete or modify the old Firebase project or old GitHub repo.
- Do not write a migration script — that will be requested separately later.

Deliverables at the end of this task:
1. A new GitHub repository containing the updated codebase.
2. A new Firebase project with Firestore + Auth configured, rules and indexes
   deployed, and collections matching the schema above (empty, ready for use).
3. A short summary of every file you changed and why.
```

---

**Note:** Ye prompt Replit Agent ko dene ke baad wo aapse naye Firebase project ke credentials (ya console access) maangega — usko new Firebase account se hi project banane dena, purane wale se link mat karna. Jab naya database ready ho jaye aur test ho jaye, tab migration wala alag task karenge.
