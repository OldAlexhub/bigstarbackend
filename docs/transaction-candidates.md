# MongoDB transaction boundaries

The production-readiness cleanup made the critical multi-document state transitions atomic. The server enables Mongoose transaction session propagation, verifies replica-set or sharded-cluster support before startup, and runs these boundaries with snapshot reads and majority writes.

## Protected workflows

- Standby deployment updates the standby day, clears any previous covered route, updates the newly covered route, and synchronizes generated issues in one transaction. A partial unique index also guarantees that only one deployed standby can cover a `(division, date, coveringRoute)` tuple.
- Run-cut creation, editing, and deletion include assignment projection, future run-cut days, generated issues, and change-log rows in the same transaction.
- Scheduled assignment rollover projects each run cut in its own transaction so one route cannot be left partially projected without creating one very large cross-division transaction.
- Route retirement removes future generated issues and run-cut days, clears standby dispositions, removes the current run cut, and retires the route atomically.
- Network Success confirmation and removal update submissions, KPI entries, aliases, and audit data atomically. Reopening and reusable performance assignments also protect their related writes.
- Deployment exception updates include the selected day, OSR follow-through for tomorrow, and generated issues in one transaction.

Activity-log writes and reporting refresh queues intentionally run after commit. They are derived, retryable side effects and must not cause an already-committed operational change to appear failed to the user.

## Operational requirement

MongoDB transactions are unavailable on standalone deployments. `MONGO_URL` must point to a replica set or sharded cluster; the process exits before `app.listen()` when the topology does not support transactions. Existing installations should check for duplicate active standby coverage before the new partial unique index is created.
