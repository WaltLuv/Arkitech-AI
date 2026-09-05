# One AgentRun, not a separate ComputerRun

Computer-use executions look different enough from chat executions that a separate `ComputerRun` table is the obvious first instinct: they have screenshots, turns, approvals, and a live viewer. We decided against it. A computer execution is an `AgentRun` like any other, distinguished only by its Agent's Execution Mode, with its desktop-specific detail in `ComputerEvent` rows that point at the Run.

## Considered Options

A separate `ComputerRun` table, mirroring `AgentRun` with extra columns. Rejected because every cross-cutting concern would have to be built twice and then unioned back together: the scheduler, the credit ledger, the run history UI, the "is this agent already running" check, and the usage dashboard. The Credit Ledger in particular has one `runId`, and two run tables would mean either two foreign keys or an untyped polymorphic reference.

## Consequences

`AgentRun` carries columns that are null for `standard` Runs (`controlState`, and the desktop it used). That is the price, and it is smaller than maintaining two lifecycles.

Control endpoints live under the Run (`/api/runs/:id/pause`), not under a parallel `/api/computer-runs` resource, so pause and cancel have one implementation regardless of mode.

Run Status stays the persisted lifecycle for every kind of execution. Who currently holds the keyboard is a separate concern, `controlState`, precisely so that this decision does not force the two ideas together.
