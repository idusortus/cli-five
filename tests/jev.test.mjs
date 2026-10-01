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
  registerSpawnGate,
  safeErrText,
  journal,
  SPAWN_GATE_FALLING_CUTOFF,
  SPAWN_GATE_MECHANICAL_CUTOFF,
  SPAWN_GATE_MAX_DENIES,
  SPAWN_GATE_MAX_TRACKED_SESSIONS,
  SPAWN_GATE_STATE_MAX_CHARS,
  SPAWN_GATE_TEST_OUTPUT_RE,
  buildSpawnGateState,
  flattenMessage,
  parseNoulAnswer,
  resolveSpawnGateProjectDir,
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

test('journaling: opts.projectDir selects the default sink and CLI_FIVE_LOGFILE overrides it', () => {
  const projectDir = workspace();
  const otherDir = workspace();
  const logFile = join(otherDir, 'custom.log');

  // No CLI_FIVE_LOGFILE: the project dir decides where the default sink lands,
  // even though process.cwd() is elsewhere.
  journal('probe-project-dir', { env: {}, projectDir });
  const projectLog = join(projectDir, '.opencode', 'journals', 'jev-tier-router.log');
  assert.ok(existsSync(projectLog), 'the project-dir journal must be created');
  assert.match(readFileSync(projectLog, 'utf8'), /probe-project-dir/);

  // CLI_FIVE_LOGFILE wins over opts.projectDir.
  journal('probe-explicit-logfile', { env: { CLI_FIVE_LOGFILE: logFile }, projectDir });
  assert.ok(existsSync(logFile), 'CLI_FIVE_LOGFILE must still win');
  assert.match(readFileSync(logFile, 'utf8'), /probe-explicit-logfile/);
  assert.ok(
    !readFileSync(projectLog, 'utf8').includes('probe-explicit-logfile'),
    'the explicit logfile must not also write the project journal',
  );

  rmSync(projectDir, { recursive: true, force: true });
  rmSync(otherDir, { recursive: true, force: true });
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

// ── Spawn gate (opt-in Reviewer-spawn admission control) ──────────────

function spawnEnv(overrides = {}) {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const env = {
    CLI_FIVE_JEVR_SPAWN_GATE: 'enforce',
    OPENCODE_API_KEY: 'k',
    CLI_FIVE_LOGFILE: logFile,
    ...overrides,
  };
  return {
    dir,
    logFile,
    env,
    read: () => readFileSync(logFile, 'utf8'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// A spawn-gate scenario driven by the project's `.opencode/jev.json` instead of
// the env var: writes `contents` there (or no file when null) and returns the
// `ctx.location` that points at that project.
function spawnEnvFile(contents, extraEnv = {}) {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const cfgDir = join(dir, '.opencode');
  mkdirSync(cfgDir, { recursive: true });
  const cfgFile = join(cfgDir, 'jev.json');
  if (contents !== null && contents !== undefined) writeFileSync(cfgFile, contents);
  const env = { OPENCODE_API_KEY: 'k', CLI_FIVE_LOGFILE: logFile, ...extraEnv };
  return {
    dir,
    logFile,
    cfgFile,
    env,
    location: { directory: dir },
    read: () => readFileSync(logFile, 'utf8'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// Capture the permission `evaluate` handler a spawn-gate registration installs.
function captureSpawnGate({ messages = [], context, location } = {}) {
  const captured = {};
  const contextImpl = context ?? (async () => messages);
  const ctx = {
    permission: { hook: (name, fn) => { captured[name] = fn; return Promise.resolve({ dispose() {} }); } },
    session: { context: contextImpl },
  };
  if (location !== undefined) ctx.location = location;
  return { ctx, captured };
}

// The REAL shape returned by ctx.session.context: a flat message with NO
// `role` and NO `content`. Keys are [id, time, text, files, type]; `type` is
// the role-ish value and `text` is the message text.
function transcriptMessage(type, text) {
  return { id: `msg_${type}_${text.length}`, time: { created: 1699999999 }, text, files: [], type };
}

// The OLD/assumed {role, content:[{type,text}]} shape, kept so both shapes stay
// covered. Used only where a test explicitly exercises the fallback path.
function contentMessage(role, text) {
  return { id: `m-${role}-${text.length}`, role, content: [{ type: 'text', text }] };
}

// The same real-shape message but with its text JSON-stringified (quotes +
// escaped newlines), which the host sometimes emits.
function jsonWrappedMessage(type, text) {
  return { id: `msg_${type}_json`, time: { created: 1699999999 }, text: JSON.stringify(text), files: [], type };
}

function noulBody(pFailing, pMechanical) {
  return {
    answers: {
      failing_now: { type: 'noul', noul: pFailing },
      mechanical: { type: 'noul', noul: pMechanical },
    },
  };
}

function reviewerEvent(sessionID) {
  return { sessionID, agent: 'orchestrator', action: 'subagent', resources: ['reviewer'], effect: 'allow' };
}

test('spawn-gate: a non-spawn event makes no network call and journals no decision', async () => {
  const j = spawnEnv();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, status: 200, async json() { return noulBody(0.99, 0.99); } };
  };
  const { ctx, captured } = captureSpawnGate({ messages: [transcriptMessage('tool', '5 passing')] });
  registerSpawnGate(ctx, { env: j.env, fetchImpl });

  await captured.evaluate({ sessionID: 's-shell', action: 'shell', resources: ['bash'] });
  await captured.evaluate({
    sessionID: 's-coder',
    agent: 'orchestrator',
    action: 'subagent',
    resources: ['probe-coder'],
    effect: 'allow',
  });
  await captured.evaluate({ sessionID: 's-read', action: 'read', resources: ['README.md'] });

  assert.equal(calls, 0, 'a non-reviewer scope must not call Jev');
  assert.ok(!/decision=/.test(j.read()), 'out-of-scope events must not journal a decision');

  j.cleanup();
});

test('spawn-gate: denies only when both probabilities meet their cutoff', async () => {
  const cases = [
    { f: 0.849, m: 0.85, deny: false },
    { f: 0.85, m: 0.85, deny: true },
    { f: 0.851, m: 0.851, deny: true },
    { f: 0.85, m: 0.849, deny: false },
    { f: 0.849, m: 0.849, deny: false },
    { f: 0.851, m: 0.849, deny: false },
    { f: 0.849, m: 0.851, deny: false },
  ];

  const j = spawnEnv();
  const { ctx, captured } = captureSpawnGate({ messages: [transcriptMessage('tool', '1 failed, 3 passed')] });
  let i = 0;
  registerSpawnGate(ctx, {
    env: j.env,
    fetchImpl: async () => {
      const { f, m } = cases[i];
      return { ok: true, status: 200, async json() { return noulBody(f, m); } };
    },
  });

  assert.equal(SPAWN_GATE_FALLING_CUTOFF, 0.85);
  assert.equal(SPAWN_GATE_MECHANICAL_CUTOFF, 0.85);

  for (const c of cases) {
    const event = reviewerEvent(`threshold-${i}`);
    await captured.evaluate(event);
    assert.equal(event.effect, c.deny ? 'deny' : 'allow', `f=${c.f} m=${c.m} must ${c.deny ? 'deny' : 'allow'}`);
    i += 1;
  }

  j.cleanup();
});

test('spawn-gate: shadow journals would-deny but never sets an effect', async () => {
  const j = spawnEnv({ CLI_FIVE_JEVR_SPAWN_GATE: 'shadow' });
  const { ctx, captured } = captureSpawnGate({ messages: [transcriptMessage('tool', '2 failed')] });
  let body;
  registerSpawnGate(ctx, {
    env: j.env,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, status: 200, async json() { return noulBody(0.9, 0.9); } };
    },
  });

  const event = reviewerEvent('shadow-1');
  await captured.evaluate(event);

  assert.equal(event.effect, 'allow', 'shadow must leave the host effect untouched');
  assert.equal(event.message, undefined, 'shadow must not set a message');
  const log = j.read();
  assert.match(log, /decision=would-deny/);
  assert.match(log, /mode=shadow/);
  assert.match(log, /provider=opencode/);
  assert.match(log, /model=jev-1\.13-free/);

  // Both questions travel in ONE request, both noul.
  assert.equal(Object.keys(body.questions).length, 2);
  assert.equal(body.questions.failing_now.type, 'noul');
  assert.equal(body.questions.mechanical.type, 'noul');
  assert.ok(body.state.length > 0);

  j.cleanup();
});

test('spawn-gate: the enforce cap turns the third deny into an allow with reason cap', async () => {
  const j = spawnEnv();
  const { ctx, captured } = captureSpawnGate({ messages: [transcriptMessage('tool', '1 failed')] });
  registerSpawnGate(ctx, {
    env: j.env,
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return noulBody(0.99, 0.99); } }),
  });

  assert.equal(SPAWN_GATE_MAX_DENIES, 2);

  const effects = [];
  for (let n = 0; n < 3; n += 1) {
    const event = reviewerEvent('cap-session');
    await captured.evaluate(event);
    effects.push(event.effect);
  }

  assert.deepEqual(effects, ['deny', 'deny', 'allow']);
  const log = j.read();
  assert.equal((log.match(/decision=deny\b/g) || []).length, 2, 'exactly two denies are spent');
  assert.equal((log.match(/reason=cap\b/g) || []).length, 1, 'the third attempt is capped to allow');

  j.cleanup();
});

test('spawn-gate: a stale failing run followed by a newer passing run allows', async () => {
  const j = spawnEnv();
  const messages = [
    transcriptMessage('tool', 'FAIL tests/old.test.js — 3 failing'),
    transcriptMessage('assistant', 'the old failure is still in the transcript'),
    transcriptMessage('tool', 'PASS tests/new.test.js — 12 passing'),
  ];
  const { ctx, captured } = captureSpawnGate({ messages });
  let seen;
  registerSpawnGate(ctx, {
    env: j.env,
    fetchImpl: async (_url, init) => {
      seen = JSON.parse(init.body);
      const newestIsPass = seen.state.indexOf('PASS') < seen.state.indexOf('FAIL');
      return { ok: true, status: 200, async json() { return noulBody(newestIsPass ? 0.1 : 0.9, 0.9); } };
    },
  });

  const event = reviewerEvent('stale-1');
  await captured.evaluate(event);

  assert.ok(
    seen.state.indexOf('PASS') < seen.state.indexOf('FAIL'),
    'the state must present the most recent run first (newest first)',
  );
  assert.equal(event.effect, 'allow', 'a passing most-recent run must not deny');
  assert.match(j.read(), /decision=allow/);

  j.cleanup();
});

test('spawn-gate: Jev error, HTTP failure, timeout, malformed response, or missing credential all allow', async () => {
  const scenarios = [
    { name: 'network error', fetchImpl: async () => { throw new TypeError('fetch failed'); } },
    { name: 'http failure', fetchImpl: async () => ({ ok: false, status: 429, async json() { return {}; } }) },
    {
      name: 'malformed response',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { answers: { failing_now: { type: 'choice', choice: 'yes' } } };
        },
      }),
    },
    {
      name: 'non-numeric noul',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { answers: { failing_now: { type: 'noul', noul: 'high' }, mechanical: { type: 'noul', noul: 0.9 } } };
        },
      }),
    },
    {
      name: 'out-of-range noul',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { answers: { failing_now: { type: 'noul', noul: 1.5 }, mechanical: { type: 'noul', noul: 0.9 } } };
        },
      }),
    },
    {
      name: 'timeout',
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
      opts: { timeoutMs: 10 },
    },
  ];

  for (const s of scenarios) {
    const j = spawnEnv();
    const { ctx, captured } = captureSpawnGate({ messages: [transcriptMessage('tool', '1 failed')] });
    registerSpawnGate(ctx, { env: j.env, fetchImpl: s.fetchImpl, ...(s.opts ?? {}) });

    const event = reviewerEvent('fail-1');
    await assert.doesNotReject(() => captured.evaluate(event), s.name);
    assert.equal(event.effect, 'allow', `${s.name} must leave the effect untouched`);
    assert.match(j.read(), /decision=allow/, s.name);

    j.cleanup();
  }

  // Missing credential: allow with zero network calls.
  const j = spawnEnv({ OPENCODE_API_KEY: undefined });
  let calls = 0;
  const { ctx, captured } = captureSpawnGate({ messages: [transcriptMessage('tool', '1 failed')] });
  registerSpawnGate(ctx, {
    env: j.env,
    readFile: throwingRead,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, async json() { return noulBody(0.9, 0.9); } };
    },
  });

  const event = reviewerEvent('no-cred-1');
  await captured.evaluate(event);
  assert.equal(calls, 0, 'no credential must make zero network calls');
  assert.equal(event.effect, 'allow');
  assert.match(j.read(), /reason=no-credential/);

  j.cleanup();
});

