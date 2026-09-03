# Switchboard

**An LLM spend and routing control center that a human and an agent operate at the same board.**

A human sees provider budgets, a priced model catalogue joined with real measured
behaviour, and an ordered routing policy. An agent — through
[WebMCP](https://github.com/webmachinelearning/webmcp) — reads the same state,
compares models, simulates candidate policies, finds waste, and **proposes**
changes. Routing and budget changes are never applied by the agent. They land in
an approval queue, and the human decides.

Built for the [OpenAI WebMCP Challenge](https://webmcp.devpost.com/).

---

## Why this use case needs WebMCP

The operations that matter here are **computations over the site's data model**,
not button clicks:

- `simulate_policy` projects what a candidate routing policy would cost and
  deliver. There is no button for that, and there could not be — the input is an
  arbitrary rule set.
- `compare_models` ranks candidates using *that traffic class's own token
  profile and volume*, so the dollar figures are directly comparable.
- `check_compliance` evaluates latency ceilings, success-rate floors, quality
  gates, data-retention limits and a no-training-on-data requirement together.

An agent driving the DOM could read a rendered chart. A tool hands it the rows,
the units and the constraints. And critically, the tools that move money are
deliberately **not** directly callable — which is a thing you can only express
if you are designing the tool surface, not scraping a page.

## The human-agent contract

Tools are split by blast radius, and the split is the design:

| | Tools | Behaviour |
|---|---|---|
| **Read-only** | `get_provenance`, `list_providers`, `list_traffic_classes`, `list_models`, `get_model`, `compare_models`, `get_routing_policy`, `simulate_policy`, `check_compliance`, `find_waste` | Called freely. `simulate_policy` also renders its projection on the human's screen, so they can follow the agent's reasoning as it iterates. |
| **Guarded** | `propose_policy_change`, `propose_budget_change` | Do **not** mutate. They create a proposal, return its id, and tell the agent to wait. |
| **Unguarded write** | `pin_insight` | Applies immediately — it only adds a note. Proof that the guard is a considered choice, not a blanket block. |
| **Poll** | `get_proposal_status` | Returns `pending` / `approved` / `rejected`, plus any note the human left. |

The approval loop is an **asynchronous handshake conducted entirely through the
tool return channel**. No out-of-band signalling:

```
agent  → propose_policy_change({rules, rationale})
site   ← "Proposal P-1 created and shown to the operator. Nothing applied.
          Moves projected spend from $255.31/mo to $23.94/mo.
          Call get_proposal_status with proposalId "P-1"."
human  → Reject, note: "don't fall back to a model that failed its quality gates"
agent  → get_proposal_status({proposalId: "P-1"})
site   ← {status: "rejected", decisionNote: "don't fall back to …",
          guidance: "propose a corrected version addressing that objection"}
agent  → compare_models → simulate_policy → propose_policy_change (corrected)
human  → Approve  ⇒  dashboard updates live
```

Every tool call is appended to an **agent activity feed** with arguments,
result and duration, so the human can audit exactly what happened.

## The data is real

This is not a mock dataset.

- **Prices and governance metadata** (`dataRetentionDays`, `trainsOnData`) are
  transcribed from published provider and gateway documentation, with the
  retrieval date recorded.
- **Latency, success rates, token means and cost-per-1000-successful-outputs**
  are my own measurements from **4 valid live evaluation runs on 2026-08-20 covering
  667 real API calls** across 19 gateway models on one structured-output task.
- `scripts/extract-seed.ts` derives `src/data/seed.json` from those runs behind
  a strict field allowlist and a secret scan. Prompts, fixture ids, response
  text and credentials never enter this repo.

**What is *not* measured, and is labelled as such throughout:** monthly call
volumes, budget caps and traffic-class constraints. These are operator inputs,
editable in the UI. Projections are derived from them. Nothing invented is
presented as a measurement.

The measurements cover one task, so they are indicative, not a general
capability benchmark — `get_provenance` says exactly this to any agent that asks,
so it can state the limits of the evidence it is reasoning from.

### What the real data happens to show

Two findings drive the demo, and neither was designed in:

1. **Of 19 gateway models, exactly one passes the quality gates** (`gpt-5.6-luna`).
   Eight returned zero successful calls across every run.
2. That one model **retains data for 30 days** — so the traffic class carrying
   customer records, which requires zero retention, has **no eligible model at all**.

The second is the interesting one. It is not an optimisation problem. The agent
cannot solve it; `compare_models` returns an explicit note saying a human has to
decide which constraint to relax. That is the correct behaviour, and it is the
part of the human-agent relationship that automation demos usually skip.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build
npm run typecheck
```

Regenerating the seed (needs the private evaluation repo; the committed
`seed.json` is the shipped artefact):

```bash
VOLTWISE_ROOT=/path/to/eval/repo npm run seed
```

## Seeing the tools

**In ChatGPT's in-app browser** — open the live URL and ask for something, e.g.

> Look at my models. Build me a routing policy that keeps total spend under $20
> a month, never routes customer data to a model that trains on it or retains it,
> and keeps realtime p95 under 4 seconds.

**In Chrome** — enable `chrome://flags/#enable-webmcp-testing`, reload, then:

```js
await document.modelContext.getTools()   // 14 tools with their schemas
```

**Without any WebMCP client** — the built-in **Agent console** panel lists the
registered tools, shows what `modelContext.getTools()` reports back, and lets you
invoke any tool by hand with JSON arguments. Same handlers an agent hits.

## Implementation notes

Vite + React 19 + TypeScript, Tailwind v4, Zustand (`localStorage`-persisted),
Recharts. No backend and no database: WebMCP tools execute in the page, so
server state would add failure modes without adding capability. **Reset demo**
restores the seeded state.

`src/webmcp/shim.ts` resolves the imperative API from **`document.modelContext`**,
falling back to `navigator.modelContext` for hosts still on the pre-Chrome-150
name. `src/webmcp/useTool.ts` registers every tool under one `AbortController`
and aborts on unmount, so the tool list an agent sees always matches what is
actually mounted.

```
src/
  data/          seed.json (generated, committed) + operator-declared initial state
  domain/        cost projection, compliance evaluation, waste detectors — all pure
  store/         zustand store; the only place state mutates
  webmcp/        shim, registration hook, and the 14 tool definitions
  features/      dashboard panels + agent console
  ui/            design tokens, primitives, charts
```

Chart colours come from a palette validated for colour-vision deficiency; the
red/green status pair failed CVD separation as a primary channel, so identity on
the cost/latency scatter is carried by two validated hues **plus** marker shape
**plus** a legend, never hue alone.

## Licence

MIT — see [LICENSE](./LICENSE).
