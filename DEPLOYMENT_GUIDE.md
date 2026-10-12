# Deployment Guide - zip-prep-pal.xyz

## Quick Start: Deploy to Vercel

### Step 1: Connect GitHub Repository
Your project is already connected to GitHub via the branch system.

```bash
# Current branch: website-migration-and-fixes
# Base branch: main
# Repo: jayvanow2011-wq/remix-of-remix-of-remix-of-remix-of-remix-of-full-stack-embrace
```

### Step 2: Deploy via Vercel Dashboard
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project: `jayvanow2011-wq-remix-of-remix...`
3. Click "Deploy"
4. Select "Merge to production" or "Deploy"

The deployment will automatically:
- Build the project with `npm run build`
- Deploy Nitro output to your hosting
- Set environment variables from Supabase integration

### Step 3: Test Live Environment
After deployment, verify:
- [ ] Login page loads at domain
- [ ] Sign up form works
- [ ] Authentication flows complete
- [ ] Dashboard loads when authenticated
- [ ] All pages render correctly

---

## Manual Deployment Options

### Option A: Cloudflare Workers (Recommended for TanStack Start)
```bash
# Build production bundle
npm run build

# Deploy to Cloudflare Workers
npx nitro deploy --prebuilt

# Or manually push to Cloudflare
# Copy .output/server files to your worker script
```

### Option B: Node.js Hosting (Self-hosted)
```bash
# Build
npm run build

# Copy .output directory to your server
# Install dependencies: npm install
# Start server: node .output/server/index.mjs

# Environment variables needed:
export SUPABASE_URL="..."
export SUPABASE_PUBLISHABLE_KEY="..."
export SUPABASE_SERVICE_ROLE_KEY="..."
export NODE_ENV="production"
```

### Option C: Docker Deployment
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY .output ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
```

---

## Environment Variables Checklist

### Required (Configured via Supabase Integration)
- ✅ `SUPABASE_URL` - Your Supabase project URL
- ✅ `SUPABASE_PUBLISHABLE_KEY` - Public/anon key
- ✅ `SUPABASE_SERVICE_ROLE_KEY` - Service role key (server-side only)

### Optional (Already Set)
- ✅ `NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL` - OAuth callback

### Custom Environment Variables (If Adding)
If you need to add custom env vars:
1. In Vercel: Project Settings → Environment Variables
2. Add variable: e.g., `API_KEY=value`
3. Redeploy project

---

## Database Setup

### Current Schema
The database already has:
- ✅ Auth tables (user, session, account, etc.)
- ✅ Verification table for email confirmations
- ✅ JWKS table for token signing
- ✅ Organization & member tables
- ✅ Project config table

### Migration Path
If you need to add new tables:
1. Create via Supabase dashboard
2. Enable RLS if needed
3. Update TypeScript types in `src/integrations/supabase/types.ts`
4. Use in your code

---

## Monitoring & Debugging

### View Live Logs
```bash
# For Vercel deployments
vercel logs <project-name>

# For Cloudflare Workers
wrangler tail --format pretty
```

### Supabase Dashboard
Monitor:
- Auth → Users (see sign-ups)
- Auth → Logs (see login attempts)
- Database → Tables (verify data)
- Real-time → Subscriptions (if using)

### Performance Monitoring
The app includes error capture. Errors will appear in:
- Browser console (F12)
- Supabase logs (if auth-related)
- Application logs (check your hosting dashboard)

---

## Rollback Plan

If deployment causes issues:

### Vercel Rollback
1. Go to project settings
2. Click "Deployments"
3. Select previous successful deployment
4. Click "Promote to Production"

### Manual Rollback
```bash
# Switch to previous branch
git checkout main
git log --oneline | head -5

# Deploy previous version
npm run build
# Deploy .output folder
```

---

## Performance Optimization

### Already Optimized
- ✅ Tailwind CSS v4 (smaller bundle)
- ✅ Code splitting via Vite
- ✅ Lazy loading of routes
- ✅ SWR for data fetching

### Additional Steps (Optional)
1. Enable compression on server
2. Set up CDN for static assets
3. Monitor Core Web Vitals
4. Optimize images (if added)

---

## Common Issues & Solutions

### Issue: "Supabase connection failed"
**Solution:** 
1. Check environment variables in Vercel
2. Verify Supabase project is active
3. Check firewall rules don't block connection

### Issue: "Auth redirect loop"
**Solution:**
1. Verify redirect URL matches Supabase config
2. Check NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL
3. Clear browser cookies and try again

### Issue: "Build fails"
**Solution:**
1. Run locally: `npm run build`
2. Check for TypeScript errors: `npx tsc --noEmit`
3. Check dependencies installed: `npm ci`
4. Check Node version (should be 18+)

### Issue: "Database queries fail"
**Solution:**
1. Verify RLS policies in Supabase
2. Check user ID is passed to queries
3. Verify service role key is available for admin operations

---

## Production Checklist

Before going live:
- [ ] Build completes without errors
- [ ] All pages load in test environment
- [ ] Authentication flows work
- [ ] Database queries return correct data
- [ ] Error boundaries catch errors gracefully
- [ ] Redirect URLs configured in Supabase
- [ ] Environment variables set in production
- [ ] HTTPS enabled (automatic on Vercel/CF)
- [ ] Custom domain configured (if applicable)
- [ ] SSL certificate installed (if self-hosted)

---

## Getting Help

### Documentation
- [Vercel Deployment Docs](https://vercel.com/docs/deployments)
- [Supabase Auth Docs](https://supabase.com/docs/guides/auth)
- [TanStack Router Docs](https://tanstack.com/router/latest)
- [Vite Deployment Guide](https://vitejs.dev/guide/static-deploy.html)

### Support
- Vercel Support: https://vercel.com/support
- Supabase Support: https://supabase.com/support
- GitHub Issues: Check your repository

---

## Next: What's Running Now

**Current Status:**
- ✅ Dev server running on `localhost:8083`
- ✅ All routes accessible
- ✅ Database connected
- ✅ Build successful (7.71s)
- ✅ Ready for deployment

**Next Step:** Push to your Git repository, then deploy via Vercel dashboard.

---

*Generated: July 9, 2026*
*Framework: TanStack Start + Vite*
*Runtime: Node.js / Cloudflare Workers*
