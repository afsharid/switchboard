# Devpost gallery — upload in this order

The rules say judges "may choose to judge based solely on the text description,
images, and video," so these carry weight on their own. Order matters: problem,
then the agent working, then the guard, then the refusal.

| # | File | Caption to paste |
|---|------|------------------|
| 1 | `03-approval-queue.png` | **The agent proposes; the human decides.** Two pending proposals with a rule-by-rule diff and the projected cost delta — $255/mo down to $28.23. `propose_policy_change` mutates nothing. There is no `apply_policy` tool and no `set_budget` tool. |
| 2 | `04-refusal-and-lever.png` | **Where the agent stops.** The customer-data class requires zero retention and passing quality gates. Of 19 measured models exactly one passes the gates — and it retains data for 30 days. `compare_models` returns an empty ranking and says a human must choose. The "relax constraints" control has no tool behind it. |
| 3 | `01-dashboard.png` | **Switchboard on a cold load.** $255/mo projected against a $60 cap, 8 compliance blockers, $231/mo of identified waste. Every latency, success rate and cost figure is measured — 667 real API calls across 19 models. |
| 4 | `06-agent-console.png` | **15 WebMCP tools on `document.modelContext`.** The console shows what the page registered and what the browser reports back through `getTools()`, and invokes any tool by hand — so the surface is verifiable without a WebMCP client. |
| 5 | `02-simulation.png` | **The agent thinks on the human's screen.** `simulate_policy` is read-only and applies nothing, but renders its projection beside the live policy, so the operator watches the trade-off space being searched instead of reading a conclusion. |
| 6 | `08-model-catalogue.png` | **Cost per delivered output, not per call.** A cheap model that fails half its calls is not cheap. Governance is first-class: retention and training-on-data sit in the same table as price. Eight models returned zero successes and cannot be plotted. |
| 7 | `07-activity-feed.png` | **Every tool call is auditable.** Name, arguments, result and duration for everything the agent did on this page. |
| 8 | `09-policy-findings.png` | **Findings are typed.** `spend` is money being wasted now; `risk` is fragility; `hygiene` is a data gap. Only spend findings carry a savings figure. |
| 9 | `05-pinned-insight.png` | **`pin_insight` needs no approval** — it spends nothing and routes nothing. Proof the guard is a considered choice rather than a blanket block. |

Devpost shows the first image as the thumbnail, which is why the approval queue
leads: it is the one frame that states the whole idea without a caption.
