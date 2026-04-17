#!/usr/bin/env bun

import { Command } from "commander";
import { registerBuild } from "./cli/commands/build.js";
import { registerCheck } from "./cli/commands/check.js";
import { registerContract } from "./cli/commands/contract.js";
import { registerFmt } from "./cli/commands/fmt.js";
import { registerLocate } from "./cli/commands/locate.js";
import { registerSummary } from "./cli/commands/summary.js";

const program = new Command();

program
	.name("radahn")
	.description("The Radahn compiler — a programming language for coding agents")
	.version("0.1.0");

registerCheck(program);
registerBuild(program);
registerFmt(program);
registerContract(program);
registerSummary(program);
registerLocate(program);

program.parse();
