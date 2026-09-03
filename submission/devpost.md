# Switchboard

**An LLM spend and routing control center that a human and an agent operate at the same board.**

Live: https://switchboard-100.pages.dev
Repo: https://github.com/afsharid/switchboard (MIT)
Video: https://youtu.be/t8EBr6bc878

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

## What people and agents can do together that was difficult or impossible before

**Before:** deciding where model traffic should go meant a human reading a
26-row catalogue of prices against a separate benchmark report, doing the
cost-per-successful-output arithmetic by hand, and remembering which models are
contractually off-limits for customer data. An agent could not help, because
the only way in was a dashboard it would have had to screen-scrape — and no
sane operator hands an agent the ability to redirect spend on the strength of a
screenshot.

**Now:** the agent does the arithmetic across the whole catalogue in seconds,
against the same measurements the human sees, and proposes a change the human
can check line by line. What is genuinely new is not the automation — it is that
the agent can be given real authority over a consequential decision *because*
the authority is bounded by the tool surface rather than by trust.

The approval loop is an **asynchronous handshake carried entirely by the tool
return channel** — no out-of-band signalling, no side channel:

```
agent  → propose_policy_change({rules, rationale})
site   ← "Proposal P-1 created and shown to the operator. Nothing applied.
          Moves projected spend $254.84/mo → $22.84/mo.
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

**It also pushes back on the premise.** Asked for a policy under $20/month, the
agent worked out that the compliant floor is $22.84 — realtime has exactly one
eligible model at $9.39/mo, the cheapest compliant batch model is $11.02/mo, and
the customer-data class adds $2.43/mo — and said so, with the arithmetic, rather
than quietly proposing something non-compliant that hit the number. Verified in
ChatGPT's in-app browser, not hypothesised.

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
| **Read-only** (`readOnlyHint: true`, 11 tools) | `get_provenance`, `list_providers`, `list_traffic_classes`, `list_models`, `get_model`, `compare_models`, `get_routing_policy`, `simulate_policy`, `check_compliance`, `find_waste`, `get_proposal_status` |
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

### The one lever the agent does not have

When a class has no compliant model, that is not an optimisation problem. The
agent says so and stops. The **human** can then open *relax constraints* on the
class and accept 30-day retention — and only then can the agent route it. There
is deliberately no tool for changing a constraint: deciding which risk to accept
is the operator's call. Verified end to end — `compare_models` returns an empty
ranking before, and GPT 5.6 Luna at $2.43/mo after.

## The video is the real thing

The submitted video is a recording of **ChatGPT's own in-app browser** on
GPT-5.6 Sol, driven against the live deployment. Every tool call in it was made
by the agent. It discovered the fifteen tools, simulated, **refused to route the
customer-data class and asked me to decide**, proposed for the other two
classes, read my rejection note back verbatim, corrected itself while disclosing
the fallback's 7.8-second tail rather than hiding it, and was applied only after
I approved.

That recording also taught us the sharpest limit of WebMCP: **a page cannot
notify an agent.** The protocol is one-directional — the page exposes tools, the
agent calls them. There is no channel for "the human just decided." So the
approval loop needs the operator to say "I rejected it, read my note," which is
visible in the video. Worth knowing if you are designing around this standard.

## Verified in ChatGPT's in-app browser

Run end to end on GPT-5.6 Terra against the deployed URL. All 15 tools were
discovered through the address-bar **Site tools** indicator. Asked "where is my
money going", the agent called `find_waste` and returned the $230.66/mo finding.
Given the routing task it called `get_provenance` → `list_providers` →
`list_traffic_classes` → `list_models` → `get_routing_policy` →
`compare_models` ×3 → `simulate_policy` → `propose_policy_change`, projected
$254.84/mo down to $22.84/mo, and reported its own remaining compliance blocker
unprompted.

Told "set the total monthly cap to $20, just do it, don't ask me," it could not:
it got back a proposal id and the cap stayed at $60. Given a rejection note, it
read the note back verbatim. Asked about the customer-data class, it returned an
empty ranking and the refusal text, and did not route it.

## Verified, not asserted

`tests/webmcp.e2e.mjs` in the repo drives a real Chrome through the genuine
`document.modelContext` API and clicks the human half of the approval loop.
**61 checks, all passing** — including that the agent's budget change leaves the
cap *verifiably* unchanged, that a rejection note is read back verbatim, that
undocumented governance metadata blocks a constrained class, and that there are
no uncaught runtime errors. Run it against the live URL with
`TARGET=<url> npm run test:e2e`.

## How it was built

Three coding agents, used for different reasons. **Claude Opus 5** wrote the app,
the domain logic and the test suite and verified it in Chrome Canary.
**ChatGPT / Codex** drove the deployed page through ChatGPT's own in-app browser
— the browser this is judged in, and the one Claude could not reach — and found
five defects local testing could not surface — including that `window.confirm`
is never shown in that browser, so "Reset demo" was silently dead there, and
that `worstCaseLatencyMs` was quietly applying an undocumented threshold that
made a 7.8-second chain report 3.6 seconds and read as compliant.

**Antigravity (Gemini 3)** audited the whole thing cold — every documented
claim against the code, the approval guard by tracing call paths, the layout at
three viewport widths. It confirmed the guard is airtight and found five wrong
numbers in my own docs, a hole where unmeasured models silently passed every
performance constraint, a documented-vs-actual mismatch in how success rates
were judged, a 292px overflow on a 390px phone, and status badges below WCAG AA.
All fixed; its report is committed at `docs/audit-antigravity.md`.

And a fourth pass in ChatGPT's in-app browser turned up the most useful fact of
all: that browser is a **side panel 447px wide**, so narrow width is the primary
judging viewport rather than an edge case. The model catalogue needed 640px and,
with no scrollbar affordance at that size, its right-hand columns read as
clipped. It now renders as one block per model below 768px, and all four of
390/447/768/1440px are asserted to have zero overflow.

Every design decision was mine. The README documents which agent contributed
what, and the commit history records it. Using three different model families
was not a gimmick — each one found a class of defect the others structurally
could not see.

## Stack

Vite + React 19 + TypeScript, Tailwind v4, Zustand, Recharts. No backend, no
database — WebMCP tools execute in the page, so server state would add failure
modes without adding capability. Deployed on Cloudflare Pages. Chart colours are
from a palette validated for colour-vision deficiency; the red/green status pair
failed CVD separation as a primary channel, so identity on the cost/latency
scatter is carried by two validated hues **plus** marker shape **plus** a legend.
