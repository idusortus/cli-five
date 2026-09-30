# Spec Delta

## Purpose

Gives the Planner an optional real-Jev classification of a task into cli-five's `trivial | minor | major` tiers — preferring the OpenCode credential the user already has, with TypeSafe as an optional secondary — while guaranteeing that a missing credential or any API failure degrades to the existing local heuristic with the same consumer-facing result contract.

## ADDED Requirements

### Requirement: Tier classification result contract
The tier-classification tool SHALL return a result object carrying the fields `tier`, `confidence`, `rationale`, `available`, and `source`, which are the fields the Planner consumes. `tier` MUST be one of `trivial`, `minor`, or `major`. `source` MUST identify which path produced the answer: `jev_api` for a real System One call and `local_heuristic` for the local path. `available` SHALL be `true` whenever a tier was produced by either path, and `false` only when an unexpected internal error prevents even the local heuristic from producing a result. The result MAY include an additional diagnostic field (such as `note`) that consumers MUST ignore. The tool MUST NOT throw; in the catastrophic case it SHALL still return a result object.

#### Scenario: Local path reports its source
- **WHEN** no credential is available and a task description is classified
- **THEN** the result has `source` equal to `local_heuristic` and `tier` equal to one of `trivial`, `minor`, `major`

#### Scenario: API path reports its source
- **WHEN** a credential resolves and the endpoint returns a usable answer
- **THEN** the result has `source` equal to `jev_api`, `tier` equal to the option the API chose, `confidence` reflecting the API's choice confidence, and `available` equal to `true`

#### Scenario: The tool never breaks the caller's turn
- **WHEN** an unexpected internal error prevents even the local heuristic from producing a result
- **THEN** the tool returns a result object instead of raising, and `available` is `false`

### Requirement: Provider selection is credential-gated
The tool SHALL perform a real System One call only when a credential resolves. It SHALL prefer the OpenCode Zen endpoint and use the TypeSafe endpoint only when no OpenCode credential resolves but a TypeSafe key is present. When neither resolves, the tool MUST NOT perform any network call.

#### Scenario: OpenCode credential takes precedence
- **WHEN** an OpenCode credential resolves
- **THEN** the tool calls `https://opencode.ai/zen/v1/systemone` and not the TypeSafe endpoint

#### Scenario: TypeSafe is the fallback provider
- **WHEN** no OpenCode credential resolves but a TypeSafe key is present
- **THEN** the tool calls `https://api.typesafe.ai/v1/systemone`

#### Scenario: No credential means no network
- **WHEN** neither credential resolves
- **THEN** classification makes zero network calls and returns exactly the result the local heuristic produced before this change

### Requirement: OpenCode credential resolution
For the OpenCode path, the tool SHALL use the `OPENCODE_API_KEY` environment variable when it is set and non-empty; otherwise it SHALL read the OpenCode credential store, preferring `$XDG_DATA_HOME/opencode/auth.json` and falling back to `~/.local/share/opencode/auth.json`, taking the credential for provider `opencode-go`. Reading the store MUST be defensive: a missing file, an unreadable or unparseable file, or a missing provider entry SHALL be treated as "no credential", never as an error that escapes the tool.

#### Scenario: Environment variable wins
- **WHEN** `OPENCODE_API_KEY` is set and non-empty
- **THEN** the tool uses it as the bearer credential and does not read the credential store

#### Scenario: Store is used when the environment is silent
- **WHEN** `OPENCODE_API_KEY` is unset or empty and the credential store contains provider `opencode-go`
- **THEN** the tool uses that stored key as the bearer credential

#### Scenario: Malformed or absent store degrades quietly
- **WHEN** the credential store is missing, unreadable, unparseable, or lacks `opencode-go`
- **THEN** the tool behaves as though no OpenCode credential exists rather than throwing

### Requirement: Custom criteria for the three tiers
The tool SHALL pose exactly one Choice question with the three options `trivial`, `minor`, and `major`, each with a criteria description derived from that tier's existing signal intent: mechanical / no-reasoning for `trivial`, bounded / local for `minor`, and architectural / cross-cutting / ambiguous for `major`. The criteria MUST NOT introduce unrelated classification concerns. The task description SHALL be sent as the request's `state`.

#### Scenario: Criteria map has exactly the three tiers
- **WHEN** the tool builds a real-Jev request
- **THEN** the question's criteria map has exactly the keys `trivial`, `minor`, and `major`, each with a non-empty description matching its tier's intent

#### Scenario: State carries the task
- **WHEN** the tool builds a real-Jev request
- **THEN** the task description is sent as `state`

### Requirement: Model selection per provider
Each provider SHALL send a versioned Jev model identifier rather than a floating alias: the OpenCode path SHALL default to `jev-1.13-free`, and the TypeSafe path SHALL default to `jev-1.13.0`. The model identifier SHALL be overridable through a documented environment variable so the default can move without a code change.

#### Scenario: OpenCode default model
- **WHEN** the tool builds an OpenCode Zen request with no override set
- **THEN** `model` is `jev-1.13-free`

#### Scenario: TypeSafe default model
- **WHEN** the tool builds a TypeSafe request with no override set
- **THEN** `model` is `jev-1.13.0`

#### Scenario: Override is honored
- **WHEN** the documented model-override environment variable is set
- **THEN** the tool sends that value as `model` instead of the default for the selected provider

### Requirement: One bounded attempt, no retry
The real-Jev path SHALL make exactly one request attempt, bounded by a fixed short timeout, and MUST NOT retry or back off inside the tool's execution path.

