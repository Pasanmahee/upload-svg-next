# Guest auth TypeScript fix

This update fixes the backend build error:

```text
Property 'isAnonymous' does not exist on type 'AuthResult'.
```

The daily challenge route now stores `authIsAnonymous` only after checking the `auth.ok` branch. This keeps TypeScript narrowings valid for both authenticated and unauthenticated requests.

Updated files:

- `app/api/daily-challenge/route.ts`
- `app/api/levels/route.ts`
- `app/api/levels/progress/route.ts`
- `app/api/progress/sync/route.ts`

Run:

```bash
npm install
npm run build
```
