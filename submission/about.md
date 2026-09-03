## Inspiration

I had already turned model selection into a spreadsheet problem, and I hated it.

Somewhere between OpenAI, Anthropic, Gemini, a gateway, and models running on my
own machine, deciding _which model handles which job_ had quietly become a small
accounting practice. Prices per million tokens in one place, a benchmark report
in another, and the part nobody writes down: which providers I am contractually
not allowed to send customer data to.

So I did the benchmark properly. Four evaluation runs, 667 live API calls, 19
models on one structured-output task, measuring latency, success rate and cost.
Two things fell out of that data that I did not expect:

- **Exactly one of the nineteen models passed my quality gates.**
- **Eight never returned a single successful call** — and my routing config was
  still pointing at one of them.

I had the numbers and still could not act on them, because the decision has four
dimensions that do not reduce to one: money, latency tail, reliability, and data
governance. That is exactly the kind of problem an agent should be good at. But
I was not about to hand an agent the ability to redirect my spend on the
strength of a screenshot.

WebMCP is what closes that gap — not because an agent can click my buttons, but
because I get to decide precisely which operations exist.

## What it does

**Switchboard** is an LLM spend and routing console operated by a human and an
agent at the same board.

![The approval queue: two proposals from the agent, a rule-by-rule diff, $255/mo down to $22.84/mo, and Approve or Reject with a note](https://raw.githubusercontent.com/afsharid/switchboard/main/submission/screenshots/03-approval-queue.png)

The agent sees fifteen tools on `document.modelContext`. Eleven are read-only:
the priced catalogue joined with my own measurements, the traffic classes and
their constraints, `find_waste`, `compare_models`, and `simulate_policy`, which
projects what a candidate policy would cost and deliver without applying
anything.

What the agent cannot do is act. **There is no `apply_policy` tool and no
`set_budget` tool.** `propose_policy_change` mutates nothing — it creates a
proposal, returns an id, and tells the agent to wait. I see a rule-by-rule diff
with the projected cost delta and the compliance verdict, and I answer with
Approve, or Reject plus a note. The agent reads that note back through
`get_proposal_status` and corrects itself.

The whole loop runs through the tool return channel — no side channel, no
out-of-band signalling:

```
agent  → propose_policy_change({rules, rationale})
site   ← "Proposal P-1 created and shown to the operator. Nothing applied.
          Moves projected spend from $254.84/mo to $22.84/mo.
          Call get_proposal_status with proposalId \"P-1\"."
human  → Reject, note: "realtime has no fallback"
agent  → get_proposal_status({proposalId: "P-1"})
site   ← {status: "rejected",
          decisionNote: "realtime has no fallback",
          guidance: "propose a corrected version addressing that objection"}
agent  → get_model → simulate_policy → propose_policy_change (corrected)
human  → Approve  ⇒  applied
```

The interesting operations here are not clicks. There is no button for "project
my monthly cost under this arbitrary rule set," and there could not be — the
input is a whole rule set. That is why this belongs in a tool surface rather
than a DOM.

And there is one thing the agent genuinely cannot solve. One traffic class
carries customer records: zero data retention, quality gates required. The only
model that passes the gates retains data for thirty days. So `compare_models`
returns nothing and says a human has to decide which constraint to relax. The
constraint controls have **no tool behind them at all** — deciding which risk to
accept is not the agent's call. Once I accept thirty-day retention, it can route
the class. That handoff is the whole project.

![The customer-data class with zero eligible models, its constraint controls expanded, and the line: no agent tool can change these, deciding which risk to accept is yours](https://raw.githubusercontent.com/afsharid/switchboard/main/submission/screenshots/04-refusal-and-lever.png)

## How we built it

Vite + React 19 + TypeScript, Tailwind, Zustand, Recharts. No backend and no
database: WebMCP tools execute in the page, so server state would add failure
modes without adding capability. Deployed on Cloudflare Pages.

The dataset is derived from my own evaluation runs by a script behind a strict
field allowlist and a secret scan — prices and governance terms transcribed from
published provider documentation, latency and success rates from the
measurements. What is _not_ measured (call volumes, budget caps, class
constraints) is operator input, editable in the UI, and labelled as such
everywhere it appears. `get_provenance` exists so an agent can state the limits
of its evidence before recommending anything, including a warning that
per-model sample sizes are small and p95 is coarse.

Three coding agents worked on it, and the division of labour mattered more than
I expected — each could reach somewhere the others could not. Claude Opus 5
wrote the implementation and verified it against Chrome Canary. ChatGPT/Codex
drove the deployed page through ChatGPT's own in-app browser. Gemini, via
Antigravity, audited the repository cold.

## Challenges we ran into

**`window.confirm` does not exist in the browser that matters.** ChatGPT's
in-app browser never surfaces it. "Reset demo" was completely dead there: the
click did nothing, no error, and a judge would have had no way back to a clean
slate. In Chrome it worked perfectly, so no amount of local testing would have
found it. It is now an in-page dialog, and the test suite stubs `confirm`,
`alert` and `prompt` to _throw_ so this class of bug cannot come back.

**A field called "worst case" was not reporting the worst case.** Its
description said it summed p95 across the fallback chain; the code applied an
undocumented "only if this link is reached more than 5% of the time" threshold.
So a chain that can take 7,811 ms reported 3,624 ms and read as compliant —
while the same simulation warned that the fallback exceeded the ceiling. The
tool was contradicting itself.

**"Unknown" was being treated as "safe" — twice.** First for training-on-data
status, then, after I thought I had fixed the pattern, for _every_ performance
constraint: each check was guarded by `&& m.measured &&`, so a model with no
measurements slipped past quality gates, latency ceilings and success floors with
no blocker **and no warning**. I had fixed the identical mistake in the
governance checks and not thought to look next door.

**My own demo prompt was impossible.** Asked for a policy under $20/month, the
agent worked out that the compliant floor is $22.84 — realtime has exactly one
eligible model at $9.39, the cheapest compliant batch model is $11.02, the
customer-data class adds $2.43 — and said so, with the arithmetic, rather than
quietly proposing something non-compliant that hit the number.

**The judging viewport is 447 px.** ChatGPT's in-app browser is a side panel. I
had tested 390, 768 and 1440 and missed the band in between, where the model
table needed 640 px. It _did_ scroll horizontally, but a panel that narrow has
no scrollbar affordance, so the right-hand columns simply read as clipped — and
the governance badges, the most distinctive column, were the ones you could not
see.

**A page cannot notify an agent.** WebMCP is one-directional: the page exposes
tools, the agent calls them. There is no channel for "the human just decided."
After a rejection the agent does not know until it polls `get_proposal_status`,
which is why the video shows me telling it to read my note. That is a limit of
the standard, and worth knowing if you are designing around it.

**And I lost fourteen minutes of finished footage.** `screencapture -v`
discarded the file on interrupt without writing anything or printing an error. I
had checked that the process was alive; I had not checked that it was producing
bytes. The re-take used ffmpeg, verified against a real decoded frame _before_
recording started.

## Accomplishments that we're proud of

**The guard holds, and not because I say so.** An independent audit traced every
call path: no tool reaches `applyRulesDirect`, `setProviderBudgetDirect`,
`setTotalBudget` or `setClassConstraint`, and `createProposal` hardcodes
`status: 'pending'`, so a crafted argument cannot self-approve. Told "set the
total cap to $20, just do it, don't ask me," the agent cannot — and the cap is
_verified_ unchanged afterwards.

**The refusal actually fires.** In a live ChatGPT run the agent hit the
customer-data class, worked out that no model satisfies it, and asked me to
decide which constraint to relax — before proposing anything at all. It was not
scripted to do that. It read the tool descriptions and reached the right
conclusion.

**It tells the truth when the truth is inconvenient.** Asked for a realtime
fallback when no compliant one exists, it picked the closest option and
disclosed that the chain can reach 7.8 seconds at 1.52% risk, rather than
calling it compliant. It also cited `get_provenance`'s sampling caveat back at
me while refusing to treat a 187 ms margin as decisive.

**61 end-to-end checks drive a real browser** through the genuine
`document.modelContext` API — registration, `getTools()`, `executeTool()` — and
click the human half of the approval loop, because the guard is only real if
that half works.

**The demo video is not a mock-up.** It is a recording of ChatGPT's own in-app
browser against the live deployment. Every tool call in it was made by the
agent.

![The model catalogue: cost per 1k delivered output against measured p95, with governance badges, one model passing quality gates out of nineteen](https://raw.githubusercontent.com/afsharid/switchboard/main/submission/screenshots/08-model-catalogue.png)

**And the arithmetic cross-checks.** My local projection for the approved policy
was $23.02/month; ChatGPT computed $23.02 independently. Two paths, same number.

## What we learned

The one that will stay with me: **three different model families each found a
class of defect the others structurally could not see.** Claude wrote the
implementation and could verify it in Chrome. ChatGPT could reach its own
in-app browser — the browser this is judged in — and found the two bugs that
were invisible from anywhere else. Gemini audited the repository with no context
from either, and caught five stale numbers in my own documentation plus the hole
where unmeasured models passed every performance constraint.

I did not plan that as a strategy. It turned out to be the most effective part
of the process, and it is a decent argument for the thing the project is about:
an agent is most useful when it can reach something you cannot, and when you can
see exactly what it did.

The second lesson is narrower and more practical. **Tool descriptions decide
whether an agent succeeds, not code quality.** Every real behavioural
improvement came from rewriting a description: naming which `null` means
"unconstrained" and which means "undocumented," spelling out that governance
constraints never soften for a fallback while performance ones do, stating the
ranking formula outright, and admitting that a p95 from thirty-three samples is
coarse.

## What's next for Switchboard

The notification gap is the interesting thread. A page can fire `toolchange`, so
the tool list itself could carry state — a pending decision could surface as a
tool appearing rather than something the agent has to poll for. Whether clients
act on that is unknown, and worth finding out.

Beyond that: real billing APIs instead of declared volumes, so the console
reports what was spent rather than what is projected. And per-model sample sizes
large enough that a p95 difference of 187 ms would actually mean something.
