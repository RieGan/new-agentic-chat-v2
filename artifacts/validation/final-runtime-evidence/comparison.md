# Runtime comparison

## Release gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Isolated restart and adversarial delivery | PASS | final-runtime-evidence/restart.json |
| Task 17 schema-v2 parity | PASS | final-runtime-evidence/parity.json |
| Temporal history replay | PASS | final-runtime-evidence/temporal-replay.json |

Release gates have exact PASS criteria. PENDING is not accepted as a completed release result.

## Non-gating measurements

These observations have no pass threshold and do not select a runtime by themselves.

| Measurement | Simple Loop | State Workflow |
| --- | ---: | ---: |
| Compose worker health recovery (ms) | 6491 | 10559 |
| Runtime-specific source lines | 1222 | 1334 |
| Shared parity gate duration (ms) | 8783 | 8783 |

Task 17 records do not contain per-flow wall-clock latency, so this report does not fabricate F01/F03 median or p95 values. Recovery and implementation complexity remain measured observations without release thresholds.
