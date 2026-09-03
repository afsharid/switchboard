# Switchboard

**An LLM spend and routing control center that a human and an agent operate at the same board.**

Live: https://switchboard-100.pages.dev
Repo: https://github.com/afsharid/switchboard (MIT)

---

## Why this use case fits WebMCP

Most agent demos automate clicking. This one exposes operations that **have no
button and could not have one**, because their input is an arbitrary structure
rather than a control:

- `simulate_policy(rules)` projects what a candidate routing policy would cost,
  deliver and how slowly, against declared traffic volumes. The input is a whole
  rule set. There is no widget for that.
- `compare_models(classId, optimiseFor)` ranks candidates using *that traffic
  class's own token profile and monthly volume*, so the dollar figures are
  directly comparable rather than nominally comparable.
- `check_compliance(rules)` evaluates latency ceilings, success-rate floors,
  quality gates, **data-retention limits and a no-training-on-data
  requirement** together, and separates hard blockers from warnings.

An agent driving the DOM could read a rendered chart and guess. A tool hands it
the rows, the units, and the constraints — and gets a typed error back when it
passes a model id that does not exist.

The inverse also matters: because we design the tool surface, we can decide what
is **not** callable. `set_provider_budget` does not exist. Neither does
`apply_policy`. That is the whole design.

## How it improves the experience

The screen and the agent read the same state. When the agent calls
`simulate_policy`, the projection renders next to the live policy — so the human
watches the agent search the trade-off space in real time instead of receiving a
paragraph of conclusions. Every tool call lands in an activity feed with its
arguments, result and duration, so nothing the agent did is invisible.

And when the agent proposes something, the human gets a rule-by-rule diff with
the cost delta and the compliance verdict, and answers with **Approve, or Reject
plus a note**.

## What people and agents accomplish together

The approval loop is an **asynchronous handshake carried entirely by the tool
return channel** — no out-of-band signalling, no side channel:

```
agent  → propose_policy_change({rules, rationale})
site   ← "Proposal P-1 created and shown to the operator. Nothing applied.
          Moves projected spend $254.84/mo → $45.50/mo.
          Warning: candidate still has 2 compliance blockers: SUCCESS_RATE, RETENTION.
          Call get_proposal_status with proposalId "P-1"."
human  → Reject — "don't fall back to GLM 5.2, it fails the quality gates"
agent  → get_proposal_status({proposalId: "P-1"})
site   ← {status: "rejected",
          decisionNote: "don't fall back to GLM 5.2, it fails the quality gates",
          guidance: "propose a corrected version addressing that objection"}
agent  → compare_models → check_compliance → propose_policy_change (corrected)
human  → Approve  ⇒  policy applied, dashboard updates live
```

The agent is told to wait, told not to resubmit, and told what to do with a
rejection. It reads the human's note and corrects itself. That is a
collaboration, not an automation.

**And sometimes the right answer is that the agent cannot help.** One traffic
class carries customer records and requires zero data retention plus passing
quality gates. In the real measurements, *exactly one* of 19 models passes the
quality gates — and it retains data for 30 days. So `compare_models` returns an
empty ranking with an explicit note:

> *"No model satisfies every constraint on this class. This cannot be optimised
> away — a human has to decide which constraint to relax. Report the trade-off
> rather than silently picking a non-compliant model."*

The agent surfaces the trade-off and stops. That refusal is the feature.

## WebMCP implementation

**15 tools, split by blast radius:**

| | Tools |
|---|---|
| **Read-only** (`readOnlyHint: true`) | `get_provenance`, `list_providers`, `list_traffic_classes`, `list_models`, `get_model`, `compare_models`, `get_routing_policy`, `simulate_policy`, `check_compliance`, `find_waste` |
| **Guarded** — create a proposal, mutate nothing | `propose_policy_change`, `propose_budget_change` (provider cap or total cap) |
| **Unguarded write** — applies immediately, spends nothing | `pin_insight` |
| **Poll / retract** | `get_proposal_status`, `withdraw_proposal` |

Registration uses the imperative API, resolved from **`document.modelContext`**
with a fallback to `navigator.modelContext` for hosts still on the
pre-Chrome-150 name. Every tool registers under one `AbortController` which
aborts on unmount, so the tool list an agent discovers always matches what is
actually on screen. Rich `inputSchema` with enums and units on every parameter;
invalid input returns a corrective string naming the valid values instead of
throwing.

`get_provenance` exists specifically so an agent can state the limits of the
evidence it is reasoning from before it recommends anything — including a
`samplingCaveat` warning that per-model sample sizes are small (median 33 calls)
and that p95 should be treated as coarse.

Three semantics the surface is deliberate about, because an agent reading tool
descriptions has no other way to know:

- **Governance constraints never degrade.** Quality-gate and latency limits
  soften to warnings on a *fallback*; retention and no-training limits do not.
- **Undocumented is not safe.** `null` governance metadata blocks a constrained
  class rather than being assumed compliant. And `null` means *unconstrained* on
  a class but *undocumented* on a model — opposite polarity across the join, so
  the descriptions say so explicitly.
- **Spend is audited with everything else,** so an empty blocker list really is
  the bar a proposal has to clear.

There is also an **Agent console** in the UI: it lists the registered tools,
shows what `modelContext.getTools()` reports back, and lets anyone invoke any
tool by hand with JSON arguments. A judge without a WebMCP client can still
verify the whole tool surface.

## The data is real

Not a mock dataset.

- **Prices and governance metadata** (`dataRetentionDays`, `trainsOnData`) are
  transcribed from published provider and gateway documentation, retrieval date
  recorded.
- **Latency, success rates, token means and cost per 1000 successful outputs**
  are my own measurements from **4 valid live evaluation runs covering 667 real
  API calls** across 19 gateway models, run on 2026-08-20.
- `scripts/extract-seed.ts` derives the shipped dataset behind a strict field
  allowlist plus a secret scan. Prompts, response text and credentials never
  enter the repo.

What is **not** measured — monthly volumes, budget caps, class constraints — is
operator input, editable in the UI, and labelled as such everywhere it appears.
Nothing invented is presented as a measurement. The measurements cover one task,
so they are indicative rather than a general capability benchmark, and
`get_provenance` says exactly that.

Two things the real data happened to show, neither designed in:

1. Of 19 gateway models, **one** passes the quality gates. **Eight returned zero
   successful calls** across every run — and the starting policy routes to one of them.
2. `find_waste` identifies **$230.66/month** of provable savings on the starting
   policy, because one class is routed to a model costing $2.24 per 1000
   successful outputs when a compliant alternative costs $0.09.

## Stack

Vite + React 19 + TypeScript, Tailwind v4, Zustand, Recharts. No backend, no
database — WebMCP tools execute in the page, so server state would add failure
modes without adding capability. Deployed on Cloudflare Pages. Chart colours are
from a palette validated for colour-vision deficiency; the red/green status pair
failed CVD separation as a primary channel, so identity on the cost/latency
scatter is carried by two validated hues **plus** marker shape **plus** a legend.
