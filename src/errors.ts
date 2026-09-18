/**
 * The SDK error taxonomy, per 06-api-contracts.md -- every failure a
 * caller can hit maps to exactly one of these, never a raw fetch/HTTP
 * error leaking through (REPOSITORY.md's "Failure modes"). Python's SDK
 * must mirror this set 1:1 when it exists.
 */
export class AdaSoulsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** 401/403 -- missing, invalid, or revoked credential; or an API key acting outside its own organization. */
export class AdaSoulsAuthError extends AdaSoulsError {}

/** Policy denied outright (no approval path) -- carries the same reasons/approvalsRequired the API returned. */
export class AdaSoulsPolicyError extends AdaSoulsError {
  constructor(message: string, readonly reasons: string[], readonly approvalsRequired: string[]) {
    super(message);
  }
}

/** The action was created but needs human approval before it can proceed -- not a failure, a pause. */
export class AdaSoulsApprovalPending extends AdaSoulsError {
  constructor(message: string, readonly economicActionId: string, readonly approvalsRequired: string[]) {
    super(message);
  }
}

/** Execution failed at the provider (an EconomicAction reaching status "failed"). */
export class AdaSoulsProviderError extends AdaSoulsError {
  constructor(message: string, readonly economicActionId: string, readonly result?: Record<string, unknown>) {
    super(message);
  }
}

/** 400 -- malformed request (bad shape, missing required field, unknown agent/delegation/etc). */
export class AdaSoulsValidationError extends AdaSoulsError {}

/** 429 -- carries the server's Retry-After (seconds), when present, so the caller doesn't have to parse the header itself. */
export class AdaSoulsRateLimitError extends AdaSoulsError {
  constructor(message: string, readonly retryAfterSeconds?: number) {
    super(message);
  }
}

/**
 * Not part of the documented taxonomy (that's for REST-layer failures) --
 * a client-side SDK convenience: execute() without an explicit
 * delegationId needs GET /agents/:id/authority to find one covering the
 * requested capability, and none did.
 */
export class AdaSoulsNoDelegationError extends AdaSoulsError {}
