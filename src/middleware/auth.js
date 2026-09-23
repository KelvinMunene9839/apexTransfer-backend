const { createClient } = require('@supabase/supabase-js');
const { eq } = require('drizzle-orm');
const { db } = require('../config/db');
const { profiles } = require('../db/schema');
const { ApiError } = require('../utils/ApiError');
const { supabaseUrl, supabaseServiceRoleKey } = require('../config/env');
const { asyncWrapper } = require('../utils/asyncWrapper');

// Service-role client used only to verify caller JWTs against Supabase
// Auth. All actual data access after this point goes through Drizzle, not
// this client — see prestigevuntures/MIGRATION_PLAN.md's "Why" section.
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

const requireUser = asyncWrapper(async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) throw new ApiError(401, 'Missing bearer token');

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) throw new ApiError(401, 'Invalid or expired token');

  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, data.user.id))
    .limit(1);

  if (!profile) throw new ApiError(403, 'No profile for this user');
  if (!profile.active) throw new ApiError(403, 'User is deactivated');

  req.user = {
    id: data.user.id,
    email: data.user.email,
    role: profile.role,
    organizationId: profile.organizationId,
    branchId: profile.branchId,
  };
  // Kept for routes that relay to a Supabase RPC as the caller (see
  // services/rpc.js) so DB-side SECURITY DEFINER authorization keeps
  // running against the real caller instead of the service role.
  req.token = token;
  next();
});

function requireRole(...allowed) {
  return (req, res, next) => {
    if (!allowed.includes(req.user.role)) {
      throw new ApiError(403, `Role '${req.user.role}' is not permitted for this action`);
    }
    next();
  };
}

module.exports = { requireUser, requireRole };
