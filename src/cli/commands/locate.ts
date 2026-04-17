import type { Command } from "commander";

export function registerLocate(program: Command): void {
	program
		.command("locate")
		.description("Find the source location of a symbol")
		.argument("<symbol>", "symbol to locate")
		.option("--json", "output location as JSON")
		.action((_symbol: string, options: { json?: boolean }) => {
			if (options.json) {
				console.log(JSON.stringify({ status: "not_implemented", command: "locate" }));
			} else {
				console.log("radahn locate: not yet implemented");
			}
		});
}
