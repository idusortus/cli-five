# Spec Delta

## Purpose

Prevents `mergeBlock` from appending a second fenced block when an existing file is corrupted or manually edited to contain only an opening fence.

## ADDED Requirements

### Requirement: Lone START fence does not produce a duplicate block
When `mergeBlock` processes a Markdown file that contains the matching `<!-- NAME_START -->` fence but no `<!-- NAME_END -->` fence, it SHALL insert the block content exactly once and SHALL ensure the result contains a single paired fence set, not two blocks.

#### Scenario: File contains only a START fence
- **WHEN** `mergeBlock` is called on a file whose contents are exactly `<!-- FOO_START -->\nexisting text`
- **THEN** the resulting file contains one `<!-- FOO_START -->` / `<!-- FOO_END -->` pair and the new content between them, with no second pair appended

### Requirement: Fully intact fence is still replaced in place
When both START and END fences exist, `mergeBlock` SHALL continue to replace only the body between them, preserving idempotency.

#### Scenario: Existing pair is updated, not duplicated
- **WHEN** `mergeBlock` is called on a file that already contains `<!-- FOO_START -->\nold\n<!-- FOO_END -->`
- **THEN** the file contains the same fences with the new body between them and no additional fences
