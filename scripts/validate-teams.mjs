#!/usr/bin/env node
/**
 * Checks data/teams.json and exits non-zero on any problem.
 *
 * The test suite runs the same validator against the same file, so this
 * script is for running by hand; CI is covered either way.
 */
import { readFileSync } from "node:fs";
import { validateTeams, describeProblems, allEntries } from "./lib/teams.mjs";

const path = new URL("../data/teams.json", import.meta.url);
let manifest;
try{ manifest = JSON.parse(readFileSync(path, "utf8")); }
catch(err){ console.error("data/teams.json could not be read: " + err.message); process.exit(1); }

const problems = validateTeams(manifest);
if(problems.length){
  console.error(problems.length + " problem(s) in data/teams.json:");
  console.error(describeProblems(problems));
  process.exit(1);
}
console.log("data/teams.json is valid — " + manifest.teams.length + " followable team(s), "
  + allEntries(manifest).length + " entries in all");
