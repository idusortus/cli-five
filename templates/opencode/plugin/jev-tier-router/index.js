// cli-five jev-tier-router plugin (OpenCode).
//
// Ships a `tier_classifier` tool that classifies a task description into
// cli-five's tier vocabulary: trivial | minor | major.
//
// It is credential-gated real Jev, not local-only. When a credential resolves
// the tool sends exactly one System One `choice` question to OpenCode Zen
// (https://opencode.ai/zen/v1/systemone) or, as a secondary, to TypeSafe
// (https://api.typesafe.ai/v1/systemone), and reports source: 'jev_api'. With
// no credential it falls back to the local keyword/regex heuristic
// (`classifyTask`) and reports source: 'local_heuristic'. The `source` field
// states which path actually answered; the name `tier_classifier` asserts
// neither, so it stays accurate either way. See JEVR_SWAP_POINT below.
//
// Fail-open: a missing credential skips the network entirely; any API failure
// (401/422/429/529, network error, timeout, malformed body) returns the local
// heuristic's own result, and only an unexpected internal error that prevents
// even the local heuristic from running reports `available: false`. It never
// throws in a way that would break the Planner's turn.

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const CONFIDENCE_CUTOFF = 0.6;
const FALLBACK_TIER = 'major';

const TIERS = ['trivial', 'minor', 'major'];

// Real-Jev wiring constants.
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_MODELS = { opencode: 'jev-1.13-free', typesafe: 'jev-1.13.0' };
const ENDPOINTS = {
  opencode: 'https://opencode.ai/zen/v1/systemone',
  typesafe: 'https://api.typesafe.ai/v1/systemone',
};

// Criteria written from the existing SIGNALS groups' intent. `trivial` is the
// mechanical / no-reasoning group, `minor` the bounded / local / incremental
// group, `major` the architectural / cross-cutting / ambiguous group. No
// unrelated classification concerns.
const TIER_CRITERIA = {
  trivial:
    'Mechanical, no-reasoning change: typo / whitespace / lint / format fixes, renames, comment or doc edits, deleting stray or dead code. No design judgment required.',
  minor:
    'Bounded, local, incremental change: validation, error handling, a bug fix, a component / function / endpoint tweak, a small refactor. Contained to one area, no cross-cutting design.',
  major:
    'Architectural, cross-cutting, or ambiguous change: redesign / rearchitecture, migrations, concurrency or consistency, system-wide work, new modules or services, or a scope that cannot be pinned down.',
};

const JEVR_AVAILABLE_HINT =
  'Jev is available (free on OpenCode): connect the OpenCode provider or set OPENCODE_API_KEY to enable real tier routing; on TypeSafe, set TYPESAFE_API_KEY.';
const NO_CREDENTIAL_HINT = `No Jev credential resolved; using the local heuristic. ${JEVR_AVAILABLE_HINT}`;

// Weighted signals. `strong` matches dominate; `moderate` accumulate.
const SIGNALS = [
  // trivial — mechanical, single-token, no reasoning
  { tier: 'trivial', weight: 3, re: /\b(typo|typos|whitespace|lint|linting|format|formatting|rename|renaming|comment|comments|docstring|spelling|indent(ation)?)\b/i },
  { tier: 'trivial', weight: 2, re: /\b(README|changelog|CHANGELOG|\.md\b|docs?)\b/i },
  { tier: 'trivial', weight: 2, re: /\b(one[- ]?line|single[- ]?(file|line)|small tweak|quick fix|minor tweak)\b/i },
  { tier: 'trivial', weight: 2, re: /\b(delete|remove)\b[\s\w]{0,20}\b(console\.log|stray|unused|dead code|tmp|temp file)\b/i },

  // major — architectural, cross-cutting, ambiguous scope
  { tier: 'major', weight: 3, re: /\b(architect(ure|ural)?|redesign|rearchitect|rewrite|overhaul|migrat(e|ion)|replatform|distributed|scalab(le|ility)|multi[- ]?(tenant|region|service))\b/i },
  { tier: 'major', weight: 3, re: /\b(entire|whole|across (the )?(codebase|repo(sitory)?|project)|end[- ]to[- ]end|system[- ]wide)\b/i },
  { tier: 'major', weight: 2, re: /\b(concurren(cy|t)|race condition|deadlock|transaction(al)?|consistency|eventual consistency|saga|retry (architecture|strategy)|queue|scheduler|orchestrat(e|ion))\b/i },
  { tier: 'major', weight: 2, re: /\b(performance|latency|throughput|optimi[sz]e|profil(e|ing)|security|auth(entication|orization)?|encryption|compliance|HIPAA|SOC ?2|GDPR)\b/i },
  { tier: 'major', weight: 1, re: /\b(design|feature|implement|build|add support for|new (module|service|system))\b/i },

  // minor — bounded, local, incremental
  { tier: 'minor', weight: 3, re: /\b(validation|validate|error handling|error message|edge case|bug ?fix|fix (a |the )?bug|patch|handle null|guard clause)\b/i },
  { tier: 'minor', weight: 2, re: /\b(component|function|method|handler|endpoint|form|button|modal|tooltip|dropdown)\b/i },
  { tier: 'minor', weight: 2, re: /\b(refactor|extract|rename (the )?(function|method|class|module)|tidy|clean ?up)\b/i },
  { tier: 'minor', weight: 1, re: /\b(add|update|adjust|tweak|improve|tidy)\b/i },
];

