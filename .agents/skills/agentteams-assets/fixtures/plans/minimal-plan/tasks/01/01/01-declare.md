# Task: Declare schema

**Story:** [Schema declaration](../../../stories/01/01-schema.md)

## Context

Write a minimal JSON schema block.

## Target Files

- `fixtures/schema.json` — the schema body.

## Changes

Create `fixtures/schema.json` with `{ "id": "string", "slug": "string" }`.

## Verification

- [ ] `cat fixtures/schema.json | jq .` exits 0.
