---
title: "PostgreSQL and Supabase for Production Apps: What You Need to Know"
description: "Row-level security, connection pooling, indexes, database functions, and the Supabase tradeoffs that show up once an app has real traffic."
date: "2026-07-13"
updated: "2026-11-11"
category: "Backend"
readTime: "3 min read"
hero: "/blog/images/postgresql-and-supabase-for-production-apps-what-you-need-to.webp"
heroAlt: "PostgreSQL and Supabase for Production Apps: What You Need to Know"
heroWidth: 1600
heroHeight: 1112
---

PostgreSQL with Supabase is ready for production only after row-level security, connection pooling, and indexes are deliberate choices. Those are the pieces that surprise people once traffic shows up. Query syntax is rarely the hard part.

## Row-Level Security Is Non-Negotiable

The biggest mistake teams make with Supabase is treating Row-Level Security (RLS) as optional. It's not. When you expose your database directly to the client via Supabase's auto-generated APIs, RLS is your **only** security layer. I learned this when a user discovered they could modify the request payload to access other users' data. We had RLS disabled during development and forgot to enable it before launch.

Here's a production-ready RLS policy pattern I use for every multi-tenant table:

```sql
-- Enable RLS on the table
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Policy for SELECT: users can only see their own projects
CREATE POLICY "Users can view own projects"
  ON projects
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy for INSERT: users can only create projects for themselves
CREATE POLICY "Users can insert own projects"
  ON projects
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy for UPDATE: users can only update their own projects
CREATE POLICY "Users can update own projects"
  ON projects
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy for DELETE: users can only delete their own projects
CREATE POLICY "Users can delete own projects"
  ON projects
  FOR DELETE
  USING (auth.uid() = user_id);
```

> **Critical:** Test your RLS policies by attempting to access data as different users. Create a test suite that tries to bypass your policies. If you can't prove your policies work, assume they don't.

## Connection Pooling: The Silent Killer

PostgreSQL has a hard limit on connections. Supabase's free tier gives you 60 connections, paid tiers give you 200. Sounds like a lot until you realize that **every** serverless function, every browser tab with an active subscription, and every API client holds a connection. We hit the limit at 500 concurrent users because each user's browser maintained a realtime subscription.

The solution is to use Supabase's connection pooler for transactional queries and be aggressive about closing connections:

```typescript
import { createClient } from '@supabase/supabase-js';

// Use the pooler connection string for server-side operations
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

// For Edge Functions or API routes, use transaction mode
const supabase = createClient(
  supabaseUrl.replace('https://', 'https://').replace('.supabase.co', '.pooler.supabase.com'),
  supabaseKey,
  {
    db: {
      schema: 'public',
    },
    auth: {
      persistSession: false, // Critical for serverless
      autoRefreshToken: false,
    },
  }
);

// For long-lived connections (realtime), use the standard connection
const supabaseRealtime = createClient(supabaseUrl, supabaseKey);

// Always clean up realtime subscriptions
const channel = supabaseRealtime
  .channel('changes')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, (payload) => {
    console.log('Change received!', payload);
  })
  .subscribe();

// When component unmounts or user leaves
const cleanup = () => {
  channel.unsubscribe();
};
```

## Indexes Are Your Friend (Until They're Not)

PostgreSQL query performance lives and dies by indexes. But here's the thing: Supabase's automatic API generation doesn't create indexes for you. Every foreign key, every column you filter on, every column you sort by—these all need indexes in production.

- Index all foreign keys (Supabase doesn't do this automatically)
- Index columns used in WHERE clauses and JOIN conditions
- Use partial indexes for soft-deleted records: `CREATE INDEX idx_active_projects ON projects(user_id) WHERE deleted_at IS NULL;`
- Monitor with `pg_stat_statements` to find slow queries
- Use `EXPLAIN ANALYZE` religiously before deploying queries

I once had a query that took 8 seconds on a table with 100k rows. Added a composite index on `(user_id, created_at)` and it dropped to 12ms. The query planner needs help—give it the tools.

## Database Functions: The Underrated Powerhouse

Want to know the biggest performance win I've implemented? Moving complex business logic from JavaScript to PostgreSQL functions. When you need to aggregate data, perform calculations, or handle complex transactions, doing it in the database is 10-100x faster than round-tripping data to your application layer.

```sql
-- Complex aggregation that would require multiple queries in JS
CREATE OR REPLACE FUNCTION get_user_dashboard_stats(user_uuid UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'total_projects', COUNT(DISTINCT p.id),
    'active_tasks', COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'active'),
    'completed_this_month', COUNT(DISTINCT t.id) FILTER (
      WHERE t.status = 'completed' 
      AND t.completed_at >= date_trunc('month', CURRENT_DATE)
    ),
    'team_members', COUNT(DISTINCT tm.user_id)
  )
  INTO result
  FROM projects p
  LEFT JOIN tasks t ON t.project_id = p.id
  LEFT JOIN team_members tm ON tm.project_id = p.id
  WHERE p.user_id = user_uuid AND p.deleted_at IS NULL;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

Then call it from your client with a single query: `supabase.rpc('get_user_dashboard_stats', { user_uuid: userId })`. One round trip instead of five. One transaction instead of five. No N+1 queries.

> **Warning:** Use `SECURITY DEFINER` carefully. It runs with the permissions of the function creator, bypassing RLS. Only use it when you've validated inputs and need to perform operations the user couldn't do directly.

## The Supabase Tradeoffs

Supabase is incredible for moving fast, but it's not magic. You're trading operational complexity for architectural constraints. You get instant APIs, auth, and realtime subscriptions, but you're locked into their client libraries and API patterns. You get managed PostgreSQL, but you're sharing resources on lower tiers and dealing with connection limits.

For early-stage products and MVPs, this tradeoff is absolutely worth it. For high-scale applications with complex requirements, you'll eventually need to run your own PostgreSQL instance or use Supabase's paid tiers with dedicated resources. The key is knowing when you're approaching those limits and planning the migration before you're in crisis mode. Monitor your connection count, query performance, and database size. Set up alerts. Don't wait until your app is down to realize you've outgrown your tier.
