import { type CallId, InvalidApprovalError } from "@agentic-chat/contracts"

export type ApprovalBinding = {
  readonly callId: CallId
  readonly argumentsHash: string
}

const approvalAuthorizationBrand = Symbol("ApprovalAuthorization")

export interface ApprovalAuthorization {
  readonly [approvalAuthorizationBrand]: true
  consume(binding: ApprovalBinding): void
}

export interface ApprovalAuthorizationIssuer {
  issue(binding: ApprovalBinding): ApprovalAuthorization
}

class SingleUseApprovalAuthorization implements ApprovalAuthorization {
  readonly [approvalAuthorizationBrand] = true
  private consumed = false

  constructor(private readonly approvedBinding: ApprovalBinding) {}

  consume(binding: ApprovalBinding): void {
    if (this.consumed) throw new InvalidApprovalError("authorization already consumed")
    if (
      binding.callId !== this.approvedBinding.callId ||
      binding.argumentsHash !== this.approvedBinding.argumentsHash
    ) {
      throw new InvalidApprovalError("authorization binding mismatch")
    }
    this.consumed = true
  }
}

export const createApprovalAuthorizationIssuer = (): ApprovalAuthorizationIssuer => ({
  issue: (binding) => new SingleUseApprovalAuthorization(binding),
})
