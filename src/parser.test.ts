import { fileTests } from "@lezer/generator/test"
import { describe, it } from "vitest"
import { parser } from "./parser.ts"
import {
	accepts,
	caseFiles,
	caseQueries,
	invalidCases,
	recordedQueries,
} from "./test-helpers.ts"

// the head of test/accepted-invalid.txt
const ACCEPTED_INVALID_HEAD = [
	"# Queries that VictoriaLogs refuses and this grammar accepts, each with",
	"# the reason VictoriaLogs gives. The grammar checks the shape of a query.",
	"# It does not check values, such as the range of a number, a time or a",
	"# pattern, nor names that clash. A variable ($name) or a duration",
	"# placeholder ($__name) is accepted where VictoriaLogs wants a number or",
	"# a duration, since it stands for one.",
	"#",
	"# A test rewrites this file. Read its diff after a change to the grammar.",
]

// the cases whose queries VictoriaLogs may refuse
const VARIABLE_CASES = "variables.txt"

describe("parser", () => {
	describe.for(caseFiles())("$name", ({ name, text }) => {
		for (const testCase of fileTests(text, name)) {
			it(`parses ${testCase.name}`, ({ expect }) => {
				expect(() => {
					testCase.run(parser)
				}).not.toThrow()
			})
		}
	})

	it.for(invalidCases())("rejects $name", ({ query }, { expect }) => {
		expect(accepts(query)).toBe(false)
	})

	it("accepts every query that VictoriaLogs accepts", ({ expect }) => {
		const rejected = recordedQueries()
			.filter((recorded) => recorded.valid && !accepts(recorded.query))
			.map((recorded) => recorded.query)

		expect(rejected).toEqual([])
	})

	it("rejects the queries that VictoriaLogs rejects, apart from the listed ones", async ({
		expect,
	}) => {
		const accepted = recordedQueries()
			.filter((recorded) => !recorded.valid && accepts(recorded.query))
			.map(
				(recorded) =>
					`${JSON.stringify(recorded.query)}\n\t${recorded.reason ?? ""}`,
			)
			.sort()

		await expect(
			`${[...ACCEPTED_INVALID_HEAD, "", ...accepted].join("\n")}\n`,
		).toMatchFileSnapshot("../test/accepted-invalid.txt")
	})

	it("has the verdict of VictoriaLogs on every case", ({ expect }) => {
		const recorded = new Map(recordedQueries().map((r) => [r.query, r.valid]))
		const cases = [
			...caseFiles().flatMap((file) =>
				caseQueries(file.text).map((query) => ({
					query: query,
					// a variable stands for a value that is filled in before the
					// query runs. VictoriaLogs itself reads $name as a word, so
					// it refuses one where it wants a number.
					valid: file.name === VARIABLE_CASES ? undefined : true,
				})),
			),
			...invalidCases().map((invalid) => ({
				query: invalid.query,
				valid: false,
			})),
		]
		// a case that is missing here was added without running the sync
		const unrecorded = cases
			.filter((c) => !recorded.has(c.query))
			.map((c) => c.query)
		const disagreeing = cases
			.filter((c) => c.valid !== undefined && recorded.get(c.query) !== c.valid)
			.map((c) => c.query)

		expect.soft(unrecorded).toEqual([])
		expect.soft(disagreeing).toEqual([])
	})

	// an editor parses the query after every key press, so the tokenizer
	// must not throw on a query that stops anywhere
	it("parses a query that is cut off at any character", ({ expect }) => {
		const queries = caseFiles().flatMap((file) => caseQueries(file.text))
		const failed: string[] = []

		for (const query of queries) {
			for (let end = 0; end <= query.length; end++) {
				const part = query.slice(0, end)

				try {
					parser.parse(part)
				} catch {
					failed.push(part)
				}
			}
		}

		expect(failed).toEqual([])
	})
})