test('spawn-gate: the handler never throws on hostile events', async () => {
  const j = spawnEnv();
  const hostile = captureSpawnGate({ context: async () => { throw new Error('context exploded'); } });
  registerSpawnGate(hostile.ctx, {
    env: j.env,
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return noulBody(0.9, 0.9); } }),
  });

  const hostileResource = { [Symbol.toPrimitive]() { throw new Error('resource boomed'); } };
  const proxyEvent = new Proxy({}, { get() { throw new Error('proxy boom'); } });

  const events = [
    undefined,
    {},
    { sessionID: 'h', action: 'subagent', resources: null },
    { sessionID: 'h', action: 'subagent', resources: [hostileResource] },
    proxyEvent,
  ];
  for (let idx = 0; idx < events.length; idx += 1) {
    await assert.doesNotReject(() => hostile.captured.evaluate(events[idx]), `must not throw for event #${idx}`);
  }

  // A reviewer spawn whose transcript read rejects also fails open.
  await assert.doesNotReject(() => hostile.captured.evaluate(reviewerEvent('h-context')));
  assert.match(j.read(), /reason=error:context exploded/);

  // A junk (non-array) transcript is treated as "no test output": allow, no call.
  const junk = captureSpawnGate({ context: async () => 'not an array' });
  registerSpawnGate(junk.ctx, {
    env: j.env,
    fetchImpl: async () => { throw new Error('must not be called'); },
  });
  const junkEvent = reviewerEvent('junk-1');
  await assert.doesNotReject(() => junk.captured.evaluate(junkEvent));
  assert.equal(junkEvent.effect, 'allow');
  assert.match(j.read(), /reason=no-test-output/);

  j.cleanup();
});

