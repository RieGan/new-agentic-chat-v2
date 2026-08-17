# Task 12 determinism failure evidence

- State machine tests exercised all 13 legal and all 36 illegal pairs in the shared seven-state transition matrix.
- Correlation tests rejected wrong run, call, approval, job, and User-correlation identities, wrong signal kinds, pre-wait signals, and terminal-state signals without changing inspect state.
- A real `reconcileStart` Activity failed after its first canonical commit, retried with the same idempotency key, and completed after two attempts with one logical start effect.
- Stable keys covered start intent, workflow history position, approval ID, User correlation ID, and job ID; eight Activity effects remained unique across the legal scenario.
- The recursive workflow-source import graph found no database, AI SDK, tool package, BullMQ, Redis, PostgreSQL, Node built-in, filesystem, clock, random, or application I/O imports.
- Production State Workflow modules measured 7-151 pure LOC, below the 250-line ceiling.
