# Feature: Schema Foundation

## Goal

Define the minimal schema used by the fixture tests. JSON shape with `id` and `slug`.

## Acceptance Criteria

- [ ] Schema is declared in tests as a frontmatter block.
- [ ] Tests pass against the minimal schema.
- [ ] Acceptance gate exit 0 on green run.
- [ ] Example fixture is committed.
- [ ] State flow: `pending → in_progress → completed`.

## Stories

| #   | Story                                               | Tasks | Description |
| --- | --------------------------------------------------- | ----- | ----------- |
| 01  | [Schema declaration](../stories/01/01-schema.md)    | 1     | Declare the schema and verify. |

## Notes

- This is the minimal fixture used by all parity tests.