/**
 * Classify a task description locally.
 *
 * Returns { tier, confidence, rationale, available, source }.
 * Ambiguity fails toward the expensive tier (major), never the cheap one.
 *
 * Pure, synchronous, and unchanged since before the real-Jev path: it is the
 * fallback and the documented public contract. Do not make it async.
 */
export function classifyTask(description) {
  const text = String(description ?? '').trim();
  if (!text) {
    return {
      tier: FALLBACK_TIER,
      confidence: 0,
      rationale: 'Empty task description; defaulting to the expensive tier.',
      available: true,
      source: 'local_heuristic',
    };
  }

  const scores = { trivial: 0, minor: 0, major: 0 };
  const hits = { trivial: [], minor: [], major: [] };

  for (const signal of SIGNALS) {
    if (signal.re.test(text)) {
      scores[signal.tier] += signal.weight;
      hits[signal.tier].push(signal.re.source.slice(0, 40));
    }
  }

  // Length is a weak major signal: long, multi-clause prompts rarely stay local.
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words > 25) scores.major += 1;
  if (words > 60) scores.major += 1;

  const ranked = TIERS.map((tier) => ({ tier, score: scores[tier] })).sort((a, b) => b.score - a.score);
  const [top, second] = ranked;

  if (top.score === 0) {
    // Nothing matched — ambiguous. Fail toward the expensive tier.
    return {
      tier: FALLBACK_TIER,
      confidence: 0.3,
      rationale: 'No tier signals matched; ambiguous, so defaulting to the expensive tier.',
      available: true,
      source: 'local_heuristic',
    };
  }

  const total = TIERS.reduce((sum, tier) => sum + scores[tier], 0);
  const separation = (top.score - (second?.score ?? 0)) / top.score;
  const share = top.score / total;
  let confidence = 0.5 * share + 0.5 * separation;

  // A single weak hit with no corroboration is not a confident call.
  if (top.score <= 1) confidence = Math.min(confidence, 0.5);

  confidence = Math.round(confidence * 100) / 100;

  if (confidence < CONFIDENCE_CUTOFF) {
    return {
      tier: FALLBACK_TIER,
      confidence,
      rationale: `Low confidence (${confidence} < ${CONFIDENCE_CUTOFF}) between ${top.tier} and ${second?.tier ?? 'n/a'}; defaulting to the expensive tier.`,
      available: true,
      source: 'local_heuristic',
    };
  }

  return {
    tier: top.tier,
    confidence,
    rationale: `Matched ${hits[top.tier].length} ${top.tier} signal(s).`,
    available: true,
    source: 'local_heuristic',
  };
}

// ── Real-Jev path: credential resolution ─────────────────────────────

