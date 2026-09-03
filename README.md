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

## How this was built

Written by me with three AI coding agents, used for different things because
they could reach different places and see different problems.

**Claude Opus 5** (Claude Code) wrote the application, the seed-extraction
script, the domain logic and the test suite, and verified it against Chrome
Canary 155 with `chrome://flags/#enable-webmcp-testing`.

**ChatGPT / Codex** drove the deployed page through **ChatGPT's own in-app
browser** — the browser this challenge is primarily judged in, and the one
Claude had no way to reach. That was not a formality. It found two real defects:

1. **`window.confirm` is never surfaced in that browser.** "Reset demo" was
   completely dead there: the click did nothing, state persisted, and a judge
   had no way back to a clean slate. In Chrome it worked perfectly, so no amount
   of local testing would have caught it. Now an in-page dialog, with the e2e
   suite stubbing `confirm`/`alert`/`prompt` to throw so it cannot regress.
2. **`worstCaseLatencyMs` did not report the worst case.** The description said
   it summed p95 across the chain; the code applied an undocumented
   "only if this link is reached more than 5% of the time" threshold. So a
   realtime chain that can take 7811ms reported 3624ms and read as compliant.
   It now sums the whole chain unconditionally and reports
   `tailRiskProbability` beside it, and the interaction between the two latency
   rules is spelled out: an over-ceiling *fallback* is a warning, not a
   blocker, but the chain's summed tail raises `CHAIN_LATENCY` regardless.
3. **`withdraw_proposal` claimed the proposal was "removed from the operator's
   queue"** when it stays visible as withdrawn history. The return text now
   says what actually happens.
4. **The agent console labelled every write as needing approval,** including
   `pin_insight` and `withdraw_proposal`, which apply immediately. Tools now
   carry an explicit effect — `read`, `writes-now`, or `proposal` — and only
   the two `propose_*` tools claim to need a human.
5. **A scripted demo target was arithmetically impossible.** Asked for a policy
   under $20/mo, the agent worked out that the compliant floor is $22.84 —
   realtime has exactly one eligible model at $9.39, the cheapest compliant
   batch model is $11.02, the customer-data class adds $2.43 — and said so with
   the arithmetic instead of proposing something non-compliant that hit the
   number. It also showed that a rejection note referring to a fallback landed
   on nothing, because the agent proposes empty fallback chains. Both the demo
   script and `get_proposal_status`'s guidance changed as a result.

**Antigravity (Gemini 3)** audited the repository with no context from either
of the other two: it checked every factual claim in this README and the Devpost
description against the code and data, tried to falsify the approval guard by
tracing call paths, and measured the layout at 390/768/1440px. Its report is in
[`docs/audit-antigravity.md`](docs/audit-antigravity.md). It confirmed the guard
is airtight — no tool reaches `applyRulesDirect`, `setProviderBudgetDirect`,
`setTotalBudget` or `setClassConstraint`, and `createProposal` hardcodes
`status: 'pending'` so a crafted argument cannot self-approve — and found:

- **Five stale or wrong numbers in my own documentation**, including a check
  count I had not updated after adding fourteen tests. All corrected.
- **Unmeasured models silently passed every performance constraint.** Each check
  was guarded by `&& m.measured &&`, so a model with no data slipped past
  quality gates, latency ceilings and success floors with no blocker *and no
  warning* — the same "unknown means safe" mistake the governance checks were
  written to avoid. Now raises `UNVERIFIABLE`.
- **`minSuccessRate` was documented as chain-level but evaluated per-model,**
  with the chain check using a hardcoded 0.9 that ignored the class's own floor.
  The chain check now uses the class floor as a blocker, and a below-floor
  *fallback* softens to a warning like latency and quality gates already did —
  that inconsistency was an oversight, not a decision.
- **The primary judging viewport turned out to be 447px.** ChatGPT's in-app
  browser is a side panel, and the first person to open the page in it reported
  that width. The model table needed 640px; it *did* scroll horizontally, but
  with no scrollbar affordance in a panel that narrow nobody discovers that, so
  the right-hand columns read as simply clipped. Below `md` the catalogue is now
  one block per model — same data, no scrolling. All four of 390/447/768/1440px
  are asserted in the test suite to have zero page overflow and nothing
  scrolling sideways.
