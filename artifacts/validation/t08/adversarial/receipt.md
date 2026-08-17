# Task 08 Adversarial Evidence

- Fixed User context was rejected for approval decisions and hidden-command submission.
- Tampered arguments/hash, expired approvals, wrong-run execution, completed runs, duplicate sends, and already-decided approval races failed typed with zero prohibited sends.
- Concurrent approve/reject produced one terminal winner; concurrent approved execution produced one simulated-send winner.
- Changed Admin-command idempotency input, expiry, wrong target, completed target, unsafe boundary, and second application were rejected.
- `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm build`: exit 0.
- LSP directory diagnostics: zero errors in DB/runtime source and tests plus testkit source.