function nonEmpty(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function selectModel(provider, env) {
  const override = nonEmpty(env.CLI_FIVE_JEVR_MODEL);
  return override || DEFAULT_MODELS[provider];
}

function extractStoreKey(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  // Read each shape's `key` independently: a present-but-keyless top-level
  // `opencode-go` entry must not shadow the `providers`-wrapped entry.
  return nonEmpty(parsed?.['opencode-go']?.key ?? parsed?.providers?.['opencode-go']?.key);
}

function readOpencodeStoreKey(opts = {}) {
  const env = opts.env ?? process.env;
  const read = typeof opts.readFile === 'function' ? opts.readFile : readFileSync;
  const home = opts.homeDir || homedir();

  const candidates = [];
  const xdg = nonEmpty(env.XDG_DATA_HOME);
  if (xdg) candidates.push(join(xdg, 'opencode', 'auth.json'));
  candidates.push(join(home, '.local', 'share', 'opencode', 'auth.json'));

  for (const file of candidates) {
    try {
      const raw = read(file, 'utf8');
      const key = extractStoreKey(JSON.parse(raw));
      if (key) return key;
    } catch {
      /* missing/unreadable/unparseable/absent-provider is "no credential" */
    }
  }
  return null;
}

/**
 * Resolve a real-Jev credential, defensively. Order:
 *   1. OPENCODE_API_KEY
 *   2. OpenCode credential store (provider `opencode-go`)
 *   3. TYPESAFE_API_KEY
 * Returns { provider, key, model } or null. Never throws.
 */
export function resolveJevCredential(opts = {}) {
  const env = opts.env ?? process.env;

  const opencodeEnvKey = nonEmpty(env.OPENCODE_API_KEY);
  if (opencodeEnvKey) {
    return { provider: 'opencode', key: opencodeEnvKey, model: selectModel('opencode', env) };
  }

  const storeKey = readOpencodeStoreKey(opts);
  if (storeKey) {
    return { provider: 'opencode', key: storeKey, model: selectModel('opencode', env) };
  }

  const typesafeKey = nonEmpty(env.TYPESAFE_API_KEY);
  if (typesafeKey) {
    return { provider: 'typesafe', key: typesafeKey, model: selectModel('typesafe', env) };
  }

  return null;
}

// ── Real-Jev path: request building, validation, attempt ─────────────

function buildRequest(description, model) {
  return {
    state: String(description ?? ''),
    model,
    questions: {
      tier: {
        type: 'choice',
        instructions: 'Classify the task into exactly one tier for planning depth.',
        criteria: { ...TIER_CRITERIA },
      },
    },
  };
}

/** Strictly validate a response body. Returns { tier, confidence } or null. */
function parseAnswer(body) {
  if (!body || typeof body !== 'object') return null;
  const answers = body.answers;
  if (!answers || typeof answers !== 'object') return null;
  const answer = answers.tier;
  if (!answer || typeof answer !== 'object') return null;
  if (answer.type !== 'choice') return null;
  if (!TIERS.includes(answer.choice)) return null;
  if (typeof answer.confidence !== 'number' || !Number.isFinite(answer.confidence)) return null;
  return { tier: answer.choice, confidence: answer.confidence };
}

/**
 * Make exactly one bounded attempt against the credential's provider.
 * Returns { ok: true, result } or { ok: false, kind, provider }. Never throws.
 */
async function attemptJev(description, cred, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (typeof fetchImpl !== 'function') {
    return { ok: false, kind: 'no_fetch', provider: cred.provider };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(ENDPOINTS[cred.provider], {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cred.key}`,
      },
      body: JSON.stringify(buildRequest(description, cred.model)),
      signal: controller.signal,
    });

    if (!response || !response.ok) {
      return { ok: false, kind: `http_${response?.status ?? 'unknown'}`, provider: cred.provider };
    }

    let body;
    try {
      body = await response.json();
    } catch {
      return { ok: false, kind: 'malformed_json', provider: cred.provider };
    }

    const parsed = parseAnswer(body);
    if (!parsed) return { ok: false, kind: 'malformed_response', provider: cred.provider };

    return {
      ok: true,
      result: {
        tier: parsed.tier,
        confidence: parsed.confidence,
        rationale: `Jev (${cred.provider}/${cred.model}) chose ${parsed.tier}.`,
        available: true,
        source: 'jev_api',
      },
    };
  } catch (err) {
    // Reading `.name` can itself throw on a hostile rejection value; keep the
    // whole catch non-throwing so a failed attempt always degrades to a result.
    let kind = 'network_error';
    try {
      if (err?.name === 'AbortError') kind = 'timeout';
    } catch {
      /* unknown rejection value — treat as a network error */
    }
    return { ok: false, kind, provider: cred.provider };
  } finally {
    clearTimeout(timer);
  }
}

function journal(message, opts = {}) {
  try {
    const env = opts.env ?? process.env;
    const file =
      env.CLI_FIVE_LOGFILE || join(process.cwd(), '.opencode', 'journals', 'jev-tier-router.log');
    // The default path's parent (.opencode/journals) does not exist on a fresh
    // scaffold, so create it before appending. Best-effort: never throws.
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${new Date().toISOString()} tier_classifier ${message}\n`);
  } catch {
    /* logging is best-effort */
  }
}

/**
 * Format a caught value for a journal line without ever throwing itself.
 *
 * A host can throw a non-Error whose `.message` getter throws, or an object
 * whose stringification throws. Formatting such a value inside a catch block
 * would make the catch rethrow, defeating fail-open. This is the only safe way
 * to turn a caught value into text; it is itself unable to throw.
 */
export function safeErrText(err) {
  try {
    return err?.message || String(err);
  } catch {
    return 'unknown error';
  }
}

/**
 * Remote-only classifier seam: one attempt when a credential resolves, else
 * null. Returns a normalized `jev_api` result on success, or null on any
 * failure (including no credential). Never throws.
 */
export async function classifyTaskWithJev(description, opts = {}) {
  const cred = resolveJevCredential(opts);
  if (!cred) return null;
  const outcome = await attemptJev(description, cred, opts);
  return outcome.ok ? outcome.result : null;
}

/**
 * The classifier used by the tool: real Jev when a credential resolves,
 * otherwise the local heuristic. Never throws; always returns a result. A
 * skipped-or-failed remote path adds the optional diagnostic `note` and writes
 * the same hint to the jev journal; `tier`/`confidence`/`available`/`source`
 * come from whichever path answered.
 */
export async function classifyWithJev(description, opts = {}) {
  const cred = resolveJevCredential(opts);

  if (!cred) {
    journal(`skipped: no credential. ${JEVR_AVAILABLE_HINT}`, opts);
    return { ...classifyTask(description), note: NO_CREDENTIAL_HINT };
  }

  const outcome = await attemptJev(description, cred, opts);
  if (outcome.ok) return outcome.result;

  const note = `Real Jev call via ${cred.provider} failed (${outcome.kind}); fell back to the local heuristic. ${JEVR_AVAILABLE_HINT}`;
  journal(`failed: provider=${cred.provider} kind=${outcome.kind}. ${JEVR_AVAILABLE_HINT}`, opts);
  return { ...classifyTask(description), note };
}

// ── JEVR_SWAP_POINT ───────────────────────────────────────────────────
// The real path is wired above: `classifyWithJev` resolves a credential, sends
// one System One `choice` question, and falls back to classifyTask().
//
// Endpoints (request/response shapes are identical):
//   OpenCode Zen (preferred): POST https://opencode.ai/zen/v1/systemone
//     default model `jev-1.13-free` (limited-time free tier)
//   TypeSafe (secondary):     POST https://api.typesafe.ai/v1/systemone
//     default model `jev-1.13.0`
//   Override either default with the CLI_FIVE_JEVR_MODEL env var.
//
// Credential sources, in precedence order:
//   1. OPENCODE_API_KEY (documented env var)
//   2. the OpenCode credential store, provider entry `opencode-go`:
//      $XDG_DATA_HOME/opencode/auth.json,
//      else ~/.local/share/opencode/auth.json
//   3. TYPESAFE_API_KEY
// Auth header: `Authorization: Bearer <credential>`; the JSON body carries the
// task as `state`. Exactly one attempt, bounded at 3000 ms, no retry/backoff.
//
// Live-observed response (OpenCode Zen, 2026-09-30):
//   {"model":"jev-1.13-free","answers":{"tier":{"type":"choice",
//    "choice":"trivial","confidence":1,
//    "probabilities":{"trivial":1,"minor":0,"major":0}}},
//    "usage":{"input_tokens":386,"output_tokens":40}}
//
// Doc sources: https://opencode.ai/v2/docs/console/models/ (Jev + systemone +
// OPENCODE_API_KEY); https://docs.typesafe.ai/models.md and
// https://docs.typesafe.ai/sdk/javascript.md (TypeSafe endpoint + versioned
// model IDs). The OpenCode auth store is OpenCode's private, undocumented
// format — re-check it if credential resolution ever stops working, and read
// it defensively (it does).
// ──────────────────────────────────────────────────────────────────────

// ── Session hooks (spike: deterministic admission-time routing) ───────
// OpenCode V2 exposes `ctx.session.hook('prompt', …)` (once per admission,
// before the model sees the prompt) and `ctx.session.hook('context', …)`
// (immediately before dispatch). When present, classify the incoming prompt
// with the existing `classifyWithJev` and inject the tier as an extra system
// instruction on the following call. The user's prompt text is never touched.
//
// This path is a spike: whether these hooks fire under OpenChamber's managed
// server is the open question. It is inert when the host lacks the surface
// (no throw, no behaviour change), on by default, and disabled with
// CLI_FIVE_JEVR_HOOKS=0. Every firing and registration outcome is journaled.
// The classifier, credential resolver, and journal sink are reused unchanged.
const HOOKS_OPT_OUT_ENV = 'CLI_FIVE_JEVR_HOOKS';

/**
 * Register the deterministic session hooks, defensively.
 *
 * No-ops (and journals why) when the host has no session hook surface or when
 * CLI_FIVE_JEVR_HOOKS=0. Every read of the host surface and every registration
 * is guarded, so this function cannot throw even if `ctx`/`opts` are hostile
 * objects with throwing getters. Never throws.
 */
export function registerSessionHooks(ctx, opts = {}) {
  try {
    const env = opts.env ?? process.env;

    let hasHook = false;
    try {
      hasHook = typeof ctx?.session?.hook === 'function';
    } catch (err) {
      journal(`hooks: session hook surface unavailable (reading ctx.session.hook threw: ${safeErrText(err)}); deterministic routing off.`, opts);
      return;
    }

    if (!hasHook) {
      journal('hooks: session hook surface unavailable (ctx.session.hook is not a function); deterministic routing off.', opts);
      return;
    }

    if (env[HOOKS_OPT_OUT_ENV] === '0') {
      journal(`hooks: disabled by ${HOOKS_OPT_OUT_ENV}=0; registering no session hooks.`, opts);
      return;
    }

    // Per-registration cache so each load (and each test) is isolated from the
    // next. `last` is the fallback ONLY when a `context` event carries no session
    // id at all; a named session resolves strictly from its own entry, so
    // concurrent sessions cannot bleed each other's tier.
    const cache = new Map();
    let last = null;

    const register = (name, handler) => {
      let outcome;
      try {
        // Called as a method so a host that relies on `this` still works.
        outcome = ctx.session.hook(name, handler);
      } catch (err) {
        journal(`hooks: failed to register ${name} hook: ${safeErrText(err)}`, opts);
        return;
      }

      // Reading `.then` can itself throw (a hostile thenable). Treat that as a
      // failed registration rather than letting it reject plugin load.
      let isThenable = false;
      try {
        isThenable = Boolean(outcome) && typeof outcome.then === 'function';
      } catch (err) {
        journal(`hooks: failed to register ${name} hook: ${safeErrText(err)}`, opts);
        return;
      }

      // A host may return a promise instead of throwing; settle it so an async
      // rejection is journaled rather than surfacing as an unhandled rejection.
      // Only safeErrText formats the caught value, so a hostile rejection value
      // cannot make this handler throw.
      if (isThenable) {
        Promise.resolve(outcome).then(
          () => journal(`hooks: registered ${name} hook.`, opts),
          (err) => journal(`hooks: failed to register ${name} hook: ${safeErrText(err)}`, opts),
        );
        return;
      }

      journal(`hooks: registered ${name} hook.`, opts);
    };

    // The ENTIRE handler body is inside the try: even coercing a hostile
    // `sessionID`/`prompt.text` (a throwing `Symbol.toPrimitive`) must fail
    // open, because a root-session `prompt` rejection is fatal to the turn.
    // The catch formats the caught value only through safeErrText, so a hostile
    // thrown value cannot make the catch itself rethrow.
    register('prompt', async (event) => {
      try {
        const session = String(event?.sessionID ?? 'current');
        const text = String(event?.prompt?.text ?? '');
        journal(`hooks: prompt fired session=${session} chars=${text.length}`, opts);

        try {
          const result = await classifyWithJev(text, opts);
          cache.set(session, result);
          last = result;
          journal(`hooks: prompt classified session=${session} tier=${result.tier} confidence=${result.confidence} source=${result.source}`, opts);
        } catch (err) {
          // classifyWithJev is fail-open, but never let the admission hook reject.
          const result = classifyTask(text);
          cache.set(session, result);
          last = result;
          journal(`hooks: prompt classification error session=${session}: ${safeErrText(err)}; using local heuristic.`, opts);
        }
      } catch (err) {
        // Hostile coercion or an unexpected failure: journal once, touch nothing.
        journal(`hooks: prompt hook fail-open: ${safeErrText(err)}`, opts);
      }
    });

    // Synchronous, and the whole body is guarded so a hostile `sessionID` or a
    // frozen `event.system` (push throws) cannot surface into the host session.
    register('context', (event) => {
      try {
        const sessionID = event?.sessionID;
        const hasSession = sessionID !== undefined && sessionID !== null;
        const session = String(sessionID ?? 'current');
        // A named session resolves strictly from its own cache entry; the cross-
        // session `last` fallback applies only when the event carries no session id.
        const result = hasSession ? cache.get(session) : last;

        if (!result) {
          journal(`hooks: context fired session=${session} but no cached classification; no injection.`, opts);
          return;
        }

        if (!Array.isArray(event?.system)) {
          journal(`hooks: context fired session=${session} but event.system is not an array; no injection.`, opts);
          return;
        }

        event.system.push({
          type: 'text',
          text: `Jev tier routing: plan at "${result.tier}" depth (confidence ${result.confidence}, source ${result.source}).`,
        });
        journal(`hooks: context injected session=${session} tier=${result.tier} confidence=${result.confidence} source=${result.source}`, opts);
      } catch (err) {
        journal(`hooks: context hook fail-open: ${safeErrText(err)}`, opts);
      }
    });
  } catch (err) {
    // Last-resort boundary guard: this function must be unable to throw.
    journal(`hooks: registration failed open: ${safeErrText(err)}`, opts);
  }
}

export const __testables = {
  classifyTask,
  CONFIDENCE_CUTOFF,
  FALLBACK_TIER,
  resolveJevCredential,
  classifyTaskWithJev,
  classifyWithJev,
  registerSessionHooks,
  safeErrText,
  attemptJev,
  parseAnswer,
  buildRequest,
  TIER_CRITERIA,
  DEFAULT_MODELS,
  DEFAULT_TIMEOUT_MS,
  ENDPOINTS,
  JEVR_AVAILABLE_HINT,
  NO_CREDENTIAL_HINT,
};

export default {
  id: 'cli-five-jev-tier-router',
  // Load-level fail-open: a hostile `ctx`, a throwing surface getter, or a
  // failing tool registration must never reject plugin load. registerSessionHooks
  // is itself non-throwing; the surrounding guard covers the tool surface too.
  setup: async (ctx) => {
    try {
      // Deterministic path first; it guards itself so it runs even when the
      // tool surface is absent.
      registerSessionHooks(ctx);

      if (!ctx || !ctx.tool || typeof ctx.tool.transform !== 'function') return;

      await ctx.tool.transform((tools) => {
        tools.add({
          name: 'tier_classifier',
          description:
            'Classify a task description into cli-five\'s tier vocabulary (trivial | minor | major). ' +
            'Call this once per task, before planning. Trust the returned tier when confidence >= 0.6; otherwise fall back to "major". ' +
            'Uses real Jev when a credential is available and a local heuristic otherwise; the result\'s `source` reports which path answered.',
          input: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                description: 'The task to classify, verbatim (the user request or planning prompt).',
              },
            },
            required: ['description'],
            additionalProperties: false,
          },
          async execute(input, opts) {
            try {
              const result = await classifyWithJev(input?.description, opts);
              return { content: JSON.stringify(result) };
            } catch (err) {
              // Fail-open: never break the caller's turn.
              journal(`fail-open: ${safeErrText(err)}`, opts);
              return {
                content: JSON.stringify({
                  tier: FALLBACK_TIER,
                  confidence: 0,
                  rationale: 'Tier classifier unavailable; defaulting to the expensive tier.',
                  available: false,
                  source: 'local_heuristic',
                }),
              };
            }
          },
        });
      });
    } catch (err) {
      journal(`plugin setup fail-open: ${safeErrText(err)}`);
    }
  },
};
