// Reads what the sync needs out of Go source text: string literals, the
// string arguments of test calls, and the keys of maps.

const SIMPLE_ESCAPES: Record<string, string | undefined> = {
	a: "\x07",
	b: "\b",
	f: "\f",
	n: "\n",
	r: "\r",
	t: "\t",
	v: "\v",
	"\\": "\\",
	'"': '"',
	"'": "'",
}

// the digits a numeric escape takes after its first character
const NUMERIC_ESCAPES: Record<
	string,
	{ base: number; digits: number } | undefined
> = {
	x: { base: 16, digits: 2 },
	u: { base: 16, digits: 4 },
	U: { base: 16, digits: 8 },
}

export interface GoString {
	value: string
	// the offset right after the closing quote
	end: number
}

// readGoString reads the string literal that starts at from, or gives null
// when no literal starts there
export function readGoString(source: string, from: number): GoString | null {
	const quote = source[from]
	if (quote === "`") {
		const close = source.indexOf("`", from + 1)

		return close < 0
			? null
			: {
					value: source.slice(from + 1, close).replaceAll("\r", ""),
					end: close + 1,
				}
	}

	if (quote !== '"') {
		return null
	}

	const bytes: number[] = []
	let at = from + 1

	while (at < source.length && source[at] !== '"') {
		if (source[at] !== "\\") {
			const char = String.fromCodePoint(source.codePointAt(at) ?? 0)

			bytes.push(...Buffer.from(char))
			at += char.length

			continue
		}

		const escape = source[at + 1] ?? ""
		const simple = SIMPLE_ESCAPES[escape]
		const numeric = /[0-7]/.test(escape)
			? { base: 8, digits: 3, from: at + 1 }
			: NUMERIC_ESCAPES[escape] && { ...NUMERIC_ESCAPES[escape], from: at + 2 }

		if (simple !== undefined) {
			bytes.push(...Buffer.from(simple))
			at += 2
		} else if (numeric) {
			const code = parseInt(
				source.slice(numeric.from, numeric.from + numeric.digits),
				numeric.base,
			)

			// \x and octal escapes write one byte, \u and \U a code point
			bytes.push(
				...(numeric.digits <= 3
					? [code]
					: Buffer.from(String.fromCodePoint(code))),
			)
			at = numeric.from + numeric.digits
		} else {
			return null
		}
	}

	return at < source.length
		? { value: Buffer.from(bytes).toString("utf8"), end: at + 1 }
		: null
}

// testFunctions lists the body of every Test function by its name
export function testFunctions(source: string): Map<string, string> {
	const functions = new Map<string, string>()

	for (const match of source.matchAll(/^func (Test\w+)\(.*\n([\s\S]*?)^}/gm)) {
		functions.set(match[1] ?? "", match[2] ?? "")
	}

	return functions
}

// functionBody gives the body of the named top-level function
export function functionBody(source: string, name: string): string {
	const body = new RegExp(`^func ${name}\\(.*\\n([\\s\\S]*?)^}`, "m").exec(
		source,
	)
	if (!body?.[1]) {
		throw new Error(`cannot find func ${name}`)
	}

	return body[1]
}

// stringArguments lists the leading string literals of every call to
// one of the named functions, one list per call. A call that starts with
// anything but a literal is skipped, and a leading t argument is ignored.
export function stringArguments(body: string, callees: string[]): string[][] {
	const calls: string[][] = []
	const start = new RegExp(`^\\s*(?:${callees.join("|")})\\((?:t,\\s*)?`, "gm")

	for (const match of body.matchAll(start)) {
		const strings: string[] = []
		let at = match.index + match[0].length

		for (;;) {
			const literal = readGoString(body, at)
			if (!literal) {
				break
			}

			strings.push(literal.value)

			const comma = /^,\s*/.exec(body.slice(literal.end))
			if (!comma) {
				break
			}

			at = literal.end + comma[0].length
		}

		if (strings.length) {
			calls.push(strings)
		}
	}

	return calls
}

// mapKeys lists the string keys of the map literal that follows the
// marker text
export function mapKeys(source: string, marker: string): string[] {
	const from = source.indexOf(marker)
	if (from < 0) {
		throw new Error(`cannot find ${JSON.stringify(marker)}`)
	}

	const open = source.indexOf("{", from + marker.length)
	const keys: string[] = []
	let depth = 0

	for (const line of source.slice(open).split("\n")) {
		const key = /^\s*"([^"]+)":/.exec(line)
		if (depth === 1 && key?.[1]) {
			keys.push(key[1])
		}

		depth += (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length
		if (depth <= 0) {
			break
		}
	}

	return keys
}
