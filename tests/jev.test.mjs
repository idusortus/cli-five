import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import plugin, {
  __testables as pluginTestables,
} from '../templates/opencode/plugin/jev-tier-router/index.js';
import { runJev, JEVR_TOOL } from '../src/addons/jev.mjs';
import { mergeBlock } from '../src/util/merge.mjs';

const {
  classifyTask,
  CONFIDENCE_CUTOFF,
  FALLBACK_TIER,
  resolveJevCredential,
  classifyTaskWithJev,
  classifyWithJev,
  registerSessionHooks,
  safeErrText,
} = pluginTestables;

const PLUGIN_FILE = new URL('../templates/opencode/plugin/jev-tier-router/index.js', import.meta.url);

function workspace() {
  return mkdtempSync(join(tmpdir(), 'cli-five-jev-'));
}

// A shared journal target so tests that exercise the fallback path never write
// into the repo's own `.opencode/journals/`. The DEFAULT-path test deliberately
// opts out by passing an env with neither CLI_FIVE_LOGFILE nor a journal file.
const JOURNAL_DIR = mkdtempSync(join(tmpdir(), 'cli-five-jev-journal-'));
const TEST_LOGFILE = join(JOURNAL_DIR, 'jev.log');
after(() => rmSync(JOURNAL_DIR, { recursive: true, force: true }));

const throwingRead = () => {
  throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
};

// Capture the session-hook handlers a registration installs, keyed by hook name.
function captureSessionHooks() {
  const captured = {};
  const ctx = { session: { hook: (name, fn) => { captured[name] = fn; } } };
  return { ctx, captured };
}

// plugin.setup() takes no opts, so its hook registration reads process.env.
// Point CLI_FIVE_LOGFILE at the shared test log for the duration of a call so
// a setup() inside a test never writes into the repo's own journal directory.
async function withDefaultJournal(fn) {
  const previous = process.env.CLI_FIVE_LOGFILE;
  process.env.CLI_FIVE_LOGFILE = TEST_LOGFILE;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.CLI_FIVE_LOGFILE;
    else process.env.CLI_FIVE_LOGFILE = previous;
  }
}

// The exact response shape captured live from the OpenCode Zen endpoint.
const LIVE_RESPONSE = {
  model: 'jev-1.13-free',
  answers: {
    tier: {
      type: 'choice',
      choice: 'trivial',
      confidence: 1,
      probabilities: { trivial: 1, minor: 0, major: 0 },
    },
  },
  usage: { input_tokens: 386, output_tokens: 40 },
};

// ── Classifier ────────────────────────────────────────────────────────

test('classifyTask routes a mechanical doc change to trivial', () => {
  const r = classifyTask('fix a typo in README');
  assert.equal(r.tier, 'trivial');
  assert.ok(r.confidence >= CONFIDENCE_CUTOFF);
  assert.equal(r.available, true);
  assert.equal(r.source, 'local_heuristic');
});

test('classifyTask routes a bounded local change to minor', () => {
  const r = classifyTask('add input validation to the login form');
  assert.equal(r.tier, 'minor');
  assert.ok(r.confidence >= CONFIDENCE_CUTOFF);
});

test('classifyTask routes an architectural change to major', () => {
  const r = classifyTask('redesign the saga retry architecture');
  assert.equal(r.tier, 'major');
  assert.ok(r.confidence >= CONFIDENCE_CUTOFF);
});

test('classifyTask fails toward the expensive tier when ambiguous', () => {
  const r = classifyTask('do the thing');
  if (r.confidence < CONFIDENCE_CUTOFF) {
    assert.equal(r.tier, FALLBACK_TIER);
  }
  assert.equal(FALLBACK_TIER, 'major');
});

test('classifyTask handles an empty description without throwing', () => {
  const r = classifyTask('');
  assert.equal(r.tier, 'major');
  assert.equal(r.available, true);
});

test('classifyTask tier is always one of the cli-five vocabulary', () => {
  for (const t of ['typo', 'small bug fix', 'rewrite the scheduler', '', 'xyzzy']) {
    assert.ok(['trivial', 'minor', 'major'].includes(classifyTask(t).tier), `bad tier for: ${t}`);
  }
});

// ── Credential resolution ─────────────────────────────────────────────

test('resolveJevCredential: OPENCODE_API_KEY wins and skips the store', () => {
  let readCalled = false;
  const readFile = () => {
    readCalled = true;
    return '{}';
  };
  const cred = resolveJevCredential({ env: { OPENCODE_API_KEY: 'env-key' }, readFile });
  assert.deepEqual(cred, { provider: 'opencode', key: 'env-key', model: 'jev-1.13-free' });
  assert.equal(readCalled, false, 'the store must not be read when the env var is set');
});

test('resolveJevCredential: empty OPENCODE_API_KEY is treated as unset', () => {
  assert.equal(resolveJevCredential({ env: { OPENCODE_API_KEY: '   ' }, readFile: throwingRead }), null);
});

test('resolveJevCredential: reads opencode-go from the XDG store (providers shape)', () => {
  const env = { XDG_DATA_HOME: '/tmp/xdg-data' };
  let seenPath;
  const readFile = (p) => {
    seenPath = p;
    return JSON.stringify({ providers: { 'opencode-go': { key: 'stored' } } });
  };
  const cred = resolveJevCredential({ env, readFile });
  assert.equal(cred.provider, 'opencode');
  assert.equal(cred.key, 'stored');
  assert.equal(cred.model, 'jev-1.13-free');
  assert.equal(seenPath, join('/tmp/xdg-data', 'opencode', 'auth.json'));
});

test('resolveJevCredential: reads opencode-go from the top-level store shape', () => {
  const readFile = () => JSON.stringify({ 'opencode-go': { key: 'top-level' } });
  const cred = resolveJevCredential({ env: { XDG_DATA_HOME: '/tmp/x' }, readFile });
  assert.equal(cred.key, 'top-level');
});

