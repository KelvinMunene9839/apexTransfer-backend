// Mirrors the authorization check inside update_account_balance itself
// (prestigevuntures/supabase/migrations/20260811000001_authorize_balance_rpcs.sql)
// — kept here because callRpcAsService (services/rpc.js) calls Postgres as
// service_role, which bypasses that check entirely, so Node must enforce it
// instead. If that migration's rule ever changes, this needs to change with
// it — the two are no longer the same code, just the same rule.
function canModifyBranchBalance(user, branchId) {
  if (user.role === 'admin' || user.role === 'accountant' || user.role === 'super_teller') return true;
  return user.branchId === branchId && user.role !== 'auditor';
}

// Mirrors approve_petit_cash_entry's own check — stricter than
// canModifyBranchBalance: no branch-membership fallback, no super_teller.
function isAdminOrAccountant(user) {
  return user.role === 'admin' || user.role === 'accountant';
}

// Mirrors currency_pairs/exchange_rates' own RLS (pairs_admin_all,
// rates_admin) — admin only, stricter than isAdminOrAccountant.
function isAdmin(user) {
  return user.role === 'admin';
}

// Mirrors payment_accounts' own pa_insert/pa_delete RLS — admin,
// accountant, or super_teller, no branch-membership fallback for tellers
// (unlike canModifyBranchBalance) and no super_teller exception on the
// table's own update policy (see isAdminOrAccountant for that one).
function isAdminAccountantOrSuperTeller(user) {
  return user.role === 'admin' || user.role === 'accountant' || user.role === 'super_teller';
}

// Mirrors transactions' own insert policies (txn_admin_all,
// txn_accountant_insert, txn_teller_insert): admin/accountant can create
// a transaction for any teller_id, a teller/super_teller only for their
// own — different shape from every other helper here (checks identity,
// not branch membership). branch_manager included on the same
// identity-only basis as teller/super_teller — RLS on transactions/
// shifts/petit_cash_entries/losses already scopes them to their own
// branch, so this only needed to stop blocking their own writes.
function canCreateTransactionForTeller(user, tellerId) {
  if (user.role === 'admin' || user.role === 'accountant') return true;
  return (user.role === 'teller' || user.role === 'super_teller' || user.role === 'branch_manager') && user.id === tellerId;
}

// Mirrors transactions' own txn_update RLS exactly: admin, or the
// teller/super_teller who owns the row (no accountant, no branch-manager
// fallback — unlike canModifyBranchBalance). Used for actions the row's
// own owner performs on themselves (accept/reject a rate recommendation,
// mark their own transaction complete) — AML/special-rate review actions
// on someone else's row require the stricter isAdmin instead, since only
// admin can update a transaction it doesn't own under this same RLS rule.
function canModifyTransaction(user, tx) {
  if (user.role === 'admin') return true;
  return (user.role === 'teller' || user.role === 'super_teller') && user.id === tx.teller_id;
}

// Mirrors petit_cash_entries' own petit_insert (any authenticated user may
// insert a row with teller_id = their own id — no role check at all) OR
// petit_insert_admin (admin/accountant may insert for anyone) policies —
// broader than every other insert rule here: there's no teller/super_teller
// role restriction, just an identity check for non-admin/accountant callers.
function canCreatePetitCashEntry(user, tellerId) {
  if (user.role === 'admin' || user.role === 'accountant') return true;
  return user.id === tellerId;
}

// Mirrors shifts' own shifts_own_teller RLS write check (identical shape
// to petit_cash_entries' insert rule): any authenticated user may write a
// shift they own (teller_id = auth.uid()), admin/accountant may act on
// anyone's. The read side of that same policy additionally allows a
// branch_manager to see (not write) shifts in their branch — irrelevant
// here since every write endpoint needs this stricter check.
function canModifyShift(user, tellerId) {
  if (user.role === 'admin' || user.role === 'accountant') return true;
  return user.id === tellerId;
}

// Mirrors ledger_entries' own two overlapping insert policies
// (ledger_insert + "ledger_entries branch_manager insert") combined —
// admin/accountant/teller/super_teller/branch_manager, i.e. every
// non-auditor role. Unlike every other table in this migration, there's
// no identity or branch-ownership check at all: any of these roles can
// write a ledger entry for any branch. Mirrored as-is, not tightened —
// this is the table's existing permissiveness, not a bug found here.
function canWriteLedgerEntry(user) {
  return ['admin', 'accountant', 'teller', 'super_teller', 'branch_manager'].includes(user.role);
}

module.exports = { canModifyBranchBalance, isAdminOrAccountant, isAdmin, isAdminAccountantOrSuperTeller, canCreateTransactionForTeller, canModifyTransaction, canCreatePetitCashEntry, canModifyShift, canWriteLedgerEntry };
