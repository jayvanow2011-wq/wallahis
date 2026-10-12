# Database Migration Guide - Complete Schema Setup

## Overview

This guide helps you migrate your complete database schema to your new Supabase instance. You have a full SQL migration script ready to be executed.

## Step 1: Access Supabase SQL Editor

1. Go to your Supabase dashboard: https://app.supabase.com
2. Select your project: `meliclbrxpurpsdiizbv`
3. Click on **SQL Editor** in the left sidebar
4. Click **New Query**

## Step 2: Execute the Migration SQL

The complete schema migration SQL is available in:
```
scripts/migrate-full-schema.sql
```

### Option A: Copy-Paste the SQL (Recommended)

1. Open `scripts/migrate-full-schema.sql` from the v0 project
2. Copy all the SQL content
3. Paste it into the Supabase SQL Editor
4. Click **Run** button
5. Wait for completion

### Option B: Execute Via Command Line

If you have Supabase CLI installed:

```bash
# Login to Supabase
supabase login

# Push schema
supabase db push

# Or execute SQL directly
supabase db execute < scripts/migrate-full-schema.sql
```

## Tables Created

### Auth Tables (neon_auth schema)
- `user` - User profiles
- `account` - Account/login records
- `session` - User sessions
- `verification` - Email verification
- `organization` - Organization profiles
- `member` - Organization members
- `invitation` - Organization invites
- `jwks` - JWT key storage
- `project_config` - Project configuration

### Public Tables (new)

**User & Profile**
- `profiles` - User profiles & metadata
- `user_roles` - User role assignments

**Device Management**
- `devices` - Connected devices
- `device_metrics` - Device performance metrics
- `device_access` - Device access control
- `device_permissions` - Device permissions

**Social Features**
- `friendships` - Friend relationships
- `community_posts` - Community posts
- `direct_messages` - Direct messaging
- `notifications` - User notifications

**Monetization**
- `referrals` - Referral tracking
- `free_claims` - Free reward claims
- `subscriptions` - User subscriptions

**Infrastructure**
- `turn_servers` - TURN server configs
- `server_endpoints` - Server endpoints
- `builds` - Build records
- `commands` - Command execution
- `command_results` - Command results
- `build_server_config` - Build config

**System**
- `recovery_codes` - Recovery codes
- `sessions` - Session tracking
- `audit_logs` - Audit logging
- `app_settings` - App configuration
- `ad_spots` - Advertisement spots
- `bio_links` - Bio links
- `client_shares` - Client shares

## Columns Included

All tables include essential columns:

### Common Columns
- `id` - UUID primary key
- `created_at` - Creation timestamp
- `updated_at` - Update timestamp (where applicable)

### User-Related
- `user_id` - Reference to auth.user
- `email` - Email address
- `username` - Username
- `role` - User role

### Device-Related
- `device_id` - Device reference
- `device_name`, `device_type`, `device_os`
- `ip_address`, `mac_address`
- `last_seen` - Last activity timestamp

### Metrics
- `cpu_usage`, `memory_usage`, `disk_usage`
- `temperature`, `battery_level`
- `network_speed`, `uptime_seconds`

### Social
- `likes_count`, `comments_count`, `shares_count`
- `followers_count`, `following_count`
- `is_read`, `status`

## Step 3: Verify Migration

After running the SQL:

1. Go to **Database** in Supabase dashboard
2. Verify all tables are created:
   - Check `neon_auth` schema
   - Check `public` schema
3. Click on each table to verify columns

Expected table count: **30+ tables**

## Step 4: Update App Configuration

### Environment Variables

Your app is already configured with:
- `NEXT_PUBLIC_SUPABASE_URL` ✅
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` ✅
- `SUPABASE_SERVICE_ROLE_KEY` ✅
- `SUPABASE_JWT_SECRET` ✅

### No Code Changes Needed

The Supabase client is already configured to use these environment variables automatically.

## Step 5: Migrate Data (Optional)

If you have existing data in your old database:

1. Export data from old database
2. Import to new Supabase tables

### Export from Old Database

```sql
SELECT * FROM old_database.public.devices;
SELECT * FROM old_database.public.commands;
-- etc for each table
```

### Import to Supabase

Use Supabase import feature:
1. Go to **Database** → **Import Data**
2. Select CSV/SQL file
3. Map columns
4. Import

## Step 6: Test the Connection

Run the build:
```bash
npm run build
```

Start the dev server:
```bash
npm run dev
```

Test authentication:
1. Go to `http://localhost:8083`
2. Login with admin user: `jayjay / jayjay100!`
3. Check console for any errors

## Troubleshooting

### Permission Denied Errors
- Ensure you're using `SUPABASE_SERVICE_ROLE_KEY` (not anon key)
- Service role key needed for schema creation

### Table Already Exists
- Normal if running migration twice
- Script uses `IF NOT EXISTS` to avoid errors

### Connection Timeout
- Check your Supabase URL is correct
- Verify service role key is valid
- Check network connectivity

### Missing Columns
- Verify migration completed successfully
- Check `scripts/migrate-full-schema.sql` has all columns
- Re-run migration if needed

## Next Steps

1. ✅ Run migration SQL in Supabase editor
2. ✅ Verify tables created
3. ✅ Test authentication
4. ✅ Deploy to production

## Support

If you encounter issues:
1. Check Supabase logs: Dashboard → Logs
2. Verify table structure: Dashboard → Database
3. Test queries in SQL editor
4. Check app environment variables: Project Settings → Environment Variables

---

**Status**: Ready for migration
**Created**: 2024
**Tables**: 30+
**Columns**: 100+
