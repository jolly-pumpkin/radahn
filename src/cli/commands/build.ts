import type { Command } from "commander";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { lex } from "../../lex/index";
import { parse } from "../../parse/index";
import { resolve } from "../../resolve/index";
import { emit } from "../../emit/index";
import type { Diagnostic } from "../../diag/types";

export function registerBuild(program: Command): void {
	program
		.command("build")
		.description("Compile .rd source files to TypeScript")
		.argument("[files...]", "source files to compile")
		.option("--outdir <dir>", "output directory", "dist")
		.option("--json", "output diagnostics as JSON-Lines")
		.action((files: string[], options: { outdir: string; json?: boolean }) => {
			if (files.length === 0) {
				console.error("radahn build: no input files");
				process.exit(1);
			}

			mkdirSync(options.outdir, { recursive: true });
			let hasError = false;

			for (const file of files) {
				let source: string;
				try {
					source = readFileSync(file, "utf-8");
				} catch {
					console.error(`radahn build: cannot read file '${file}'`);
					hasError = true;
					continue;
				}

				const lexResult = lex(source, file);
				const parseResult = parse(lexResult.tokens, file);
				const resolveResult = resolve(parseResult.root, parseResult.arena);
				const emitResult = emit(parseResult.root, parseResult.arena, resolveResult.resolutions);

				const allDiagnostics: Diagnostic[] = [
					...lexResult.diagnostics,
					...parseResult.diagnostics,
					...resolveResult.diagnostics,
					...emitResult.diagnostics,
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
					continue;
				}

				const name = basename(file, ".rd");
				writeFileSync(join(options.outdir, `${name}.ts`), emitResult.ts);
				writeFileSync(join(options.outdir, `${name}.d.ts`), emitResult.dts);
			}

			if (hasError) {
				process.exit(1);
			}
		});
}