test('spawn-gate: opt-in registration coexists with the session hooks, which still work unchanged', async () => {
  const j = spawnEnv({ CLI_FIVE_JEVR_SPAWN_GATE: 'shadow', OPENCODE_API_KEY: undefined });
  const captured = {};
  const ctx = {
    session: { hook: (name, fn) => { captured[name] = fn; return Promise.resolve({ dispose() {} }); } },
    permission: { hook: (name, fn) => { captured[`perm:${name}`] = fn; return Promise.resolve({ dispose() {} }); } },
  };

  registerSessionHooks(ctx, { env: j.env, readFile: throwingRead });
  registerSpawnGate(ctx, { env: j.env, readFile: throwingRead });

  assert.equal(typeof captured.prompt, 'function', 'the prompt hook must still register');
  assert.equal(typeof captured.context, 'function', 'the context hook must still register');
  assert.equal(typeof captured['perm:evaluate'], 'function', 'the spawn gate must register its evaluate hook');

  await captured.prompt({ sessionID: 'co-1', prompt: { text: 'fix a typo in README' } });
  const contextEvent = { sessionID: 'co-1', system: [] };
  captured.context(contextEvent);
  assert.equal(contextEvent.system.length, 1);
  assert.match(j.read(), /hooks: context injected session=co-1/);

  j.cleanup();
});

