const { createClient } = require('@supabase/supabase-js');
const { supabaseUrl, supabaseServiceRoleKey } = require('../config/env');

// service_role bypasses RLS and the SECURITY DEFINER functions' own
// auth.uid()-based checks entirely — so any route calling through here MUST
// do its own authorization first (see services/balanceAuth.js). This is
// what makes Node an actual authorization boundary instead of a relay: the
// caller's JWT never reaches Postgres for these calls, so direct
// supabase.rpc() calls from a browser can be locked out (EXECUTE revoked
// from anon/authenticated) without breaking this path.
const client = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

function callRpcAsService(fnName, params) {
  return client.rpc(fnName, params);
}

module.exports = { callRpcAsService, serviceClient: client };
