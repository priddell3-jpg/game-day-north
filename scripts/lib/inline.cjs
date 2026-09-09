/* Inlining the team manifest into the page.
 *
 * The page is one self-contained file that makes no request for its own
 * data, and that property is worth keeping: a visitor gets the app in one
 * response. So data/teams.json is substituted into the source at build
 * time rather than fetched at run time.
 *
 * This lives on its own, and in CommonJS, because two callers need it and
 * they disagree about module systems: build.js, which produces the file
 * that ships, and tests/helpers/page.mjs, which evaluates the page's
 * declarations. If only the build did the substitution, every test would
 * be reading a page whose manifest was still the empty placeholder —
 * testing a shape that never ships.
 */
const MARKER = "/*__TEAMS_MANIFEST__*/";

function inlineManifest(body, manifestJson){
  const at = body.indexOf(MARKER);
  if(at < 0) throw new Error("src/page.html has no " + MARKER + " marker to inline the manifest into");
  /* The placeholder runs from the marker to the end of that statement.
     Replacing to the semicolon rather than to the end of the line means
     the placeholder can be written however it reads best. */
  const end = body.indexOf(";", at);
  if(end < 0) throw new Error("the " + MARKER + " placeholder has no terminating semicolon");
  return body.slice(0, at) + manifestJson.trim() + body.slice(end);
}

module.exports = { MARKER, inlineManifest };
