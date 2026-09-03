# Demo video — shot list and narration

**Hard limit: under 3:00, public YouTube, audio required.** Target 2:35 to leave
room. Record in ChatGPT's in-app browser if it works; otherwise Chrome Canary
with `chrome://flags/#enable-webmcp-testing`.

Before recording: click **Reset demo** so the seeded state is clean, and close
the Agent console panel's output if it has stale text.

---

### 0:00–0:18 — The problem, on screen

*Show the dashboard, scroll once slowly through the model table.*

> "I benchmarked nineteen models across an LLM gateway — six hundred and
> sixty-seven real API calls. Exactly one of them passed my quality gates.
> Eight returned zero successful calls. And my routing policy still points at
> one of the dead ones."

*Point at the KPI row.*

> "Two hundred and fifty-five dollars a month projected, three compliance
> blockers. This is Switchboard, and the numbers on it are my own measurements."

### 0:18–0:32 — What the agent sees

*Open the Agent console panel, expand "tools the browser reports".*

> "The page registers fourteen WebMCP tools on `document.modelContext`. The
> agent doesn't hunt for buttons — the site hands it functions."

### 0:32–1:15 — The agent works

*Type into the agent:*

> "Look at my models. Build me a routing policy that keeps total spend under
> twenty dollars a month, and keep realtime p95 under four seconds."

*Let it run. Point at the activity feed as calls land.*

> "It's calling `find_waste`, `compare_models`, `simulate_policy` — and every
> call shows up here with its arguments and result, so nothing it does is
> invisible."

*When `simulate_policy` fires, point at the before/after chart.*

> "That's the key thing: when it simulates, the projection renders on **my**
> screen. I'm watching it search the trade-off space, not reading a summary of
> it afterwards."

### 1:15–1:50 — The guard, and the rejection

*The proposal appears. Point at the diff.*

> "It can't apply this. `propose_policy_change` doesn't mutate anything — there
> is no `apply_policy` tool and no `set_budget` tool. It creates a proposal and
> gets told to wait."

*Type a rejection note and click Reject:*
`don't fall back to a model that failed its quality gates`

> "I reject it, with a reason."

*Wait for the agent to poll.*

> "It reads that note back through `get_proposal_status`, and corrects itself."

*Second proposal appears. Click **Approve & apply**.*

> "Two hundred and fifty-five dollars down to about twenty-eight. Applied only
> because I approved it."

### 1:50–2:25 — The part the agent can't solve

*Scroll to the sensitive traffic class — the red blocker badge.*

> "Now the interesting one. This class carries customer records: zero data
> retention, and it has to pass quality gates."

*Ask the agent:* "What about the customer-data class?"

> "There is no answer. The one model that passes my quality gates retains data
> for thirty days. So `compare_models` comes back empty, with a note saying a
> human has to decide which constraint to relax — and it pins that trade-off to
> my dashboard instead of quietly picking something non-compliant."

### 2:25–2:40 — Close

> "That's the point. An agent that can read the same board I can, propose real
> changes with real numbers behind them, and know when to stop and ask. Code's
> MIT, data provenance is in the README."

---

## Recording notes

- **Don't narrate the UI, narrate the decision.** Nobody needs "and here's a
  table" — they need "one of nineteen passed."
- Say the numbers out loud. $255 → $28 and 1-of-19 are what people remember.
- If the agent picks a wrong tool, that is a **description** problem, not a code
  problem. Re-run once; if it repeats, tighten the tool's `description`.
- Have the Reset demo button ready for a second take.
- ffmpeg is installed if you need to trim: 
  `ffmpeg -i in.mov -ss 0 -t 175 -c copy out.mov`
