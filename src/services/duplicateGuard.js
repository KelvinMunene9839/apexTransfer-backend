// Catches double-submit races (double-click, a slow request retried by the
// client, a flaky connection resubmitting) at the one place that actually
// prevents them: before the row is ever created. Confirmed live this
// session — a teller's Kisementi->Super Teller inter-branch trade got
// submitted 2-3 times within 15-52 seconds on five separate occasions
// (same from/to branch, same currency, same amount, same reviewer, even
// the same wac_cost_rate to 6 decimals, which two genuinely independent
// trades minutes apart essentially never share), each one settling as a
// real, separate, fully-balanced trade -- silently moving real money and
// real WAC stock twice for what was actually one customer request. Every
// one of those had to be found via a manual SQL sweep and reversed by
// hand well after the fact.
//
// This only ever narrows the create window (a real second identical
// request submitted more than windowSeconds later still goes through
// fine) -- it does not touch the approval/settlement pipeline at all, so
// it can't itself corrupt a legitimate trade.
const { serviceClient } = require('./rpc');

// table: table to check. matchFields: exact-match columns identifying "the
// same submission" (never include free-text fields like notes/reference).
// windowSeconds: how recent a match has to be to count.
// excludeVoided: skip rows already voided (an already-corrected duplicate
// shouldn't block a legitimate new submission).
async function findRecentDuplicate(table, matchFields, { windowSeconds = 45, excludeVoided = true } = {}) {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  let q = serviceClient.from(table).select('id, reference, created_at').gte('created_at', since);
  for (const [key, value] of Object.entries(matchFields)) {
    if (value == null) continue;
    q = q.eq(key, value);
  }
  if (excludeVoided) q = q.eq('voided', false);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(1);
  if (error) return { error };
  return { duplicate: data && data[0] ? data[0] : null };
}

module.exports = { findRecentDuplicate };
