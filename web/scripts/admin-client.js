// admin-client.js — Supabase client for the admin page only.
// The admin page keeps its own session, separate from the app's, so signing in
// to one never signs in to the other. Sessions last only for the browser tab.

const ADMIN_SUPABASE_URL = 'https://msnholvugsehlxkvzlxp.supabase.co';
const ADMIN_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zbmhvbHZ1Z3NlaGx4a3Z6bHhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0OTUxMjgsImV4cCI6MjA5NjA3MTEyOH0.v9BjeRLE1l4RCkO7E3gmS0WiDLXk-O03xMtQ-UOKYrM';
const ADMIN_AUTH_STORAGE_KEY = 'tripcash-admin-auth';
const ADMIN_TURNSTILE_SITE_KEY = '0x4AAAAAAEm7OArk9r_5yrdA';

const db = supabase.createClient(ADMIN_SUPABASE_URL, ADMIN_SUPABASE_ANON_KEY, {
  auth: {
    storageKey: ADMIN_AUTH_STORAGE_KEY,
    storage: window.sessionStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
