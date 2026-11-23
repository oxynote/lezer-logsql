# Following VictoriaLogs

LogsQL changes with VictoriaLogs. Most releases add a pipe, a function or
an option, and the
[changelog](https://docs.victoriametrics.com/victorialogs/changelog/) lists
each one. This file says how the grammar notices such a change, and what
to do about it.

## What Is Tracked

`upstream/` holds what the grammar is checked against. All of it is
written by `pnpm sync-upstream` and never by hand.

| File | Holds |
| --- | --- |
| `upstream/VERSION` | The VictoriaLogs release the rest was read from. |
| `upstream/keywords.json` | Every keyword the parser of VictoriaLogs checks, and the names of its pipes and functions. |
| `upstream/queries.json` | Queries from the tests and docs of VictoriaLogs, each with the verdict of a VictoriaLogs server. |

The sync also sends this repository's own test queries, from `test/cases/`
and `test/invalid.txt`, to the same server. Their verdicts go to
`test/victorialogs-answers.json`, so `upstream/` holds only what comes
from VictoriaLogs.

## The Weekly Sync

[`.github/workflows/sync.yml`](.github/workflows/sync.yml) runs every
Monday, and on demand with an optional tag. It looks up the newest release
of VictoriaLogs. If `upstream/VERSION` already names it, or the branch
`sync/<tag>` already exists, the run ends. So the run never touches a
branch you have pushed fixes to. To sync the same release again, delete
its branch first.

Otherwise it starts that release in Docker, writes `upstream/` again,
runs the tests, and opens a pull request from the branch `sync/<tag>`. The
pull request says whether the tests still pass.

A pull request opened by a workflow does not start the QA workflow by
itself. Pushing a commit to the branch does.

## Reading the Pull Request

Each file tells one thing:

- `upstream/keywords.json` changed: the parser knows a new keyword, or
  lost one. The test in `src/keywords.test.ts` fails until the grammar has
  the same keywords.
- `upstream/queries.json` gained lines: VictoriaLogs has new tests or new
  examples in its docs. A changed `valid` on an old line means the release
  reads that query differently. That is rare, and it is the change to
  look at first.
- `test/victorialogs-answers.json` changed: the release reads one of this
  repository's own test queries differently. The test that compares each
  case with its verdict says which one.
- `test/accepted-invalid.txt` changed: the grammar now accepts an invalid
  query it rejected before, or the other way around. The file lists the
  invalid queries the grammar lets through on purpose, so each new line
  needs a look.

## Changing the Grammar

1. Find the code behind the change in
   [lib/logstorage](https://github.com/VictoriaMetrics/VictoriaLogs/tree/master/lib/logstorage):
   `parser.go` for filters, `pipe_<name>.go` for a pipe and
   `stats_<name>.go` for a stats function.
2. For a new keyword, add it to the `@external tokens` list in the
   grammar, under its own text, and use it in a rule. For a new pipe or
   function, add the name to `src/keywords.ts` as well.
3. Add a case to a file in `test/cases/`: a `# name` line, the query, a
   `==>` line and the tree. `pnpm parse '<query>'` prints the tree to copy
   from. A mistake the grammar must catch goes into `test/invalid.txt`.
4. Run the sync again, so the new cases get their verdict (see below).
5. Run `pnpm test`. If only `test/accepted-invalid.txt` differs and the
   new lines are fine, `pnpm exec vitest run --update` rewrites it.

## Syncing by Hand

The sync needs Docker and a network connection.

```sh
# the release in upstream/VERSION, or the one to move to
TAG="$(cat upstream/VERSION)"

./scripts/start-victorialogs.sh "$TAG"
pnpm generate
pnpm sync-upstream "$TAG"
pnpm test

docker rm -f lezer-logsql-victorialogs
```

The script refuses to run when the server reports another version than
the tag, so a record can never mix two releases. To point it at another
server, set `VICTORIA_LOGS_URL`.

Running it for the tag in `upstream/VERSION` must change nothing. CI does
exactly that on every push.

## Publishing

1. Bump `version` in `package.json`.
2. Push a tag with the same number, such as `v0.1.1`.

[`.github/workflows/publish.yml`](.github/workflows/publish.yml) runs the
QA workflow, checks the tag against `package.json` and publishes to npm
through trusted publishing.