test('resolveJevCredential: a keyless top-level entry does not shadow the providers entry', () => {
  const readFile = () =>
    JSON.stringify({
      'opencode-go': { label: 'present but no usable key' },
      providers: { 'opencode-go': { key: 'from-providers' } },
    });
  const cred = resolveJevCredential({ env: { XDG_DATA_HOME: '/tmp/x' }, readFile });
  assert.equal(cred.provider, 'opencode');
  assert.equal(cred.key, 'from-providers');
});

test('resolveJevCredential: falls back to ~/.local/share when XDG is unset', () => {
  let seenPath;
  const readFile = (p) => {
    seenPath = p;
    return JSON.stringify({ providers: { 'opencode-go': { key: 'home' } } });
  };
  const cred = resolveJevCredential({ env: {}, readFile, homeDir: '/home/tester' });
  assert.equal(cred.key, 'home');
  assert.equal(seenPath, join('/home/tester', '.local', 'share', 'opencode', 'auth.json'));
});

test('resolveJevCredential: a malformed or absent store degrades to no credential', () => {
  assert.equal(resolveJevCredential({ env: {}, readFile: throwingRead }), null);
  assert.equal(resolveJevCredential({ env: {}, readFile: () => 'not json' }), null);
  assert.equal(resolveJevCredential({ env: {}, readFile: () => '{}' }), null);
  assert.equal(
    resolveJevCredential({ env: {}, readFile: () => JSON.stringify({ providers: { other: { key: 'x' } } }) }),
    null,
  );
});

test('resolveJevCredential: TYPESAFE_API_KEY is used only when no OpenCode credential exists', () => {
  const onlyTypesafe = resolveJevCredential({ env: { TYPESAFE_API_KEY: 'ts-key' }, readFile: throwingRead });
  assert.deepEqual(onlyTypesafe, { provider: 'typesafe', key: 'ts-key', model: 'jev-1.13.0' });

  const both = resolveJevCredential({
    env: { OPENCODE_API_KEY: 'oc', TYPESAFE_API_KEY: 'ts' },
    readFile: throwingRead,
  });
  assert.equal(both.provider, 'opencode');
  assert.equal(both.key, 'oc');
});

test('resolveJevCredential: CLI_FIVE_JEVR_MODEL overrides the provider default', () => {
  const oc = resolveJevCredential({
    env: { OPENCODE_API_KEY: 'k', CLI_FIVE_JEVR_MODEL: 'jev-custom' },
    readFile: throwingRead,
  });
  assert.equal(oc.model, 'jev-custom');

  const ts = resolveJevCredential({
    env: { TYPESAFE_API_KEY: 'k', CLI_FIVE_JEVR_MODEL: 'jev-custom-ts' },
    readFile: throwingRead,
  });
  assert.equal(ts.model, 'jev-custom-ts');
});

// ── Real path: success + request sanity ───────────────────────────────

test('real path: a mocked OpenCode response yields source jev_api, the API tier, and its confidence', async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, async json() { return LIVE_RESPONSE; } };
  };
  const result = await classifyTaskWithJev('fix a typo in README', {
    fetchImpl,
    env: { OPENCODE_API_KEY: 'secret-key' },
  });

  assert.equal(result.source, 'jev_api');
  assert.equal(result.tier, 'trivial');
  assert.equal(result.confidence, 1);
  assert.equal(result.available, true);
  assert.equal(result.note, undefined, 'a successful call carries no note');

  assert.equal(captured.url, 'https://opencode.ai/zen/v1/systemone');
  assert.equal(captured.init.method, 'POST');
  assert.match(captured.init.headers.Authorization, /^Bearer secret-key$/);
  assert.equal(captured.init.headers['Content-Type'], 'application/json');

  const body = JSON.parse(captured.init.body);
  assert.equal(body.state, 'fix a typo in README');
  assert.equal(body.model, 'jev-1.13-free');
  assert.equal(Object.keys(body.questions).length, 1, 'exactly one question');
  assert.equal(body.questions.tier.type, 'choice');
  assert.deepEqual(Object.keys(body.questions.tier.criteria).sort(), ['major', 'minor', 'trivial']);
  for (const [tier, text] of Object.entries(body.questions.tier.criteria)) {
    assert.ok(typeof text === 'string' && text.length > 0, `criteria.${tier} must be non-empty`);
  }
});

test('real path: TypeSafe is used when no OpenCode credential resolves, with its own default model', async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, async json() { return LIVE_RESPONSE; } };
  };
  const env = { TYPESAFE_API_KEY: 'ts-key' };
  const cred = resolveJevCredential({ env, readFile: throwingRead });
  assert.equal(cred.provider, 'typesafe');
  assert.equal(cred.model, 'jev-1.13.0');

  const result = await classifyTaskWithJev('say hi', { fetchImpl, env, readFile: throwingRead });
  assert.equal(result.source, 'jev_api');
  assert.equal(captured.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(JSON.parse(captured.init.body).model, 'jev-1.13.0');
});

// ── Fail-open per failure mode ────────────────────────────────────────

async function expectLocalFallback(makeFetch, options = {}) {
  const description = options.description ?? 'add input validation to the login form';
  const env = { OPENCODE_API_KEY: 'k', CLI_FIVE_LOGFILE: TEST_LOGFILE, ...(options.env ?? {}) };
  const result = await classifyWithJev(description, {
    fetchImpl: makeFetch,
    env,
    timeoutMs: options.timeoutMs,
  });

  const local = classifyTask(description);
  assert.equal(result.tier, local.tier, 'tier must be the local heuristic output');
  assert.equal(result.confidence, local.confidence, 'confidence must be the local heuristic output');
  assert.equal(result.source, 'local_heuristic');
  assert.equal(result.available, true);
  assert.ok(typeof result.note === 'string' && result.note.length > 0, 'fallback must carry a diagnostic note');
  return result;
}

