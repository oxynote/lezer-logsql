import { ExternalTokenizer, type InputStream, type Stack } from "@lezer/lr"
import * as terms from "./parser.terms.ts"

// The lexer of VictoriaLogs splits a query into small tokens, and its
// parser joins them again by what it expects next. So the same text is
// one word in one place and three tokens in another, and a keyword is a
// keyword only where the parser looks for it. This tokenizer follows the
// same rules by asking the parser what it can take at each position.

// character codes, because input.next and input.peek give numbers
const NEWLINE = 10
const EXCLAMATION = 33
const DOUBLE_QUOTE = 34
const HASH = 35
const DOLLAR = 36
const SINGLE_QUOTE = 39
const PAREN_OPEN = 40
const PAREN_CLOSE = 41
const STAR = 42
const PLUS = 43
const COMMA = 44
const MINUS = 45
const DOT = 46
const SLASH = 47
const COLON = 58
const SEMICOLON = 59
const BRACKET_OPEN = 91
const BACKSLASH = 92
const BACKTICK = 96
const PIPE = 124

// the characters that join the parts of an unquoted word, as in
// foo-bar.example.com:8080
const GLUE = [PLUS, MINUS, SLASH, COLON, DOT, DOLLAR]

// the characters a word may not start with right after another word
const DENIED_AFTER_WORD = [SLASH, DOT, DOLLAR]

// the characters a filter may follow without white space
const ALLOWED_BEFORE_FILTER = [PIPE, COLON, PAREN_OPEN, EXCLAMATION, MINUS]

// the words a ( may follow without white space
const LOGIC_WORD_BEFORE = /(?:^|[^\p{L}\p{Nd}_])(?:not|and|or)$/iu

// how far back readBefore reads, which is the longest of those words and
// the character before it. That character may take two code units, as
// 𝒜 does, and the test needs all of it.
const LOOK_BEHIND = 5

const LETTER_OR_DIGIT = /[\p{L}\p{Nd}]/u
const SPACE = /\s/

// the start of a number, or inf
const NUMBER_PREFIX = /^[+-]?(?:inf$|\.?[0-9])/i

// a word that is only a variable. The variable is replaced before the
// query runs, so it can stand for a word, a number or a duration.
const VARIABLE = /^\$[a-z][a-z0-9_]*$/

// a word that is only a duration placeholder, such as $__interval. It is
// replaced before the query runs too, and always by a duration.
const DURATION_PLACEHOLDER = /^\$__[a-zA-Z_]+$/

// lezer-generator puts an underscore before a term whose name JavaScript
// reserves. These are the keywords it renames.
const RENAMED_KEYWORDS = [
	"case",
	"default",
	"delete",
	"eval",
	"if",
	"in",
	"switch",
	"with",
]

// every keyword by its text. In the grammar a keyword's name is its text,
// and every other token name holds an uppercase letter.
const KEYWORDS = new Map(
	Object.entries(terms)
		.filter(([name]) => /^[a-z0-9_]+$/.test(name))
		.map(([name, term]) => [
			name.startsWith("_") && RENAMED_KEYWORDS.includes(name.slice(1))
				? name.slice(1)
				: name,
			term,
		]),
)

// the filter functions that are plain words unless a ( follows them
const PAREN_FUNCTIONS = new Set([
	terms.eq_field,
	terms.exact,
	terms.i,
	terms.ipv4_range,
	terms.ipv6_range,
	terms.json_array_contains_any,
	terms.le_field,
	terms.len_range,
	terms.lt_field,
	terms.pattern_match,
	terms.pattern_match_full,
	terms.pattern_match_prefix,
	terms.pattern_match_suffix,
	terms.re,
	terms.seq,
	terms.string_range,
	terms.value_type,
])

// the fields with their own filter syntax, which are plain words unless
// a colon follows them
const COLON_FIELDS = new Set([terms._time, terms._stream_id])

