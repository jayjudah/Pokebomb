// Supabase project for accounts and sync. These two values are public by
// design (every visitor's browser receives them); the database's row level
// security is what keeps each account's cards private. Leave empty to run
// the app without accounts. CI can also set VITE_SUPABASE_URL /
// VITE_SUPABASE_ANON_KEY instead.
export const CLOUD_URL = "";
export const CLOUD_ANON_KEY = "";