for (const status of [401, 422, 429, 529]) {
  test(`real path: HTTP ${status} falls back to the local heuristic`, async () => {
    await expectLocalFallback(async () => ({ ok: false, status, async json() { return {}; } }));
  });
}

test('real path: a failed attempt is made exactly once (no retry)', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: false, status: 401, async json() { return {}; } };
  };
  const result = await classifyWithJev('fix a typo', {
    fetchImpl,
    env: { OPENCODE_API_KEY: 'k', CLI_FIVE_LOGFILE: TEST_LOGFILE },
  });
  assert.equal(result.source, 'local_heuristic');
  assert.equal(calls, 1, 'exactly one attempt, no retry/backoff');
});

test('real path: a network error falls back to the local heuristic', async () => {
  await expectLocalFallback(async () => {
    throw new TypeError('fetch failed');
  });
});

test('real path: a timeout abandons the single attempt and falls back', async () => {
  const fetchImpl = (url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  await expectLocalFallback(fetchImpl, { timeoutMs: 10 });
});

test('real path: an unrecognized-shape body falls back to the local heuristic', async () => {
  await expectLocalFallback(async () => ({
    ok: true,
    status: 200,
    async json() {
      return { answers: { tier: { type: 'score', value: 3 } } };
    },
  }));
});

test('real path: a choice outside the vocabulary falls back to the local heuristic', async () => {
  await expectLocalFallback(async () => ({
    ok: true,
    status: 200,
    async json() {
      return { answers: { tier: { type: 'choice', choice: 'huge', confidence: 1 } } };
    },
  }));
});

test('real path: a non-numeric confidence falls back to the local heuristic', async () => {
  await expectLocalFallback(async () => ({
    ok: true,
    status: 200,
    async json() {
      return { answers: { tier: { type: 'choice', choice: 'minor', confidence: 'high' } } };
    },
  }));
});

test('real path: an unparseable JSON body falls back to the local heuristic', async () => {
  await expectLocalFallback(async () => ({
    ok: true,
    status: 200,
    async json() {
      throw new SyntaxError('bad json');
    },
  }));
});

// ── No credential ─────────────────────────────────────────────────────

test('no credential: zero fetch calls and the local output plus a note', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error('must not be called');
  };
  const description = 'fix a typo in README';
  const result = await classifyWithJev(description, {
    fetchImpl,
    env: { CLI_FIVE_LOGFILE: TEST_LOGFILE },
    readFile: throwingRead,
  });

  assert.equal(calls, 0, 'no credential must make zero network calls');
  const local = classifyTask(description);
  assert.equal(result.tier, local.tier);
  assert.equal(result.confidence, local.confidence);
  assert.equal(result.source, 'local_heuristic');
  assert.equal(result.available, true);
  assert.ok(result.note.includes('Jev is available'), 'the note must remind the user Jev is available');
});

test('no credential: classifyTaskWithJev returns null without attempting', async () => {
  const result = await classifyTaskWithJev('x', {
    fetchImpl: () => {
      throw new Error('must not be called');
    },
    env: {},
    readFile: throwingRead,
  });
  assert.equal(result, null);
});

// ── Journaling ────────────────────────────────────────────────────────

test('a skipped remote path journals a hint and never the key', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  await classifyWithJev('fix a typo', { env: { CLI_FIVE_LOGFILE: logFile }, readFile: throwingRead });

  const body = readFileSync(logFile, 'utf8');
  assert.match(body, /tier_classifier/);
  assert.match(body, /Jev is available/);

  rmSync(dir, { recursive: true, force: true });
});