// the kinds of unquoted word. They differ in where the word stops. The
// grammar expects one kind at a time, and the first kind it can take
// wins. A kind without a number token reads a number as a word.
const WORD_KINDS = [
	{ stops: [COLON], word: terms.bareWord, number: -1 },
	{ stops: [], word: terms.bareValue, number: terms.bareNumber },
	{
		stops: [PLUS, MINUS, SLASH],
		word: terms.mathWord,
		number: terms.mathNumber,
	},
]

// the characters that are an operator where the parser expects one, and
// part of a word everywhere else
const OPERATORS = new Map([
	[COLON, terms.opColon],
	[MINUS, terms.opMinus],
	[PLUS, terms.opPlus],
	[SLASH, terms.opSlash],
])

export const contextual = new ExternalTokenizer(
	(input, stack) => {
		const code = input.next
		if (code < 0 || isSpace(code) || code === HASH) {
			return
		}

		if (
			stack.canShift(terms.filterPipeStart) &&
			startsFilterPipe(input, stack)
		) {
			input.acceptToken(terms.filterPipeStart)

			return
		}

		if (stack.canShift(terms.filterStart) && startsFilter(input, stack)) {
			input.acceptToken(terms.filterStart)

			return
		}

		if (stack.canShift(terms.noSpace)) {
			// with white space before the value, no token fits and the
			// parser reports the error
			if (!isSpace(input.peek(-1))) {
				input.acceptToken(terms.noSpace)
			}

			return
		}

		if (code === PAREN_OPEN) {
			if (stack.canShift(terms.subqueryStart) && !startsValueList(input)) {
				input.acceptToken(terms.subqueryStart)
			}

			return
		}

		if (code === STAR) {
			readStar(input, stack)

			return
		}

		const operator = OPERATORS.get(code)
		if (operator !== undefined && stack.canShift(operator)) {
			input.acceptToken(operator, 1)

			return
		}

		// after an error the parser moves on one character at a time, so
		// it can ask for a token in the middle of a word. No word starts
		// there.
		if (wordCharLength(input, 0) > 0 && wordCharLength(input, -1) > 0) {
			return
		}

		if (!readKeyword(input, stack)) {
			readWord(input, stack)
		}
	},
	{ contextual: true },
)

// readStar tells the star that belongs to a word from the lone one. A
// star right after a word makes a prefix (err*). A star right before one
// starts a substring (*err*). The lone star is left to the plain tokens.
function readStar(input: InputStream, stack: Stack) {
	const before = input.peek(-1)

	if (stack.canShift(terms.prefixStar) && before >= 0 && !isSpace(before)) {
		input.acceptToken(terms.prefixStar, 1)

		return
	}

	const after = input.peek(1)

	if (
		stack.canShift(terms.substringStar) &&
		after >= 0 &&
		!isSpace(after) &&
		!endsQueryPart(after) &&
		after !== COLON
	) {
		input.acceptToken(terms.substringStar, 1)
	}
}

// readKeyword reads a keyword when the word at the cursor is one and the
// parser can take it there. VictoriaLogs matches a keyword against one
// plain word, so or-else starts with the keyword or.
function readKeyword(input: InputStream, stack: Stack): boolean {
	const end = plainWordEnd(input, 0)
	if (end === 0) {
		return false
	}

	const keyword = KEYWORDS.get(read(input, 0, end).toLowerCase())
	if (keyword === undefined || !stack.canShift(keyword)) {
		return false
	}

	const next = input.peek(skipSpace(input, end))
	if (PAREN_FUNCTIONS.has(keyword) && next !== PAREN_OPEN) {
		return false
	}

	// range takes ( or [
	if (keyword === terms.range && next !== PAREN_OPEN && next !== BRACKET_OPEN) {
		return false
	}

	if (COLON_FIELDS.has(keyword) && next !== COLON) {
		return false
	}

	input.acceptToken(keyword, end)

	return true
}

