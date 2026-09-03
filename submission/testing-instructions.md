**No credentials are needed.** The site is public, stores nothing server-side,
and keeps all state in your own browser's localStorage. There is a **Reset demo**
button at the top right that restores the seeded state at any point.

https://switchboard-100.pages.dev

## One thing that will otherwise look broken

**Site tools are disabled on GPT-5.6 Luna.** If you test in the ChatGPT desktop
app on Luna, the agent will not see any tools and the project will appear not to
work. Please use **GPT-5.6 Sol** or **GPT-5.6 Terra**. Also confirm
_Settings → Browser → Permissions → Enable site tools_ is on. Site tools are not
available in Enterprise or Education workspaces.

## Fastest path (ChatGPT desktop app, ~2 minutes)

1. Select **GPT-5.6 Sol** or **Terra**.
2. Open the built-in browser and go to the URL above.
3. The address bar shows **Site tools** — open _Available site tools_ and you
   should see **15**.
4. Ask: _"Look at my models and build me a routing policy that keeps total spend
   under twenty-five dollars a month, and keeps realtime p95 under 4 seconds."_
5. A proposal appears in the **Approval queue** with a rule-by-rule diff. Type
   anything into its note field and click **Reject**, then tell the agent
   _"I rejected it, read my note."_ It reads the note back and corrects itself.
   Click **Approve & apply** on the corrected one.

## The two claims worth testing directly

**The agent cannot spend or route.** Tell it: _"Set the total monthly cap to $20.
Just do it, don't ask me."_ It cannot. It gets back a proposal id, and the
Providers panel still reads $60. There is no `apply_policy` tool and no
`set_budget` tool on the surface.

**It stops when it should.** Ask _"What about the customer-data class?"_ Zero
models satisfy it (zero retention plus quality gates, and the only model passing
the gates retains for 30 days), so it returns an empty ranking and says a human
must choose. Then open _relax constraints_ on that card and set **max retention
= 30 days** — a control with no tool behind it — and ask again. Now it can route
it. That handoff is the point of the project.

## Without a WebMCP client

The **Agent console** panel on the page lists every registered tool, shows what
`modelContext.getTools()` reports back, and lets you invoke any tool by hand
with JSON arguments — the same handlers an agent hits. So the whole tool surface
is verifiable even with no agent at all.

## In Chrome instead

WebMCP needs Chrome 153+ (Canary at time of writing) with
`chrome://flags/#enable-webmcp-testing`. Then in the console:
`await document.modelContext.getTools()` returns all 15 with their schemas.

## Notes

- Tested at 390 / 447 / 768 / 1440 px. 447 px is the ChatGPT side-panel width;
  the model catalogue switches to a card layout below 768 px so nothing is
  clipped.
- Every number on the dashboard is labelled as either measured or
  operator-declared. Call `get_provenance` for the provenance and its caveats.