test('journaling: the DEFAULT path is created under cwd on a fresh scaffold', async () => {
  const dir = workspace();
  const previous = process.cwd();
  try {
    process.chdir(dir);
    // No CLI_FIVE_LOGFILE: exercise the real default path, whose parent
    // (.opencode/journals) does not exist until journal() creates it.
    const result = await classifyWithJev('fix a typo', { env: {}, readFile: throwingRead });

    const logFile = join(dir, '.opencode', 'journals', 'jev-tier-router.log');
    assert.ok(existsSync(logFile), 'the default journal file must be created');
    const body = readFileSync(logFile, 'utf8');
    assert.match(body, /tier_classifier/);
    assert.match(body, /Jev is available/);
    assert.equal(result.source, 'local_heuristic');
  } finally {
    process.chdir(previous);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed remote call journals the provider and failure kind without the key', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const env = { OPENCODE_API_KEY: 'super-secret', CLI_FIVE_LOGFILE: logFile };
  const fetchImpl = async () => ({ ok: false, status: 401, async json() { return {}; } });

  await classifyWithJev('fix a typo', { fetchImpl, env });

  const body = readFileSync(logFile, 'utf8');
  assert.match(body, /provider=opencode/);
  assert.match(body, /kind=http_401/);
  assert.ok(!body.includes('super-secret'), 'the credential must never be journaled');

  rmSync(dir, { recursive: true, force: true });
});

// ── Tool identity / source hygiene ────────────────────────────────────

test('registration: the added tool is named tier_classifier and describes the real path', async () => {
  let added;
  const ctx = {
    tool: {
      transform: async (fn) => {
        added = [];
        fn({ add: (tool) => added.push(tool) });
      },
    },
  };
  await withDefaultJournal(() => plugin.setup(ctx));

  assert.equal(added.length, 1);
  assert.equal(added[0].name, 'tier_classifier');
  assert.match(added[0].description, /Jev/i);
  assert.ok(!/local[- ]only/i.test(added[0].description));
  assert.ok(!/not a Jev call/i.test(added[0].description));
});

test('catastrophic: an error inside the local heuristic returns available:false instead of throwing', async () => {
  let tool;
  const ctx = {
    tool: {
      transform: async (fn) => {
        fn({ add: (t) => { tool = t; } });
      },
    },
  };
  await withDefaultJournal(() => plugin.setup(ctx));

  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  // The remote seam fails and then the local heuristic itself throws (a
  // primitive coercion that explodes), so execute()'s catch-all is the only
  // thing standing between the caller and a broken turn.
  const exploding = { [Symbol.toPrimitive]() { throw new Error('local heuristic exploded'); } };
  const opts = {
    env: { OPENCODE_API_KEY: 'k', CLI_FIVE_LOGFILE: logFile },
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  };

  let response;
  await assert.doesNotReject(async () => {
    response = await tool.execute({ description: exploding }, opts);
  });

  const parsed = JSON.parse(response.content);
  assert.deepEqual(parsed, {
    tier: 'major',
    confidence: 0,
    rationale: 'Tier classifier unavailable; defaulting to the expensive tier.',
    available: false,
    source: 'local_heuristic',
  });
  assert.match(readFileSync(logFile, 'utf8'), /fail-open/);

  rmSync(dir, { recursive: true, force: true });
});

test('plugin source has no stale local_tier_heuristic / jev-harness references and names both endpoints', () => {
  const src = readFileSync(PLUGIN_FILE, 'utf8');
  assert.ok(!src.includes('local_tier_heuristic'));
  assert.ok(!src.includes('jev-harness'));
  assert.match(src, /opencode\.ai\/zen\/v1\/systemone/);
  assert.match(src, /api\.typesafe\.ai\/v1\/systemone/);
  assert.match(src, /OPENCODE_API_KEY/);
});

// ── Session hooks (deterministic admission-time routing) ──────────────

test('hooks: an absent session hook surface journals and never throws', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const previous = process.env.CLI_FIVE_LOGFILE;
  process.env.CLI_FIVE_LOGFILE = logFile;
  try {
    const added = [];
    const ctx = { tool: { transform: async (fn) => fn({ add: (t) => added.push(t) }) } };

    await assert.doesNotReject(() => plugin.setup(ctx));

    assert.equal(added.length, 1, 'the tier_classifier tool must still register');
    assert.match(readFileSync(logFile, 'utf8'), /hooks: session hook surface unavailable/);
  } finally {
    if (previous === undefined) delete process.env.CLI_FIVE_LOGFILE;
    else process.env.CLI_FIVE_LOGFILE = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hooks: the prompt hook classifies and never mutates the prompt text', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();
  const fetchImpl = async () => ({ ok: true, status: 200, async json() { return LIVE_RESPONSE; } });

  registerSessionHooks(ctx, { env: { OPENCODE_API_KEY: 'k', CLI_FIVE_LOGFILE: logFile }, fetchImpl });
  assert.equal(typeof captured.prompt, 'function', 'the prompt hook must be registered');

  const event = { sessionID: 's1', prompt: { text: 'fix a typo in README' } };
  await captured.prompt(event);

  assert.equal(event.prompt.text, 'fix a typo in README', 'the user prompt must be untouched');
  assert.deepEqual(Object.keys(event), ['sessionID', 'prompt'], 'the event must not gain keys');

  const body = readFileSync(logFile, 'utf8');
  assert.match(body, /hooks: prompt fired session=s1 chars=20/);
  assert.match(body, /hooks: prompt classified session=s1 tier=trivial confidence=1 source=jev_api/);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks: the context hook injects the cached tier as a system instruction', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();
  const fetchImpl = async () => ({ ok: true, status: 200, async json() { return LIVE_RESPONSE; } });

  registerSessionHooks(ctx, { env: { OPENCODE_API_KEY: 'k', CLI_FIVE_LOGFILE: logFile }, fetchImpl });
  await captured.prompt({ sessionID: 's2', prompt: { text: 'fix a typo in README' } });

  const event = { sessionID: 's2', system: [] };
  captured.context(event);

  assert.equal(event.system.length, 1, 'exactly one system instruction must be injected');
  assert.equal(event.system[0].type, 'text');
  assert.match(event.system[0].text, /trivial/);
  assert.match(event.system[0].text, /confidence 1/);
  assert.match(event.system[0].text, /source jev_api/);
  assert.match(readFileSync(logFile, 'utf8'), /hooks: context injected session=s2 tier=trivial confidence=1 source=jev_api/);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks: the context hook does not bleed one session\'s tier into another', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();
  const fetchImpl = async () => ({ ok: true, status: 200, async json() { return LIVE_RESPONSE; } });

  registerSessionHooks(ctx, { env: { OPENCODE_API_KEY: 'k', CLI_FIVE_LOGFILE: logFile }, fetchImpl });
  await captured.prompt({ sessionID: 'session-y', prompt: { text: 'fix a typo in README' } });

  // Session X was never classified: it must NOT receive session Y's result.
  const event = { sessionID: 'session-x', system: [] };
  captured.context(event);

  assert.equal(event.system.length, 0, 'an unclassified session must not receive another session\'s tier');
  assert.match(
    readFileSync(logFile, 'utf8'),
    /hooks: context fired session=session-x but no cached classification; no injection\./,
  );

  rmSync(dir, { recursive: true, force: true });
});

test('hooks: the context hook uses the last result only when the event has no session id', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();
  const fetchImpl = async () => ({ ok: true, status: 200, async json() { return LIVE_RESPONSE; } });

  registerSessionHooks(ctx, { env: { OPENCODE_API_KEY: 'k', CLI_FIVE_LOGFILE: logFile }, fetchImpl });
  await captured.prompt({ sessionID: 's3', prompt: { text: 'fix a typo in README' } });

  const event = { system: [] }; // no sessionID at all
  captured.context(event);

  assert.equal(event.system.length, 1, 'the last result must be reused when the event carries no session id');
  assert.match(event.system[0].text, /trivial/);
  assert.match(readFileSync(logFile, 'utf8'), /hooks: context injected session=current tier=trivial/);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks: the context hook journals a firing even with no cached classification', () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();

  registerSessionHooks(ctx, { env: { CLI_FIVE_LOGFILE: logFile } });

  const event = { sessionID: 'none', system: [] };
  assert.doesNotThrow(() => captured.context(event));
  assert.equal(event.system.length, 0, 'nothing may be injected before any classification');
  assert.match(
    readFileSync(logFile, 'utf8'),
    /hooks: context fired session=none but no cached classification; no injection\./,
  );

  rmSync(dir, { recursive: true, force: true });
});

