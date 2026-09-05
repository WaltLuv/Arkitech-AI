# Arkitech AI

A platform for configuring, scheduling, and running AI agents on a user's behalf. Agents are assembled from a saved configuration, given tools, and executed on demand or on a schedule. Some agents drive a real desktop.

## Language

### Agents

**Agent**:
A user's saved, named configuration: instructions, objective, skills, tools, and schedule. The thing a user creates, edits, pauses, and deletes.
_Avoid_: bot, assistant, agent config (in prose; `AgentConfig` remains the table name)

**Runtime Agent**:
The in-memory OpenAI Agents SDK object built from an **Agent** at execution time, carrying its resolved tools. Never persisted, rebuilt on every run.
_Avoid_: agent instance, live agent

**Execution Mode**:
Which runtime an **Agent** uses: `standard` (tools and chat only) or `computer` (drives a **Desktop**). A property of the Agent, not a tool it connects to.
_Avoid_: agent type, agent kind

**Agent Slot**:
One unit of a user's quota on how many **Agents** they may have. The quota is 3. Paused Agents occupy a slot; deleting an Agent frees one. Execution Mode does not change the cost.
_Avoid_: agent credit (the DB column stays `agentCredits`), agent limit

### Running

**Run**:
One execution of an **Agent**, persisted with the lifecycle it moved through. The single record of "an Agent executed", whatever its Execution Mode.
_Avoid_: job, execution, task, invocation, computer run

**Run Status**:
The persisted lifecycle of a **Run**, and only that: `scheduled`, `queued`, `running`, `completed`, `failed`, `cancelled`. Never describes what a dispatcher decided, nor who currently holds the keyboard.
_Avoid_: run state, status (unqualified)

**Control State**:
Who is driving a **Run** right now: `agent`, `paused`, `human`, or `waiting_approval`. Orthogonal to **Run Status**: a Run stays `running` while a human has taken over.
_Avoid_: control mode, run mode

**Dispatch Outcome**:
What the scheduler decided about one **Run** in one pass: `dispatched`, `skipped`, or `failed`. Reported by the cron job, never persisted on a Run. A Run whose dispatch was skipped is still `queued` or `running`, handled by another worker.
_Avoid_: status, dispatch status, skipped status

**Cancellation**:
A user deliberately stopping their own **Run**, recorded as `cancelled`. Distinct from `failed`: the platform did not break, the user changed their mind.
_Avoid_: abort, kill, stop (as a noun)

**Occurrence**:
One scheduled future execution of an **Agent**, which becomes a **Run** when it is enqueued. A schedule itself is free: nothing is charged until an Occurrence is accepted.
_Avoid_: scheduled run (before enqueue), cron job

### Credits

**Usage Credit**:
One unit of a user's allowance to run an **Agent**. A credit buys a successful result, not an attempt.
_Avoid_: credit (unqualified, where an **Agent Slot** may be meant), token, quota

**Credit Cost**:
How many **Usage Credits** one **Run** was charged, recorded on the Run itself. Priced by **Execution Mode** and captured at acceptance, so later price changes never rewrite history.
_Avoid_: price, run price

**Credit Ledger**:
The append-only record of every **Usage Credit** movement, and the source of truth for what a user has spent. The balance on the user row is a cache of it.
_Avoid_: transactions, credit history, audit log (which means something else here)

**Ledger Entry**:
One movement in the **Credit Ledger**: which **Agent** and **Run** it belongs to, the amount and direction, why it happened, the resulting balance, and an idempotency key that makes a retry a no-op.
_Avoid_: transaction, row

**Refund**:
The return of a **Run**'s **Credit Cost** when it failed through platform, worker, provider, or agent fault, or was cancelled before execution began. Identical for scheduled and on-demand Runs, and issued at most once per Run.
_Avoid_: credit back, reversal

### Desktops

**Desktop**:
An isolated Orgo-hosted machine that a `computer` **Agent** operates. Persistent in its files, identity, and installed applications, not in being always on: it is created lazily, started on demand, and stopped by Arkitech when its work ends or its **Control Lease** lapses, losing running processes and its IP each time.
_Avoid_: VM, computer (unqualified), sandbox, machine, instance

**Machine Status**:
What a **Desktop** itself is doing: `starting`, `running`, `stopping`, `stopped`, or `error`. Says nothing about who is controlling it.
_Avoid_: desktop state, computer status

**Control Lease**:
A held claim on a **Desktop** naming its owner, an expiry, and a version. Prevents two controllers driving one Desktop, including when no **Run** exists to carry a **Control State**.
_Avoid_: lock, mutex, ownership

**Computer Event**:
One recorded moment in a `computer` **Run**: a screenshot, a requested or executed action, an approval, a takeover, or a failure. The durable evidence a Run's history is rebuilt from.
_Avoid_: log, step, action record

**Desktop Template**:
A versioned Orgo snapshot a **Desktop** can be created from, giving a repeatable starting environment instead of a bare base image.
_Avoid_: image, snapshot, AMI
