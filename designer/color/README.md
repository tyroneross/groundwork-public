# The colour engine

> A palette is not a list of colours. It is a **vector of relationships** — contrast
> targets, the neutral↔base↔accent chroma structure, hue deltas, tonal steps. Fix the
> relationships and rotate the anchor hue and you get an infinite family of
> distinct-but-equally-valid systems.

This is the core claim, and it has a consequence most colour discussions miss: **the hue
is a free variable.** `preview.py --sweep-hue 12` renders the proof — one vector, twelve
hues, every one hitting the same contrast targets. When someone argues indigo vs teal
they are usually arguing about the least load-bearing part of the system.

What *is* load-bearing: one accent, two stops (light + dark), every role contrast-verified,
and status hues left alone.

## Why the engine instead of picking hexes

Four things it guarantees that no amount of taste reproduces:

1. **Contrast is solved, never eyeballed.** Given a target ratio it bisects on OKLCH-L to
   land the exact lightness that hits it — measured against the *rendered* hex, so
   gamut-mapping cannot silently drift a value below AA after you approve it.
2. **Gamut safety.** Out-of-range colours reduce *chroma only*, preserving lightness and
   hue. A `clipped: true` flag means sRGB cannot render the chroma you asked for — such an
   option must never be offered as a real choice, because it will render duller than
   promised. Lower `energy` or `accent_intensity` instead of accepting the drift.
3. **The mid-tone dead-zone.** `solve_accent_L` pushes an accent out of the band where it
   can clear its surface target but host no legible label. Hand-picked accents land here
   constantly — it is why so many buttons have unreadable text.
4. **Label polarity matches the mode.** Escaping the dead-zone in one direction can land
   you in a second trap the ratio cannot see: on a dark surface the accent gets pushed
   *light*, and at that lightness only a near-black label clears 4.5 — which then reads as
   inverted or disabled, because every other foreground on that surface is light. Contrast
   is a scalar and describes white-on-indigo and black-on-indigo identically, so `4.53 ✓`
   is not evidence the button looks right. `on_accent_prefer` (default `auto` → light label
   in dark mode) constrains polarity directly. Reaching it may trade fill contrast down
   toward `accent_contrast_floor`; the result sets `accent_contrast_relaxed: true`.

## The vector

| Dimension | Values → effect |
|---|---|
| `temperature` | cool 250° · fresh 160° · warm 40° · bold 330° · neutral 250° low-chroma → `anchor_hue` |
| `mode` | light 0.985 · dim 0.22 · dark 0.16 → `surface_L` |
| `energy` | calm · balanced · vivid → base/accent chroma |
| `contrast_feel` | soft 8.5 · standard 12 · crisp 15.5 → on-surface contrast |
| `harmony` | analogous 35° · split-complementary 150° · complementary 180° · triadic 120° → `accent_hue_delta` |
| `accent_intensity` | subtle 3.2 · clear 4.5 · bold 6.0 → accent contrast |
| `accent_plan` | single · duo-adjacent · duo-mirrored · trio → `accent_count` + `accent_structure` |
| `ramp_shape` | even-tone · even-contrast → `ramp_mode` |
| `gradient` | none · subtle 14° · expressive 30° → `gradient_hue_sweep` + `gradient_L_shift` |

Out: five roles (`surface`, `on_surface`, `muted`, `accent`, `on_accent`), two tonal ramps,
and a contrast report of target vs achieved vs pass.

The last three dimensions are structural and default to off, so a vector that never answers
them generates exactly the single-accent system it always did.

### Tonal steps spaced by contrast

Even lightness steps are not even contrast steps. WCAG contrast is a function of luminance,
so a perceptually-even ramp bunches its usable contrast at one end — and "step 3" then means
a different relationship in light mode than in dark. `ramp_mode: "contrast"` makes the ramp
position itself the relationship: step *i* targets a ratio against the surface and the
lightness is solved out of it, geometrically spaced because contrast reads as a multiple
(4.5 → 9 is the same perceived move as 2 → 4). Both modes emit `ramp_contrast`, the ratios
**measured on the rendered hexes** rather than copied from the targets that requested them.