test('hooks: a non-array event.system is journaled and not thrown on', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();

  registerSessionHooks(ctx, { env: { CLI_FIVE_LOGFILE: logFile }, readFile: throwingRead });

  // Classify first (no credential: local heuristic) so the context hook has a
  // cached result and reaches the system-shape guard.
  await captured.prompt({ sessionID: 'x', prompt: { text: 'fix a typo in README' } });

  const event = { sessionID: 'x', system: 'not-an-array' };
  assert.doesNotThrow(() => captured.context(event));
  assert.match(readFileSync(logFile, 'utf8'), /event\.system is not an array/);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks: CLI_FIVE_JEVR_HOOKS=0 registers no hooks and leaves the tool path intact', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const previousOptOut = process.env.CLI_FIVE_JEVR_HOOKS;
  const previousLog = process.env.CLI_FIVE_LOGFILE;
  process.env.CLI_FIVE_JEVR_HOOKS = '0';
  process.env.CLI_FIVE_LOGFILE = logFile;
  try {
    const captured = {};
    const added = [];
    const ctx = {
      session: { hook: (name, fn) => { captured[name] = fn; } },
      tool: { transform: async (fn) => fn({ add: (t) => added.push(t) }) },
    };

    await plugin.setup(ctx);

    assert.equal(captured.prompt, undefined, 'the prompt hook must not be registered');
    assert.equal(captured.context, undefined, 'the context hook must not be registered');
    assert.equal(added.length, 1, 'the tier_classifier tool still registers');
    assert.match(readFileSync(logFile, 'utf8'), /disabled by CLI_FIVE_JEVR_HOOKS=0/);
  } finally {
    if (previousOptOut === undefined) delete process.env.CLI_FIVE_JEVR_HOOKS;
    else process.env.CLI_FIVE_JEVR_HOOKS = previousOptOut;
    if (previousLog === undefined) delete process.env.CLI_FIVE_LOGFILE;
    else process.env.CLI_FIVE_LOGFILE = previousLog;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hooks: a failed classification still resolves fail-open to the local heuristic', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();
  const fetchImpl = async () => {
    throw new TypeError('fetch failed');
  };

  registerSessionHooks(ctx, { env: { OPENCODE_API_KEY: 'k', CLI_FIVE_LOGFILE: logFile }, fetchImpl });

  // Must resolve, not reject.
  await assert.doesNotReject(() => captured.prompt({ sessionID: 's4', prompt: { text: 'fix a typo in README' } }));

  const event = { sessionID: 's4', system: [] };
  captured.context(event);

  assert.equal(event.system.length, 1);
  assert.match(event.system[0].text, /source local_heuristic/);
  assert.match(readFileSync(logFile, 'utf8'), /hooks: prompt classified session=s4 .* source=local_heuristic/);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks: a rejected registration is journaled and does not break plugin load', () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const ctx = {
    session: {
      hook: (name) => {
        if (name === 'prompt') throw new Error('registration refused');
      },
    },
  };

  assert.doesNotThrow(() => registerSessionHooks(ctx, { env: { CLI_FIVE_LOGFILE: logFile } }));
  assert.match(readFileSync(logFile, 'utf8'), /hooks: failed to register prompt hook: registration refused/);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks: an async-rejected registration is journaled and does not surface unhandled', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  let unhandled = null;
  const onUnhandled = (reason) => { unhandled = reason; };
  process.on('unhandledRejection', onUnhandled);
  try {
    const ctx = {
      session: {
        hook: (name) =>
          name === 'context'
            ? Promise.reject(new Error('async registration refused'))
            : Promise.resolve(),
      },
    };

    assert.doesNotThrow(() => registerSessionHooks(ctx, { env: { CLI_FIVE_LOGFILE: logFile } }));

    // Let both returned promises settle and any unhandled rejection fire.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const body = readFileSync(logFile, 'utf8');
    assert.match(body, /hooks: registered prompt hook\./);
    assert.match(body, /hooks: failed to register context hook: async registration refused/);
    assert.equal(unhandled, null, 'a rejected registration must not become an unhandled rejection');
  } finally {
    process.off('unhandledRejection', onUnhandled);
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Session hooks: forced-failure fail-open regressions ───────────────
//
// These tests drive the REAL handlers captured from registerSessionHooks and
// assert that a hostile or broken input can never reject/mutate a host hook.
// A root-session `prompt` failure is FATAL to the session; fail-open is a hard
// requirement.

// An object that throws whenever the host tries to coerce it to a string
// (`String(x)`, which calls `Symbol.toPrimitive` with hint "string").
function hostileCoercion(message = 'hostile coercion') {
  return {
    [Symbol.toPrimitive]() {
      throw new Error(message);
    },
  };
}

test('hooks(a): prompt resolves when fetchImpl throws (classification fails internally)', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();
  registerSessionHooks(ctx, {
    env: { OPENCODE_API_KEY: 'k', CLI_FIVE_LOGFILE: logFile },
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });

  const event = { sessionID: 'a1', prompt: { text: 'fix a typo in README' } };
  await assert.doesNotReject(() => captured.prompt(event));
  assert.equal(event.prompt.text, 'fix a typo in README', 'the prompt must be untouched');
  assert.deepEqual(Object.keys(event), ['sessionID', 'prompt'], 'the event must not gain keys');
  assert.match(readFileSync(logFile, 'utf8'), /hooks: prompt classified session=a1 .* source=local_heuristic/);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks(a2): prompt resolves when classifyWithJev throws outright', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();
  // registerSessionHooks reads opts.env; the fetchImpl accessor throws so the
  // otherwise-guarded attemptJev (and thus classifyWithJev) throws before its
  // own try, proving the hook's catch is the last line of defence.
  registerSessionHooks(ctx, {
    env: { OPENCODE_API_KEY: 'k', CLI_FIVE_LOGFILE: logFile },
    get fetchImpl() {
      throw new Error('fetchImpl getter exploded');
    },
  });

  const event = { sessionID: 'a2', prompt: { text: 'fix a typo in README' } };
  await assert.doesNotReject(() => captured.prompt(event));
  assert.equal(event.prompt.text, 'fix a typo in README');
  assert.deepEqual(Object.keys(event), ['sessionID', 'prompt']);
  assert.match(readFileSync(logFile, 'utf8'), /prompt classification error session=a2: fetchImpl getter exploded/);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks(b): prompt resolves when fetchImpl rejects', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();
  registerSessionHooks(ctx, {
    env: { OPENCODE_API_KEY: 'k', CLI_FIVE_LOGFILE: logFile },
    fetchImpl: async () => Promise.reject(new Error('network down')),
  });

  const event = { sessionID: 'b1', prompt: { text: 'add input validation' } };
  await assert.doesNotReject(() => captured.prompt(event));
  assert.deepEqual(Object.keys(event), ['sessionID', 'prompt']);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks(c): prompt resolves when fetchImpl hangs past the timeout', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();
  const fetchImpl = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  registerSessionHooks(ctx, {
    env: { OPENCODE_API_KEY: 'k', CLI_FIVE_LOGFILE: logFile },
    fetchImpl,
    timeoutMs: 10,
  });

  const event = { sessionID: 'c1', prompt: { text: 'fix a typo' } };
  await assert.doesNotReject(() => captured.prompt(event));
  assert.deepEqual(Object.keys(event), ['sessionID', 'prompt']);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks(d1): prompt resolves on a non-JSON response body', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();
  registerSessionHooks(ctx, {
    env: { OPENCODE_API_KEY: 'k', CLI_FIVE_LOGFILE: logFile },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        throw new SyntaxError('not json');
      },
    }),
  });

  const event = { sessionID: 'd1', prompt: { text: 'fix a typo' } };
  await assert.doesNotReject(() => captured.prompt(event));
  assert.deepEqual(Object.keys(event), ['sessionID', 'prompt']);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks(d2): prompt resolves on a JSON body with the wrong shape', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();
  registerSessionHooks(ctx, {
    env: { OPENCODE_API_KEY: 'k', CLI_FIVE_LOGFILE: logFile },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { answers: { tier: { type: 'score', value: 3 } } };
      },
    }),
  });

  const event = { sessionID: 'd2', prompt: { text: 'fix a typo' } };
  await assert.doesNotReject(() => captured.prompt(event));
  assert.deepEqual(Object.keys(event), ['sessionID', 'prompt']);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks(e): an unwritable journal target never throws', async () => {
  const dir = workspace();
  // A FILE where journal() wants a directory: mkdirSync of its parent fails.
  const blocker = join(dir, 'blocker');
  writeFileSync(blocker, 'i am a file\n');
  const logFile = join(blocker, 'jev.log'); // parent is a file, not a dir

  const { ctx, captured } = captureSessionHooks();
  assert.doesNotThrow(() =>
    registerSessionHooks(ctx, { env: { CLI_FIVE_LOGFILE: logFile } }),
  );
  assert.equal(typeof captured.prompt, 'function');
  assert.equal(typeof captured.context, 'function');

  const event = { sessionID: 'e1', prompt: { text: 'fix a typo in README' } };
  await assert.doesNotReject(() => captured.prompt(event));
  assert.doesNotThrow(() => captured.context({ sessionID: 'e1', system: [] }));
  assert.deepEqual(Object.keys(event), ['sessionID', 'prompt']);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks(f): prompt tolerates missing/odd event fields', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();
  registerSessionHooks(ctx, { env: { CLI_FIVE_LOGFILE: logFile }, readFile: throwingRead });

  for (const event of [undefined, {}, { prompt: null }, { prompt: { text: null } }]) {
    await assert.doesNotReject(() => captured.prompt(event), `prompt must not reject for ${JSON.stringify(event)}`);
  }
  rmSync(dir, { recursive: true, force: true });
});

