# Accounts and sync setup (Supabase, free tier)

About 5 minutes, once. After this, signing in on any device shows the same collection.

## 1. Create the project
1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Name it `pokebomb`, pick a region near you, and let it generate a database password (you won't need it again).

## 2. Create the tables and privacy rules
1. In the project: **SQL Editor** → **New query**.
2. Paste the whole of [`supabase/migrations/001_collection.sql`](../supabase/migrations/001_collection.sql) and click **Run**.

This creates one table of cards with **row level security**: the database only ever returns or changes rows belonging to the signed-in account. `supabase/rls.test.ts` checks that against real Postgres on every CI run.

## 3. Turn on 6-digit email codes
The app signs in with a code instead of a link (links open Safari, not the home-screen app).

1. **Authentication → Emails → Templates**.
2. In both **Magic Link** and **Confirm signup**, replace the body with:
   ```html
   <h2>Your Pokebomb code</h2>
   <p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
   ```
3. Save.

Supabase's built-in email only sends to members of your Supabase organisation, which is exactly you. So nobody else can even create an account. (To let others sign up later, add your own SMTP under **Authentication → Emails → SMTP**.)

## 4. Connect the app
1. **Project Settings → API**: copy the **Project URL** and the **publishable / anon** key.
2. Put them in [`src/cloudConfig.ts`](../src/cloudConfig.ts), or add repo variables `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Settings → Secrets and variables → Actions → Variables).

Both values are public by design: every visitor's browser receives them. The database rules are what protect your data. **Never** put the `service_role` key anywhere in this repo.

## 5. Sign in
Open the app → **Settings → Account & sync** → enter your email → type the code. Cards already on that device are added to your account. Do the same on your other devices.
