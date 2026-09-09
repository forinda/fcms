#!/usr/bin/env node
/**
 * `fcms` — the entry point, and only that.
 *
 * The program itself is next door, because a file that parses `process.argv`
 * when it is imported cannot be imported: the test that checks every command is
 * documented would run the CLI instead of reading it.
 */
import { buildProgram } from "./program.js";

buildProgram().parse();
