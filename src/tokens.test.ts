import { describe, it } from "vitest"
import { leaves, recordedQueries } from "./test-helpers.ts"

describe("contextual", () => {
	// every query here is also a case under test/, so the record holds
	// the verdict of VictoriaLogs on it
	it.for([
		{
			name: "reads a host name with a port as one word",
			input: "host:web-1.example.com:8080",
			expected: ["FieldName:host", ":", "Phrase:web-1.example.com:8080"],
		},
		{
			name: "ends the first word of a filter at its colon",
			input: "a:b:c",
			expected: ["FieldName:a", ":", "Phrase:b:c"],
		},
		{
			name: "keeps every glue character inside a word",
			input: "foo-bar.baz/qux$x+1",
			expected: ["Phrase:foo-bar.baz/qux$x+1"],
		},
		{
			name: "reads letters outside the basic plane",
			input: "𝒜𝒷:𝒸",
			expected: ["FieldName:𝒜𝒷", ":", "Phrase:𝒸"],
		},
		{
			name: "reads keywords in any case",
			input: "Error AND NOT Timeout OR _TIME:5m",
			expected: [
				"Phrase:Error",
				"LogicOperator:AND",
				"LogicOperator:NOT",
				"Phrase:Timeout",
				"LogicOperator:OR",
				"FieldName:_TIME",
				":",
				"Time:5m",
			],
		},
		{
			name: "reads a keyword as a word where the parser expects none",
			input: "* | fields limit, by, as | sort by (offset, desc)",
			expected: [
				"*",
				"|",
				"PipeName:fields",
				"FieldName:limit",
				",",
				"FieldName:by",
				",",
				"FieldName:as",
				"|",
				"PipeName:sort",
				"Keyword:by",
				"(",
				"FieldName:offset",
				",",
				"FieldName:desc",
				")",
			],
		},
		{
			name: "reads a function name as a word without its parentheses",
			input: "exact i range re seq",
			expected: [
				"Phrase:exact",
				"Phrase:i",
				"Phrase:range",
				"Phrase:re",
				"Phrase:seq",
			],
		},
		{
			name: "reads a signed, a dotted and an infinite number",
			input: "a:>-1.5 b:>.5 c:<inf d:>+inf",
			expected: [
				"FieldName:a",
				":",
				">",
				"Number:-1.5",
				"FieldName:b",
				":",
				">",
				"Number:.5",
				"FieldName:c",
				":",
				"<",
				"Number:inf",
				"FieldName:d",
				":",
				">",
				"Number:+inf",
			],
		},
		{
			name: "reads a word after a comparison as a value",
			input: "level:>info",
			expected: ["FieldName:level", ":", ">", "Value:info"],
		},
		{
			name: "reads a minus after white space as a not",
			input: "a -b",
			expected: ["Phrase:a", "-", "Phrase:b"],
		},
		{
			name: "reads a minus inside a word as part of it",
			input: "a-b",
			expected: ["Phrase:a-b"],
		},
		{
			name: "ends a math word at an operator",
			input: "* | math a-b/c as x",
			expected: [
				"*",
				"|",
				"PipeName:math",
				"FieldName:a",
				"-",
				"FieldName:b",
				"/",
				"FieldName:c",
				"Keyword:as",
				"FieldName:x",
			],
		},
		{
			name: "takes the star that touches a word as its prefix",
			input: "err*",
			expected: ["Prefix:err*"],
		},
		{
			name: "takes the star apart from a word as a filter of its own",
			input: "err *",
			expected: ["Phrase:err", "*"],
		},
		{
			name: "reads a list of values inside in",
			input: 'x:in("a,b", c)',
			expected: [
				"FieldName:x",
				":",
				"FunctionName:in",
				"(",
				'String:"a,b"',
				",",
				"Value:c",
				")",
			],
		},
		{
			name: "reads a query inside in",
			input: "user:in(error | fields user)",
			expected: [
				"FieldName:user",
				":",
				"FunctionName:in",
				"(",
				"Phrase:error",
				"|",
				"PipeName:fields",
				"FieldName:user",
				")",
			],
		},
		{
			name: "starts a filter pipe at a field name, a quote and a not",
			input: '* | level:error | "timeout" | not debug',
			expected: [
				"*",
				"|",
				"FieldName:level",
				":",
				"Phrase:error",
				"|",
				'String:"timeout"',
				"|",
				"LogicOperator:not",
				"Phrase:debug",
			],
		},
		{
			name: "skips a comment up to the end of its line",
			input: "_time:1h # the last hour\nerror",
			expected: [
				"FieldName:_time",
				":",
				"Time:1h",
				"LineComment:# the last hour",
				"Phrase:error",
			],
		},
		{
			name: "refuses an operator apart from its value",
			input: "level = error",
			expected: ["Phrase:level", "=", "⚠", "Phrase:error"],
		},
		{
			name: "refuses a pipe name glued to its argument",
			input: "* | limit.10",
			expected: ["*", "|", "PipeName:limit", "⚠", "Number:10"],
		},
	])("$name", ({ input, expected }, { expect }) => {
		const recorded = recordedQueries().find((r) => r.query === input)

		expect.soft(leaves(input)).toEqual(expected)
		expect.soft(recorded?.valid).toBe(!expected.includes("⚠"))
	})

	// a variable or a duration placeholder is filled in before the query
	// runs, so these are not checked against VictoriaLogs
	it.for([
		{
			name: "reads a word that is only a variable as one",
			input: "env:$env status:>$min",
			expected: [
				"FieldName:env",
				":",
				"VariableReference:$env",
				"FieldName:status",
				":",
				">",
				"VariableReference:$min",
			],
		},
		{
			name: "reads a variable where a number goes",
			input: "* | limit $n",
			expected: ["*", "|", "PipeName:limit", "VariableReference:$n"],
		},
		{
			name: "reads a variable where a duration goes",
			input: "_time:$window offset $shift",
			expected: [
				"FieldName:_time",
				":",
				"VariableReference:$window",
				"Keyword:offset",
				"VariableReference:$shift",
			],
		},
		{
			name: "reads a variable inside a longer word as part of the word",
			input: "host:web-$zone.example.com",
			expected: ["FieldName:host", ":", "Phrase:web-$zone.example.com"],
		},
		{
			name: "reads a dollar before a digit as a word",
			input: "$1",
			expected: ["Phrase:$1"],
		},
		{
			name: "reads a dollar before an uppercase letter as a word",
			input: "$Env",
			expected: ["Phrase:$Env"],
		},
		{
			name: "reads a duration placeholder where a time and an offset go",
			input: "_time:>$__interval offset $__range",
			expected: [
				"FieldName:_time",
				":",
				">",
				"DynamicDurationPlaceholder:$__interval",
				"Keyword:offset",
				"DynamicDurationPlaceholder:$__range",
			],
		},
		{
			name: "reads a duration placeholder as the size of a bucket",
			input: "* | stats by (_time:$__interval) count()",
			expected: [
				"*",
				"|",
				"PipeName:stats",
				"Keyword:by",
				"(",
				"FieldName:_time",
				":",
				"DynamicDurationPlaceholder:$__interval",
				")",
				"FunctionName:count",
				"(",
				")",
			],
		},
		{
			name: "reads a duration placeholder as a word where no duration goes",
			input: "level:$__interval",
			expected: ["FieldName:level", ":", "Phrase:$__interval"],
		},
	])("$name", ({ input, expected }, { expect }) => {
		expect(leaves(input)).toEqual(expected)
	})
})
