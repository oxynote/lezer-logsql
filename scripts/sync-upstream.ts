// Rewrites upstream/ from a VictoriaLogs release:
//
//   pnpm sync-upstream v1.54.0
//
// It takes the keywords from the parser's source, and the queries from
// its tests and from the LogsQL docs. Every query is then sent to a
// running VictoriaLogs of the same release, which says whether it is
// valid. The tests in this repository hold the grammar to that record.
//
// The queries of this repository's own tests are sent too. Their answers
// go to test/victorialogs-answers.json, so upstream/ holds only what
// comes from VictoriaLogs.

import { execFileSync } from "node:child_process"
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	functionBody,
	mapKeys,
	stringArguments,
	testFunctions,
} from "./go-source.ts"
import { askAll, serverVersion } from "./victorialogs.ts"
import { caseFiles, caseQueries, invalidCases } from "../src/test-helpers.ts"

const REPOSITORY = "https://github.com/VictoriaMetrics/VictoriaLogs.git"
const SOURCE_DIR = "lib/logstorage"
const DOCS_FILE = "docs/victorialogs/logsql.md"
const ROOT = join(import.meta.dirname, "..")
const UPSTREAM_DIR = join(ROOT, "upstream")

// a longer string in a test is data, not a query worth keeping
const MAX_QUERY_LENGTH = 2000

// the test files whose strings are one pipe or one stats function, and
// not a whole query
const PIPE_TEST_FILE = /^(pipe|stats|running_stats)_/

// the test helpers that take the text to parse as their first string
const TEST_CALLS = ["f", "expectParse\\w+", "expectPipe\\w+"]

// the words parseFilterGeneric checks that are no filter function
const NOT_FILTER_FUNCTIONS = ["not", "_time", "_stream", "_stream_id"]

interface Candidate {
	query: string
	source: string
}

const tag = process.argv[2]
if (!tag) {
	throw new Error("usage: pnpm sync-upstream <tag>, for example v1.54.0")
}

const version = await serverVersion()
if (version !== tag) {
	throw new Error(
		`the VictoriaLogs at VICTORIA_LOGS_URL runs ${version}, not ${tag}. Start that release first.`,
	)
}

const checkout = mkdtempSync(join(tmpdir(), "victorialogs-"))

try {
	// a sparse clone fetches only the two directories that are read
	execFileSync("git", [
		"clone",
		"--quiet",
		"--depth",
		"1",
		"--branch",
		tag,
		"--filter=blob:none",
		"--sparse",
		REPOSITORY,
		checkout,
	])
	execFileSync("git", [
		"-C",
		checkout,
		"sparse-checkout",
		"set",
		SOURCE_DIR,
		"docs/victorialogs",
	])

	// everything is read and asked before the first file is written. So a
	// sync that fails halfway leaves the old record whole, and never mixes
	// two releases.
	const keywords = collectKeywords(checkout)
	const upstream = await withAnswers(
		`${tag} upstream`,
		collectQueries(checkout),
	)
	const own = await withAnswers(`${tag} own tests`, collectOwnQueries())

	writeFileSync(join(UPSTREAM_DIR, "VERSION"), `${tag}\n`)
	writeFileSync(
		join(UPSTREAM_DIR, "keywords.json"),
		`${JSON.stringify(keywords, null, "\t")}\n`,
	)
	writeFileSync(join(UPSTREAM_DIR, "queries.json"), upstream)
	writeFileSync(join(ROOT, "test", "victorialogs-answers.json"), own)
} finally {
	rmSync(checkout, { recursive: true, force: true })
}

// withAnswers asks VictoriaLogs about each query and gives the file text
// that holds the queries with the answers
async function withAnswers(
	label: string,
	candidates: Candidate[],
): Promise<string> {
	const answers = await askAll(candidates.map((c) => c.query))
	const lines = candidates.map((candidate, index) =>
		JSON.stringify({ ...candidate, ...answers[index] }),
	)
	const valid = answers.filter((a) => a.valid).length

	console.log(
		`${label}: ${String(candidates.length)} queries, ${String(valid)} valid and ${String(candidates.length - valid)} invalid`,
	)

	// one query a line, so a change reads well in a diff
	return `[\n${lines.join(",\n")}\n]\n`
}