#### Scenario: Timeout abandons the attempt
- **WHEN** the endpoint does not respond within the timeout
- **THEN** the tool abandons the attempt and produces a result without issuing a second request

#### Scenario: Rate-limit responses are not retried
- **WHEN** the endpoint responds with 429 or 529
- **THEN** the tool does not retry and produces a result immediately

### Requirement: Fail-open fallback to the local heuristic
When the real-Jev path cannot produce a valid classified result for any reason — including the HTTP statuses 401, 422, 429, and 529, a network error, a timeout, or a missing, malformed, or unrecognized response body — the tool SHALL fall back to the existing local heuristic and report `source` as `local_heuristic`. The fallback result MUST carry a `tier` and `confidence` produced by the local heuristic; the tool MUST NOT substitute a bare or synthetic `major` for the local heuristic's own output.

#### Scenario: Unauthorized response falls back locally
- **WHEN** the endpoint responds with 401
- **THEN** the result is the local heuristic's output with `source` equal to `local_heuristic`

#### Scenario: Rate-limited response falls back locally
- **WHEN** the endpoint responds with 429
- **THEN** the result is the local heuristic's output with `source` equal to `local_heuristic`

#### Scenario: Network error or timeout falls back locally
- **WHEN** the request times out or fails at the network layer
- **THEN** the result is the local heuristic's output with `source` equal to `local_heuristic`

#### Scenario: Malformed response falls back locally
- **WHEN** the endpoint returns a body that cannot be interpreted as a valid choice answer
- **THEN** the result is the local heuristic's output with `source` equal to `local_heuristic`

#### Scenario: Failures are journaled without throwing
- **WHEN** the real-Jev path fails for any reason
- **THEN** the failure is appended to the jev journal on a best-effort basis and the tool still returns normally

### Requirement: Fallback reminds the user that Jev is available
Whenever the real-Jev path is skipped for want of a credential, or attempted and fails, the tool SHALL include a human-readable hint that Jev is available (and, on the OpenCode path, how to make it work) in the result's optional diagnostic field, and SHALL record the same hint in the jev journal. The hint MUST NOT alter `tier`, `confidence`, `available`, or `source`.

#### Scenario: No credential yields a hint
- **WHEN** no credential resolves and the local heuristic answers
- **THEN** the result carries a diagnostic note stating that Jev is available if a credential is provided, while `tier`/`confidence`/`available`/`source` stay those of the local heuristic

#### Scenario: Failed call yields a hint
- **WHEN** the endpoint fails and the local heuristic answers
- **THEN** the diagnostic note states that the real path was attempted and failed, and the journal records the same

### Requirement: Scaffolded Planner instruction matches the tool
`add jev` SHALL register the classifier under the name `tier_classifier`, and the Planner instruction written into the target repository's `AGENTS.md` SHALL reference that same name. The instruction SHALL describe the classifier as optional — real Jev when a credential is available, local heuristic otherwise — rather than local-only, and SHALL mention that Jev is free on OpenCode so the reader knows it is available. Its threshold semantics MUST be unchanged: trust the returned `tier` when `confidence >= 0.6`, otherwise fall back to the Planner's own judgment defaulting to `major`.

#### Scenario: Registered name and instruction name agree
- **WHEN** `add jev` runs against an OpenCode target
- **THEN** the registered tool name and the name referenced in the injected Planner instruction are both `tier_classifier`

#### Scenario: Instruction no longer claims local-only
- **WHEN** the injected Planner instruction is read
- **THEN** it does not assert that the classifier is always a local heuristic with no Jev call, and it notes that Jev is available on OpenCode

#### Scenario: Threshold semantics are preserved
- **WHEN** the injected Planner instruction is read
- **THEN** it still specifies trusting `tier` when `confidence >= 0.6` and defaulting to `major` otherwise

### Requirement: Registered add-on status is accurate
The jev add-on's reported status SHALL describe both operational states — real Jev when a credential resolves (OpenCode Zen free model, or TypeSafe), and the local heuristic otherwise — while still noting that the test-gate is parked alongside its issue link.

#### Scenario: Status reflects both states
- **WHEN** the jev add-on's status is read
- **THEN** it describes the real-Jev path and the local-heuristic fallback, and it still mentions the parked test-gate with its issue link

#### Scenario: Obsolete rationale is removed
- **WHEN** the jev add-on's status is read
- **THEN** it no longer states that jev-harness lacks a custom-criteria interface as the blanket reason for being local-only

### Requirement: Swap-point marker describes the built implementation
The swap-point marker in the tier-router plugin SHALL describe the real System One wiring that exists, and MUST NOT describe a `jev-harness route` shell-out as the implementation or the future plan.

#### Scenario: Marker no longer claims a jev-harness plan
- **WHEN** the swap-point marker comment is read
- **THEN** it describes the OpenCode Zen and TypeSafe endpoints and the credential sources, and does not present `jev-harness route` as the mechanism to build

### Requirement: The real-Jev path is documented
The README's jev section SHALL document that the classifier optionally uses real Jev, that on OpenCode it works with the credential the user already has (`OPENCODE_API_KEY` or the stored `opencode-go` credential) and is free, that TypeSafe is available as a secondary provider via `TYPESAFE_API_KEY`, and that it falls back to the local heuristic otherwise.

#### Scenario: Reader can determine how to enable it
- **WHEN** a reader consults the README's jev section
- **THEN** they can determine the credential sources, the default models, and the fallback behavior when no credential is present
