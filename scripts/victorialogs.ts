// Asks a running VictoriaLogs whether it accepts a query. The server is
// the last word on what valid LogsQL is.

// how many queries are sent at a time
const CONCURRENCY = 8

// the start of the answer to a query that does not parse
const PARSE_ERROR = "cannot parse `query` arg"

// the answer to an empty query, which never reaches the parser
const EMPTY_QUERY = "`query` arg cannot be empty"

// the start of the answer to a query that parsed and then failed to run
const EXECUTION_ERROR = "cannot execute query"

export const VICTORIA_LOGS_URL =
	process.env.VICTORIA_LOGS_URL ?? "http://127.0.0.1:9428"

export interface Verdict {
	valid: boolean
	// why VictoriaLogs refused the query
	reason?: string
}

// askVictoriaLogs runs the query with a limit of one log and tells
// whether it parsed. A query that parsed and then failed to run counts
// as valid. Any other answer throws, because then the verdict is unknown.
export async function askVictoriaLogs(query: string): Promise<Verdict> {
	const response = await fetch(`${VICTORIA_LOGS_URL}/select/logsql/query`, {
		method: "POST",
		body: new URLSearchParams({ query: query, limit: "1", timeout: "5s" }),
	})
	const body = await response.text()

	if (response.ok || body.startsWith(EXECUTION_ERROR)) {
		return { valid: true }
	}

	if (response.status === 400 && body.startsWith(EMPTY_QUERY)) {
		return { valid: false, reason: "missing query" }
	}

	if (response.status !== 400 || !body.startsWith(PARSE_ERROR)) {
		throw new Error(
			`unexpected answer ${String(response.status)} for ${JSON.stringify(query)}: ${body}`,
		)
	}

	return { valid: false, reason: reasonOf(body, query) }
}

// askAll asks for every query, a few at a time, and keeps their order
export async function askAll(queries: string[]): Promise<Verdict[]> {
	const verdicts: Verdict[] = []
	let next = 0

	async function worker() {
		while (next < queries.length) {
			const index = next
			next++

			verdicts[index] = await askVictoriaLogs(queries[index] ?? "")
		}
	}

	await Promise.all(Array.from({ length: CONCURRENCY }, worker))

	return verdicts
}

// serverVersion gives the release the server runs, such as v1.54.0
export async function serverVersion(): Promise<string> {
	const response = await fetch(`${VICTORIA_LOGS_URL}/select/buildinfo`)
	const info = (await response.json()) as { data?: { version?: string } }

	if (!info.data?.version) {
		throw new Error(`${VICTORIA_LOGS_URL} did not report a version`)
	}

	return info.data.version
}

// reasonOf cuts the answer down to the error. VictoriaLogs repeats the
// query before the error and its last characters after it.
function reasonOf(body: string, query: string): string {
	return body
		.trim()
		.replace(`${PARSE_ERROR} [${query}]: `, "")
		.replace(/; context: \[[\s\S]*$/, "")
}
