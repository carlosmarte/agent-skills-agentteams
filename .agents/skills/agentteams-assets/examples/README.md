# AgentTeams examples

Three example shapes — `cli/`, `sdk/`, `api/` — each documenting the same full-cycle scenario from a different surface.

| Directory | What it shows |
| --------- | --- |
| `cli/`    | Shell-level invocation of all six subcommands against the bundled fixture. |
| `sdk/`    | Library-level invocation of the public API (mjs + py) — same flow, no shell. |
| `api/`    | Type signatures and one-paragraph behavior per public surface. |

Run the full cycle from the repo root:

```sh
make analyze
make dag
make slice
make run
make resume
```
