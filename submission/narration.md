# Narration script

**The shipped video is a recording of ChatGPT's own in-app browser**, driven end
to end against the live deployment — every tool call in it was made by GPT-5.6
Sol, not scripted. `cut-list.json` records which line maps to which offset in
the 15:35 raw take, so the edit is reproducible. Note the order: the agent
raised the customer-data conflict *before* it proposed anything, so lines 11 and
12 sit between 06 and 07 rather than at the end — the narration follows what
actually happened.

Fifteen lines, in order. The current audio is macOS `say` (Samantha) — usable,
but any decent TTS or a human read will be better. Two ways to swap it in:

**A. One file per line** (best). Name them `01.wav` … `15.wav`, drop them in a
folder, and re-mux — the video is fully scripted, so if the new lines are a
different length the recording is simply re-run timed to them. Nothing has to
be edited by hand.

**B. One continuous read.** Record the whole thing in one take and it gets laid
over the existing footage; expect to nudge the timing.

Target durations below are what the current footage is cut to. Within about a
second either way needs no change.

| # | at | length | line |
|---|---|---|---|
| 01 | 0.0s | 9.6s | This is Switchboard. It routes my LLM traffic, and the numbers on it are my own measurements: six hundred and sixty seven real API calls across nineteen models. |
| 02 | 10.2s | 13.7s | Two hundred and fifty five dollars a month projected, against a sixty dollar cap. Six compliance blockers. Of those nineteen models, exactly one passed my quality gates, and eight never returned a single successful call. |
| 03 | 24.5s | 8.6s | The page registers fifteen WebMCP tools on document dot modelContext. An agent doesn't hunt for buttons. The site hands it functions. |
| 04 | 33.6s | 7.5s | So I ask it to build me a routing policy under twenty five dollars a month, keeping realtime p ninety five under four seconds. |
| 05 | 41.7s | 8.9s | It calls find waste, compares models, and simulates. Every call lands in this feed with its arguments and result, so nothing it does is invisible. |
| 06 | 51.2s | 7.9s | And when it simulates, the projection renders on my screen. I'm watching it search the trade off space, not reading a summary afterwards. |
| 07 | 59.7s | 8.7s | Now the important part. It cannot apply this. There is no apply policy tool and no set budget tool. It creates a proposal and gets told to wait. |
| 08 | 69.0s | 3.5s | I reject it, with a reason: realtime has no fallback. |
| 09 | 75.6s | 12.1s | It reads that note back through get proposal status, finds no fully compliant fallback exists, picks the closest one, and tells me about the one hundred and eighty seven millisecond overage instead of hiding it. |
| 10 | 88.2s | 6.2s | I approve. Two hundred and fifty five dollars down to twenty three. Applied only because I said so. |
| 11 | 95.0s | 7.5s | Now the one it can't solve. This class carries customer records: zero data retention, and it has to pass quality gates. |
| 12 | 103.1s | 10.1s | There is no answer. The only model that passes my gates retains data for thirty days. So it returns an empty ranking and says a human has to decide which constraint to relax. |
| 13 | 113.8s | 3.6s | That's my call, not its. I accept thirty day retention. |
| 14 | 118.7s | 4.8s | And now it can work. It found the trade off, I made the judgement, it did the rest. |
| 15 | 124.1s | 7.6s | An agent reading the same board I am, proposing real changes with real numbers behind them, and knowing exactly where to stop and ask. |

## Plain text, for pasting into a TTS tool

```
This is Switchboard. It routes my LLM traffic, and the numbers on it are my own measurements: six hundred and sixty seven real API calls across nineteen models.
Two hundred and fifty five dollars a month projected, against a sixty dollar cap. Six compliance blockers. Of those nineteen models, exactly one passed my quality gates, and eight never returned a single successful call.
The page registers fifteen WebMCP tools on document dot modelContext. An agent doesn't hunt for buttons. The site hands it functions.
So I ask it to build me a routing policy under twenty five dollars a month, keeping realtime p ninety five under four seconds.
It calls find waste, compares models, and simulates. Every call lands in this feed with its arguments and result, so nothing it does is invisible.
And when it simulates, the projection renders on my screen. I'm watching it search the trade off space, not reading a summary afterwards.
Now the important part. It cannot apply this. There is no apply policy tool and no set budget tool. It creates a proposal and gets told to wait.
I reject it, with a reason: realtime has no fallback.
It reads that note back through get proposal status, finds no fully compliant fallback exists, picks the closest one, and tells me about the one hundred and eighty seven millisecond overage instead of hiding it.
I approve. Two hundred and fifty five dollars down to twenty three. Applied only because I said so.
Now the one it can't solve. This class carries customer records: zero data retention, and it has to pass quality gates.
There is no answer. The only model that passes my gates retains data for thirty days. So it returns an empty ranking and says a human has to decide which constraint to relax.
That's my call, not its. I accept thirty day retention.
And now it can work. It found the trade off, I made the judgement, it did the rest.
An agent reading the same board I am, proposing real changes with real numbers behind them, and knowing exactly where to stop and ask.
```

## Reading notes

- The numbers carry the video: `$255 → $23`, one of nineteen models passing,
  eight returning nothing, `$230.66/mo` of waste. Land on them.
- Line 07 is the point of the whole project — the agent *cannot* apply the
  change. Slow down there.
- Line 12 into 13 is the turn: the agent stops, the human decides. A beat
  between them helps.
- Don't rush line 15; it's the only sentence that says what it all means.

## Re-muxing

```bash
# per-line files in ./voice/01.wav … 15.wav
node scripts/build-video.mjs --voice ./voice
```

That re-records the screen against the new timings and produces
`submission/switchboard-demo.mp4`. Everything in the recording is a real
`document.modelContext` tool call, so re-running it re-verifies the demo.
