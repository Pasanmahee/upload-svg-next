# Hint Admin TypeScript Build Fix

Fixed the Next.js build error in `app/api/admin/hints/route.ts`:

```text
Type error: Untyped function calls may not accept type arguments.
const users = db.collection<any>('users');
```

The helper functions now type the Mongo database parameter as `Db` from the official MongoDB driver instead of `any`, so `db.collection<any>(...)` is accepted by TypeScript.

Changed:

```ts
import type { Db } from 'mongodb';

async function resolveUidFromActivity(db: Db, email: string) { ... }
async function findUserDocForLookup(db: Db, lookup: UserLookup) { ... }
```

Verified:

```bash
npm ci --no-audit --no-fund
npm run build
```

Build passed in the sandbox using Node 22.16.0 with an engine warning because the project requires Node 24.x. On the VPS/local Node 24.x, the warning should not appear.
