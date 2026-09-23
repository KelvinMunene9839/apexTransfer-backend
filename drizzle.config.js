require('dotenv').config();
const { defineConfig } = require('drizzle-kit');

// Uses the DIRECT (port 5432) connection for CLI operations (introspect,
// generate, migrate). Runtime app code uses the pooled connection instead
// — see src/config/db.js.
module.exports = defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.js',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DIRECT_DATABASE_URL,
  },
});
