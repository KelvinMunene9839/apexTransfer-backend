const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const schema = require('../db/schema');
const { databaseUrl } = require('./env');

// Pooled (port 6543, PgBouncer transaction mode) connection string is
// required in DATABASE_URL — this app deploys to Vercel (see ../../vercel.json),
// where each invocation is a short-lived process, so `prepare: false` and a
// small connection cap are both needed for transaction-mode pooling.
// https://supabase.com/docs/guides/database/connecting-to-postgres#serverless
const sql = postgres(databaseUrl, {
  prepare: false,
  max: 1,
});

const db = drizzle(sql, { schema });

module.exports = { db, sql };
