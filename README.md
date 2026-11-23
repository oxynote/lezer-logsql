# lezer-logsql

A [Lezer](https://lezer.codemirror.net/) grammar for LogsQL, the query
language of [VictoriaLogs](https://docs.victoriametrics.com/victorialogs/).
It lets an editor such as CodeMirror 6 highlight a query, complete it and
mark its errors.

The grammar follows the parser of VictoriaLogs, rule by rule, and is
checked against the answers of a real VictoriaLogs on thousands of
queries. It reads LogsQL as the VictoriaLogs release named in
[`upstream/VERSION`](upstream/VERSION) does.

## Installation

```sh
npm install @oxynote/lezer-logsql
```

`@lezer/lr`, `@lezer/highlight` and `@lezer/common` are peer dependencies,
so the parser shares the copies your editor already has.

## Usage

```ts
import { LanguageSupport, LRLanguage } from "@codemirror/language"
import { parser } from "@oxynote/lezer-logsql"

const logsql = LRLanguage.define({
	name: "logsql",
	parser: parser,
	languageData: { commentTokens: { line: "#" } },
})

export const logsqlSupport = new LanguageSupport(logsql)
```

The parser carries its highlighting, so a CodeMirror highlight style
colors the query with no further setup. To change the tags, pass your own
`styleTags` through `parser.configure({ props: [...] })`.

The package exports:

| Export | What it is |
| --- | --- |
| `parser` | The Lezer parser. |
| `logsqlHighlighting` | The highlighting the parser carries, as a `NodePropSource`. |
| `pipeNames` | The names of every pipe, such as `stats` and `sort`. |
| `filterFunctions` | The filter functions, such as `in` and `ipv4_range`. |
| `statsFunctions` | The functions of the `stats` pipe. |
| `runningStatsFunctions` | The functions of `running_stats` and `total_stats`. |
| `mathFunctions` | The functions of the `math` pipe. |

The lists are there for completion menus.

## Variables

A word that is only a variable, such as `$env`, parses as a
`VariableReference`. This is for tools that fill in variables before the
query runs. The grammar takes a variable wherever a word, a number or a
duration goes, so `| limit $n` is valid here.

A word that is only a duration placeholder, such as `$__interval` or
`$__range`, parses as a `DynamicDurationPlaceholder` where a duration
goes: after `_time:`, after `offset`, and as the bucket in
`stats by (_time:$__interval)`. Anywhere else it is an ordinary word.

| Node | Text | Taken as |
| --- | --- | --- |
| `VariableReference` | `$` and a lowercase name, such as `$env` | A word, a number or a duration |
| `DynamicDurationPlaceholder` | `$__` and a name, such as `$__interval` | A duration |

VictoriaLogs itself reads both as ordinary words. It accepts `env:$env`
and refuses `| limit $n` and `_time:$__range`. If your queries carry
neither, nothing changes for you, apart from the node names.

## How the Grammar Is Checked

The grammar is held to four references, in this order of trust.

1. The parser of VictoriaLogs. The rules in
   [`src/logsql.grammar`](src/logsql.grammar) follow
   [lib/logstorage/parser.go](https://github.com/VictoriaMetrics/VictoriaLogs/blob/master/lib/logstorage/parser.go)
   and the `pipe_*.go` and `stats_*.go` files
   [beside it](https://github.com/VictoriaMetrics/VictoriaLogs/tree/master/lib/logstorage).
2. The tests of VictoriaLogs. The queries in its test files, such as
   [lib/logstorage/parser_test.go](https://github.com/VictoriaMetrics/VictoriaLogs/blob/master/lib/logstorage/parser_test.go),
   are copied into [`upstream/queries.json`](upstream/queries.json).
3. The LogsQL docs. Every example in
   [docs/victorialogs/logsql.md](https://github.com/VictoriaMetrics/VictoriaLogs/blob/master/docs/victorialogs/logsql.md),
   the source of
   [docs.victoriametrics.com/victorialogs/logsql](https://docs.victoriametrics.com/victorialogs/logsql/),
   is copied there too.
4. A running VictoriaLogs. Every query in the record was sent to the
   VictoriaLogs release in `upstream/VERSION`, and its answer is stored
   beside the query: valid, or invalid with the error message.

The tests hold the grammar to the queries in `upstream/queries.json`:

- The grammar accepts every query that VictoriaLogs accepts.
- The grammar rejects the queries that VictoriaLogs rejects, apart from
  those listed, with VictoriaLogs' reason for each, in
  [`test/accepted-invalid.txt`](test/accepted-invalid.txt).
- The grammar's keywords must equal the keywords that the parser of
  VictoriaLogs checks, which are read from its source into
  [`upstream/keywords.json`](upstream/keywords.json).

This repository has test queries of its own.
[`test/cases/`](test/cases) holds queries with the result each must give,
and [`test/invalid.txt`](test/invalid.txt) the mistakes the grammar must
catch. These are sent to VictoriaLogs as well, and its answers are
kept apart in
[`test/victorialogs-answers.json`](test/victorialogs-answers.json). So a
case cannot claim something the server disagrees with. The exception is
the variable cases (see [Variables](#variables)): VictoriaLogs refuses some
of them, and they are listed in `test/accepted-invalid.txt` too.

CI writes both files again from a real VictoriaLogs on every push and
fails when either differs from the committed one. So the record cannot
drift, and it cannot be edited by hand.

### Checking a Query Yourself

Start a VictoriaLogs and ask both sides about a query:

```sh
./scripts/start-victorialogs.sh "$(cat upstream/VERSION)"
VICTORIA_LOGS_URL=http://127.0.0.1:9428 pnpm parse 'level=error'
```

```
level=error
Query
  Phrase
    ⚠
      = "="
grammar: invalid
VictoriaLogs: invalid, missing whitespace or ':' between "level" and "="; probably, the whole string must be put into quotes
```

`docker rm -f lezer-logsql-victorialogs` stops the server again.

## What the Grammar Does Not Check

The grammar checks the shape of a query. It leaves three things to
VictoriaLogs, and `test/accepted-invalid.txt` lists every known example:

- Values: `| limit -5`, `_time:foo` and a broken regular expression all
  have the right shape.
- Names that clash: two results with the same name, or a second `limit`
  in one `sort`.
- What a query inside `in(...)` returns: VictoriaLogs wants it to end with
  a `fields` or `uniq` pipe that names one field.

It does check the number of arguments a function takes, where a wildcard
is allowed, and the white space rules that make `level = error` an error.

## Development

```sh
pnpm install
pnpm test          # generate the parser, run the tests with coverage
pnpm check-lint    # types, eslint, prettier and knip
pnpm build         # write dist/
pnpm parse '...'   # parse a query and print the result
```

The parser is generated from `src/logsql.grammar`. The tokenizer in
[`src/tokens.ts`](src/tokens.ts) reads the words, because in LogsQL the
same text is a keyword in one place and a field name in another.

[SYNCING.md](SYNCING.md) says how the grammar follows new releases of
VictoriaLogs, and how to publish a version.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The keyword lists
and the recorded queries come from VictoriaLogs, which is also under
Apache-2.0, and `NOTICE` names each file.
