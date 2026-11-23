// Prints the syntax tree of each query given as an argument:
//
//   pnpm parse '_time:5m error | stats count()'
//
// With VICTORIA_LOGS_URL set, it also asks that VictoriaLogs whether it
// accepts the query, so the two answers can be compared.

import { parser } from "../src/index.ts"
import { accepts } from "../src/test-helpers.ts"
import { askVictoriaLogs } from "./victorialogs.ts"

for (const query of process.argv.slice(2)) {
	const lines: string[] = []
	let depth = 0

	parser.parse(query).iterate({
		enter(node) {
			const text = node.node.firstChild
				? ""
				: ` ${JSON.stringify(query.slice(node.from, node.to))}`

			lines.push(`${"  ".repeat(depth)}${node.name}${text}`)
			depth++
		},
		leave() {
			depth--
		},
	})

	console.log(query)
	console.log(lines.join("\n"))
	console.log(`grammar: ${accepts(query) ? "valid" : "invalid"}`)

	if (process.env.VICTORIA_LOGS_URL) {
		const verdict = await askVictoriaLogs(query)

		console.log(
			`VictoriaLogs: ${verdict.valid ? "valid" : `invalid, ${verdict.reason ?? ""}`}`,
		)
	}

	console.log()
}
