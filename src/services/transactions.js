const { serviceClient } = require('./rpc');

// Looks up just enough to authorize an action on a transaction (branch_id)
// before calling an RPC as service_role — the RPC itself only takes
// p_tx_id, not p_branch_id, so Node has to resolve which branch it belongs
// to before it can apply canModifyBranchBalance (services/balanceAuth.js).
async function getTransactionBranchId(txId) {
  const { data, error } = await serviceClient
    .from('transactions')
    .select('branch_id')
    .eq('id', txId)
    .maybeSingle();
  if (error) throw error;
  return data?.branch_id ?? null;
}

module.exports = { getTransactionBranchId };