### More than one accent

`accent_count` 1–3 with `accent_structure` `spread` (one family, clearly ordered) ·
`mirror` (the harmony delta reflected back across the anchor) · `triadic` (evenly spaced).
Every extra accent gets the *full* solve — dead-zone push, polarity constraint, 1.4.11
floor, its own text-grade twin — and enters the scored contract as `accent2_vs_surface`,
`on_accent2_vs_accent2`, and so on. A secondary accent that only mostly works is the
cheapest way to ship an unreadable button under a green report.

The one-accent rule below is now **machine-checkable rather than only written down**:
`reserved_status_conflicts` names any accent whose hue lands in a reserved status band
(success 145–168° · warning 62–95° · error 8–36°, centres measured from the rendered
tokens). It is reported, never auto-corrected — shifting the status set off pure hues is a
legal choice, just an expensive and deliberate one.

### Gradients

`gradient_hue_sweep` (≤ 40°, rejected above that: past it the ends read as two colours
meeting rather than one travelling) and `gradient_L_shift`, interpolated in **OKLCH** —
sRGB interpolation drags the midpoint toward gray, so the middle of the gradient comes out
duller than either end it was built from.

The defect this closes: a label is solved against **one** colour and a gradient is **many**,
so the ratio that passes at the first stop can fail at the last, and a single number never
sees it. Every stop is measured and the **worst** is what gets reported
(`on_min_contrast`, `vs_bg_min_contrast`).

Direction is the whole design. The accent is solved at *minimal deviation* — it sits exactly
on its label target with no margin — so a band centred on it is illegible from the first
step, and "shrink until it fits" collapses to a flat colour. The band is therefore anchored
**on** the accent and travels **away** from the label: light label → runs darker, dark label
→ runs lighter. Whatever that does not buy (dark mode travels toward the surface; a pure hue
sweep has no lightness headroom to spend) is fitted by shrinking `travel_scale`, reported
alongside `clamped`. `gradient_fit: "raw"` skips the fit for a decorative wash that hosts no
text, and still reports both minima honestly.

⚠️ **The accent is the anchor rotated by the harmony delta**, not the anchor itself. With
the default split-complementary, a "cool" (250°) anchor yields an *orange* accent. If you
want the accent to sit in the anchor family, set `harmony: analogous`. This surprises
almost everyone the first time.

## Using it

```bash
GW=~/dev/git-folder/groundwork

# Elicit — ask the highest-information-gain question, show real swatches
PYTHONPATH=$GW python3 -m designer.decide.color_dimensions init \
  --goal "<what this product is>" --mode dark \
  --decided '{"contrast_feel":"crisp"}' --out /tmp/c.json
PYTHONPATH=$GW python3 -m designer.decide.color_dimensions ask    --session /tmp/c.json
PYTHONPATH=$GW python3 -m designer.decide.color_dimensions answer --session /tmp/c.json \
  --dim temperature --value cool --decided
PYTHONPATH=$GW python3 -m designer.decide.color_dimensions emit   --session /tmp/c.json > /tmp/r.json

# Render the family (and both twins: surface_L 0.985 light / 0.16 dark)
PYTHONPATH=$GW python3 -m designer.color.preview --params-file /tmp/r.json --sweep-hue 12 > /tmp/p.html

# Audit a palette you already have — returns solved replacements, same hue + chroma
PYTHONPATH=$GW python3 -m designer.color.combos ingest \
  --name my-app --surface '#0b0b0f' --text '#f4f4f5' --accent '#818cf8' \
  --source 'my-app:src/styles/tokens.css' --intent 'body text on the page ground'
```

### Reading an audit: the house target is stricter than the law

`suggest_improvements` fires against 7.0 for text and 4.5 for an accent, but WCAG demands
4.5 (SC 1.4.3) and 3.0 (SC 1.4.11). Both situations produce the same suggestion, so each one
carries a **`wcag`** grade — `fail-1.4.3` · `fail-1.4.3-any-size` · `fail-1.4.11` ·
`pass-1.4.3` · `pass-1.4.11` · `n/a` — and the report carries **`wcag_pass`** for the
palette as a whole. Without it an audit reads identically whether a palette misses AAA by
0.1 or fails AA outright.