// readWord reads an unquoted word of the kind the parser expects
function readWord(input: InputStream, stack: Stack) {
	// a word may not start with one of these right after another word, as
	// in "limit.10"
	if (DENIED_AFTER_WORD.includes(input.next) && wordCharLength(input, -1) > 0) {
		return
	}

	for (const kind of WORD_KINDS) {
		const takesWord = stack.canShift(kind.word)
		const takesNumber = kind.number >= 0 && stack.canShift(kind.number)
		if (!takesWord && !takesNumber) {
			continue
		}

		const end = wordEnd(input, 0, kind.stops)
		if (end === 0) {
			return
		}

		const text = read(input, 0, end)

		if (
			DURATION_PLACEHOLDER.test(text) &&
			stack.canShift(terms.DynamicDurationPlaceholder)
		) {
			input.acceptToken(terms.DynamicDurationPlaceholder, end)
		} else if (VARIABLE.test(text) && stack.canShift(terms.VariableReference)) {
			input.acceptToken(terms.VariableReference, end)
		} else if (takesNumber && NUMBER_PREFIX.test(text)) {
			input.acceptToken(kind.number, end)
		} else if (takesWord) {
			input.acceptToken(kind.word, end)
		}

		return
	}
}

// startsFilterPipe tells whether the pipe at the cursor is a filter
// written without its keyword, as in "| level:error" (isLikelyFilterPipe).
// A pipe name or a stats function comes first, so "| count:5" is a stats
// pipe.
function startsFilterPipe(input: InputStream, stack: Stack): boolean {
	const code = input.next
	if (isQuote(code)) {
		return true
	}

	const end = plainWordEnd(input, 0)
	if (end === 0) {
		// a ( opens the by clause of a stats pipe
		return !endsQueryPart(code) && code !== PAREN_OPEN
	}

	const word = read(input, 0, end).toLowerCase()
	const keyword = KEYWORDS.get(word)

	if (keyword !== undefined && stack.canShift(keyword)) {
		return false
	}

	if (word === "not") {
		return true
	}

	return input.peek(skipSpace(input, wordEnd(input, 0, [COLON]))) === COLON
}

// startsFilter tells whether a filter may start at the cursor.
//
// The parser asks this before the first filter and after every filter,
// since another one may follow. So a token that goes on with what came
// before starts no filter: the end of the query part, a keyword the
// parser can take here (such as or), the colon after a field name and
// the star of a prefix.
//
// A filter also needs white space before it, unless it follows one of
// | : ( ! - or opens with a ( after not, and or or. So "level=error" is
// an error, and not the word level followed by an exact match.
function startsFilter(input: InputStream, stack: Stack): boolean {
	const code = input.next
	const before = input.peek(-1)

	if (endsQueryPart(code)) {
		return false
	}

	if (code === COLON && stack.canShift(terms.opColon)) {
		return false
	}

	if (code === STAR && stack.canShift(terms.prefixStar) && !isSpace(before)) {
		return false
	}

	const keyword = KEYWORDS.get(
		read(input, 0, plainWordEnd(input, 0)).toLowerCase(),
	)
	if (keyword !== undefined && stack.canShift(keyword)) {
		return false
	}

	return (
		before < 0 ||
		isSpace(before) ||
		ALLOWED_BEFORE_FILTER.includes(before) ||
		(code === PAREN_OPEN && LOGIC_WORD_BEFORE.test(readBefore(input)))
	)
}

// startsValueList tells whether the ( at the cursor opens a list of
// values, as in in(a, b), and not a query, as in in(_time:1d | fields x).
// VictoriaLogs reads the list first and falls back to the query, so this
// reads ahead as far as a list of values would go.
function startsValueList(input: InputStream): boolean {
	let at = skipSpace(input, 1)

	while (input.peek(at) !== PAREN_CLOSE) {
		const code = input.peek(at)
		const end =
			code === STAR
				? at + 1
				: isQuote(code)
					? stringEnd(input, at)
					: wordEnd(input, at, [])

		if (end <= at) {
			return false
		}

		at = skipSpace(input, end)

		if (input.peek(at) === COMMA) {
			at = skipSpace(input, at + 1)
		} else if (input.peek(at) !== PAREN_CLOSE) {
			return false
		}
	}

	return true
}

