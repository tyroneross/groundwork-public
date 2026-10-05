// Deterministic accessibility guards for the Designer panel.
//
// These read the shipped CSS and markup rather than a rendered page, so they
// fail on the source that causes the defect: a colour token that no longer
// clears contrast, a focus ring written as a shorthand a parser cannot expand,
// a disclosure row under the minimum target size, or a new button added with
// no focus rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(HERE, '..', 'server');
const CSS = fs.readFileSync(path.join(SERVER_DIR, 'picker.css'), 'utf8');
const HTML = fs.readFileSync(path.join(SERVER_DIR, 'picker.html'), 'utf8');
const VIEW = fs.readFileSync(path.join(SERVER_DIR, 'picker-bootstrap-view.mjs'), 'utf8');
const SCRIPT = fs.readFileSync(path.join(SERVER_DIR, 'picker.js'), 'utf8');

const AA_NORMAL_TEXT = 4.5;
const MIN_TARGET_PX = 24;

function channel(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function parseHex(hex) {
  const clean = hex.replace('#', '');
  return [0, 2, 4].map((offset) => parseInt(clean.slice(offset, offset + 2), 16));
}

// Judge the relationship between two colours, never a literal value.
function contrastRatio(a, b) {
  const luminances = [relativeLuminance(parseHex(a)), relativeLuminance(parseHex(b))].sort((x, y) => y - x);
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
}

function tokens() {
  const root = CSS.match(/:root\s*\{([\s\S]*?)\}/);
  assert.ok(root, 'picker.css must declare its tokens on :root');
  const map = {};
  for (const [, name, value] of root[1].matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) {
    map[name] = value;
  }
  return map;
}

test('every text ink clears AA against the darkest surface it can sit on', () => {
  const t = tokens();
  const surfaces = ['bg', 'sunken', 'surface'].map((name) => {
    assert.ok(t[name], `missing surface token --${name}`);
    return t[name];
  });
  // The darkest declared surface is the worst case for any text drawn on it.
  const worstSurface = surfaces.reduce((darkest, candidate) =>
    relativeLuminance(parseHex(candidate)) < relativeLuminance(parseHex(darkest)) ? candidate : darkest);

  for (const ink of ['ink', 'ink2', 'ink3', 'accentStrong']) {
    assert.ok(t[ink], `missing text token --${ink}`);
    const ratio = contrastRatio(t[ink], worstSurface);
    assert.ok(ratio >= AA_NORMAL_TEXT,
      `--${ink} (${t[ink]}) measures ${ratio.toFixed(2)}:1 on --${worstSurface === t.bg ? 'bg' : 'surface'} ${worstSurface}; AA needs ${AA_NORMAL_TEXT}:1`);
  }
});

test('the filled button clears AA between its label and its own background', () => {
  const t = tokens();
  const rule = CSS.match(/\.btn-primary\s*\{([\s\S]*?)\}/);
  assert.ok(rule, 'picker.css must declare .btn-primary');
  const background = rule[1].match(/background:\s*var\(--([\w-]+)\)/);
  const color = rule[1].match(/color:\s*var\(--([\w-]+)\)/);
  assert.ok(background && color, '.btn-primary must take both colours from tokens');
  const ratio = contrastRatio(t[background[1]], t[color[1]]);
  assert.ok(ratio >= AA_NORMAL_TEXT,
    `.btn-primary measures ${ratio.toFixed(2)}:1 (--${background[1]} under --${color[1]}); AA needs ${AA_NORMAL_TEXT}:1`);
});

test('the focus ring is declared in longhand so it survives a parser', () => {
  const block = CSS.match(/button:focus-visible[\s\S]*?\{([\s\S]*?)\}/);
  assert.ok(block, 'picker.css must declare a focus ring for the button base');
  assert.match(block[1], /outline-width:\s*2px/);
  assert.match(block[1], /outline-style:\s*solid/);
  assert.match(block[1], /outline-color:/);
  // A shorthand carrying var() cannot be expanded to longhands at parse time,
  // so a scanner reads the ring as absent. Never reintroduce it.
  const cssWithoutComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/outline:\s*[^;\n]*var\(/.test(cssWithoutComments), false,
    'declare outline-width/style/color separately; `outline: … var(…)` is unreadable to CSS parsers');
});

test('every interactive element in the panel has a focus rule keyed to its own selector', () => {
  const idSelectors = new Set(
    [...CSS.matchAll(/#([\w-]+):focus-visible/g)].map((match) => match[1]),
  );
  const classSelectors = new Set(
    [...CSS.matchAll(/\.([\w-]+):focus-visible/g)].map((match) => match[1]),
  );

  const staticIds = [...HTML.matchAll(/<(button|a)\b[^>]*\bid="([\w-]+)"/g)].map((match) => match[2]);
  // Controls the baseline view builds at runtime carry the same contract.
  const runtimeIds = [...VIEW.matchAll(/(?:Button|confirm|toggle)\.id = '([\w-]+)'/g)].map((match) => match[1]);

  assert.ok(staticIds.length >= 15, `expected the panel's controls to be discoverable, found ${staticIds.length}`);
  assert.ok(runtimeIds.length >= 4, `expected the baseline view's controls to be discoverable, found ${runtimeIds.length}`);

  for (const id of [...staticIds, ...runtimeIds]) {
    assert.ok(idSelectors.has(id),
      `#${id} is interactive but has no focus rule; add #${id}:focus-visible to the focus-ring block in picker.css`);
  }

  // picker.js builds buttons for resume rows, review rows, option cards and
  // workspace selection. Each must be reachable by a focus rule through EITHER
  // its own id or its first class — otherwise a scanner keyed to the element's
  // own selector reports it bare, and the next author has no signal.
  const created = [...SCRIPT.matchAll(/createElement\('button'\)([\s\S]{0,300})/g)];
  assert.ok(created.length >= 4,
    `expected picker.js to build controls this test can see, found ${created.length}`);
  for (const [, block] of created) {
    const id = block.match(/\.id = [`']([\w-]+)/);
    const className = block.match(/\.className = '([\w-]+)/);
    const covered = (id && idSelectors.has(id[1])) || (className && classSelectors.has(className[1]));
    assert.ok(covered,
      `a button built in picker.js has no focus rule for its id or its first class: ${block.slice(0, 120).replace(/\s+/g, ' ')}`);
  }

  // A control can also arrive as markup handed to setSanitizedHtml, which the
  // createElement scan above cannot see. Hold that form to the same contract.
  for (const [markup, attributes] of SCRIPT.matchAll(/<button\b([^>]*)>/g)) {
    const id = attributes.match(/\bid="([\w-]+)"/);
    const className = attributes.match(/\bclass="([\w-]+)/);
    const covered = (id && idSelectors.has(id[1])) || (className && classSelectors.has(className[1]));
    assert.ok(covered,
      `a button written as markup in picker.js has no focus rule for its id or its first class: ${markup}`);
  }

  // Every base selector a dynamic control can match must also be declared.
  for (const base of ['option', 'resume-row', 'review-opt-row', 'btn-quiet', 'btn-primary', 'rail-item']) {
    assert.ok(classSelectors.has(base), `missing focus rule for .${base}`);
  }

  // Option cards are generated per decision; their ids are positional and the
  // CSS declares a fixed run of them.
  const declaredOptionIds = [...idSelectors].filter((id) => /^option-\d+$/.test(id)).length;
  const declaredPendingIds = [...idSelectors].filter((id) => /^pending-option-\d+$/.test(id)).length;
  assert.equal(declaredOptionIds, declaredPendingIds,
    'the decision pane and the baseline screen must declare the same number of option ids');
  assert.ok(declaredOptionIds >= 6, `only ${declaredOptionIds} option ids declared`);
  for (let index = 0; index < declaredOptionIds; index += 1) {
    assert.ok(idSelectors.has(`option-${index}`), `missing focus rule for decision option ${index}`);
    assert.ok(idSelectors.has(`pending-option-${index}`), `missing focus rule for pending option ${index}`);
  }
});

test('disclosure rows meet the minimum target size', () => {
  const rule = CSS.match(/(?:^|\n)summary\s*\{([\s\S]*?)\}/);
  assert.ok(rule, 'picker.css must give every summary a minimum height');
  const minHeight = rule[1].match(/min-height:\s*(\d+)px/);
  assert.ok(minHeight, 'summary must declare min-height');
  assert.ok(Number(minHeight[1]) >= MIN_TARGET_PX,
    `summary min-height is ${minHeight[1]}px; the minimum target is ${MIN_TARGET_PX}px`);
});

test('the rail lists Groundwork components and never fakes a surface it lacks', () => {
  const railItems = [...HTML.matchAll(/<(button|li|span)[^>]*class="[^"]*rail-item[^"]*"/g)].map((match) => match[1]);
  assert.ok(railItems.includes('button'), 'live destinations are buttons');

  const staticBlocks = [...HTML.matchAll(/<li class="rail-item rail-item--static">([\s\S]*?)<\/li>/g)].map((match) => match[1]);
  assert.ok(staticBlocks.length >= 4, 'components that run in chat must still be listed');
  for (const block of staticBlocks) {
    assert.equal(/<button/.test(block), false, 'a component with no surface here must not render a button');
    assert.match(block, /rail-item-note/);
  }

  // Designer is one destination, not the whole panel.
  assert.match(HTML, /data-destination="designer"/);
  assert.match(HTML, /data-destination="saved"/);
  assert.match(HTML, /data-destination="output"/);
});

test('saved-work feedback exposes bounded, reversible review controls', () => {
  assert.match(HTML, /id="workspace-suggestions"[^>]*checked/);
  const counts = [...HTML.matchAll(/<option value="([2-5])"/g)].map((match) => Number(match[1]));
  assert.deepEqual(counts, [2, 3, 4, 5]);
  assert.match(HTML, /id="workspace-review-layout"/);
  assert.match(HTML, /value="single"/);
  assert.match(HTML, /value="compare"/);
  assert.match(HTML, /id="workspace-low-fi"[^>]*checked/);
  assert.match(SCRIPT, /postJSON\('\/api\/chat', \{ text, id: pendingChatId, review \}\)/);
});

test('existing-app suggestions disclose provenance and stay editable', () => {
  assert.match(HTML, /Suggested inputs and outputs/);
  assert.match(SCRIPT, /Observed in code/);
  assert.match(SCRIPT, /provenance: 'Suggested'/);
  assert.match(SCRIPT, /input\.className = 'field-input'/);
  assert.match(SCRIPT, /accept\.textContent = 'Accept'/);
  assert.match(SCRIPT, /remove\.textContent = 'Remove'/);
});