test('spawn-gate: the evaluate hook is registered regardless of mode', () => {
  const register = (value) => {
    const j = spawnEnv({ CLI_FIVE_JEVR_SPAWN_GATE: value });
    const { ctx, captured } = captureSpawnGate({ messages: [] });
    registerSpawnGate(ctx, { env: j.env });
    const registered = typeof captured.evaluate === 'function';
    j.cleanup();
    return registered;
  };

  // The mode is resolved per event, not at registration, so every value must
  // still install the hook (a file toggle needs no re-registration).
  for (const value of [undefined, 'off', 'bogus', 'true', '1', 'shadow', 'enforce', 'ENFORCE']) {
    assert.equal(register(value), true, `${String(value)} must still register the evaluate hook`);
  }
});

test('spawn-gate config: the env switch overrides .opencode/jev.json', async () => {
  const j = spawnEnvFile(JSON.stringify({ spawnGate: 'shadow' }), { CLI_FIVE_JEVR_SPAWN_GATE: 'enforce' });
  let calls = 0;
  const { ctx, captured } = captureSpawnGate({
    messages: [transcriptMessage('tool', '1 failed')],
    location: j.location,
  });
  registerSpawnGate(ctx, {
    env: j.env,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, async json() { return noulBody(0.9, 0.9); } };
    },
  });

  const event = reviewerEvent('env-wins');
  await captured.evaluate(event);

  assert.equal(event.effect, 'deny', 'the env switch (enforce) must win over the file (shadow)');
  assert.equal(calls, 1);
  assert.match(j.read(), /mode=enforce/);

  j.cleanup();
});

test('spawn-gate config: a set-but-invalid env value is off and does not fall through to the file', async () => {
  // The file says enforce, but a typo'd env value is authoritative: off, not
  // the file's enforce.
  const j = spawnEnvFile(JSON.stringify({ spawnGate: 'enforce' }), { CLI_FIVE_JEVR_SPAWN_GATE: 'bogus' });
  let calls = 0;
  const { ctx, captured } = captureSpawnGate({
    messages: [transcriptMessage('tool', '1 failed')],
    location: j.location,
  });
  registerSpawnGate(ctx, {
    env: j.env,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, async json() { return noulBody(0.9, 0.9); } };
    },
  });

  const event = reviewerEvent('bogus-env');
  await captured.evaluate(event);

  assert.equal(event.effect, 'allow', 'an invalid env value must resolve off, not read the file');
  assert.equal(calls, 0, 'off makes no network call');
  assert.ok(!/decision=/.test(j.read()), 'off journals no decision');

  j.cleanup();
});

test('spawn-gate config: the cache signature includes the inode, catching a same-mtime same-size rewrite', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  const cfgFile = join(dir, '.opencode', 'jev.json');
  mkdirSync(join(dir, '.opencode'), { recursive: true });
  writeFileSync(cfgFile, JSON.stringify({ spawnGate: 'shadow' }));

  const { ctx, captured } = captureSpawnGate({
    messages: [transcriptMessage('tool', '1 failed')],
    location: { directory: dir },
  });
  // Inject a stat whose mtime and size are frozen, so only the inode changes.
  let ino = 1;
  let current = 'shadow';
  registerSpawnGate(ctx, {
    env: { OPENCODE_API_KEY: 'k', CLI_FIVE_LOGFILE: logFile },
    statSync: () => ({ mtimeMs: 1000, size: 20, ino }),
    readFileSync: () => JSON.stringify({ spawnGate: current }),
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return noulBody(0.9, 0.9); } }),
  });

  const first = reviewerEvent('ino-1');
  await captured.evaluate(first);
  assert.equal(first.effect, 'allow', 'shadow must not deny');
  assert.match(readFileSync(logFile, 'utf8'), /decision=would-deny/);

  // Same mtime and size, new inode, new content: the mode must change to deny.
  ino = 2;
  current = 'enforce';
  const second = reviewerEvent('ino-2');
  await captured.evaluate(second);
  assert.equal(second.effect, 'deny', 'a changed inode must invalidate the cache even at equal mtime+size');

  rmSync(dir, { recursive: true, force: true });
});