// wordEnd finds where the unquoted word at from ends: after its letters,
// digits, underscores and glue characters, and before the first stop
// character. It gives from when no word starts there. A lone glue
// character is no word.
function wordEnd(input: InputStream, from: number, stops: number[]): number {
	let end = from

	for (;;) {
		const length = wordCharLength(input, end)
		const code = input.peek(end)

		if (length > 0) {
			end += length
		} else if (GLUE.includes(code) && !stops.includes(code)) {
			end++
		} else {
			break
		}
	}

	return end === from + 1 && wordCharLength(input, from) === 0 ? from : end
}

// plainWordEnd finds where the letters, digits and underscores at from
// end, which is one token of VictoriaLogs' lexer
function plainWordEnd(input: InputStream, from: number): number {
	let end = from

	for (;;) {
		const length = wordCharLength(input, end)
		if (length === 0) {
			return end
		}

		end += length
	}
}

// wordCharLength gives how many code units the letter, digit or
// underscore at offset takes. It gives 0 for any other character
// (isTokenRune).
function wordCharLength(input: InputStream, offset: number): number {
	const code = input.peek(offset)

	if (code < 0x80) {
		return (code >= 48 && code <= 57) ||
			(code >= 65 && code <= 90) ||
			(code >= 97 && code <= 122) ||
			code === 95
			? 1
			: 0
	}

	const low = input.peek(offset + 1)
	const isPair =
		code >= 0xd800 && code <= 0xdbff && low >= 0xdc00 && low <= 0xdfff
	const char = isPair
		? String.fromCharCode(code, low)
		: String.fromCharCode(code)

	return LETTER_OR_DIGIT.test(char) ? char.length : 0
}

// stringEnd finds where the quoted token at from ends. It gives -1 when
// the quote is never closed.
function stringEnd(input: InputStream, from: number): number {
	const quote = input.peek(from)

	for (let at = from + 1; ; at++) {
		const code = input.peek(at)
		if (code < 0 || (code === NEWLINE && quote === DOUBLE_QUOTE)) {
			return -1
		}

		if (code === quote) {
			return at + 1
		}

		if (code === BACKSLASH && quote !== BACKTICK) {
			at++
		}
	}
}

// skipSpace gives the offset after the white space and comments at from
function skipSpace(input: InputStream, from: number): number {
	let at = from

	for (;;) {
		const code = input.peek(at)

		if (code === HASH) {
			while (input.peek(at) >= 0 && input.peek(at) !== NEWLINE) {
				at++
			}
		} else if (code >= 0 && isSpace(code)) {
			at++
		} else {
			return at
		}
	}
}

// readBefore gives the few characters before the cursor
function readBefore(input: InputStream): string {
	let text = ""

	for (let at = -LOOK_BEHIND; at < 0; at++) {
		const code = input.peek(at)

		text += code < 0 ? "" : String.fromCharCode(code)
	}

	return text
}

function read(input: InputStream, from: number, to: number): string {
	let text = ""

	for (let at = from; at < to; at++) {
		text += String.fromCharCode(input.peek(at))
	}

	return text
}

function isSpace(code: number): boolean {
	return SPACE.test(String.fromCharCode(code))
}

function isQuote(code: number): boolean {
	return code === DOUBLE_QUOTE || code === SINGLE_QUOTE || code === BACKTICK
}

// endsQueryPart tells whether the character ends a filter or a pipe
// (queryPartTrailers)
function endsQueryPart(code: number): boolean {
	return code < 0 || code === PIPE || code === PAREN_CLOSE || code === SEMICOLON
}
