import type { ApprovalsRepository } from "./approvals-repository.js";
import type { ApprovalExpiryResult } from "./approvals-types.js";

export interface ApprovalExpiryWorker {
  processExpiredApprovals(): Promise<ApprovalExpiryResult>;
}

export interface ApprovalExpiryWorkerOptions {
  batchSize?: number;
  now?: () => Date;
}

export function createApprovalExpiryWorker(
  repository: Pick<ApprovalsRepository, "expireDue">,
  options: ApprovalExpiryWorkerOptions = {},
): ApprovalExpiryWorker {
  const now = options.now ?? (() => new Date());
  const batchSize = options.batchSize ?? 100;
  return {
    processExpiredApprovals: () => repository.expireDue(now(), batchSize),
  };
}