- **A 292px horizontal overflow on a 390px phone.** Grid items default to
  `min-width: auto`, so the 640px model table stretched the whole page. Fixed
  with `min-w-0`; also bumped form controls to 16px and 36px tall below 640px,
  since iOS auto-zooms on smaller text and a 21px select is not a tap target.
- **Small text and status badges below WCAG AA.** Status *fill* steps were being
  used as *text* colours, putting critical labels at 3.17:1 on their own chip.
  Text-specific steps are now derived and every small text on the page clears
  4.5:1, verified by measuring the rendered DOM rather than by eye.

Every design decision — the idea, the stack, publishing the measurement data,
making constraint relaxation a human-only control — was mine. The commit history
records which agent contributed to which change.

Neither of them could have done this alone, which is a slightly on-the-nose
illustration of the thing the project is actually about: an agent is most useful
when it can reach something you cannot, and when you can see exactly what it
did.

## Project origin

Switchboard was **written from scratch on 2026-09-03**, inside the WebMCP
Challenge submission period (2026-08-25 to 2026-09-03). The commit history in
this repository is the dated record: the first commit creates the project, and
there is no prior work in it.

One thing predates the period and is not code: the **measurement dataset**. The
latency, success-rate and cost figures in `src/data/seed.json` come from
evaluation runs I performed on 2026-08-20 in a separate private repository of
mine. `scripts/extract-seed.ts` is the new code that derives the shipped dataset
from those runs, behind a field allowlist and a secret scan. No source code from
that repository was copied here.

Per OpenCode's terms, the measurement outputs are mine to publish: *"you own the
Output. We hereby assign to you all our right, title, and interest, if any, in
and to Output."* Their terms contain no restriction on publishing benchmark or
evaluation results. Model prices and governance metadata are factual figures
transcribed from published provider and gateway documentation, with retrieval
dates recorded.

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
| **Guarded** | `propose_policy_change`, `propose_budget_change` | Do **not** mutate. They create a proposal, return its id, and tell the agent to wait. Budget proposals cover both a provider cap and the total cap. |
| **Unguarded write** | `pin_insight` | Applies immediately — it only adds a note. Proof that the guard is a considered choice, not a blanket block. |
| **Poll / retract** | `get_proposal_status`, `withdraw_proposal` | Status returns `pending` / `approved` / `rejected` / `withdrawn`, plus any note the human left. An agent that thinks better of a proposal can retract it rather than leave it stale. |

The approval loop is an **asynchronous handshake conducted entirely through the
tool return channel**. No out-of-band signalling:

```
agent  → propose_policy_change({rules, rationale})
site   ← "Proposal P-1 created and shown to the operator. Nothing applied.
          Moves projected spend from $254.84/mo to $22.84/mo.
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

### The demo video

`submission/switchboard-demo.mp4` is a recording of **ChatGPT's own in-app
browser** on GPT-5.6 Sol, driven against the live deployment. Nothing in it is
mocked: the agent discovered the fifteen tools itself, simulated, refused to
route the customer-data class, proposed, read a rejection note back, corrected
itself, and got approved. The cut list is in `submission/cut-list.json`.

One thing that recording taught us about WebMCP: **a page cannot notify an
agent.** The protocol is one-directional — the page exposes tools, the agent
calls them. So when the operator rejects a proposal, the agent does not know
until it polls `get_proposal_status`, which is why the video shows a human
saying "I rejected it, read my note." That is a limit of the standard, not of
this implementation.

### The one lever the agent does not have

When a class has no compliant model, that is not an optimisation problem. The
agent says so and stops. The **human** can then open *relax constraints* on the
class and accept 30-day retention — and only then can the agent route it. There
is deliberately no tool for changing a constraint: deciding which risk to accept
is the operator's call. Verified end to end — `compare_models` returns an empty
ranking before, and GPT 5.6 Luna at $2.43/mo after.

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

**In ChatGPT's desktop app** (what the challenge calls the in-app browser, and
what ChatGPT calls *site tools*):

1. Update the desktop app to the latest version.
2. **Pick GPT-5.6 Sol or GPT-5.6 Terra.** Site tools are disabled on GPT-5.6
   Luna, so nothing will happen on that model.
3. Check *Settings → Browser → Permissions → Enable site tools* is on. Site
   tools are not available in Enterprise or Education workspaces.
4. Open the built-in browser from the app toolbar and go to the live URL.
5. The address bar shows **Site tools** — grey when a page offers them, blue
   while ChatGPT is using them. *Available site tools* lists all 15.
6. Then ask for something, e.g.

> Look at my models. Build me a routing policy that keeps total spend under $20
> a month, never routes customer data to a model that trains on it or retains it,
> and keeps realtime p95 under 4 seconds.

**In Chrome** — WebMCP needs Chrome 153+ (Canary at the time of writing) with
`chrome://flags/#enable-webmcp-testing`. This script sets the flag in a
throwaway profile so you do not have to:

