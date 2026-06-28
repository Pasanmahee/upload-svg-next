# Vercel Node.js 24 Fix

Vercel is warning that Node.js 20.x is deprecated for future deployments.

This update sets the backend project to Node.js 24.x for Vercel and local consistency.

Updated files:

- `package.json`
- `package-lock.json`
- `.nvmrc`
- `.node-version`
- `Dockerfile`

Important Vercel step:

1. Open Vercel Dashboard.
2. Select the backend project.
3. Go to Settings → Build and Deployment.
4. Set Node.js Version to `24.x`.
5. Redeploy with cleared build cache if Vercel still uses the old version.

Local test:

```bash
nvm install 24
nvm use 24
npm install
npm run build
```
