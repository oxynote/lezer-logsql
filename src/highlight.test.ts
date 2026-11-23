import { highlightTree, tagHighlighter, tags } from "@lezer/highlight"
import { describe, it } from "vitest"
import { parser } from "./parser.ts"

// names every tag the highlighting uses, so a test can read it back
const HIGHLIGHTER = tagHighlighter([
	{ tag: tags.lineComment, class: "comment" },
	{ tag: tags.string, class: "string" },
	{ tag: tags.number, class: "number" },
	{ tag: tags.propertyName, class: "field" },
	{ tag: tags.special(tags.variableName), class: "variable" },
	{ tag: tags.keyword, class: "pipe" },
	{ tag: tags.modifier, class: "keyword" },
	{ tag: tags.function(tags.variableName), class: "function" },
	{ tag: tags.logicOperator, class: "logic" },
	{ tag: tags.operatorKeyword, class: "operatorKeyword" },
	{ tag: tags.compareOperator, class: "compare" },
	{ tag: tags.arithmeticOperator, class: "arithmetic" },
	{ tag: tags.operator, class: "operator" },
	{ tag: tags.punctuation, class: "punctuation" },
	{ tag: tags.paren, class: "paren" },
	{ tag: tags.squareBracket, class: "bracket" },
	{ tag: tags.brace, class: "brace" },
])

describe("logsqlHighlighting", () => {
	it.for([
		{
			name: "styles fields, operators, strings and logic in a filter",
			input: '_time:[now-1h, now) level:!="info" and not {app=~"api"} # c',
			expected: [
				"field:_time",
				"punctuation::",
				"bracket:[",
				"number:now-1h",
				"punctuation:,",
				"number:now",
				"paren:)",
				"field:level",
				"punctuation::",
				"compare:!=",
				'string:"info"',
				"logic:and",
				"logic:not",
				"brace:{",
				"field:app",
				"compare:=~",
				'string:"api"',
				"brace:}",
				"comment:# c",
			],
		},
		{
			name: "styles pipe names, functions, keywords and variables",
			input:
				"!$env | stats by (_time:$__interval) count() if (a:>5) as n | limit $n;",
			expected: [
				"logic:!",
				"variable:$env",
				"operator:|",
				"pipe:stats",
				"keyword:by",
				"paren:(",
				"field:_time",
				"punctuation::",
				"variable:$__interval",
				"paren:)",
				"function:count",
				"paren:(",
				"paren:)",
				"keyword:if",
				"paren:(",
				"field:a",
				"punctuation::",
				"compare:>",
				"number:5",
				"paren:)",
				"keyword:as",
				"field:n",
				"operator:|",
				"pipe:limit",
				"variable:$n",
				"punctuation:;",
			],
		},
		{
			name: "styles the operators of a math expression",
			input: "* | math -a + b * c / d % e ^ f & g xor h as x",
			expected: [
				"operator:|",
				"pipe:math",
				"arithmetic:-",
				"field:a",
				"arithmetic:+",
				"field:b",
				"arithmetic:*",
				"field:c",
				"arithmetic:/",
				"field:d",
				"arithmetic:%",
				"field:e",
				"arithmetic:^",
				"field:f",
				"arithmetic:&",
				"field:g",
				"operatorKeyword:xor",
				"field:h",
				"keyword:as",
				"field:x",
			],
		},
	])("$name", ({ input, expected }, { expect }) => {
		const styled: string[] = []

		highlightTree(parser.parse(input), HIGHLIGHTER, (from, to, classes) => {
			styled.push(`${classes}:${input.slice(from, to)}`)
		})

		expect(styled).toEqual(expected)
	})
})
