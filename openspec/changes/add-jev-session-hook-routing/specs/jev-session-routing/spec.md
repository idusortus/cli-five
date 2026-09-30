# Spec Delta

## Purpose

Makes the tier classification deterministic instead of advisory: the host classifies the incoming user prompt once at admission and injects the resulting tier into the model's instructions, so planning depth no longer depends on the agent choosing to call a tool.

## ADDED Requirements

### Requirement: Admission-time classification
When the host exposes a session prompt hook, the plugin SHALL classify the incoming user prompt exactly once per admission, before the model sees it, and SHALL retain the result for the following model dispatch.

#### Scenario: One classification per admission
- **WHEN** a user prompt is admitted and the host supports session hooks
- **THEN** the classifier runs once for that admission and its result is cached for the subsequent model request

#### Scenario: Classification runs before dispatch
- **WHEN** the prompt hook completes
- **THEN** the resulting tier is available to the model call that follows, without the agent having to request it

### Requirement: System-side injection only
The injected tier SHALL be delivered as an additional system instruction, and the user's own prompt text SHALL NOT be rewritten or mutated.

#### Scenario: User prompt is untouched
- **WHEN** the tier is injected
- **THEN** the prompt text the user submitted is unchanged

#### Scenario: Model receives the tier as an instruction
- **WHEN** a model request follows an admission with a cached classification
- **THEN** the request's system instructions include the tier and the result's `source`, and the injection happens only for that outgoing call

### Requirement: Graceful absence of the hook surface
When the host does not expose the session hook surface, the plugin MUST NOT throw and MUST NOT change behaviour; the `tier_classifier` tool remains available.

#### Scenario: Older host without hook support
- **WHEN** the plugin is loaded on a host whose context lacks a session hook function
- **THEN** the plugin registers the tool as before, adds no injection, and logs that the hook surface was unavailable

#### Scenario: Registration failure is contained
- **WHEN** registering a session hook throws
- **THEN** the error is journaled and the plugin continues to load normally

### Requirement: Hooks never block or break admission
Classification inside the hook SHALL be fail-open: any failure (no credential, HTTP error, timeout, malformed response) SHALL fall back to the existing local heuristic, and the hook MUST NOT reject or abort admission.

#### Scenario: Failure falls back locally
- **WHEN** the real classification attempt fails inside the prompt hook
- **THEN** the cached result is the local heuristic's output and admission proceeds normally

#### Scenario: Hooks are opt-out capable
- **WHEN** the hook path is disabled through its documented switch
- **THEN** the plugin registers no session hooks and behaves exactly as the tool-only path

### Requirement: Hook activity is observable
Every hook firing, and every failure to register or fire one, SHALL be appended to the jev journal so whether the hooks ran can be established from the log alone.

#### Scenario: Firing is journaled
- **WHEN** the prompt hook or the context hook runs
- **THEN** a journal line records which hook fired, the session, and the classification outcome (`tier`, `confidence`, `source`)

#### Scenario: Registration failure is journaled
- **WHEN** a hook cannot be registered
- **THEN** a journal line records the failure reason
