import { describe, it } from "vitest"
import {
	filterFunctions,
	mathFunctions,
	pipeNames,
	runningStatsFunctions,
	statsFunctions,
} from "./keywords.ts"
import * as terms from "./parser.terms.ts"
import { upstreamKeywords } from "./test-helpers.ts"

// lezer-generator puts an underscore before a term whose name JavaScript
// reserves
const RENAMED = /^_(case|default|delete|eval|if|in|switch|with)$/

// in _stream:{app="nginx"}, VictoriaLogs treats _stream as a keyword.
// The grammar reads it as a normal field name instead, and lets a stream
// filter follow any field. That way _stream needs no rule of its own.
const NOT_A_KEYWORD_HERE = ["_stream"]

describe("keywords", () => {
	it.for([
		{ name: "pipeNames", list: pipeNames, key: "pipes" as const },
		{
			name: "filterFunctions",
			list: filterFunctions,
			key: "filterFunctions" as const,
		},
		{
			name: "statsFunctions",
			list: statsFunctions,
			key: "statsFunctions" as const,
		},
		{
			name: "runningStatsFunctions",
			list: runningStatsFunctions,
			key: "runningStatsFunctions" as const,
		},
		{
			name: "mathFunctions",
			list: mathFunctions,
			key: "mathFunctions" as const,
		},
	])("lists in $name what VictoriaLogs knows", ({ list, key }, { expect }) => {
		expect(list).toEqual(upstreamKeywords()[key])
	})

	it("gives the grammar the same keywords as VictoriaLogs", ({ expect }) => {
		const upstream = upstreamKeywords()
		const expected = new Set(
			[
				...upstream.keywords,
				...upstream.queryOptions,
				...upstream.pipes,
				...upstream.statsFunctions,
				...upstream.runningStatsFunctions,
				...upstream.mathFunctions,
				...upstream.mathOperators,
			].filter((keyword) => !NOT_A_KEYWORD_HERE.includes(keyword)),
		)
		// in the grammar a keyword's name is its text, and no other token
		// has an all-lowercase name
		const actual = Object.keys(terms)
			.filter((name) => /^[a-z0-9_]+$/.test(name))
			.map((name) => (RENAMED.test(name) ? name.slice(1) : name))

		expect([...actual].sort()).toEqual([...expected].sort())
	})
})
