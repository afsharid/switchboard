/**
 * End-to-end test of the WebMCP tool surface in a real browser.
 *
 * Drives Chrome through the actual `document.modelContext` API — registration,
 * getTools(), executeTool() — rather than calling the handlers directly, so the
 * host round trip is covered. Also clicks the human side of the approval loop,
 * because the guard is only real if the UI half works.
 *
 *   npm run test:e2e                      # against a local preview
 *   TARGET=https://your-url npm run test:e2e
 *
 * Requires a Chrome build with WebMCP: Chrome 153+ (Canary at time of writing)
 * with chrome://flags/#enable-webmcp-testing. Point CHROME at it if it is not
 * in the default macOS location.
 */
import puppeteer from 'puppeteer-core';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';

const CHROME = process.env.CHROME
  ?? '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary';
const TARGET = process.env.TARGET ?? 'http://localhost:4319/';
const PROFILE = '/tmp/switchboard-e2e-profile';

let failures = 0;
const ok = (label, value) => {
  console.log(`${value ? '  ✓' : '  ✗'} ${label}`);
  if (!value) failures += 1;
};
const section = (name) => console.log(`\n${name}`);

rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(PROFILE, { recursive: true });
// same thing chrome://flags writes, so the flag is on without a manual toggle
writeFileSync(
  `${PROFILE}/Local State`,
  JSON.stringify({ browser: { enabled_labs_experiments: ['enable-webmcp-testing@1'] } }),
);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: PROFILE,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1600 });

const runtimeErrors = [];
page.on('pageerror', (e) => runtimeErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !/404|favicon/.test(m.text())) runtimeErrors.push(`console: ${m.text()}`);
});

console.log(`target: ${TARGET}`);
await page.goto(TARGET, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));

/** Invoke a tool the way an agent does: through the host's executeTool. */
const callTool = (name, args = {}) =>
  page.evaluate(
    async (n, a) => {
      const ctx = document.modelContext ?? navigator.modelContext;
      const tool = (await ctx.getTools()).find((t) => t.name === n);
      if (!tool) throw new Error(`tool not registered: ${n}`);
      return await ctx.executeTool(tool, JSON.stringify(a));
    },
    name, args,
  );

const clickButton = (pattern) =>
  page.evaluate((p) => {
    const re = new RegExp(p);
    const b = [...document.querySelectorAll('button')].find((x) => re.test(x.textContent ?? ''));
    if (!b) return false;
    b.click();
    return true;
  }, pattern);

section('registration');
const surface = await page.evaluate(() =>
  document.modelContext ? 'document.modelContext'
    : navigator.modelContext ? 'navigator.modelContext' : 'none');
ok(`surface resolves to document.modelContext (got ${surface})`, surface === 'document.modelContext');
const tools = await page.evaluate(async () => (await document.modelContext.getTools()).map((t) => t.name).sort());
ok(`getTools() reports 15 tools (got ${tools.length})`, tools.length === 15);
ok('badge reports the same count the host does',
  await page.evaluate(() => /agent-ready · 15 tools/.test(document.body.innerText)));

section('cold load carries the seeded dataset');
const text = await page.evaluate(() => document.body.innerText);
ok('provenance is stated on the page', /667 real API calls/.test(text));
ok('projected spend rendered', /\$255/.test(text));
ok('billing caveat present', /not production billing/.test(text));

section('read-only tools answer');
ok('find_waste returns typed findings', await (async () => {
  const f = JSON.parse(await callTool('find_waste'));
  return f.findings.length > 0
    && f.findings.every((x) => ['spend', 'risk', 'hygiene'].includes(x.kind))
    && f.findings.every((x) => x.kind === 'spend' || x.estimatedMonthlySavingsUsd === null);
})());
ok('compliance audits spend as well as governance', await (async () => {
  const c = JSON.parse(await callTool('check_compliance'));
  const codes = c.blockers.map((b) => b.code);
  return codes.includes('TOTAL_BUDGET') && codes.includes('PROVIDER_BUDGET');
})());
ok('unknown governance metadata blocks a constrained class', await (async () => {
  const m = JSON.parse(await callTool('get_model', { modelId: 'openai/gpt-4o-mini' }));
  const v = m.perClassVerdict.find((x) => x.classId === 'sensitive');
  return v.eligibleAsPrimary === false && v.blockers.some((b) => /TRAINING_UNKNOWN|RETENTION_UNKNOWN/.test(b));
})());
ok('governance filter excludes undocumented models', await (async () => {
  const l = JSON.parse(await callTool('list_models', { excludeTrainsOnData: true }));
  return l.models.every((m) => m.trainsOnData === false);
})());

section('bad input is corrected, not thrown');
ok('unknown classId lists the valid ones',
  /Valid: realtime, batch, sensitive/.test(await callTool('compare_models', { classId: 'nope' })));
ok('unknown model id is refused',
  /Unknown primaryModelId/.test(await callTool('simulate_policy',
    { rules: [{ classId: 'batch', primaryModelId: 'fake/model', fallbackModelIds: [] }] })));
