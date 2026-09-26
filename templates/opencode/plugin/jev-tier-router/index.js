// cli-five jev-tier-router plugin (OpenCode).
//
// Ships a `local_tier_heuristic` tool that classifies a task description into
// cli-five's tier vocabulary: trivial | minor | major.
//
// TRUTHFUL NAMING: this is a LOCAL heuristic. It does NOT call Jev. As of
// 2026-09-26, jev-harness's `route` subcommand exposes no custom-criteria
// interface (it emits its own fixed tier vocabulary: deterministic /
// lightweight_system2 / heavy_system2) and returns a constant confidence
// (0.88) under its offline/mock engine, so it cannot be thresholded on.
// The name `local_tier_heuristic` is deliberate — do not revive `jev_tier_route`
// unless/until real Jev wiring is verified. See JEVR_SWAP_POINT below.
//
// Fail-open: if anything goes wrong the tool reports `available: false` and
// tier "major" (the expensive tier), so the Planner falls back to its own
// judgment. It never throws in a way that would break the Planner's turn.

import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

const CONFIDENCE_CUTOFF = 0.6;
const FALLBACK_TIER = 'major';

const TIERS = ['trivial', 'minor', 'major'];

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

// ── JEVR_SWAP_POINT ───────────────────────────────────────────────────
// Real-Jev wiring would replace classifyTask() above with a shell-out to
//   jev-harness route --json --task "<description>"
// and map the returned `selected_tier` onto cli-five's tiers, thresholding on
// `confidence`. It is NOT wired because, as of 2026-09-26, `route` exposes no
// custom-criteria interface, emits a fixed vocabulary, and returns a constant
// confidence under the offline engine. Re-verify before swapping.
// Exact call site: the `execute` handler below that calls classifyTask().
// ──────────────────────────────────────────────────────────────────────

export const __testables = { classifyTask, CONFIDENCE_CUTOFF, FALLBACK_TIER };

export default {
  id: 'cli-five-jev-tier-router',
  setup: async (ctx) => {
    if (!ctx || !ctx.tool || typeof ctx.tool.transform !== 'function') return;

    await ctx.tool.transform((tools) => {
      tools.add({
        name: 'local_tier_heuristic',
        description:
          'Classify a task description into cli-five\'s tier vocabulary (trivial | minor | major) using a local heuristic. ' +
          'Call this once per task, before planning. Trust the returned tier when confidence >= 0.6; otherwise fall back to "major". ' +
          'This is a local heuristic, not a Jev call.',
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
        async execute(input) {
          try {
            const result = classifyTask(input?.description);
            return { content: JSON.stringify(result) };
          } catch (err) {
            // Fail-open: never break the caller's turn.
            try {
              appendFileSync(
                process.env.CLI_FIVE_LOGFILE || join(process.cwd(), '.opencode', 'journals', 'jev-tier-router.log'),
                `${new Date().toISOString()} local_tier_heuristic fail-open: ${err?.message || err}\n`,
              );
            } catch {
              /* logging is best-effort */
            }
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
  },
};
