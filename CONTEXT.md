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
Which runtime an **Agent** uses. Only `standard` (tools and chat) exists today. The concept is kept because **Credit Cost** is priced by it, so a second mode can be added without reworking the ledger.
_Avoid_: agent type, agent kind

**Agent Slot**:
One unit of an account's **Agent Slot Entitlement**: how many **Agents** it may have. Paused Agents occupy a slot; deleting an Agent frees one. Execution Mode does not change the cost, and a slot is not browser capacity: a Business account may employ 25 Agents while Arkitech still runs them through one browser slot.
_Avoid_: agent credit (the `agentCredits` column is gone, and never had a reader), agent limit, seat

**Agent Slot Entitlement**:
How many **Agent Slots** one account may occupy: its **Plan Tier**'s allotment, or an operator-set override in its place. Resolved server-side, inside the same statement that claims the slot. Never sent by a client, and never 3 as a universal rule: 3 is what Starter includes.
_Avoid_: quota (which read as a platform-wide constant, and was one)

**Plan Tier**:
Which plan an account is on, and what decides its **Agent Slot Entitlement** without an override: `starter` 3, `pro` 10, `business` 25, `enterprise` configured per account. An account with no plan recorded is Starter.
_Avoid_: plan (unqualified), subscription, tier (unqualified)

**Over Entitlement**:
An account occupying more **Agent Slots** than its **Agent Slot Entitlement** allows, which a downgrade produces. Every existing **Agent** is kept, keeps its slot index, and keeps running; only creating another is refused, until enough are deleted to get below the entitlement.
_Avoid_: over quota, overage (which suggests a charge), exceeded

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
How many **Usage Credits** one **Run** was charged, recorded on the Run itself. Priced by **Execution Mode** and captured at acceptance, so later price changes never rewrite history. Today every Run costs 1.
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


### Channels

**Channel**:
Where a **Conversation** is carried: `web`, `telegram` or `slack`. Not a different Agent and not a different product, only a different place the same **Team member** is reached. Web needs no **Channel Connection**, being Arkitech itself.
_Avoid_: integration, platform, provider (which means the company, not the channel)

**Channel Connection**:
One bot or one workspace install a user has attached to their account, holding its sealed credentials, its status, and the **Team member** that answers on it. Owned by one user; the thing an inbound event must resolve to before any Agent exists.
_Avoid_: integration, account, app install

**Connection Status**:
Where a **Channel Connection** stands: `pending_link`, `active`, `needs_attention`, `disconnected`. `pending_link` is the gap between a verified bot and a human proving they hold the account, and nothing runs for a connection in it.
_Avoid_: connected (as a stored value), state

**Channel Thread**:
The provider-side identity of a **Conversation**, and the record that it was authorised: which external chat, on which **Channel Connection**, opened by which external person. Its absence is what refuses a stranger who messages a public bot.
_Avoid_: chat, mapping, binding

**Link Code**:
A single-use, short-lived code that binds an external chat to an Arkitech account, stored hashed and carried into Telegram inside a deep link. What makes a public bot username harmless.
_Avoid_: invite, token (which means a credential here), pairing code

**Conversation**:
One exchange between a user and one **Team member** on one **Channel**, owned by Arkitech. Deliberately per-channel: continuity across channels comes from conversations sharing an owner and a Team member, not from merging transcripts.
_Avoid_: thread, chat, session

**Message**:
One turn in a **Conversation**, inbound or outbound, carrying its **Delivery Status** and, for an agent reply, the **Run** that produced it and therefore the **Usage Credit** it cost.
_Avoid_: event, turn, post

**Delivery Status**:
What actually happened to a **Message**: `received` for anything inbound, and `queued`, `sending`, `sent` or `failed` for anything outbound. `sent` means the provider accepted it, never that Arkitech queued it.
_Avoid_: state, status (unqualified), delivered

**Inbound Event Claim**:
The row written before an inbound provider delivery is processed, unique on the connection, provider and the provider's own event id. Both providers retry, so the claim is what stops one message becoming two Agent runs, two charges and two replies.
_Avoid_: dedup key, idempotency key (which means the Credit Ledger's)

**Team member**:
What an **Agent** is called in anything a customer reads. The everyday product is about delegating work, not configuring AI, so the interface says team member, task, and activity where the code says Agent, Run, and event.
_Avoid_: agent (in user-facing copy), bot, assistant

---

## Deferred / Future Computer Infrastructure

The terms below are **not current implementation requirements**. They were settled while specifying the Desktop subsystem in issue #2, which is deferred: Arkitech AI does not provision or depend on remote desktops. They are kept so the terminology is not lost if computer infrastructure returns later.

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
