import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");

test("the What's on strip contains no scores, statuses, or carriers", () => {
  const at = SRC.indexOf("function railCard");
  const body = SRC.slice(at, SRC.indexOf("function renderRugbyPicker", at));
  assert.doesNotMatch(body, /scoreFor|resolveRights|dot-live|rail-meta|rail-row/);
  assert.match(body, /data-rail-game/);
});

test("finished games are filtered out of What's on", () => {
  const at = SRC.indexOf("function renderRail");
  const body = SRC.slice(at, SRC.indexOf("function railCard", at));
  assert.match(body, /!railFinished\(g, now\)/);
});

test("every full schedule row carries a focusable jump destination", () => {
  const renderers = ["eventRow", "rugbyRow", "tennisRow", "gameRow"];
  for(const name of renderers){
    const at = SRC.indexOf("function "+name);
    const end = SRC.indexOf("\nfunction ", at + 10);
    const body = SRC.slice(at, end < 0 ? undefined : end);
    assert.match(body, /data-game-id=/, name+" must expose its destination");
    assert.match(body, /tabindex="-1"/, name+" must accept shortcut focus");
  }
});

test("tapping a matchup switches to the list and highlights its row", () => {
  const at = SRC.indexOf('document.getElementById("rail").addEventListener');
  const body = SRC.slice(at, SRC.indexOf("/* The service cards", at));
  assert.match(body, /view!=="list"/);
  assert.match(body, /scrollIntoView/);
  assert.match(body, /rail-jump/);
});
