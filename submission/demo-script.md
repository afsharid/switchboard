# Demo video — shot list and narration

**Hard limit: under 3:00, public YouTube, audio required.** Target 2:35 to leave
room. Record in ChatGPT's in-app browser if it works; otherwise Chrome Canary
with `chrome://flags/#enable-webmcp-testing`.

Before recording: click **Reset demo** so the seeded state is clean, and close
the Agent console panel's output if it has stale text.

**If recording in the ChatGPT desktop app:** select **GPT-5.6 Sol** or
**GPT-5.6 Terra** first. Site tools are disabled on GPT-5.6 Luna and the agent
will simply not see the tools. Check *Settings → Browser → Permissions → Enable
site tools* is on too.

---

### 0:00–0:18 — The problem, on screen

*Show the dashboard, scroll once slowly through the model table.*

> "I benchmarked nineteen models across an LLM gateway — six hundred and
> sixty-seven real API calls. Exactly one of them passed my quality gates.
> Eight returned zero successful calls. And my routing policy still points at
> one of the dead ones."

*Point at the KPI row.*

> "Two hundred and fifty-five dollars a month projected against a sixty-dollar cap, eight compliance
> blockers. This is Switchboard, and the numbers on it are my own measurements."

### 0:18–0:32 — What the agent sees

*Open the Agent console panel, expand "tools the browser reports".*

> "The page registers fifteen WebMCP tools on `document.modelContext`. The
> agent doesn't hunt for buttons — the site hands it functions."

### 0:32–1:15 — The agent works

*Type into the agent:*

> "Look at my models. Build me a routing policy that keeps total spend under
> twenty-five dollars a month, and keep realtime p95 under four seconds."

*Use $25, not $20.* The compliant floor is $22.84/mo — realtime has exactly one
eligible model at $9.39, the cheapest eligible batch model is $11.02, and the
customer-data class adds $2.43. Asking for $20 makes the agent explain, with the
arithmetic, that the target is unreachable without relaxing a constraint. That
is genuinely good behaviour and worth one sentence if you have room, but it
muddies a three-minute arc, so ask for $25 and let it land at $22.84.

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
`realtime has no fallback — if GPT 5.6 Luna goes down the whole class is dead`

> "I reject it, with a reason."

*(Verified: the agent proposes empty `fallbackModelIds`, so a note about
removing a bad fallback lands on nothing and the agent correctly refuses to
resubmit. Fallback depth is a real objection it can act on — `find_waste`
flags the same thing as THIN_ELIGIBILITY.)*

*Wait for the agent to poll.*

> "It reads that note back through `get_proposal_status`, and corrects itself."

*Second proposal appears. Click **Approve & apply**.*

> "Two hundred and fifty-five dollars a month down to about twenty-three.
> Applied only because I approved it."

### 1:50–2:30 — The part the agent can't solve, and who can

*Scroll to the sensitive traffic class — the red blocker badge.*

> "Now the interesting one. This class carries customer records: zero data
> retention, and it has to pass quality gates."

*Ask the agent:* "What about the customer-data class?"

> "There's no answer. The one model that passes my quality gates retains data
> for thirty days. So `compare_models` comes back empty — with a note saying a
> human has to decide which constraint to relax. It won't quietly pick something
> non-compliant, and it can't relax the constraint itself. There's no tool for
> that, on purpose."

*Open "relax constraints" on that class and switch retention to 30 days.*

> "That's my call to make, not its. I'll accept thirty-day retention."

*Ask the agent again.* It now returns GPT 5.6 Luna at $2.43/mo.

> "And now it can work. That's the handoff: it found the trade-off, I made the
> judgement, it did the rest."

### 2:30–2:45 — Close

> "An agent reading the same board I am, proposing real changes with real
> numbers behind them, and knowing exactly where to stop and ask. Fifteen
> WebMCP tools, six hundred and sixty-seven real measured calls, MIT licence."

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
---

## Rules compliance for the video (from the official rules)

- **Under 3:00.** "Judges are not required to watch beyond three minutes."
- **Public on YouTube.** Not unlisted — "made publicly visible on YouTube."
- **Audio required,** and it must cover "what you built and how you used
  WebMCP." The script does both; do not drop the WebMCP explanation at 0:18.
- **No copyrighted music.** No backing track at all is the safe choice.
- **No third-party logos.** Naming models (GPT, Kimi, Qwen, GLM) is factual
  descriptive use and unavoidable for this project, but do not put provider
  logos, marketing screenshots or brand imagery on screen.
- **Nothing on screen you do not have rights to** — close unrelated tabs,
  Slack, email, and anything with someone else's content in it.
