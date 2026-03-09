#!/usr/bin/env node
/**
 * AI Operations OS — Live Demo
 *
 * Runs 3 real scenarios through the pipeline to demonstrate:
 *   1. Email reply (read=auto, reply=needs approval)
 *   2. Calendar scheduling (check=auto, create=needs approval)
 *   3. Social media post (post=needs approval, CORD gate)
 *
 * Usage: node scripts/demo.js
 */

const API = 'http://localhost:3100';

// ── Terminal colors ──────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgRed: '\x1b[41m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function banner(text) {
  const line = '═'.repeat(60);
  console.log(`\n${c.cyan}${line}${c.reset}`);
  console.log(`${c.bold}${c.white}  ${text}${c.reset}`);
  console.log(`${c.cyan}${line}${c.reset}\n`);
}

function step(icon, label, detail) {
  console.log(`  ${icon}  ${c.bold}${label}${c.reset}  ${c.dim}${detail || ''}${c.reset}`);
}

function pipelineEvent(evt) {
  const type = evt.type;
  const task = evt.task;
  const s = evt.step;
  const run = evt.run;
  const approval = evt.approval;

  switch (type) {
    case 'task_created':
      step('📥', 'Task Created', `id=${task?.id?.slice(0,8)}...  "${task?.title}"`);
      break;
    case 'intent_classified':
      step('🧠', 'Intent Classified', `${c.magenta}${task?.intent}${c.reset}`);
      break;
    case 'workflow_started':
      step('⚡', 'Workflow Started', `type=${c.blue}${run?.workflowType}${c.reset}  steps=${run?.steps?.length}`);
      break;
    case 'step_evaluating':
      step('🔍', 'Evaluating', `${c.cyan}${s?.connector}.${s?.operation}${c.reset}`);
      break;
    case 'step_allowed': {
      const score = s?.cordScore ?? 0;
      step('🛡️', 'CORD Safety', `${c.green}ALLOW${c.reset}  score=${score}/99`);
      step('📋', 'Policy Gate', `${c.green}autonomous${c.reset}  — read-only, no approval needed`);
      break;
    }
    case 'step_approval_needed':
      step('🛡️', 'CORD Safety', `${c.green}ALLOW${c.reset}  score=${s?.cordScore ?? 0}/99`);
      step('📋', 'Policy Gate', `${c.yellow}approval required${c.reset}  — write operation`);
      step('🔔', 'Approval Request', `${c.yellow}risk=${approval?.risk}${c.reset}  "${approval?.reason}"`);
      break;
    case 'step_approved':
      step('✅', 'Approved', `${c.green}user approved${c.reset}  ${c.dim}(auto in demo)${c.reset}`);
      break;
    case 'step_blocked':
      step('🚫', 'BLOCKED', `${c.red}${evt.message}${c.reset}`);
      break;
    case 'step_executing':
      step('⏳', 'Executing', `${s?.connector}.${s?.operation}...`);
      break;
    case 'step_completed':
      step('✔️', 'Done', `${c.green}${s?.connector}.${s?.operation}${c.reset}  ${s?.durationMs ?? 0}ms`);
      break;
    case 'workflow_completed':
      step('🏁', 'Workflow Complete', `${c.green}${c.bold}SUCCESS${c.reset}  ${run?.steps?.length} steps executed`);
      break;
    case 'workflow_failed':
      step('❌', 'Workflow Failed', `${c.red}${evt.message}${c.reset}`);
      break;
    case 'done':
      break;
    default:
      // Skip noisy intermediate events like approval_request from SSE wrapper
      if (type === 'approval_request') {
        // Already handled in step_approval_needed
        break;
      }
      step('📌', type, evt.message || JSON.stringify(evt).slice(0, 80));
  }
}

// ── Scenarios ────────────────────────────────────────────────────────────────

