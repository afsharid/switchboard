# Switchboard Independent Audit Report

**Auditor:** Antigravity (Gemini 3.8 Flash High)  
**Date:** 2026-09-03  
**Repository:** `/Users/mini/Projects/switchboard`  
**Commit Audited:** `0a9635f`  
**Live Target:** `https://switchboard-100.pages.dev` / local build preview (`http://localhost:4319`)

---

## 1. Claims Checked

All claims in [`README.md`](file:///Users/mini/Projects/switchboard/README.md) and [`submission/devpost.md`](file:///Users/mini/Projects/switchboard/submission/devpost.md) were verified against the repository code, test suites, and raw seed data in [`src/data/seed.json`](file:///Users/mini/Projects/switchboard/src/data/seed.json).

| Claim | Location | Verdict | Details / Correct Value if Wrong |
|---|---|---|---|
| **15 tools registered** | `README.md:210, 229, 271`<br>`devpost.md:105, 183` | **CORRECT** | [`buildTools()`](file:///Users/mini/Projects/switchboard/src/webmcp/tools.ts#L80) in `src/webmcp/tools.ts` defines and returns exactly 15 tools. |
| **Tool blast radius table classification** | `devpost.md:109` | **MINOR DISCREPANCY** | `devpost.md` lists 10 tools under `Read-only (readOnlyHint: true)` and places `get_proposal_status` under `Poll / retract`. However, in `src/webmcp/tools.ts:589`, `get_proposal_status` has `readOnly: true`, so it registers with `readOnlyHint: true` (11 tools total have `readOnlyHint: true`). |
| **35 e2e checks passing** | `README.md:287`<br>`devpost.md:201` | **UNDERSTATED / STALE** | [`tests/webmcp.e2e.mjs`](file:///Users/mini/Projects/switchboard/tests/webmcp.e2e.mjs) actually defines and runs **49 `ok(...)` assertions**, not 35. Stale documentation from an earlier commit. |
| **Initial projected spend: $255** | `README.md:49, 92, 280`<br>`tests/webmcp.e2e.mjs:92, 280` | **CORRECT (DISPLAY)** | Exact computed initial monthly spend is **$254.84** (`$254.8389...`). The UI formatting helper [`usd()`](file:///Users/mini/Projects/switchboard/src/domain/cost.ts#L107-L113) rounds numbers $\ge 100$ to 0 decimal places (`$255`). |
| **Initial spend mock: $255.31/mo** | `README.md:123` | **STALE / WRONG** | Quote: `Moves projected spend from $255.31/mo to $23.94/mo.`<br>**Correct value:** Starting spend under [`INITIAL_POLICY`](file:///Users/mini/Projects/switchboard/src/data/initial.ts#L70) is **$254.84/mo**. $255.31 is a stale value from the initial commit. |
| **Candidate spend mock: $45.50/mo** | `devpost.md:68` | **STALE / WRONG** | Quote: `Moves projected spend $254.84/mo → $45.50/mo.`<br>**Correct value:** Applying the batch change (`deepseek-v4-flash` primary + `glm-5.2` fallback) moves total projected spend to **$46.66/mo** ($10.72 realtime + $33.50 batch + $2.43 sensitive). |
| **$230.66 / $231 waste savings** | `README.md:49`<br>`devpost.md:168` | **CORRECT** | [`findWaste()`](file:///Users/mini/Projects/switchboard/src/domain/waste.ts#L9-L69) computes `CHEAPER_ELIGIBLE` on batch as `$241.6843 - $11.0208 = $230.6635...`, which rounds to **$230.66** (or **$231** integer). |
| **$2.24 vs $0.09 per 1k delivered** | `devpost.md:169-170` | **CORRECT** | In `seed.json`: `opencode-go/qwen3.8-max` is **$2.2408/1k**, and `opencode-go/deepseek-v4-flash` is **$0.0918/1k**. |
| **$22.84 compliant floor** | `README.md:50`<br>`devpost.md:85` | **CORRECT** | Pure calculation from `cost.ts`: Realtime with Luna = **$9.392**; Batch with DeepSeek V4 Flash = **$11.0208**; Sensitive with Luna (at 30d retention) = **$2.432**. Sum = **$22.8448**, rounding to **$22.84**. |
| **$9.39 realtime compliant model** | `README.md:51`<br>`devpost.md:86` | **CORRECT** | 40,000 calls $\times$ $(490 \times 0.25 + 114 \times 1.00) / 10^6 = \$9.392 \rightarrow \mathbf{\$9.39}$. |
| **$11.02 batch compliant model** | `README.md:52`<br>`devpost.md:86` | **CORRECT** | 120,000 calls $\times$ $(516 \times 0.14 + 70 \times 0.28) / 10^6 = \$11.0208 \rightarrow \mathbf{\$11.02}$. |
| **$2.43 customer-data model** | `README.md:52, 180`<br>`devpost.md:87, 180` | **CORRECT** | 8,000 calls $\times$ $(560 \times 0.25 + 160 \times 1.00) / 10^6 = \$2.432 \rightarrow \mathbf{\$2.43}$. |
| **4 valid live evaluation runs** | `README.md:144`<br>`devpost.md:152` | **CORRECT** | `src/data/seed.json` contains exactly 4 `evalRuns`, all dated `2026-08-20` and marked valid. |
| **667 real API calls** | `README.md:145`<br>`devpost.md:152` | **CORRECT** | Sum of `actualTotalNetworkCalls` across all 4 runs in `src/data/seed.json` is exactly 667. |
| **19 gateway models / catalogue count** | `README.md:145, 163`<br>`devpost.md:49, 153, 166` | **MOSTLY CORRECT / AMBIGUOUS** | Exactly 19 gateway models (`opencode-go/*`) were measured. However, the total catalogue in `seed.json` has **26 models** (19 gateway + 7 direct provider models). `devpost.md:49` refers to *"a 19-row spreadsheet"*, which understates the full 26-model catalogue. |
| **19 models with measurements** | `README.md:102` | **CORRECT** | Exactly 19 models have `measured !== null` (the 7 direct provider models have `measured: null`). |
| **Exactly 1 model passes quality gates** | `README.md:163`<br>`devpost.md:93, 166` | **CORRECT** | Only `opencode-go/gpt-5.6-luna` has `meetsQualityGates: true`. |
| **8 models returned zero successes** | `README.md:164`<br>`devpost.md:166` | **CORRECT** | Exactly 8 measured models have `requestSuccessRate === 0` (`grok-4.5`, `kimi-k2.6`, `mimo-v2.5`, `mimo-v2.5-pro`, `hy3`, `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus`). |
| **Median 33 calls per model** | `README.md:256`<br>`devpost.md:124` | **CORRECT** | 18 measured models have 33 calls and 1 has 66 calls; median is 33. |
| **No secrets, prompts, or response text in seed.json** | `README.md:147-148`<br>`devpost.md:154-156` | **CORRECT** | Verified via string and regex scan. `seed.json` contains only model metadata, benchmark aggregates, pricing, and error categories. Zero prompts, fixtures, or responses. |
| **Strict field allowlist in extract script** | `scripts/extract-seed.ts:5-8` | **QUALIFIED TRUE** | Key-level validation is strictly enforced on `model` and `measured` properties via `ALLOWED_MODEL_KEYS` and `ALLOWED_MEASURED_KEYS`. Note: String array contents (e.g. `gateFailureReasons`) are copied from report files without value sanitization (other than the 5 regex secret checks). |
| **No source code copied from another repo** | `README.md:78-79` | **CORRECT** | All code in `src/` is newly authored. `extract-seed.ts` imports TypeScript types/catalogs from `/Users/mini/Projects/voltwise`, but no files were copied into this repo. |
| **MIT licence detectable by GitHub** | `README.md:310-312`<br>`devpost.md:6` | **CORRECT** | Standard `LICENSE` file exists at root. (Note: `package.json` omits the `"license": "MIT"` field, but GitHub Licensee detects the root file). |
| **Project origin: created on 2026-09-03** | `README.md:69-72` | **CORRECT** | All 13 git commits in `git log` were created on `2026-09-03` between 10:12:46 +0300 and 15:28:17 +0300. |

---

## 2. Security Review Findings

### 2.1 Direct State Mutation by an Agent
**Verdict: VERIFIED SECURE (No bypass found).**
- Traced all 15 tool handlers in [`src/webmcp/tools.ts`](file:///Users/mini/Projects/switchboard/src/webmcp/tools.ts):
  - No tool calls [`applyRulesDirect`](file:///Users/mini/Projects/switchboard/src/store/useSwitchboard.ts#L97), [`setProviderBudgetDirect`](file:///Users/mini/Projects/switchboard/src/store/useSwitchboard.ts#L90), [`setTotalBudget`](file:///Users/mini/Projects/switchboard/src/store/useSwitchboard.ts#L88), or [`setClassConstraint`](file:///Users/mini/Projects/switchboard/src/store/useSwitchboard.ts#L81).
  - The guarded tools ([`propose_policy_change`](file:///Users/mini/Projects/switchboard/src/webmcp/tools.ts#L453) and [`propose_budget_change`](file:///Users/mini/Projects/switchboard/src/webmcp/tools.ts#L506)) solely invoke `s.createProposal(...)`.
  - In `src/store/useSwitchboard.ts:107-119`, `createProposal` strictly hardcodes `status: 'pending'`, `decidedAt: null`, and `decisionNote: null`. Even if a malicious agent passes `status: 'approved'` in arguments, it is completely ignored and overwritten.
  - State application occurs strictly inside [`decideProposal`](file:///Users/mini/Projects/switchboard/src/store/useSwitchboard.ts#L121-L138), which is **only** invoked by the human operator's click handlers in [`src/features/Panels.tsx:164, 171`](file:///Users/mini/Projects/switchboard/src/features/Panels.tsx#L164-L171).
  - [`withdraw_proposal`](file:///Users/mini/Projects/switchboard/src/webmcp/tools.ts#L567) only transitions a proposal from `'pending'` to `'withdrawn'`.
  - No DOM-based XSS, `dangerouslySetInnerHTML`, or client-side code execution sinks exist in the UI.

### 2.2 Side Effects in Read-Only Tools
- **`simulate_policy` mutates UI display state:**
  [`simulate_policy`](file:///Users/mini/Projects/switchboard/src/webmcp/tools.ts#L353) is annotated with `readOnly: true` (setting `readOnlyHint: true` in WebMCP registration) and `effect: 'read'`. However, line 379 calls `s.setSimulation(...)`.
  - **Assessment:** While `simulation` is excluded from localStorage persistence and does not alter routing or budgets, in standard WebMCP/MCP protocol specifications `readOnlyHint: true` indicates zero side effects. An agent calling `simulate_policy` in a loop will constantly trigger React re-renders and repaint the operator's display, and calling it after `propose_policy_change` overwrites the visual preview of the proposal awaiting review.

### 2.3 Domain Logic Correctness Bugs
Two significant logic issues were uncovered in [`src/domain/compliance.ts`](file:///Users/mini/Projects/switchboard/src/domain/compliance.ts):

1. **Unmeasured models silently pass quality gates, latency ceilings, and success rate floors when `requireMeasured: false`** ([`src/domain/compliance.ts:29, 34, 38`](file:///Users/mini/Projects/switchboard/src/domain/compliance.ts#L29-L41)):
   - In `modelViolations`:
     ```ts
     if (c.requireQualityGates && m.measured && !m.measured.meetsQualityGates) { ... }
     if (c.minSuccessRate !== null && m.measured && m.measured.requestSuccessRate < c.minSuccessRate) { ... }
     if (c.maxP95Ms !== null && m.measured && m.measured.p95LatencyMs > c.maxP95Ms) { ... }
     ```
   - If `c.requireMeasured` is `false`, any unmeasured model (`m.measured === null`, e.g. `openai/gpt-4o-mini`, `google/gemini-2.5-flash`) evaluates these conditions to `null`/falsy and **passes without any blocker or warning**.
   - Furthermore, in [`src/domain/cost.ts:44-51`](file:///Users/mini/Projects/switchboard/src/domain/cost.ts#L44-L51), unmeasured models default to `0ms` latency (`m.measured?.p95LatencyMs ?? 0`), so they report `worstCaseLatencyMs = 0ms`, completely bypassing `CHAIN_LATENCY`.
   - Contrast this with governance rules ([`compliance.ts:42-60`](file:///Users/mini/Projects/switchboard/src/domain/compliance.ts#L42-L60)), where undocumented fields correctly raise `RETENTION_UNKNOWN` and `TRAINING_UNKNOWN` blockers. Performance constraints should similarly flag unmeasured models when constraints are active.

2. **`minSuccessRate` is evaluated per-model instead of chain delivery rate** ([`src/domain/compliance.ts:34-37`](file:///Users/mini/Projects/switchboard/src/domain/compliance.ts#L34-L37)):
   - Documentation in `README.md:140` and `tools.ts:140, 357` explicitly promises:
     > *"minSuccessRate (judged against the chain-level delivery rate, not one model's success rate)"*
   - In actual code: Line 34 evaluates `m.measured.requestSuccessRate < c.minSuccessRate` on **every model individually as a hard blocker** (`add('blocker', 'SUCCESS_RATE', ...)`), including fallbacks.
   - Meanwhile, chain delivery is checked in [`compliance.ts:93`](file:///Users/mini/Projects/switchboard/src/domain/compliance.ts#L93) using a **hardcoded 90% threshold** (`if (proj.deliveredRate < 0.9)`), which ignores `cls.constraints.minSuccessRate` entirely and emits a `warning` (`DELIVERY`), not a blocker.

---

## 3. Viewport & Usability Findings

Tested using Chromium/Puppeteer across 390px (Mobile), 768px (Tablet), and 1440px (Desktop).

### 3.1 Mobile (390px Viewport — iPhone 12/13/14/15/16)
**Severity: High**
1. **Severe Horizontal Page Overflow (`scrollWidth: 682px` vs `clientWidth: 390px`):**
   - The document exhibits 292px of unwanted horizontal scroll on phone screens.
   - **Root Cause:** In [`src/App.tsx:76`](file:///Users/mini/Projects/switchboard/src/App.tsx#L76), `<div className="mt-3 grid gap-3 lg:grid-cols-[1fr_360px]">` wraps `<div className="space-y-3">`. In CSS grid, grid items default to `min-width: auto`. Inside `ModelsPanel` ([`src/features/Panels.tsx:443`](file:///Users/mini/Projects/switchboard/src/features/Panels.tsx#L443)), the table has `min-w-[640px]`. Because the parent grid item lacks `min-w-0`, it expands to 664px (640px + card padding), forcing the entire document to 682px.
2. **"Relax Constraints" `<select>` and `<details>` Touch Targets Too Small:**
   - `<summary>` toggle height is only **17px** (`text-[11px]`).
   - The `<select>` dropdowns for "max retention" and "p95 ceiling" ([`src/features/Panels.tsx:236, 251`](file:///Users/mini/Projects/switchboard/src/features/Panels.tsx#L236-L253)) have a rendered height of only **21px** (`px-1 py-0.5 text-[11px]`) and width of 69px–72px.
   - The checkboxes are unstyled native 13x13px boxes.
   - Standard touch guidelines (Apple iOS HIG / WCAG 2.5.5) recommend a minimum 44x44px tap target (or 32px compact). A 21px select is difficult to tap accurately on a mobile device without mis-tapping adjacent text.
3. **Mobile Safari/Chrome Auto-Zoom:**
   - Form inputs and `<select>` elements styled with `text-[11px]` (< 16px) trigger automatic viewport zoom on iOS devices upon focus, causing sudden UI shifting.
4. **Color Contrast:**
   - Small 11px text using `--ink-muted` (`#898781`) on `--surface-2` (`#222221`) in `ClassesPanel` measures a contrast ratio of **4.46:1**, slightly below WCAG AA (4.5:1).
   - Badges with `--critical` (`#d03b3b`) text on dark card backgrounds yield a contrast ratio of **3.58:1**, failing WCAG AA for 11px text.

### 3.2 Tablet (768px Viewport — iPad Mini / Small Tablet)
**Severity: Low**
- The layout drops to a single column (since `lg:grid-cols-[1fr_360px]` applies at $\ge 1024\text{px}$).
- Available width is 710px, which accommodates the 640px model catalogue table without horizontal document overflow (`hasHorizontalScroll: false`).
- All interactive controls operate cleanly.

### 3.3 Desktop (1440px Viewport)
**Severity: None**
- Two-column grid displays as designed.
- No clipping or overflow detected.

---

## 4. Open Questions & Recommendations

1. **Should the mock output in `README.md` and `submission/devpost.md` be synchronized with actual tool output?**
   - In `README.md:123`, change `$255.31/mo to $23.94/mo` to `$254.84/mo to $46.66/mo`.
   - In `devpost.md:68`, change `$254.84/mo → $45.50/mo` to `$254.84/mo → $46.66/mo`.
2. **Update check count in documentation:**
   - Update both `README.md:287` and `devpost.md:201` from `35 checks` to `49 checks`.
3. **Add `min-w-0` to the grid children in `src/App.tsx`:**
   - Adding `min-w-0` to `<div className="space-y-3 min-w-0">` immediately isolates the `overflow-x-auto` table in `ModelsPanel` and eliminates the 682px mobile horizontal page blowout.
4. **Enlarge `<select>` and `<summary>` in `ConstraintEditor`:**
   - Increasing padding to `py-1.5 px-2` (achieving at least 32px height) on mobile will prevent mis-taps during the demo finale.
5. **Align `minSuccessRate` implementation with documented intent:**
   - Decide whether `minSuccessRate` is intended to be a per-model constraint or a chain-level constraint, and update either the code in `compliance.ts` or the documentation in `tools.ts` accordingly.
