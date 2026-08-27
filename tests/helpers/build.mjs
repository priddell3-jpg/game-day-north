import { readFileSync } from "node:fs";

/* scripts/fetch-data.mjs is a program, not a module: it imports its
   helpers and then runs top to bottom talking to ESPN, so importing it
   from a test would spend twenty minutes rebuilding data.json. To reach
   the parsing it does without running any of that, evaluate the block of
   declarations between the imports and the first line that fetches
   anything. The test therefore exercises the code that actually ships,
   the same bargain tests/helpers/page.mjs makes for the page.

   The block is delimited by two lines rather than by a count, so a
   refactor that moves either one fails here loudly instead of quietly
   testing half a file. */
const SRC = readFileSync(new URL("../../scripts/fetch-data.mjs", import.meta.url), "utf8");
const OPEN = "\nconst ESPN = ";
const CLOSE = "\nconst SAME = ";

export function loadFromBuild(names){
  const from = SRC.indexOf(OPEN), to = SRC.indexOf(CLOSE);
  if(from < 0 || to <= from){
    throw new Error("could not find the declaration block in scripts/fetch-data.mjs — " +
      "it is delimited by the lines starting `const ESPN =` and `const SAME =`");
  }
  const factory = new Function(SRC.slice(from, to) + "\nreturn {" + names.join(",") + "};");
  return factory();
}
