// Helpers for the tests and for the scripts.

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parser } from "./parser.ts"

const ROOT = join(import.meta.dirname, "..")
const CASES_DIR = join(ROOT, "test", "cases")

// a query with the verdict VictoriaLogs gave on it
export interface RecordedQuery {
	query: string
	source: string
	valid: boolean
	// why VictoriaLogs refused the query
	reason?: string
}

export interface UpstreamKeywords {
	keywords: string[]
	filterFunctions: string[]
	queryOptions: string[]
	pipes: string[]
	statsFunctions: string[]
	runningStatsFunctions: string[]
	mathFunctions: string[]
	mathOperators: string[]
}

export interface CaseFile {
	name: string
	text: string
}

export interface InvalidCase {
	name: string
	query: string
}

// accepts tells whether the grammar reads the query without an error
export function accepts(query: string): boolean {
	let valid = true

	parser.parse(query).iterate({
		enter(node) {
			if (node.type.isError) {
				valid = false
			}

			return valid
		},
	})

	return valid
}

// leaves lists the tokens of a query in order. A token with a name
// shows as Name:text, and a punctuation mark as itself. A part the
// parser could not read shows as ⚠.
export function leaves(query: string): string[] {
	const found: string[] = []

	parser.parse(query).iterate({
		enter(node) {
			const text = query.slice(node.from, node.to)

			if (node.type.isError) {
				found.push("⚠")

				return false
			}

			if (!node.node.firstChild) {
				found.push(node.name === text ? text : `${node.name}:${text}`)
			}

			return true
		},
	})

	return found
}

// recordedQueries reads the queries of VictoriaLogs in
// upstream/queries.json and the queries of this repository's tests in
// test/victorialogs-answers.json. A query in both files is kept once.
export function recordedQueries(): RecordedQuery[] {
	const all = [
		...(readJSON("upstream/queries.json") as RecordedQuery[]),
		...(readJSON("test/victorialogs-answers.json") as RecordedQuery[]),
	]

	return [...new Map(all.map((r) => [r.query, r])).values()]
}

// upstreamKeywords reads upstream/keywords.json
export function upstreamKeywords(): UpstreamKeywords {
	return readJSON("upstream/keywords.json") as UpstreamKeywords
}

// caseFiles reads the files of parse cases in test/cases
export function caseFiles(): CaseFile[] {
	return readdirSync(CASES_DIR)
		.sort()
		.map((name) => ({
			name: name,
			text: readFileSync(join(CASES_DIR, name), "utf8"),
		}))
}

// caseQueries lists the queries of a file of parse cases. A case is a
// "# name" line, the query, a "==>" line and the expected tree.
export function caseQueries(text: string): string[] {
	return [...text.matchAll(/^#.*\n+([\s\S]*?)\n+==>/gm)].map(
		(match) => match[1] ?? "",
	)
}

// invalidCases reads test/invalid.txt, the queries that must not parse.
// A case is a "# name" line and the query after it.
export function invalidCases(): InvalidCase[] {
	const text = readFileSync(join(ROOT, "test", "invalid.txt"), "utf8")

	return [...text.matchAll(/^# (.*)\n\n(.*)$/gm)].map((match) => ({
		name: match[1] ?? "",
		query: match[2] ?? "",
	}))
}

function readJSON(path: string): unknown {
	return JSON.parse(readFileSync(join(ROOT, path), "utf8"))
}
