import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { lex } from "../../lex/index";
import { parse } from "../../parse/index";
import { resolve } from "../../resolve/index";
import type { Diagnostic } from "../../diag/types";

export function registerCheck(program: Command): void {
	program
		.command("check")
		.description("Type-check and effect-check .rd source files")
		.argument("[files...]", "source files to check")
		.option("--json", "output diagnostics as JSON-Lines")
		.action((files: string[], options: { json?: boolean }) => {
			if (files.length === 0) {
				console.error("radahn check: no input files");
				process.exit(1);
			}

			let hasError = false;

			for (const file of files) {
				let source: string;
				try {
					source = readFileSync(file, "utf-8");
				} catch {
					console.error(`radahn check: cannot read file '${file}'`);
					hasError = true;
					continue;
				}

				const lexResult = lex(source, file);
				const parseResult = parse(lexResult.tokens, file);
				const resolveResult = resolve(parseResult.root, parseResult.arena);

				const allDiagnostics: Diagnostic[] = [
					...lexResult.diagnostics,
					...parseResult.diagnostics,
					...resolveResult.diagnostics,
				];

				if (options.json) {
					for (const d of allDiagnostics) {
						console.log(JSON.stringify(d));
					}
				} else {
					for (const d of allDiagnostics) {
						console.log(
							`${d.span.file}:${d.span.line}:${d.span.col}: ${d.severity} [${d.code}]: ${d.message}`,
						);
					}
				}

				if (allDiagnostics.some((d) => d.severity === "error")) {
					hasError = true;
				}
			}

			if (hasError) {
				process.exit(1);
			}
		});
}