test('hooks(f2): context tolerates missing/odd event fields', () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();
  registerSessionHooks(ctx, { env: { CLI_FIVE_LOGFILE: logFile }, readFile: throwingRead });

  for (const event of [undefined, {}, { system: null }, { system: 'nope' }]) {
    assert.doesNotThrow(() => captured.context(event), `context must not throw for ${JSON.stringify(event)}`);
  }
  rmSync(dir, { recursive: true, force: true });
});

test('hooks(g1): prompt fail-opens on a hostile sessionID coercion', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();
  registerSessionHooks(ctx, { env: { CLI_FIVE_LOGFILE: logFile }, readFile: throwingRead });

  const event = { sessionID: hostileCoercion('sessionID boomed'), prompt: { text: 'fix a typo' } };
  await assert.doesNotReject(() => captured.prompt(event));
  assert.deepEqual(Object.keys(event), ['sessionID', 'prompt']);
  assert.match(readFileSync(logFile, 'utf8'), /hooks: prompt hook fail-open: sessionID boomed/);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks(g2): prompt fail-opens on a hostile prompt.text coercion', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();
  registerSessionHooks(ctx, { env: { CLI_FIVE_LOGFILE: logFile }, readFile: throwingRead });

  const event = { sessionID: 'g2', prompt: { text: hostileCoercion('prompt text boomed') } };
  await assert.doesNotReject(() => captured.prompt(event));
  assert.deepEqual(Object.keys(event), ['sessionID', 'prompt']);
  assert.match(readFileSync(logFile, 'utf8'), /hooks: prompt hook fail-open: prompt text boomed/);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks(g3): context fail-opens on a hostile sessionID coercion', () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();
  registerSessionHooks(ctx, { env: { CLI_FIVE_LOGFILE: logFile }, readFile: throwingRead });

  const event = { sessionID: hostileCoercion('context sessionID boomed'), system: [] };
  assert.doesNotThrow(() => captured.context(event));
  assert.equal(event.system.length, 0, 'nothing may be injected when coercion fails');
  assert.match(readFileSync(logFile, 'utf8'), /hooks: context hook fail-open: context sessionID boomed/);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks(g4): a plain Symbol sessionID is String()-safe (documents non-throw)', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();
  registerSessionHooks(ctx, { env: { CLI_FIVE_LOGFILE: logFile }, readFile: throwingRead });

  const event = { sessionID: Symbol('x'), prompt: { text: 'fix a typo' } };
  await assert.doesNotReject(() => captured.prompt(event));
  assert.equal(typeof event.sessionID, 'symbol', 'the Symbol must be untouched');
  assert.match(readFileSync(logFile, 'utf8'), /hooks: prompt fired session=Symbol\(x\)/);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks(h): context fail-opens when event.system is frozen', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();
  registerSessionHooks(ctx, { env: { CLI_FIVE_LOGFILE: logFile }, readFile: throwingRead });
  await captured.prompt({ sessionID: 'h1', prompt: { text: 'fix a typo in README' } });

  const frozen = Object.freeze([]);
  const event = { sessionID: 'h1', system: frozen };
  assert.doesNotThrow(() => captured.context(event));
  assert.equal(event.system.length, 0, 'a frozen array must not be mutated');
  assert.match(readFileSync(logFile, 'utf8'), /hooks: context hook fail-open:/);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks(i): registerSessionHooks survives a thenable with a throwing then getter', () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const ctx = {
    session: {
      hook: () => ({
        get then() {
          throw new Error('then getter exploded');
        },
      }),
    },
  };

  assert.doesNotThrow(() => registerSessionHooks(ctx, { env: { CLI_FIVE_LOGFILE: logFile } }));
  assert.match(readFileSync(logFile, 'utf8'), /hooks: failed to register prompt hook: then getter exploded/);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks(j): a rejecting ctx.session.get is never called; hooks still register and load', async () => {
  const dir = workspace();
  let getCalls = 0;
  const captured = {};
  const ctx = {
    session: {
      hook: (name, fn) => { captured[name] = fn; },
      get: () => {
        getCalls += 1;
        return Promise.reject(new Error('session.get must not be used'));
      },
    },
    tool: { transform: async (fn) => fn({ add: () => {} }) },
  };

  await assert.doesNotReject(() => withDefaultJournal(() => plugin.setup(ctx)));
  assert.equal(getCalls, 0, 'the plugin must not depend on ctx.session.get');
  assert.equal(typeof captured.prompt, 'function', 'the prompt hook must still register');
  assert.equal(typeof captured.context, 'function', 'the context hook must still register');

  rmSync(dir, { recursive: true, force: true });
});

