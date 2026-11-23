import { describe, it } from "vitest"
import {
	functionBody,
	mapKeys,
	readGoString,
	stringArguments,
	testFunctions,
} from "./go-source.ts"

const TEST_SOURCE = [
	"package logstorage",
	"",
	"func TestParseFirst(t *testing.T) {",
	"\tf := func(s string) {",
	"\t\tt.Helper()",
	"\t}",
	'\tf("foo")',
	"\tf(`a | b`, `a | b`)",
	"\tf(query)",
	'\texpectParsePipeSuccess(t, "limit 5")',
	"}",
	"",
	"func helper() {",
	'\tf("not a test")',
	"}",
	"",
	"func TestSecond(t *testing.T) {",
	'\tf("bar", 5)',
	"}",
	"",
].join("\n")

const MAP_SOURCE = [
	"func initParsers() {",
	"\tparsers = map[string]parseFunc{",
	'\t\t"limit": parseLimit,',
	'\t\t"sort":  parseSort,',
	"\t}",
	"}",
	"",
	"var ops = map[string]op{",
	'\t"+": {',
	"\t\tpriority: 3,",
	"\t},",
	'\t"xor": {',
	"\t\tpriority: 5,",
	"\t},",
	"}",
	"",
].join("\n")

describe("readGoString", () => {
	it.for([
		{
			name: "reads a raw string as it is written",
			input: '`a\\n"b"`',
			expected: { value: 'a\\n"b"', end: 8 },
		},
		{
			name: "drops carriage returns from a raw string",
			input: "`a\r\nb`",
			expected: { value: "a\nb", end: 6 },
		},
		{
			name: "reads the one-character escapes",
			input: String.raw`"\a\b\f\n\r\t\v\\\"\'"`,
			expected: { value: "\x07\b\f\n\r\t\v\\\"'", end: 22 },
		},
		{
			name: "reads hex and octal escapes as bytes",
			input: String.raw`"\xc3\xa9\101"`,
			expected: { value: "éA", end: 14 },
		},
		{
			name: "reads unicode escapes as code points",
			input: String.raw`"\u00e9\U0001F600"`,
			expected: { value: "é😀", end: 18 },
		},
		{
			name: "reads characters outside ASCII",
			input: '"тест😀" + x',
			expected: { value: "тест😀", end: 8 },
		},
		{
			name: "gives null for an escape Go does not know",
			input: String.raw`"\q"`,
			expected: null,
		},
		{
			name: "gives null for an interpreted string that is not closed",
			input: '"abc',
			expected: null,
		},
		{
			name: "gives null for a raw string that is not closed",
			input: "`abc",
			expected: null,
		},
		{
			name: "gives null where no string starts",
			input: "query",
			expected: null,
		},
	])("$name", ({ input, expected }, { expect }) => {
		expect(readGoString(input, 0)).toEqual(expected)
	})
})

describe("testFunctions", () => {
	it("lists the body of every Test function by its name", ({ expect }) => {
		const functions = testFunctions(TEST_SOURCE)

		expect.soft([...functions.keys()]).toEqual(["TestParseFirst", "TestSecond"])
		expect.soft(functions.get("TestSecond")).toBe('\tf("bar", 5)\n')
	})
})

describe("functionBody", () => {
	it("gives the body of the named function", ({ expect }) => {
		expect(functionBody(TEST_SOURCE, "helper")).toBe('\tf("not a test")\n')
	})

	it("throws for a function the source does not have", ({ expect }) => {
		expect(() => functionBody(TEST_SOURCE, "missing")).toThrow(
			"cannot find func missing",
		)
	})
})

describe("stringArguments", () => {
	it("lists the leading strings of each call, and skips a call that starts with none", ({
		expect,
	}) => {
		const body = testFunctions(TEST_SOURCE).get("TestParseFirst") ?? ""

		expect(stringArguments(body, ["f", "expectParse\\w+"])).toEqual([
			["foo"],
			["a | b", "a | b"],
			["limit 5"],
		])
	})

	it("stops at the first argument that is no string", ({ expect }) => {
		expect(stringArguments('\tf("bar", 5, "baz")', ["f"])).toEqual([["bar"]])
	})
})

describe("mapKeys", () => {
	it.for([
		{
			name: "lists the keys of a map inside a function",
			marker: "parsers = map[string]parseFunc",
			expected: ["limit", "sort"],
		},
		{
			name: "skips the keys of nested literals",
			marker: "var ops = ",
			expected: ["+", "xor"],
		},
	])("$name", ({ marker, expected }, { expect }) => {
		expect(mapKeys(MAP_SOURCE, marker)).toEqual(expected)
	})

	it("throws when the marker is not in the source", ({ expect }) => {
		expect(() => mapKeys(MAP_SOURCE, "missing")).toThrow(
			'cannot find "missing"',
		)
	})
})