test('spawn-gate config: a missing project directory journals a clear notice and disables the file switch', async () => {
  const dir = workspace();
  const logFile = join(dir, 'jev.log');
  // No ctx.location and no projectDir: there is nothing to read the file from.
  const { ctx, captured } = captureSpawnGate({ messages: [transcriptMessage('tool', '1 failed')] });
  let calls = 0;
  registerSpawnGate(ctx, {
    env: { OPENCODE_API_KEY: 'k', CLI_FIVE_LOGFILE: logFile },
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, async json() { return noulBody(0.9, 0.9); } };
    },
  });

  assert.match(readFileSync(logFile, 'utf8'), /spawn-gate-config: no project directory; file switch disabled/);

  const event = reviewerEvent('no-dir');
  await captured.evaluate(event);
  assert.equal(event.effect, 'allow');
  assert.equal(calls, 0, 'without a project directory the file switch is off — no call');

  rmSync(dir, { recursive: true, force: true });
});

test('spawn-gate config: the file is used when the env switch is unset', async () => {
  const j = spawnEnvFile(JSON.stringify({ spawnGate: 'shadow' }));
  let calls = 0;
  const { ctx, captured } = captureSpawnGate({
    messages: [transcriptMessage('tool', '1 failed')],
    location: j.location,
  });
  registerSpawnGate(ctx, {
    env: j.env,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, async json() { return noulBody(0.9, 0.9); } };
    },
  });

  const event = reviewerEvent('file-shadow');
  await captured.evaluate(event);

  assert.equal(event.effect, 'allow', 'shadow must leave the effect untouched');
  assert.equal(calls, 1);
  const log = j.read();
  assert.match(log, /decision=would-deny/);
  assert.match(log, /mode=shadow/);

  j.cleanup();
});

test('spawn-gate config: missing, malformed, unrecognised, or keyless file is off with no network call', async () => {
  const cases = [
    { name: 'missing file', contents: null },
    { name: 'malformed JSON', contents: '{ not json at all' },
    { name: 'unrecognised value', contents: JSON.stringify({ spawnGate: 'sometimes' }) },
    { name: 'absent key', contents: JSON.stringify({ other: true }) },
    { name: 'non-object JSON', contents: JSON.stringify('shadow') },
  ];

  for (const c of cases) {
    const j = spawnEnvFile(c.contents);
    let calls = 0;
    const { ctx, captured } = captureSpawnGate({
      messages: [transcriptMessage('tool', '1 failed')],
      location: j.location,
    });
    registerSpawnGate(ctx, {
      env: j.env,
      fetchImpl: async () => {
        calls += 1;
        return { ok: true, status: 200, async json() { return noulBody(0.9, 0.9); } };
      },
    });

    const event = reviewerEvent('off-1');
    await assert.doesNotReject(() => captured.evaluate(event), c.name);
    assert.equal(event.effect, 'allow', `${c.name} must be off (allow)`);
    assert.equal(calls, 0, `${c.name} must make no network call`);
    assert.ok(!/decision=/.test(j.read()), `${c.name} must journal no decision`);

    j.cleanup();
  }
});

test('spawn-gate config: toggling the file between events changes behaviour without re-registering', async () => {
  const j = spawnEnvFile(JSON.stringify({ spawnGate: 'shadow' }));
  let calls = 0;
  const { ctx, captured } = captureSpawnGate({
    messages: [transcriptMessage('tool', '1 failed')],
    location: j.location,
  });
  // Registered ONCE. Every evaluation below uses this same captured handler.
  registerSpawnGate(ctx, {
    env: j.env,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, async json() { return noulBody(0.9, 0.9); } };
    },
  });

  const shadowEvent = reviewerEvent('toggle-1');
  await captured.evaluate(shadowEvent);
  assert.equal(shadowEvent.effect, 'allow', 'shadow must not deny');
  assert.match(j.read(), /decision=would-deny/);
  assert.equal(calls, 1);

  writeFileSync(j.cfgFile, JSON.stringify({ spawnGate: 'off' }));
  const before = j.read();
  const offEvent = reviewerEvent('toggle-2');
  await captured.evaluate(offEvent);
  assert.equal(offEvent.effect, 'allow');
  assert.equal(calls, 1, 'off must make no network call');
  assert.equal(j.read(), before, 'off must append no gate lines');

  writeFileSync(j.cfgFile, JSON.stringify({ spawnGate: 'enforce' }));
  const enforceEvent = reviewerEvent('toggle-3');
  await captured.evaluate(enforceEvent);
  assert.equal(enforceEvent.effect, 'deny', 'enforce must deny the same mechanical failure');
  assert.equal(calls, 2);
  assert.match(j.read(), /decision=deny/);

  j.cleanup();
});