// ── Session hooks: hostile caught-value fail-open (catch bodies) ──────
//
// A catch block that formats the caught value unguardedly can itself throw.
// These tests throw a NON-Error whose own `.message` getter throws, so the
// fix must format it through a sink that cannot throw.

// A thrown non-Error whose `.message` getter throws when read.
function hostileThrown() {
  return {
    get message() {
      throw new Error('message getter boomed');
    },
  };
}

// A value that throws `thrown` whenever the host coerces it with String().
function throwsValue(thrown) {
  return {
    [Symbol.toPrimitive]() {
      throw thrown;
    },
  };
}

test('hooks(k1): prompt resolves when the caught value has a throwing message getter (sessionID)', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();
  registerSessionHooks(ctx, { env: { CLI_FIVE_LOGFILE: logFile }, readFile: throwingRead });

  const event = { sessionID: throwsValue(hostileThrown()), prompt: { text: 'x' } };
  await assert.doesNotReject(() => captured.prompt(event));
  assert.deepEqual(Object.keys(event), ['sessionID', 'prompt'], 'the event must be untouched');
  assert.match(readFileSync(logFile, 'utf8'), /hooks: prompt hook fail-open: unknown error/);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks(k2): prompt resolves when the caught value has a throwing message getter (prompt.text)', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();
  registerSessionHooks(ctx, { env: { CLI_FIVE_LOGFILE: logFile }, readFile: throwingRead });

  const event = { sessionID: 'k2', prompt: { text: throwsValue(hostileThrown()) } };
  await assert.doesNotReject(() => captured.prompt(event));
  assert.deepEqual(Object.keys(event), ['sessionID', 'prompt']);
  assert.match(readFileSync(logFile, 'utf8'), /hooks: prompt hook fail-open: unknown error/);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks(k3): context does not throw when the caught value has a throwing message getter', () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const { ctx, captured } = captureSessionHooks();
  registerSessionHooks(ctx, { env: { CLI_FIVE_LOGFILE: logFile }, readFile: throwingRead });

  const event = { sessionID: throwsValue(hostileThrown()), system: [] };
  assert.doesNotThrow(() => captured.context(event));
  assert.equal(event.system.length, 0, 'nothing may be injected');
  assert.match(readFileSync(logFile, 'utf8'), /hooks: context hook fail-open: unknown error/);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks(l1): a sync registration throw of a hostile value is journaled, never thrown', () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const ctx = { session: { hook: () => { throw hostileThrown(); } } };

  assert.doesNotThrow(() => registerSessionHooks(ctx, { env: { CLI_FIVE_LOGFILE: logFile } }));
  assert.match(readFileSync(logFile, 'utf8'), /hooks: failed to register prompt hook: unknown error/);

  rmSync(dir, { recursive: true, force: true });
});

