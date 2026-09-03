# YouTube upload

## The one rule that matters

The official rules say the video "must be uploaded to and made publicly visible
on YouTube." Set visibility to **Public**, not Unlisted. Everything else about
the video already complies: 1:46 (under the three-minute limit), narrated audio
covering what was built and how WebMCP was used, no music, no third-party logos.

## Settings

- **Visibility: Public.** Not Unlisted, not Private, and not scheduled.
- **"Is this video made for kids?" → No.** Marking it for kids strips
  clickable links out of the description, which defeats the point of writing one.
- Nothing else needs changing. No monetisation, no end screens, no music.

## Title

```
Switchboard — an LLM routing console a human and an AI agent operate together (WebMCP)
```

## Description

```
Switchboard is an LLM spend and routing console built for a human and an AI
agent at the same board. The agent reads every number on it through WebMCP —
prices, measured latency, success rates, data-governance terms — compares
models, projects what a candidate routing policy would cost, and finds waste.
What it cannot do is apply anything. There is no apply_policy tool and no
set_budget tool. It creates a proposal; only the human approves it.

Live: https://switchboard-100.pages.dev
Code: https://github.com/afsharid/switchboard  (MIT)

This recording is ChatGPT's own in-app browser on GPT-5.6 Sol, driven against
the live deployment. Nothing in it is mocked. The agent discovered the fifteen
tools itself, refused to route the customer-data class and asked me to decide,
proposed for the other two classes, read my rejection note back verbatim,
corrected itself while disclosing the fallback's 7.8-second tail rather than
hiding it, and was applied only after I approved.

The numbers are real too. Prices and data-retention terms come from published
provider documentation; latency, success rates and cost per delivered output
are my own measurements from four evaluation runs covering 667 live API calls
across 19 models. Of those 19, exactly one passed my quality gates and eight
never returned a single successful call.

One limit of WebMCP worth knowing: a page cannot notify an agent. The protocol
is one-directional, so after the human decides, the agent does not know until
it polls get_proposal_status — which is why you see me tell it that I rejected
the proposal.

Built for the OpenAI WebMCP Challenge.
```

## After uploading

Paste the watch URL into the Devpost submission's video field. Devpost wants the
YouTube link, not an upload.