async function runScenario(title, payload) {
  banner(title);

  // Show the input
  step('📨', 'Inbound Event', `source=${c.cyan}${payload.source}${c.reset}`);
  if (payload.event?.subject) step('   ', '', `subject: "${payload.event.subject}"`);
  if (payload.event?.body) step('   ', '', `body: "${payload.event.body}"`);
  console.log();

  // Run pipeline via SSE
  step('🚀', 'Pipeline Starting...', '');
  console.log(`  ${c.dim}${'─'.repeat(56)}${c.reset}`);

  const res = await fetch(`${API}/api/pipeline/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  const events = text
    .split('\n')
    .filter(line => line.startsWith('data: '))
    .map(line => {
      try { return JSON.parse(line.slice(6)); }
      catch { return null; }
    })
    .filter(Boolean);

  for (const evt of events) {
    await sleep(200); // Pace for readability
    pipelineEvent(evt);
  }

  console.log(`  ${c.dim}${'─'.repeat(56)}${c.reset}`);
  console.log();
}

async function runSimulation(title, payload) {
  banner(title);

  step('🔮', 'Dry-Run Simulation', `source=${c.cyan}${payload.source}${c.reset}  "${payload.title}"`);
  console.log();

  const res = await fetch(`${API}/api/pipeline/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  step('🧠', 'Intent', `${c.magenta}${data.intent}${c.reset}  workflow=${c.blue}${data.workflowType}${c.reset}`);
  console.log();

  for (const s of data.steps) {
    const auto = s.policyDecision === 'auto';
    const icon = auto ? '🟢' : '🟡';
    const label = `${s.connector}.${s.operation}`;
    const policy = auto ? `${c.green}autonomous${c.reset}` : `${c.yellow}needs approval${c.reset}`;
    const safety = s.safetyDecision === 'ALLOW' ? `${c.green}ALLOW${c.reset}` : `${c.red}${s.safetyDecision}${c.reset}`;
    step(icon, label, `policy=${policy}  safety=${safety}`);
  }

  console.log();
  const summary = data.summary;
  console.log(`  ${c.bold}Summary:${c.reset} ${summary.totalSteps} steps | ${c.green}${summary.autoSteps} auto${c.reset} | ${c.yellow}${summary.approvalSteps} approval${c.reset} | ${c.red}${summary.blockedSteps} blocked${c.reset}`);
  console.log();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log();
  console.log(`${c.bold}${c.cyan}  ┌─────────────────────────────────────────────┐${c.reset}`);
  console.log(`${c.bold}${c.cyan}  │       AI OPERATIONS OS — LIVE DEMO          │${c.reset}`);
  console.log(`${c.bold}${c.cyan}  │  Policy Gates · CORD Safety · Audit Trail   │${c.reset}`);
  console.log(`${c.bold}${c.cyan}  └─────────────────────────────────────────────┘${c.reset}`);
  console.log();

  // Check server
  try {
    const health = await fetch(`${API}/health`).then(r => r.json());
    step('💚', 'Server Online', `v${health.version}  uptime=${Math.floor(health.uptime)}s`);
  } catch {
    console.error(`${c.red}  ✗ Server not running. Start with: npm run dev --workspace=apps/ops-api${c.reset}`);
    process.exit(1);
  }

  console.log();

  // ── Scenario 1: Email Reply ──
  await runScenario('SCENARIO 1: Customer Email Reply', {
    source: 'email',
    event: {
      subject: 'Reply to customer about shipping delay',
      body: 'Customer asked when their order will arrive. Please respond with updated ETA.',
    },
  });

  await sleep(500);

  // ── Scenario 2: Calendar Scheduling ──
  await runScenario('SCENARIO 2: Schedule Team Meeting', {
    source: 'calendar',
    event: {
      subject: 'Schedule a meeting with the design team',
      body: 'Need to set up a 30-min sync about the new landing page next week.',
    },
  });

  await sleep(500);

  // ── Scenario 3: Social Post (Simulation) ──
  await runSimulation('SCENARIO 3: Social Media Post (Dry Run)', {
    source: 'social',
    title: 'Post product launch announcement to X',
    body: 'Tweet about our new v2.0 release with pricing info',
  });

  await sleep(300);

  // ── Summary ──
  banner('DEMO COMPLETE');
  step('📊', 'What You Just Saw:', '');
  console.log(`    ${c.green}•${c.reset} Intent classification from raw events`);
  console.log(`    ${c.green}•${c.reset} Policy gates: read ops run autonomously, writes need approval`);
  console.log(`    ${c.green}•${c.reset} CORD safety scoring on every action`);
  console.log(`    ${c.green}•${c.reset} Human-in-the-loop approval for risky operations`);
  console.log(`    ${c.green}•${c.reset} Cryptographically signed execution receipts`);
  console.log(`    ${c.green}•${c.reset} Dry-run simulation for risk preview`);
  console.log();
  step('🔗', 'GitHub', 'github.com/zanderone1980/ai-operations-os');
  step('📦', 'npm', 'npmjs.com/package/codebot-ai  ·  npmjs.com/package/cord-engine');
  console.log();
}

main().catch(err => {
  console.error(`${c.red}Demo failed:${c.reset}`, err.message);
  process.exit(1);
});