test('hooks(l2): an async rejection of a hostile value yields no unhandled rejection', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  let unhandled = null;
  const onUnhandled = (reason) => { unhandled = reason; };
  process.on('unhandledRejection', onUnhandled);
  try {
    const ctx = {
      session: {
        hook: (name) => (name === 'context' ? Promise.reject(hostileThrown()) : Promise.resolve()),
      },
    };

    assert.doesNotThrow(() => registerSessionHooks(ctx, { env: { CLI_FIVE_LOGFILE: logFile } }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(unhandled, null, 'a hostile rejection value must not become an unhandled rejection');
    assert.match(readFileSync(logFile, 'utf8'), /hooks: failed to register context hook: unknown error/);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hooks(m): setup resolves when ctx.session.hook is a getter that throws a hostile value', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const previous = process.env.CLI_FIVE_LOGFILE;
  process.env.CLI_FIVE_LOGFILE = logFile;
  try {
    const ctx = { session: { get hook() { throw hostileThrown(); } } };
    await assert.doesNotReject(() => plugin.setup(ctx));
  } finally {
    if (previous === undefined) delete process.env.CLI_FIVE_LOGFILE;
    else process.env.CLI_FIVE_LOGFILE = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('safeErrText: never throws and falls back for hostile values', () => {
  assert.equal(safeErrText(new Error('boom')), 'boom');
  assert.equal(safeErrText('plain string'), 'plain string');
  assert.equal(safeErrText(null), 'null');
  assert.equal(safeErrText(undefined), 'undefined');
  assert.equal(safeErrText(hostileThrown()), 'unknown error');
  assert.equal(safeErrText({ toString() { throw new Error('toString boomed'); } }), 'unknown error');
});

// ── add jev (OpenCode target) ─────────────────────────────────────────

test('runJev scaffolds the plugin and wires opencode.json + AGENTS.md', async () => {
  const dir = workspace();
  mkdirSync(join(dir, '.opencode', 'agents'), { recursive: true });
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({ $schema: 'x', model: 'keep-me' }, null, 2));
  writeFileSync(join(dir, 'AGENTS.md'), '# Project\n\nKeep this.\n');

  await runJev({ cwd: dir });

  // Plugin dir scaffolded with the confirmed convention
  const pluginDir = join(dir, '.opencode', 'plugin', 'jev-tier-router');
  assert.ok(existsSync(join(pluginDir, 'index.js')));
  assert.ok(existsSync(join(pluginDir, 'package.json')));
  const pkg = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.exports['.'], './index.js');

  // opencode.json preserves existing keys and appends to plugins[]
  const cfg = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf8'));
  assert.equal(cfg.model, 'keep-me');
  assert.ok(Array.isArray(cfg.plugins));
  assert.ok(cfg.plugins.includes('.opencode/plugin/jev-tier-router'));

  // AGENTS.md preserves prior content and gains the corrected instruction
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(agents.includes('Keep this.'));
  assert.ok(agents.includes(JEVR_TOOL));
  assert.ok(agents.includes('<!-- JEV_TIER_ROUTING_START -->'));
  assert.ok(!agents.includes('not a Jev call'), 'the fence must no longer claim local-only');
  assert.ok(!/local heuristic\)/.test(agents), 'the section header must no longer be local-only');
  assert.match(agents, /free on OpenCode/, 'the fence must note Jev is available on OpenCode');
  assert.match(agents, /confidence` >= 0\.6/, 'the threshold semantics must be preserved');
  assert.match(agents, /default to `major`/);

  rmSync(dir, { recursive: true, force: true });
});

test('runJev is idempotent — re-running does not duplicate plugin entries', async () => {
  const dir = workspace();
  mkdirSync(join(dir, '.opencode', 'agents'), { recursive: true });
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({}, null, 2));

  await runJev({ cwd: dir });
  await runJev({ cwd: dir });

  const cfg = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf8'));
  assert.equal(cfg.plugins.filter((p) => p.includes('jev-tier-router')).length, 1);

  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.equal((agents.match(/JEV_TIER_ROUTING_START/g) || []).length, 1);

  rmSync(dir, { recursive: true, force: true });
});

test('runJev preserves an existing plugins[] array (does not overwrite)', async () => {
  const dir = workspace();
  mkdirSync(join(dir, '.opencode', 'agents'), { recursive: true });
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({ plugins: ['some/other-plugin'] }, null, 2));

  await runJev({ cwd: dir });

  const cfg = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf8'));
  assert.ok(cfg.plugins.includes('some/other-plugin'));
  assert.ok(cfg.plugins.includes('.opencode/plugin/jev-tier-router'));

  rmSync(dir, { recursive: true, force: true });
});

// ── add jev (Copilot target) ──────────────────────────────────────────

test('runJev refuses cleanly on a Copilot target with no partial writes', async () => {
  const dir = workspace();
  mkdirSync(join(dir, '.github', 'agents'), { recursive: true });
  writeFileSync(join(dir, '.github', 'agents', 'orchestrator.agent.md'), '---\n---\n');
  const before = process.exitCode;

  await runJev({ cwd: dir });

  assert.equal(process.exitCode, 1, 'refusal should set a non-zero exit code');
  assert.ok(!existsSync(join(dir, '.opencode')), 'no .opencode dir written');
  assert.ok(!existsSync(join(dir, 'opencode.json')), 'no opencode.json written');
  assert.ok(!existsSync(join(dir, 'AGENTS.md')), 'no AGENTS.md written');

  process.exitCode = before;
  rmSync(dir, { recursive: true, force: true });
});

// ── mergeBlock integration (same write path, no second merge approach) ──

test('jev writes go through mergeBlock and leave foreign JSON keys intact', () => {
  const dir = workspace();
  const file = join(dir, 'opencode.json');
  writeFileSync(file, JSON.stringify({ mcp: { codegraph: {} }, model: 'x' }, null, 2));

  mergeBlock(file, 'jev', { plugins: ['.opencode/plugin/jev-tier-router'] }, { track: true });

  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(cfg.mcp, { codegraph: {} });
  assert.equal(cfg.model, 'x');
  assert.deepEqual(cfg.$cliFive.blocks, ['jev']);

  rmSync(dir, { recursive: true, force: true });
});
