import type { KnipConfig } from "knip"

// knip runs with --no-gitignore. The generated parser is gitignored, and
// it is the only file that imports the tokenizer and the highlighting.
const config: KnipConfig = {
	entry: ["src/index.ts", "scripts/*.ts"],
	project: ["src/**/*.ts", "scripts/**/*.ts"],

	// the built declarations keep the .ts extension of the sources, which
	// TypeScript resolves to the .d.ts beside them and knip does not
	ignore: ["dist/**"],

	// some types are exported only so that another export in the same file
	// can name them. They are part of that file's contract, so they are not
	// dead exports.
	ignoreExportsUsedInFile: {
		interface: true,
		type: true,
	},
}

export default config