test('spawn-gate config: a malformed file is journaled once per stat signature, not per event', async () => {
  const j = spawnEnvFile('{ not json at all');
  let calls = 0;
  const { ctx, captured } = captureSpawnGate({
    messages: [transcriptMessage('tool', '1 failed')],
    location: j.location,
  });
  registerSpawnGate(ctx, {
    env: j.env,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, async json() { return noulBody(0.9, 0.9); } };
    },
  });

  const notices = () => (j.read().match(/spawn-gate-config: malformed/g) || []).length;

  await captured.evaluate(reviewerEvent('mal-1'));
  await captured.evaluate(reviewerEvent('mal-2'));
  assert.equal(calls, 0, 'a malformed file must make no network call');
  assert.equal(notices(), 1, 'the same malformed file is journaled once, not per event');

  // A rewrite changes the stat signature, so it earns exactly one more notice.
  writeFileSync(j.cfgFile, '{ still not json, but definitely longer');
  await captured.evaluate(reviewerEvent('mal-3'));
  assert.equal(notices(), 2, 'a rewritten malformed file earns one more notice');
  assert.ok(!/decision=/.test(j.read()), 'a malformed file makes no decision');

  j.cleanup();
});

test('spawn-gate config: non-reviewer events touch no fs and no network', async () => {
  const j = spawnEnvFile(JSON.stringify({ spawnGate: 'enforce' }));
  let stats = 0;
  let reads = 0;
  let calls = 0;
  const { ctx, captured } = captureSpawnGate({
    messages: [transcriptMessage('tool', '1 failed')],
    location: j.location,
  });
  registerSpawnGate(ctx, {
    env: j.env,
    statSync: () => {
      stats += 1;
      throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    },
    readFileSync: () => {
      reads += 1;
      return '{}';
    },
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, async json() { return noulBody(0.9, 0.9); } };
    },
  });

  await captured.evaluate({ sessionID: 's-shell', action: 'shell', resources: ['bash'] });
  await captured.evaluate({
    sessionID: 's-coder',
    agent: 'orchestrator',
    action: 'subagent',
    resources: ['probe-coder'],
    effect: 'allow',
  });
  await captured.evaluate({ sessionID: 's-read', action: 'read', resources: ['README.md'] });

  assert.equal(stats, 0, 'statSync must not run for out-of-scope events');
  assert.equal(reads, 0, 'readFileSync must not run for out-of-scope events');
  assert.equal(calls, 0, 'fetch must not run for out-of-scope events');
  assert.ok(!/decision=/.test(j.read()), 'out-of-scope events must journal nothing');

  // In scope, the same handler does stat (proving the filter is the cause).
  await captured.evaluate(reviewerEvent('in-scope'));
  assert.equal(stats, 1, 'an in-scope reviewer event reads the config file stat');
  assert.equal(reads, 0, 'a missing file is never read');

  j.cleanup();
});

test('spawn-gate config: the project directory resolves from ctx.location with documented fallbacks', () => {
  assert.equal(resolveSpawnGateProjectDir({ location: { directory: '/p' } }, {}), '/p');
  assert.equal(resolveSpawnGateProjectDir({ location: { project: { directory: '/q' } } }, {}), '/q');
  assert.equal(resolveSpawnGateProjectDir({ location: { project: { canonical: '/r' } } }, {}), '/r');
  assert.equal(
    resolveSpawnGateProjectDir({ location: { directory: '/p', project: { canonical: '/r' } } }, {}),
    '/p',
    'directory wins over project metadata',
  );
  assert.equal(resolveSpawnGateProjectDir({ location: {} }, {}), null);
  assert.equal(resolveSpawnGateProjectDir({}, {}), null);
  assert.equal(
    resolveSpawnGateProjectDir({ get location() { throw new Error('boom'); } }, {}),
    null,
    'a hostile location getter must fail to null, not throw',
  );
  assert.equal(
    resolveSpawnGateProjectDir({ location: { directory: '/p' } }, { spawnGateProjectDir: '/s' }),
    '/s',
    'the explicit option is the test seam and wins',
  );
});