An ingested row therefore records both verdicts: `valid` (clean against the house model) and
`wcag_pass` (legal). A row can be legal and still short of the model — filter on whichever
question is being asked. `--source` is what makes the registry traceable across repos; a
sweep recorded without it leaves every row indistinguishable from every other.

The accent grade assumes the accent is a **fill**. Drawn as a link or kicker the same hex
owes 1.4.3's 4.5 instead, which is why the suggestion still fires above 3.0 — check the call
sites before deciding it is a real failure. `ross-labs-astro` is the worked example in
`docs/palette-audit-2026-08.md`: its `#3b82f6` reads as short of text grade and is fine,
because the repo already draws its links in a text-grade twin.

Present the swatches, not the words: the option previews exist so a person chooses from
colour, not from adjectives.

## Keeping it adjustable — the learning loop

The engine is deliberately not a fixed palette. Two registries let it accumulate taste and
new structure over time, and both are meant to be written to:

**`combos.jsonl` — the palette registry.** Every accepted system gets recorded, so
favourites become reusable and new *arrangements* enter the vocabulary rather than being
re-derived.

```bash
# Record a favourite (or a NEW relationship pattern you invented)
PYTHONPATH=$GW python3 -m designer.color.combos add \
  --name rosslabs-indigo-dark \
  --params '{"energy":"balanced","contrast_feel":"crisp","accent_intensity":"clear",
             "harmony":"analogous","anchor_hue":277,"surface_L":0.16}' \
  --intent "personal site, brief visits, first-class light+dark" --source mine

PYTHONPATH=$GW python3 -m designer.color.combos list
PYTHONPATH=$GW python3 -m designer.color.combos validate   # re-checks every row
```

A row carries `valid:false` when it fails its own targets — that is a feature. The one
light palette in the registry failed at 3.90:1 and kept its solved fix alongside it, which
is more useful than deleting the mistake.

**`decide/profile.py` — the cross-project taste layer.** Dimensions chosen in one session
warm-start the next, so the same questions stop being asked.

```bash
PYTHONPATH=$GW python3 -m designer.decide.profile record --session /tmp/c.json   # fold in a session
PYTHONPATH=$GW python3 -m designer.decide.profile record-dims '{"contrast_feel":"crisp"}'  # taste seen elsewhere
PYTHONPATH=$GW python3 -m designer.decide.profile seed --out /tmp/next.json       # warm-start
PYTHONPATH=$GW python3 -m designer.decide.profile show
```

**Record every real decision.** An empty profile means every session re-asks settled
questions and the engine never gets smarter. The profile is also the honest record of what
was actually elicited — do not infer a preference that was never chosen from swatches, and
do not treat a template example in a doc as evidence of taste.

**Adding a new dimension** (a relationship the vector cannot currently express): add it to
`PARAMS` in `relationships.py`, give it an entry in `color_dimensions.py` with an
`importance` weight and real `option_previews`, and add a self-test asserting the design
stays invariant under hue rotation. That invariance is the engine's contract; a dimension
that breaks it is a bug, not a feature.

## Rules that survive every project

- One accent by default. Status hues (success / warning / error) are reserved and can never
  be the brand accent — if the accent is the success green, "success" stops signalling
  anything. `accent_count` 2–3 exists for systems that genuinely need it, and every extra
  accent is scored like the first; check `reserved_status_conflicts` before accepting one.
  A `trio` in particular collides with a status band at most anchor hues — that is the rule
  showing its work, not a bug in the structure.
- Two stops, always. An accent that clears AA on `#09090b` can fail badly on white; solve
  both twins from the same vector rather than inverting one.
- Colour encodes state, not decoration. An accent used as a kicker or eyebrow carries no
  meaning and should be dropped.
- Never present a `clipped` option as a choice.