```bash
./scripts/open-in-chrome.sh                    # the deployed URL
./scripts/open-in-chrome.sh http://localhost:5173/
```

Then in the DevTools console:

```js
await document.modelContext.getTools()   // 15 tools with their schemas
```

**Without any WebMCP client** — the built-in **Agent console** panel lists the
registered tools, shows what `modelContext.getTools()` reports back, and lets you
invoke any tool by hand with JSON arguments. Same handlers an agent hits.

## Implementation notes

Vite + React 19 + TypeScript, Tailwind v4, Zustand (`localStorage`-persisted),
Recharts. No backend and no database: WebMCP tools execute in the page, so
server state would add failure modes without adding capability. **Reset demo**
restores the seeded state.

### Constraint semantics worth knowing

- **Governance never degrades.** Quality-gate and latency constraints soften to
  warnings on a *fallback* — a slow answer beats no answer. Retention and
  training constraints do not: a fallback that leaks customer data leaks it
  just as thoroughly.
- **Undocumented is not safe.** A model with `dataRetentionDays: null` or
  `trainsOnData: null` is *blocked* on a class that constrains either, rather
  than assumed compliant. Note the polarity trap: `null` on a *class*
  constraint means unconstrained; `null` on a *model* means undocumented.
- **Spend is a constraint too.** `check_compliance` reports `TOTAL_BUDGET` and
  `PROVIDER_BUDGET` blockers, so "no blockers" genuinely means the plan fits the
  declared budget — not merely that it is technically permissible.
- **Sample sizes are small** (median 33 calls per model). `get_provenance`
  returns a `samplingCaveat` telling an agent to treat p95 as coarse and not to
  present sub-second latency differences as decisive.

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
  webmcp/        shim, registration hook, and the 15 tool definitions
  features/      dashboard panels + agent console
  ui/            design tokens, primitives, charts
```

Chart colours come from a palette validated for colour-vision deficiency; the
red/green status pair failed CVD separation as a primary channel, so identity on
the cost/latency scatter is carried by two validated hues **plus** marker shape
**plus** a legend, never hue alone.

## Testing

`tests/webmcp.e2e.mjs` drives a real Chrome through the actual
`document.modelContext` API — registration, `getTools()`, `executeTool()` — so
the host round trip is covered rather than the handlers being called directly.
It also clicks the human half of the approval loop, because the guard is only
real if that half works. 61 checks, including:

- the agent cannot mutate a budget or a policy, and the cap is *verified*
  unchanged after it tries
- a rejection note is read back verbatim by the agent, which is then told to
  correct rather than resubmit
- unknown governance metadata blocks a constrained class rather than being
  assumed safe
- bad input returns a corrective string naming the valid values instead of
  throwing
- no uncaught runtime errors

```bash
npm run build
npm run preview:test &      # serves dist on :4319
npm run test:e2e
TARGET=https://your-url npm run test:e2e   # or against a deployment
```

Needs a Chrome with WebMCP (153+; Canary at the time of writing) and sets
`enable-webmcp-testing` in a throwaway profile itself. Override the binary with
`CHROME=/path/to/chrome`.

## Licence

MIT — see [LICENSE](./LICENSE).