ok('a proposal without a rationale is refused',
  /rationale of at least 10 characters/.test(await callTool('propose_policy_change',
    { rules: [{ classId: 'batch', primaryModelId: 'opencode-go/minimax-m3', fallbackModelIds: [] }], rationale: 'x' })));

section('the guard: agents cannot spend or route');
ok('there is no tool that applies a policy or sets a budget',
  !tools.some((t) => /^(apply|set|update|delete)_/.test(t)));
const budgetMsg = await callTool('propose_budget_change',
  { scope: 'total', monthlyBudgetUsd: 20, rationale: 'Operator asked to stay under twenty a month.' });
ok('budget change becomes a proposal, not a mutation', /Not applied/.test(budgetMsg));
ok('the cap is genuinely unchanged', /"totalMonthlyBudgetUsd":60/.test(await callTool('list_providers')));

section('the refusal: some things are not the agent’s call');
const sensitiveBefore = JSON.parse(await callTool('compare_models', { classId: 'sensitive' }));
ok('no model satisfies the customer-data class', sensitiveBefore.ranked.length === 0);
ok('the refusal says a human must choose', /human has to decide/.test(sensitiveBefore.note ?? ''));

section('the human lever the agent does not have');
await page.evaluate(() => { document.querySelectorAll('details').forEach((d) => { d.open = true; }); });
ok('operator relaxes retention in the UI', await page.evaluate(() => {
  const card = [...document.querySelectorAll('article')]
    .find((c) => /Customer-data explanations/.test(c.textContent ?? ''));
  const select = card?.querySelector('select');
  if (!select) return false;
  select.value = '30';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}));
await new Promise((r) => setTimeout(r, 900));
const sensitiveAfter = JSON.parse(await callTool('compare_models', { classId: 'sensitive' }));
ok('the agent can route it once the human decides', sensitiveAfter.ranked.length > 0);

section('the approval handshake, both halves');
const proposal = await callTool('propose_policy_change', {
  rationale: 'Batch to DeepSeek V4 Flash at $0.09 per 1k delivered against $2.24 for Qwen 3.8 Max.',
  rules: [{ classId: 'batch', primaryModelId: 'opencode-go/deepseek-v4-flash', fallbackModelIds: ['opencode-go/glm-5.2'] }],
});
const firstId = proposal.match(/P-\d+/)?.[0];
ok('proposal created with an id', !!firstId);
ok('the tool warns about its own compliance blockers', /compliance blocker/.test(proposal));
await new Promise((r) => setTimeout(r, 700));

const noteBox = await page.$('input[placeholder*="Optional note"]');
ok('the human gets a note field', !!noteBox);
await noteBox.type('do not fall back to a model that failed its quality gates');
ok('reject is clickable', await clickButton('^Reject$'));
await new Promise((r) => setTimeout(r, 800));
const rejected = await callTool('get_proposal_status', { proposalId: firstId });
ok('the agent reads the rejection', /"status":"rejected"/.test(rejected));
ok('the agent reads the human’s note verbatim',
  rejected.includes('do not fall back to a model that failed its quality gates'));
ok('the agent is told to correct rather than resubmit', /propose a corrected version/.test(rejected));

const corrected = await callTool('propose_policy_change', {
  rationale: 'Dropped GLM 5.2 as asked. Falls back to MiniMax M3: 82% success, p95 4.2s, $0.17 per 1k delivered.',
  rules: [{ classId: 'batch', primaryModelId: 'opencode-go/deepseek-v4-flash', fallbackModelIds: ['opencode-go/minimax-m3'] }],
});
const secondId = corrected.match(/P-\d+/)?.[0];
await new Promise((r) => setTimeout(r, 700));
ok('the simulation is shown to the human',
  await page.evaluate(() => /Simulation —/.test(document.body.innerText)));
ok('approve is clickable', await clickButton('Approve'));
await new Promise((r) => setTimeout(r, 1000));
ok('the approved policy is applied',
  /"classId":"batch","primaryModelId":"opencode-go\/deepseek-v4-flash"/.test(await callTool('get_routing_policy')));
ok('the agent sees the approval', /"status":"approved"/.test(await callTool('get_proposal_status', { proposalId: secondId })));

section('withdrawal');
const pending = await callTool('propose_budget_change',
  { scope: 'provider', providerId: 'opencode-go', monthlyBudgetUsd: 25, rationale: 'Trimming the gateway cap a little.' });
const pendingId = pending.match(/P-\d+/)?.[0];
ok('a pending proposal can be withdrawn', /withdrawn/.test(await callTool('withdraw_proposal', { proposalId: pendingId })));
ok('withdrawing twice is refused', /already withdrawn/.test(await callTool('withdraw_proposal', { proposalId: pendingId })));

section('audit trail');
const feed = await page.evaluate(() => document.body.innerText);
ok('every tool call is visible to the human',
  ['find_waste', 'compare_models', 'propose_policy_change', 'get_proposal_status', 'withdraw_proposal']
    .every((t) => feed.includes(t)));

section('runtime');
ok(`no uncaught errors (${runtimeErrors.length})`, runtimeErrors.length === 0);
if (runtimeErrors.length) console.log(runtimeErrors.slice(0, 5).join('\n'));

await browser.close();
console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
