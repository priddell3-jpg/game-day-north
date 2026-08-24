import { readFileSync } from "node:fs";

/* The app is one HTML file by design — no bundler, no modules, nothing to
   import. To test its logic without changing that, pull the named
   top-level declarations out of the source and evaluate just those. The
   test therefore runs the code that actually ships, rather than a copy
   that can drift from it. */
const SRC = readFileSync(new URL("../../src/page.html", import.meta.url), "utf8");

function declarationOf(name){
  // function NAME(...) { ... }  — closing brace at column 0
  const fn = new RegExp("^function " + name + "\\(", "m").exec(SRC);
  if(fn){
    const start = fn.index;
    const end = SRC.indexOf("\n}", start);
    if(end < 0) throw new Error("unterminated function " + name);
    return SRC.slice(start, end + 2);
  }
  /* const NAME = ...;  — may span lines, so scan to the semicolon that
     closes it rather than assuming one line. */
  const c = new RegExp("^const " + name + "\\s*=", "m").exec(SRC);
  if(c){
    let depth = 0;
    for(let i = c.index; i < SRC.length; i++){
      const ch = SRC[i];
      if(ch === "{" || ch === "[" || ch === "(") depth++;
      else if(ch === "}" || ch === "]" || ch === ")") depth--;
      else if(ch === ";" && depth === 0) return SRC.slice(c.index, i + 1);
    }
    throw new Error("unterminated declaration " + name);
  }
  throw new Error("could not find a declaration for " + name);
}

/** Evaluate the named page declarations and hand them back.
    `preamble` supplies whatever they close over. */
export function loadFromPage(names, preamble = ""){
  const body = names.map(declarationOf).join("\n\n");
  const factory = new Function(preamble + "\n" + body + "\nreturn {" + names.join(",") + "};");
  return factory();
}

/** The page's stylesheet text, for asserting layout invariants.
    There is no browser in this project's test environment, so these
    assertions check the rules that are shipped rather than the pixels
    they produce. That catches a regression — someone reinstating
    white-space:nowrap — without claiming to have rendered anything. */
export function styleText(){
  const open = SRC.indexOf("<style>");
  const close = SRC.lastIndexOf("</style>");
  if(open < 0 || close < 0) throw new Error("no <style> block found");
  return SRC.slice(open + "<style>".length, close);
}

/** The body of the first @media block whose query contains `needle`. */
export function mediaBlock(needle){
  const css = styleText();
  const at = css.indexOf("@media " + needle);
  if(at < 0) return null;
  const open = css.indexOf("{", at);
  let depth = 0;
  for(let i = open; i < css.length; i++){
    if(css[i] === "{") depth++;
    else if(css[i] === "}"){ depth--; if(depth === 0) return css.slice(open + 1, i); }
  }
  return null;
}

/** Every declaration for a selector, concatenated. A selector is often
    written more than once — a base rule and a later override — and
    taking only the first would assert against half the truth. */
export function ruleFor(css, selector){
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("(?:^|[},])\\s*" + esc + "\\s*\\{([^}]*)\\}", "gm");
  const found = [];
  let m;
  while((m = re.exec(css))) found.push(m[1].trim());
  return found.length ? found.join(";") : null;
}