test('spawn-gate config: setup journals the project directory under a non-decision prefix', () => {
  const j = spawnEnvFile(null);
  const { ctx, captured } = captureSpawnGate({ messages: [], location: j.location });
  registerSpawnGate(ctx, { env: j.env });

  assert.equal(typeof captured.evaluate, 'function', 'the hook is registered even with no config');
  const log = j.read();
  assert.match(log, /spawn-gate-config: dir=/);
  assert.match(log, new RegExp(`spawn-gate-config: dir=${j.dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.ok(!/spawn-gate: dir=/.test(log), 'the directory line must not use the decision prefix');
  assert.ok(!/spawn-gate: /.test(log), 'no decision line when no decision was made');

  j.cleanup();
});

test('spawn-gate config: the decision journal stays unambiguous for the documented tally', async () => {
  const j = spawnEnvFile(JSON.stringify({ spawnGate: 'shadow' }));
  const { ctx, captured } = captureSpawnGate({
    messages: [transcriptMessage('tool', '1 failed')],
    location: j.location,
  });
  registerSpawnGate(ctx, {
    env: j.env,
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return noulBody(0.9, 0.9); } }),
  });
  await captured.evaluate(reviewerEvent('tally-1'));

  // Mirrors the README tally: only `spawn-gate:` decision lines carry
  // `decision=<value>`; config/setup lines must not match.
  const log = j.read();
  const tallyLines = log.split('\n').filter((line) => line.includes('spawn-gate:'));
  const decisions = tallyLines
    .map((line) => (line.match(/decision=([a-z-]+)/) || [])[1])
    .filter(Boolean);
  assert.deepEqual(decisions, ['would-deny']);
  assert.equal(tallyLines.length, decisions.length, 'every spawn-gate: line must be a decision line');

  j.cleanup();
});

test('spawn-gate: the test-output heuristic matches real runner output and state truncates to the cap', async () => {
  assert.ok(SPAWN_GATE_TEST_OUTPUT_RE.test('12 passing, 1 failing'));
  assert.ok(SPAWN_GATE_TEST_OUTPUT_RE.test('FAIL src/x.test.ts'));
  assert.ok(SPAWN_GATE_TEST_OUTPUT_RE.test('AssertionError: expected 1 to equal 2'));
  assert.ok(SPAWN_GATE_TEST_OUTPUT_RE.test('Traceback (most recent call last):'));
  assert.ok(SPAWN_GATE_TEST_OUTPUT_RE.test('npm test'));
  assert.ok(SPAWN_GATE_TEST_OUTPUT_RE.test('✓ renders the panel'));
  assert.ok(!SPAWN_GATE_TEST_OUTPUT_RE.test('just a normal assistant message'));

  const j = spawnEnv({ CLI_FIVE_JEVR_SPAWN_GATE: 'shadow' });
  const long = 'x'.repeat(20000);
  const { ctx, captured } = captureSpawnGate({
    messages: [transcriptMessage('tool', `1 failed\n${long}`)],
  });
  let body;
  registerSpawnGate(ctx, {
    env: j.env,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, status: 200, async json() { return noulBody(0.9, 0.9); } };
    },
  });

  await captured.evaluate(reviewerEvent('trunc-1'));
  assert.ok(body.state.length <= SPAWN_GATE_STATE_MAX_CHARS, 'state must be truncated to the cap');
  assert.equal(SPAWN_GATE_STATE_MAX_CHARS, 8000);

  j.cleanup();
});

test('spawn-gate: flattenMessage reads the real flat shape, the legacy content shape, and unwraps JSON text', () => {
  const real = flattenMessage(transcriptMessage('tool', '3 failing'));
  assert.equal(real.role, 'tool');
  assert.equal(real.text, '3 failing');

  const legacy = flattenMessage(contentMessage('assistant', 'hello from a content part'));
  assert.equal(legacy.role, 'assistant');
  assert.equal(legacy.text, 'hello from a content part');

  const wrapped = flattenMessage(jsonWrappedMessage('tool', 'line1\nline2 "quoted"'));
  assert.equal(wrapped.text, 'line1\nline2 "quoted"', 'a JSON-stringified text must be unwrapped once');

  // Absent `text` falls back to a content array / string; hostile and missing
  // fields are tolerated without throwing.
  assert.deepEqual(flattenMessage({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }), {
    role: 'unknown',
    text: 'a\nb',
  });
  assert.deepEqual(flattenMessage({ content: 'plain' }), { role: 'unknown', text: 'plain' });
  assert.deepEqual(flattenMessage({}), { role: 'unknown', text: '' });
  assert.deepEqual(flattenMessage(undefined), { role: 'unknown', text: '' });
  assert.deepEqual(flattenMessage({ text: undefined, files: 'not-an-array' }), { role: 'unknown', text: '' });

  // A text that starts/ends with a quote but is not valid JSON is left as-is.
  assert.equal(flattenMessage({ text: '"x" trailing' }).text, '"x" trailing');
});

test('spawn-gate: buildSpawnGateState detects a real-shaped transcript (deterministic)', async () => {
  const messages = [
    transcriptMessage('user', 'run the suite'),
    transcriptMessage('assistant', 'running the tests'),
    jsonWrappedMessage('tool', 'FAIL tests/a.test.js\n1 failing, 4 passing'),
  ];
  const ctx = { session: { context: async () => messages } };

  const state = await buildSpawnGateState(ctx, 'deterministic-1');
  assert.equal(state.hasTestOutput, true, 'the real flat shape must be detected');
  assert.ok(state.chars > 0, 'the real flat shape must produce a non-empty state');
  assert.ok(state.text.includes('1 failing, 4 passing'));
});

test('spawn-gate regression: a real-shaped transcript with a failing run attempts the Jev call', async () => {
  const j = spawnEnv();
  let calls = 0;
  const { ctx, captured } = captureSpawnGate({
    messages: [
      transcriptMessage('user', 'fix the build'),
      transcriptMessage('tool', 'FAIL tests/real.test.js\n1 failing, 4 passing'),
    ],
  });
  registerSpawnGate(ctx, {
    env: j.env,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, async json() { return noulBody(0.9, 0.9); } };
    },
  });

  const event = reviewerEvent('real-shape-1');
  await captured.evaluate(event);

  assert.equal(calls, 1, 'the real-shaped transcript must reach Jev, not short-circuit as no-test-output');
  assert.ok(!/reason=no-test-output/.test(j.read()), 'must not take the no-test-output path');
  assert.equal(event.effect, 'deny');

  const log = j.read();
  assert.match(log, /p_failing=0\.9/);
  assert.ok(!/state_chars=0\b/.test(log), 'state must be non-empty');

  j.cleanup();
});

test('spawn-gate: the legacy {role, content} shape still reaches Jev', async () => {
  const j = spawnEnv();
  let calls = 0;
  const { ctx, captured } = captureSpawnGate({ messages: [contentMessage('tool', '2 failed')] });
  registerSpawnGate(ctx, {
    env: j.env,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, async json() { return noulBody(0.9, 0.9); } };
    },
  });

  const event = reviewerEvent('legacy-1');
  await captured.evaluate(event);

  assert.equal(calls, 1, 'the legacy content array must still be read');
  assert.equal(event.effect, 'deny');

  j.cleanup();
});

test('spawn-gate: parseNoulAnswer rejects values outside [0,1] and non-numbers', () => {
  const body = (value) => ({ answers: { q: { type: 'noul', noul: value } } });

  assert.equal(parseNoulAnswer(body(0), 'q'), 0);
  assert.equal(parseNoulAnswer(body(0.9), 'q'), 0.9);
  assert.equal(parseNoulAnswer(body(1), 'q'), 1);

  for (const bad of [1.5, -0.1, NaN, Infinity, -Infinity, '0.9', null, undefined, true, {}, []]) {
    assert.equal(parseNoulAnswer(body(bad), 'q'), null, `must reject ${String(bad)}`);
  }
});

test('spawn-gate: a frozen event does not consume a cap slot and the journal stays truthful', async () => {
  const j = spawnEnv();
  const { ctx, captured } = captureSpawnGate({ messages: [transcriptMessage('tool', '1 failed')] });
  registerSpawnGate(ctx, {
    env: j.env,
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return noulBody(0.99, 0.99); } }),
  });

  // A frozen event makes `event.effect = 'deny'` throw before any deny lands.
  const frozen = Object.freeze({
    sessionID: 'frozen-session',
    agent: 'orchestrator',
    action: 'subagent',
    resources: ['reviewer'],
    effect: 'allow',
  });
  await assert.doesNotReject(() => captured.evaluate(frozen));
  assert.equal(frozen.effect, 'allow', 'the frozen event must be unchanged');

  const afterFrozen = j.read();
  assert.ok(!/decision=deny\b/.test(afterFrozen), 'no deny may be journaled when the assignment failed');
  assert.match(afterFrozen, /decision=allow/, 'the run must journal allow truthfully');

  // The cap slot was NOT consumed: two further denies for the same session land.
  const first = reviewerEvent('frozen-session');
  const second = reviewerEvent('frozen-session');
  await captured.evaluate(first);
  await captured.evaluate(second);
  assert.equal(first.effect, 'deny');
  assert.equal(second.effect, 'deny');

  j.cleanup();
});

test('spawn-gate: a partially-applied deny is rolled back and does not consume a cap slot', async () => {
  const j = spawnEnv();
  const { ctx, captured } = captureSpawnGate({ messages: [transcriptMessage('tool', '1 failed')] });
  registerSpawnGate(ctx, {
    env: j.env,
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return noulBody(0.99, 0.99); } }),
  });

  // `effect` is assignable, but the `message` setter throws — the deny is
  // applied then partially fails, so the effect must be rolled back.
  const partial = {
    sessionID: 'partial-session',
    agent: 'orchestrator',
    action: 'subagent',
    resources: ['reviewer'],
    effect: 'allow',
    set message(_value) { throw new Error('message setter boomed'); },
  };
  await assert.doesNotReject(() => captured.evaluate(partial));
  assert.equal(partial.effect, 'allow', 'the effect must be rolled back');
  assert.ok(!/decision=deny\b/.test(j.read()), 'no deny may be journaled for a rolled-back apply');

  const first = reviewerEvent('partial-session');
  const second = reviewerEvent('partial-session');
  await captured.evaluate(first);
  await captured.evaluate(second);
  assert.equal(first.effect, 'deny');
  assert.equal(second.effect, 'deny');

  j.cleanup();
});

test('spawn-gate: the deny-session map is bounded and evicts the oldest session', async () => {
  const j = spawnEnv();
  const { ctx, captured } = captureSpawnGate({ messages: [transcriptMessage('tool', '1 failed')] });
  registerSpawnGate(ctx, {
    env: j.env,
    spawnGateMaxTrackedSessions: 2,
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return noulBody(0.99, 0.99); } }),
  });

  assert.equal(SPAWN_GATE_MAX_TRACKED_SESSIONS, 256);

  // Sessions A and B each spend their 2-deny cap; with a bound of 2 they fill it.
  for (const session of ['A', 'A', 'B', 'B']) {
    await captured.evaluate(reviewerEvent(session));
  }

  // Denying C inserts a third session, evicting the oldest (A).
  const c = reviewerEvent('C');
  await captured.evaluate(c);
  assert.equal(c.effect, 'deny');

  // A's entry was evicted, so A starts a fresh cap instead of being capped.
  const a = reviewerEvent('A');
  await captured.evaluate(a);
  assert.equal(a.effect, 'deny', 'the evicted session must start with a fresh cap');

  j.cleanup();
});