// collectKeywords reads the names the parser knows out of its source
function collectKeywords(root: string) {
	const read = (file: string) =>
		readFileSync(join(root, SOURCE_DIR, file), "utf8")
	const sources = readdirSync(join(root, SOURCE_DIR))
		.filter((file) => file.endsWith(".go") && !file.endsWith("_test.go"))
		.map(read)
	const parser = read("parser.go")

	return {
		// every word the parser compares the current token with
		keywords: keywordChecks(sources.join("\n")),
		filterFunctions: keywordChecks(
			functionBody(parser, "parseFilterGeneric"),
		).filter((word) => !NOT_FILTER_FUNCTIONS.includes(word)),
		// the option names are compared as plain strings
		queryOptions: [
			...functionBody(parser, "parseQueryOptions").matchAll(
				/^\s*case "(\w+)":/gm,
			),
		]
			.map((match) => match[1] ?? "")
			.sort(),
		pipes: mapKeys(
			read("pipe.go"),
			"pipeParsers = map[string]pipeParseFunc",
		).sort(),
		statsFunctions: mapKeys(
			read("pipe_stats.go"),
			"statsFuncParsers = map[string]",
		).sort(),
		runningStatsFunctions: mapKeys(
			read("pipe_running_stats.go"),
			"runningStatsFuncParsers = map[string]",
		).sort(),
		mathFunctions: mapKeys(
			read("pipe_math.go"),
			"mathFuncParsers = map[string]",
		).sort(),
		mathOperators: mapKeys(read("pipe_math.go"), "var mathBinaryOps = ")
			.filter((operator) => /^\w+$/.test(operator))
			.sort(),
	}
}

// keywordChecks lists the words the source passes to isKeyword
function keywordChecks(source: string): string[] {
	const words = new Set<string>()

	for (const call of source.matchAll(/\bisKeyword\(([^)]*)\)/g)) {
		for (const word of (call[1] ?? "").matchAll(/"(\w+)"/g)) {
			words.add(word[1] ?? "")
		}
	}

	return [...words].sort()
}

// collectQueries lists every query of VictoriaLogs worth checking, each
// one once
function collectQueries(root: string): Candidate[] {
	const { candidates, add } = candidateList()
	const testFiles = readdirSync(join(root, SOURCE_DIR))
		.filter((file) => file.endsWith("_test.go"))
		.sort()

	for (const file of testFiles) {
		const source = `${SOURCE_DIR}/${file}`
		const isPipe = PIPE_TEST_FILE.test(file)
		const tests = testFunctions(readFileSync(join(root, source), "utf8"))

		for (const [name, body] of tests) {
			// outside the parser and pipe tests, only a parse test is sure
			// to pass query text
			if (
				file !== "parser_test.go" &&
				!isPipe &&
				!name.startsWith("TestParse")
			) {
				continue
			}

			for (const [first = "", second] of stringArguments(body, TEST_CALLS)) {
				add(isPipe ? `* | ${first}` : first, source)

				// the success test pairs each query with its canonical form,
				// which is a query too
				if (name === "TestParseQuery_Success" && second !== undefined) {
					add(second, source)
				}
			}
		}
	}

	const docs = readFileSync(join(root, DOCS_FILE), "utf8")

	for (const block of docs.matchAll(/^```logsql\n([\s\S]*?)^```/gm)) {
		add((block[1] ?? "").trim(), DOCS_FILE)
	}

	return [...candidates.values()]
}

// collectOwnQueries lists the queries of this repository's tests, each
// one once
function collectOwnQueries(): Candidate[] {
	const { candidates, add } = candidateList()

	for (const file of caseFiles()) {
		for (const query of caseQueries(file.text)) {
			add(query, `test/cases/${file.name}`)
		}
	}

	for (const invalid of invalidCases()) {
		add(invalid.query, "test/invalid.txt")
	}

	return [...candidates.values()]
}

// candidateList gives an empty list of queries and a function that adds a
// query once, with the file it came from
function candidateList() {
	const candidates = new Map<string, Candidate>()
	const add = (query: string, source: string) => {
		if (query.length <= MAX_QUERY_LENGTH && !candidates.has(query)) {
			candidates.set(query, { query: query, source: source })
		}
	}

	return { candidates, add }
}
