/* Groundwork guided-decision surface -- client.
 *
 * The pure half of this file (normalize, lane, condense, buildRecord,
 * overlayPlan, stripTransient) is exported for `node --test` so the rules that
 * decide what reaches the file are tested without a browser. The DOM half only
 * runs when there is a document.
 *
 * THE TWO RULES THAT COST THE MOST TO LEARN, BOTH ENCODED IN buildRecord:
 *
 * 1. A DELETE HAS TO REACH THE FILE. buildRecord unions what is in memory with
 *    a FRESH READ OF DISK -- that re-read is what stops a concurrent writer's
 *    work being clobbered. But it also means a plain splice from the in-memory
 *    array resurrects the item on the next save, because disk still has it. So
 *    a deletion is a TOMBSTONE (`deletedIds`), applied after the union.
 *
 * 2. NO ITEM ASSERTS ITS OWN SAVE STATE. `savedToFile` and `unsaved` describe
 *    this browser session, not the record. They are stripped on the way out and
 *    set only after the server has confirmed the write. That is what lets the
 *    page answer "is this in the record?" per item, instead of comparing two
 *    blobs by timestamp and guessing.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GroundworkDecisions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SCHEMA = "groundwork.decision-set/v1";
  var RULEABLE_ARRAYS = ["axes", "openItems", "compares"];
  var TRANSIENT_FIELDS = ["savedToFile", "unsaved"];
  var LIVE_LISTS = ["previewComments", "annotations"];

  /* The adapter table. Must stay in lockstep with decision_record.py's ADAPTER.
     designer/tests/test_decision_record.py executes BOTH implementations and
     compares them, because two implementations of one rule drift silently and
     the drift shows up as a decision landing in the wrong lane on one surface
     and not the other. */
  var ADAPTER = {
    title:    { axes: "title",    openItems: "question",   compares: "question" },
    prompt:   { axes: "decision", openItems: "question",   compares: "question" },
    why:      { axes: "why",      openItems: "why",        compares: "why" },
    chosen:   { axes: "selected", openItems: "ruling",     compares: "ruling" },
    freeText: { axes: "note",     openItems: "rulingText", compares: "rulingText" },
    ruledAt:  { axes: "ruledAt",  openItems: "ruledAt",    compares: "ruledAt" },
    status:   { axes: null,       openItems: "status",     compares: "status" },
    kind:     { axes: null,       openItems: "kind",       compares: null },
    target:   { axes: null,       openItems: "target",     compares: "target" }
  };
  var CHOICES_KEY = { axes: "options", openItems: "choices", compares: null };

  /* A compare's four answers are fixed by the surface, not authored per item,
     so an export can map them onto selection.json modes without guessing.
     Mirrors decision_record.py COMPARE_CHOICES; the parity test executes both. */
  var COMPARE_CHOICES = [
    { key: "keep-a",    label: "Keep A",    needsText: false },
    { key: "approve-b", label: "Approve B", needsText: false },
    { key: "revise-b",  label: "Revise B",  needsText: true },
    { key: "other",     label: "Neither",   needsText: true }
  ];
  var COMPARE_RULINGS = COMPARE_CHOICES.map(function (c) { return c.key; });

  /* Revise B and Neither mean nothing without the words. Returns the reason a
     ruling may not be recorded yet, or null when it may. Same rule as
     decision_record.compare_note_error. */
  function compareNoteError(ruling, note) {
    if (ruling === null || ruling === undefined) return null;
    if (typeof ruling === "string" && ruling.trim() === "") return null;
    if (COMPARE_RULINGS.indexOf(ruling) === -1) {
      return "ruling must be one of " + COMPARE_RULINGS.join(", ");
    }
    var needs = COMPARE_CHOICES.filter(function (c) { return c.key === ruling; })[0].needsText;
    if (needs && !(typeof note === "string" && note.trim() !== "")) {
      return ruling === "revise-b" ? "say what to change in B" : "say what you want instead";
    }
    return null;
  }

  function side(v) {
    if (typeof v === "string") return { summary: v, visual: null, mockup: null };
    if (!v || typeof v !== "object" || Array.isArray(v)) return { summary: "", visual: null, mockup: null };
    var ok = function (x) { return typeof x === "string" && x.trim() !== "" ? x : null; };
    return { summary: typeof v.summary === "string" ? v.summary : "", visual: ok(v.visual), mockup: ok(v.mockup) };
  }

  function compareOf(raw) {
    /* Strings only, in both languages: anything else is treated as absent, so
       the two normalizers cannot stringify a malformed value differently. */
    var str = function (x) { return typeof x === "string" && x !== "" ? x : null; };
    var so = raw.secondOpinion, second = null;
    if (so && typeof so === "object" && !Array.isArray(so) && (str(so.source) || str(so.verdict) || str(so.note))) {
      second = { source: str(so.source), verdict: str(so.verdict), note: str(so.note) };
    }
    return {
      area: str(raw.area),
      headline: str(raw.headline),
      optionA: side(raw.optionA), optionB: side(raw.optionB),
      secondOpinion: second
    };
  }

  /* A visual is a LEAF name inside the record's visuals/ directory. Anything
     that could name another path or carry a scheme is refused here, before it
     reaches an img or iframe src; the server also resolves by leaf only. */
  function safeVisual(name) {
    if (typeof name !== "string") return null;
    var n = name.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(n)) return null;
    if (!/\.(png|jpe?g|webp|avif|gif|html)$/i.test(n)) return null;
    return n;
  }

  function field(raw, source, name) {
    var key = ADAPTER[name][source];
    return key === null ? null : raw[key];
  }

  /* A ruling is present when it carries content. Empty string and empty list
     are what a CLEARED ruling leaves behind. `false` and `0` are real answers
     to a yes/no or a count, so this is deliberately not `!!v`. */
  function truthy(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === "string") return v.trim() !== "";
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return Object.keys(v).length > 0;
    return true;
  }

  function choice(c) {
    return {
      key: c.key,
      label: c.label || String(c.key == null ? "" : c.key),
      note: c.note || c.body || null,
      cost: c.cost || null,
      letter: c.letter || null,
      needsText: !!c.needsText,
      text: Object.prototype.hasOwnProperty.call(c, "text") ? c.text : null
    };
  }

  function ruleable(source, index, raw) {
    var chosen = field(raw, source, "chosen");
    var ck = CHOICES_KEY[source];
    return {
      source: source, index: index, id: String(raw.id || ""),
      title: field(raw, source, "title") || String(raw.id || ""),
      prompt: field(raw, source, "prompt") || "",
      why: field(raw, source, "why") || "",
      chosen: chosen === undefined ? null : chosen,
      freeText: field(raw, source, "freeText") || null,
      ruledAt: field(raw, source, "ruledAt") || null,
      status: field(raw, source, "status") || null,
      kind: source === "compares" ? "compare"
        : source === "openItems" ? (field(raw, source, "kind") || "axis") : "axis",
      target: field(raw, source, "target") || null,
      preview: raw.preview || null,
      addressed: !!raw.addressed,
      choices: (ck === null ? COMPARE_CHOICES : (raw[ck] || [])).filter(function (c) {
        return c && typeof c === "object";
      }).map(choice),
      compare: source === "compares" ? compareOf(raw) : null,
      raw: raw
    };
  }

  /* DERIVED, never declared. `status` is prose a human wrote and it drifts: on
     the record this surface was built against, 20 of 25 items said "open..."
     while already carrying a ruling. Reading it would mislabel 20 of 25. */
  function lane(r) {
    if (r.addressed) return "ruled";
    return truthy(r.chosen) ? "ruled" : "open";
  }

  function normalize(record) {
    var out = [];
    RULEABLE_ARRAYS.forEach(function (source) {
      (record[source] || []).forEach(function (raw, i) {
        if (raw && typeof raw === "object") out.push(ruleable(source, i, raw));
      });
    });
    return out;
  }

  /* Variants are one decision when they describe the same area and the same
     existing UI. An area alone is too broad: unrelated questions may share it. */
  function comparisonSets(list) {
    var sets = [], byBaseline = {};
    (list || []).filter(function (r) { return r.source === "compares"; }).forEach(function (r) {
      var current = r.compare.optionA;
      var signature = current.summary || current.visual
        ? [r.compare.area || "", current.summary || "", current.visual || ""].join("\u001f")
        : "item\u001f" + r.id;
      if (!byBaseline[signature]) {
        byBaseline[signature] = { id: r.id, name: r.compare.area || "Other decisions", items: [] };
        sets.push(byBaseline[signature]);
      }
      byBaseline[signature].items.push(r);
    });
    return sets;
  }

  function selectedProposal(set, selected) {
    var snapshot = function (raw) {
      if (typeof raw === "string") return { summary: raw };
      return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
    };
    if (set.items.length > 1) {
      if (selected === "current") return snapshot(set.items[0].raw.optionA);
      var variant = set.items.filter(function (r) { return r.id === selected; })[0];
      return variant ? snapshot(variant.raw.optionB) : null;
    }
    if (selected === "keep-a") return snapshot(set.items[0].raw.optionA);
    if (selected === "approve-b" || selected === "revise-b") return snapshot(set.items[0].raw.optionB);
    return null;
  }

  /* Implementation is separate from the person's choice. A stale status for a
     former choice cannot describe the newly selected version. */
  function implementationLane(record, set) {
    var selection = (record.groupSelections || {})[set.id] || {};
    var selected = set.items.length > 1 ? selection.selected
      : (selection.selected || set.items[0].chosen);
    var decisionNote = set.items.length > 1 ? (selection.note || "") : (set.items[0].freeText || "");
    if (!truthy(selected)) return { key: "needs-decision", label: "Needs decision", evidence: [] };
    var entry = (record.implementationStatus || {})[set.id] || {};
    var evidence = Array.isArray(entry.evidence) ? entry.evidence.filter(function (item) {
      return item && typeof item.detail === "string" && item.detail.trim();
    }) : [];
    var proposal = selectedProposal(set, selected);
    if (entry.selected !== selected || entry.decisionNote !== decisionNote || !proposal || !entry.proposal ||
        JSON.stringify(entry.proposal) !== JSON.stringify(proposal) || !evidence.length) {
      return { key: "pending", label: "Pending", evidence: [] };
    }
    if (entry.stage === "complete" && evidence.some(function (item) {
      return item.kind === "verification" && typeof item.ref === "string" && item.ref.trim() &&
        typeof item.revision === "string" && item.revision.trim();
    })) {
      return { key: "complete", label: "Complete", evidence: evidence };
    }
    if (entry.stage === "in-progress" || entry.stage === "complete") {
      return { key: "in-progress", label: "In progress", evidence: evidence };
    }
    return { key: "pending", label: "Pending", evidence: [] };
  }

  function comparisonBuckets(record, sets) {
    var pending = [], selected = [];
    (sets || []).forEach(function (set) {
      (implementationLane(record || {}, set).key === "needs-decision" ? pending : selected).push(set);
    });
    return { pending: pending, selected: selected };
  }

  function revealCompareTarget(target) {
    if (!target) return false;
    var card = target.closest("details[data-selected-card]");
    if (card) card.open = true;
    var details = target.closest("details[data-work-lane]");
    if (details) details.open = true;
    if (typeof target.focus === "function") target.focus({ preventScroll: true });
    if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "start" });
    return true;
  }

  function compareRenderSignature(list, record) {
    return (list || []).map(function (r) {
      return [r.id, r.compare.area, r.chosen, r.freeText,
        JSON.stringify(r.raw.optionA || null), JSON.stringify(r.raw.optionB || null)].join("\u001f");
    }).join("\u0000") + JSON.stringify((record && record.groupSelections) || {}) +
      JSON.stringify((record && record.implementationStatus) || {});
  }

  /* Two sentences, ~35 words. The full reason is not lost -- it is the first
     thing "more" opens. */
  function condense(s, maxWords, maxSentences) {
    var t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    if (!t) return "";
    maxWords = maxWords || 35;
    maxSentences = maxSentences || 2;
    var sents = t.match(/[^.!?]+[.!?]+["')”’]?|[^.!?]+$/g) || [t];
    var out = "", n = 0;
    for (var i = 0; i < sents.length && i < maxSentences; i++) {
      var piece = sents[i].trim();
      var words = piece.split(/\s+/).length;
      if (out && n + words > maxWords) break;
      out = out ? out + " " + piece : piece;
      n += words;
      if (n >= maxWords) break;
    }
    var w = out.split(/\s+/);
    if (w.length > maxWords) {
      out = w.slice(0, maxWords).join(" ").replace(/[,;:—-]+$/, "") + "…";
    }
    return out;
  }

  /* An option label is a button. Twelve words is the ceiling; the tail is not
     thrown away, it becomes the quiet line under the button. */
  function splitLabel(label, maxWords) {
    maxWords = maxWords || 12;
    var w = String(label == null ? "" : label).replace(/\s+/g, " ").trim().split(/\s+/);
    if (w.length <= maxWords) return { head: w.join(" "), tail: "" };
    return { head: w.slice(0, maxWords).join(" "), tail: w.slice(maxWords).join(" ") };
  }

  /* HTML escaping. Lives in the PURE half deliberately: it was originally below
     the `typeof document === "undefined"` return, which put it and every HTML
     builder beyond the reach of `node --test`. The test named for it could then
     only assert that a string was a string, and stayed green with the escape
     deleted. An untestable guard is not a guard. */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* F1. A record is untrusted input, and `preview.byChoice[k].url` is assigned
     straight to an iframe's src. `javascript:` there executes in THIS origin --
     the one origin that owns the only writable path -- so escaping markup would
     not have helped: this is not that kind of sink. Only same-document paths are
     allowed through; anything with a scheme, and any protocol-relative `//host`,
     is refused. Caught in independent audit before this reached main. */
  function safePreviewUrl(url) {
    if (typeof url !== "string") return null;
    var u = url.trim();
    if (u === "") return null;
    if (u.charAt(0) === "/" && u.charAt(1) === "/") return null;   // //evil.example
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) return null;          // any scheme at all
    if (u.charAt(0) !== "/" && u.charAt(0) !== ".") return null;   // must be a path
    return u;
  }

  function stripTransient(item) {
    var out = {};
    Object.keys(item).forEach(function (k) {
      if (TRANSIENT_FIELDS.indexOf(k) === -1) out[k] = item[k];
    });
    return out;
  }

  function indexById(list) {
    var m = {};
    (list || []).forEach(function (it) { if (it && it.id) m[it.id] = it; });
    return m;
  }

  /* THE MERGE.
   *
   * `disk` is a fresh read; `mem` is this session. A key seeded from disk and
   * never touched is not an intent to write it back, so only ids this session
   * actually changed (`dirty`) win over disk. Everything else disk keeps.
   *
   * Order matters: union first (so a concurrent writer's new items survive),
   * then apply tombstones (so a delete is not undone by the union it just
   * passed through), then strip transient fields (so nothing persists a claim
   * about its own save state).
   */
  function buildRecord(disk, mem, scope) {
    var out = JSON.parse(JSON.stringify(disk || {}));
    mem = mem || {};
    var deleted = mem.deletedIds || {};
    var dirty = mem.dirty || {};

    LIVE_LISTS.concat(["history"]).forEach(function (key) {
      var byId = indexById(out[key]);
      (mem[key] || []).forEach(function (it) {
        if (!it || !it.id) return;
        if (dirty[it.id] || !byId[it.id]) byId[it.id] = it;
      });
      out[key] = Object.keys(byId)
        .filter(function (id) { return !deleted[id]; })
        .map(function (id) { return stripTransient(byId[id]); });
    });

    /* Rulings project back through the adapter to the array the item came from,
       so an openItems field can never be written onto an axis. */
    if ((scope === "rulings" || scope === "compare") && mem.rulings) {
      RULEABLE_ARRAYS.forEach(function (source) {
        (out[source] || []).forEach(function (raw) {
          var patch = mem.rulings[raw.id];
          if (!patch || patch.source !== source) return;
          if (patch.chosen !== undefined && patch.chosen !== null) {
            raw[ADAPTER.chosen[source]] = patch.chosen;
          }
          if (patch.freeText !== undefined && patch.freeText !== null) {
            raw[ADAPTER.freeText[source]] = patch.freeText;
          }
          if (patch.ruledAt) raw[ADAPTER.ruledAt[source]] = patch.ruledAt;
          /* `status` is the author's prose. The surface never writes it, so a
             stale status stays theirs to fix rather than being overwritten with
             a fabricated agreement. */
        });
      });
    }

    /* A compare's note autosaves on its own, WITHOUT a ruling: typing is not a
       commitment. Applied AFTER rulings, so text typed while a ruling was in
       flight wins over the text the click captured. Only ids whose note this session changed are in mem.notes,
       so a note seeded from disk and never touched is not written back. */
    if (mem.notes) {
      RULEABLE_ARRAYS.forEach(function (source) {
        (out[source] || []).forEach(function (raw) {
          var n = mem.notes[raw.id];
          if (!n || n.source !== source || typeof n.freeText !== "string") return;
          raw[ADAPTER.freeText[source]] = n.freeText;
        });
      });
    }

    if (scope === "group" && mem.groupSelections) {
      var sets = comparisonSets(normalize(out));
      var valid = {};
      sets.filter(function (set) { return set.items.length > 1; }).forEach(function (set) {
        valid[set.id] = ["current"].concat(set.items.map(function (r) { return r.id; }));
      });
      out.groupSelections = out.groupSelections && typeof out.groupSelections === "object" &&
        !Array.isArray(out.groupSelections) ? out.groupSelections : {};
      Object.keys(mem.groupSelections).forEach(function (id) {
        var selection = mem.groupSelections[id];
        if (!valid[id] || valid[id].indexOf(selection.selected) === -1) {
          throw new Error("group selection is not an option in this record");
        }
        out.groupSelections[id] = {
          selected: selection.selected,
          note: typeof selection.note === "string" ? selection.note : "",
          ruledAt: selection.ruledAt
        };
      });
    }

    /* "Ask for new options": append-only requests an agent reads and answers by
       adding compares. Merged by id so another writer's requests survive. */
    if (mem.optionRequests && mem.optionRequests.length) {
      var reqs = Array.isArray(out.optionRequests) ? out.optionRequests : [];
      var have = {};
      reqs.forEach(function (q) { if (q && q.id) have[q.id] = true; });
      mem.optionRequests.forEach(function (q) { if (q && q.id && !have[q.id]) reqs.push(q); });
      out.optionRequests = reqs;
    }

    out.lifecycle = out.lifecycle || {};
    out.lifecycle.savedScope = scope;
    out.lifecycle.savedAt = new Date().toISOString();
    out.schema = out.schema || SCHEMA;
    return out;
  }

  /* Incorporating an annotation MOVES it; it never copies. An id living in both
     the live list and history means one of them is a ghost, which is exactly
     what verify_record.py's id-coherence invariant refuses. A declined one stays
     visible with its reason -- absence of a disposition is not consent to hide. */
  function incorporate(record, id, receipt) {
    var out = JSON.parse(JSON.stringify(record));
    out.history = out.history || [];
    LIVE_LISTS.forEach(function (key) {
      var keep = [];
      (out[key] || []).forEach(function (it) {
        if (it && it.id === id) {
          var moved = stripTransient(it);
          moved.disposition = "incorporated";
          moved.receipt = receipt || null;
          out.history.push(moved);
        } else { keep.push(it); }
      });
      out[key] = keep;
    });
    return out;
  }

  function decline(record, id, reason) {
    var out = JSON.parse(JSON.stringify(record));
    LIVE_LISTS.forEach(function (key) {
      (out[key] || []).forEach(function (it) {
        if (it && it.id === id) { it.disposition = "declined"; it.declinedReason = reason || null; }
      });
    });
    return out;
  }

  /* Selection-driven preview mutation.
   *
   * The mapping is DATA on the ruleable (`preview`), never selectors compiled
   * into this file -- those belong to a project, not to the template. A record
   * that carries no `preview` block degrades to `none`, which is why this is
   * safe to ship before any project has written one.
   *
   *   preview: { selector: "[data-component='Hero']",
   *              byChoice: { "use-tagline": {mode:"text", value:"..."},
   *                          "remove":      {mode:"hide"},
   *                          "rewrite":     {mode:"page", url:"/alt"} } }
   */
  function overlayPlan(r, choiceKey) {
    if (!r || !r.preview || !choiceKey) return { mode: "none" };
    var pv = r.preview;
    var spec = (pv.byChoice || {})[choiceKey];
    var selector = (spec && spec.selector) || pv.selector || null;
    if (!spec) {
      /* A choice that carries its own words still previews, without the record
         needing a byChoice entry for it. */
      var ch = (r.choices || []).filter(function (c) { return c.key === choiceKey; })[0];
      if (ch && ch.text != null && String(ch.text).trim() !== "" && selector) {
        return { mode: "text", selector: selector, value: String(ch.text) };
      }
      return { mode: "none" };
    }
    if (spec.mode === "page") return { mode: "page", url: safePreviewUrl(spec.url) };
    if (spec.mode === "hide") return { mode: "hide", selector: selector };
    if (spec.mode === "text") {
      return { mode: "text", selector: selector, value: spec.value == null ? null : String(spec.value) };
    }
    return { mode: "none" };
  }

  /* The save contract, as a predicate. The server must return all three fields;
     a 204 or an empty body is a save that succeeded on disk and reported
     failure to the person, which is worse than failing. */
  function saveAccepted(httpOk, body) {
    if (!httpOk || !body || body.ok !== true) return false;
    if (typeof body.savedAt !== "string" || body.savedAt === "") return false;
    return typeof body.bytes === "number";
  }

  var api = {
    SCHEMA: SCHEMA, ADAPTER: ADAPTER, TRANSIENT_FIELDS: TRANSIENT_FIELDS,
    RULEABLE_ARRAYS: RULEABLE_ARRAYS, COMPARE_CHOICES: COMPARE_CHOICES,
    compareNoteError: compareNoteError, safeVisual: safeVisual,
    truthy: truthy, normalize: normalize, comparisonSets: comparisonSets, selectedProposal: selectedProposal, implementationLane: implementationLane, comparisonBuckets: comparisonBuckets, revealCompareTarget: revealCompareTarget, compareRenderSignature: compareRenderSignature, lane: lane, condense: condense,
    splitLabel: splitLabel, stripTransient: stripTransient,
    buildRecord: buildRecord, incorporate: incorporate, decline: decline,
    overlayPlan: overlayPlan, saveAccepted: saveAccepted,
    esc: esc, safePreviewUrl: safePreviewUrl
  };

  if (typeof document === "undefined") return api;

  /* ==================================================================== DOM */

  var RECORD_URL = "./record.json";
  var LIVE_ROOT = "/__live/";
  var STATUS_URL = "./live-status.json";
  var VISUALS_URL = "./visuals/manifest.json";

  var DATA = null, VISUALS = {}, RULEABLES = [];
  var picks = {}, texts = {}, rulingDirty = {}, recorded = {};
  var comments = [], annotations = [], deletedIds = {}, dirtyIds = {};
  var putInFlight = null, autosaveTimer = null, autosaveFails = 0;
  var pvSource = "live", overlay = null, liveOrigin = null, liveSha = null;
  /* Compare state. `cPending` is a Revise B / Neither click still waiting for
     its note -- shown as pressed, never written. `cCommits` is a ruling the
     person clicked and the file has not confirmed yet. `cNotes`/`cNoteDirty`
     is typed text, which autosaves on its own because typing is not a ruling. */
  var cPending = {}, cCommits = {}, cNotes = {}, cNoteDirty = {}, cMsg = {}, cTimers = {};
  var gPending = {}, gCommits = {}, gNotes = {}, gMsg = {}, gRequests = [];
  var cSignature = "";

  function el(id) { return document.getElementById(id); }

  function setStatus(msg, cls) {
    var n = el("status-line");
    if (!n) return;
    n.textContent = msg || "";
    n.className = "status-line" + (cls ? " " + cls : "");
  }

  /* Compares have their own board, where an answered item stays in place with
     its answer beside it, so the Open view lists the other two arrays only. */
  function openList() {
    return RULEABLES.filter(function (r) {
      return r.source !== "compares" && lane(pickApplied(r)) === "open";
    });
  }
  function compareList() {
    return RULEABLES.filter(function (r) { return r.source === "compares"; });
  }
  function ruledList() {
    return RULEABLES.filter(function (r) { return lane(pickApplied(r)) === "ruled"; });
  }
  /* A PICK IS NOT A RULING.
     Only a recorded decision -- the person pressed "Use this" -- moves a card
     out of the open lane. Applying a bare pick made the card vanish under the
     cursor the instant an option was touched, before the person had read the
     other options or typed their wording. Caught by clicking the first option
     in a browser and watching the count go 2 -> 1. */
  function pickApplied(r) {
    if (!recorded[r.id]) return r;
    var copy = Object.create(r);
    copy.chosen = picks[r.id];
    return copy;
  }

  function visualFor(id) {
    var v = VISUALS[id];
    return v && v.file ? v : null;
  }

  /* "I don't know what this refers to, where it is in the UI or what it looks
     like." A card answers that BEFORE it asks its question: a picture of the
     element, or the words themselves, or an honest line saying neither exists. */
  function whatThisIsHtml(r) {
    var v = visualFor(r.id);
    if (v) {
      return '<div class="d-what"><img class="d-shot" src="' + esc("./visuals/" + v.file) +
        '" alt="' + esc(r.title) + ' as it appears in the app" loading="lazy"' +
        (v.width ? ' width="' + esc(v.width) + '"' : "") +
        (v.height ? ' height="' + esc(v.height) + '"' : "") + ">" +
        (v.capturedAt ? '<span class="d-shot-cap">' + esc("Captured " + v.capturedAt) + "</span>" : "") +
        "</div>";
    }
    var raw = r.raw || {};
    if (raw.before != null || raw.after != null) {
      var cells = "";
      if (raw.before != null) {
        cells += '<div class="d-text-cell"><span class="d-text-k">Now</span>' +
          '<div class="d-text-v">' + esc(raw.before) + "</div></div>";
      }
      if (raw.after != null) {
        cells += '<div class="d-text-cell"><span class="d-text-k">Proposed</span>' +
          '<div class="d-text-v">' + esc(raw.after) + "</div></div>";
      }
      return '<div class="d-what"><div class="d-text-pair">' + cells + "</div></div>";
    }
    if (r.target && (r.target.section || r.target.surface)) {
      return '<div class="d-what"><p class="d-missing">' +
        esc([r.target.surface, r.target.section].filter(Boolean).join(" — ")) +
        ". No picture captured for this one yet.</p></div>";
    }
    return '<div class="d-what"><p class="d-missing">No picture captured for this one yet.</p></div>';
  }

  function moreHtml(r) {
    var bits = "";
    var full = String(r.why || "");
    if (full && condense(full, 35, 2) !== full) bits += "<p>" + esc(full) + "</p>";
    var raw = r.raw || {};
    var rows = [
      ["What changes", raw.impact], ["Recommendation", raw.recommendation],
      ["Why it matters", raw.whyItMatters], ["What happens next", raw.nextStep],
      ["Captured from", raw.source]
    ].filter(function (p) { return p[1]; });
    if (rows.length) {
      bits += "<dl>" + rows.map(function (p) {
        return "<dt>" + esc(p[0]) + "</dt><dd>" + esc(p[1]) + "</dd>";
      }).join("") + "</dl>";
    }
    if (r.status) bits += '<p class="d-status">' + esc(r.status) + "</p>";
    return bits;
  }

  function cardHtml(r, n) {
    var picked = Object.prototype.hasOwnProperty.call(picks, r.id) ? picks[r.id] : r.chosen;
    var shortWhy = condense(r.why || r.prompt, 35, 2);
    var more = moreHtml(r);
    var opts = r.choices.map(function (o) {
      var on = picked === o.key;
      var lab = splitLabel(o.letter ? o.letter + ". " + o.label : o.label, 12);
      var sub = [lab.tail, o.note].filter(Boolean).join(" ");
      var li = '<li><button type="button" class="d-opt' + (on ? " picked" : "") +
        '" data-pick="' + esc(r.id) + "::" + esc(o.key) + '" aria-pressed="' + (on ? "true" : "false") + '">' +
        '<span class="d-opt-label">' + esc(lab.head) + "</span>" +
        (sub ? '<span class="d-opt-note">' + esc(sub) + "</span>" : "") +
        (o.cost ? '<span class="d-opt-cost">' + esc(o.cost) + "</span>" : "") +
        "</button></li>";
      if (on && o.needsText) {
        li += '<li class="d-field"><label for="t-' + esc(r.id) + '">Your wording. Saved with this decision.</label>' +
          '<textarea id="t-' + esc(r.id) + '" data-text="' + esc(r.id) + '" placeholder="Write the line you want.">' +
          esc(texts[r.id] != null ? texts[r.id] : (r.freeText || "")) + "</textarea></li>";
      }
      return li;
    }).join("");

    return '<article class="d-card" data-decision="' + esc(r.id) + '">' +
      '<div class="d-head"><span class="d-num" data-num>' + n + "</span>" +
      '<h2 class="d-q">' + esc(r.title) + "</h2></div>" +
      whatThisIsHtml(r) +
      (shortWhy ? '<p class="d-why">' + esc(shortWhy) + "</p>" : "") +
      (more ? '<button type="button" class="d-more-btn" data-more="' + esc(r.id) +
        '" aria-expanded="false" aria-controls="m-' + esc(r.id) + '">more</button>' +
        '<div class="d-more" id="m-' + esc(r.id) + '" hidden>' + more + "</div>" : "") +
      '<ul class="d-opts">' + opts + "</ul>" +
      '<div class="d-foot"><button type="button" class="d-use" data-use="' + esc(r.id) + '"' +
      (picked ? "" : " disabled") + ">Use this</button>" +
      '<span class="d-hint">' + (picked ? esc("Records: " + picked) : "Pick one to record it.") +
      "</span></div></article>";
  }

  function renderOpen() {
    var list = openList();
    var h = el("open-h1");
    h.textContent = list.length
      ? list.length + (list.length === 1 ? " decision waiting for you" : " decisions waiting for you")
      : "Nothing is waiting for you";
    /* nosec: every value interpolated into this markup passes through esc(),
       which replaces & < > " and '. A decision record is untrusted input -- an
       agent writes into it and it travels between repositories -- so this was
       proved rather than assumed: a record carrying
       `<img src=x onerror="window.__pwned=1">` in its question, why, status,
       before/after, option label and annotation note renders every one as
       literal text (0 injected nodes, no handler fires), and stripping esc()
       turns the same record into 3 injected <img> and window.__pwned=1.
       Measured 2026-09-14 in a real browser. Escaping at the interpolation
       point is the mitigation; DOMPurify would add a dependency to a
       zero-dependency surface to re-solve a solved problem. */
    el("open-stack").innerHTML = list.map(function (r, i) { return cardHtml(r, i + 1); }).join("");  // nosec: every interpolated value passes through esc(); proved by mutation, see above
    el("open-stack").hidden = !list.length;
    paintFoot();
  }

  function renderRuled() {
    var list = ruledList();
    /* nosec: every value interpolated into this markup passes through esc(),
       which replaces & < > " and '. A decision record is untrusted input -- an
       agent writes into it and it travels between repositories -- so this was
       proved rather than assumed: a record carrying
       `<img src=x onerror="window.__pwned=1">` in its question, why, status,
       before/after, option label and annotation note renders every one as
       literal text (0 injected nodes, no handler fires), and stripping esc()
       turns the same record into 3 injected <img> and window.__pwned=1.
       Measured 2026-09-14 in a real browser. Escaping at the interpolation
       point is the mitigation; DOMPurify would add a dependency to a
       zero-dependency surface to re-solve a solved problem. */
    el("ruled-list").innerHTML = list.length ? list.map(function (r) {  // nosec: every interpolated value passes through esc(); proved by mutation, see above
      var raw = r.raw || {};
      var rec = raw.receipt;
      var chosen = Object.prototype.hasOwnProperty.call(picks, r.id) ? picks[r.id] : r.chosen;
      return '<li class="ruled-item"><p class="ruled-q">' + esc(r.title) + "</p>" +
        '<div class="ruled-what">' + esc(r.addressed && !truthy(chosen) ? "Settled elsewhere"
          : (r.source === "compares" ? compareLabel(chosen) : String(chosen))) + "</div>" +
        (r.ruledAt ? '<div class="ruled-when">' + esc(r.ruledAt) + "</div>" : "") +
        (r.freeText ? '<div class="ruled-text">' + esc(r.freeText) + "</div>" : "") +
        (rec ? '<dl class="receipt">' + Object.keys(rec).map(function (k) {
          return "<dt>" + esc(k) + "</dt><dd>" + esc(rec[k]) + "</dd>";
        }).join("") + "</dl>" : "") + "</li>";
    }).join("") : '<li class="ruled-item" style="box-shadow:none">Nothing ruled yet.</li>';
  }

  function renderReference() {
    var lc = (DATA && DATA.lifecycle) || {};
    var live = comments.concat(annotations);
    var hist = (DATA && DATA.history) || [];
    var noteRow = function (it, archived) {
      var d = it.disposition;
      var cls = "note-item" + (d === "declined" ? " declined" : "") + (it.unsaved ? " unsaved-item" : "");
      return '<li class="' + cls + '">' +
        (d ? '<span class="disp ' + esc(d) + '">' + esc(d) + "</span> " : "") +
        "<span>" + esc(it.note || it.text || "(no text)") + "</span>" +
        (it.selector ? '<div class="note-el">' + esc(it.selector) + "</div>" : "") +
        (d === "declined" && it.declinedReason ? '<div class="note-reason">' + esc(it.declinedReason) + "</div>" : "") +
        (archived && it.receipt ? '<div class="note-reason">' + esc(JSON.stringify(it.receipt)) + "</div>" : "") +
        (it.savedToFile ? "" : '<div class="note-reason">Not in the record yet.</div>') +
        "</li>";
    };
    /* nosec: every value interpolated into this markup passes through esc(),
       which replaces & < > " and '. A decision record is untrusted input -- an
       agent writes into it and it travels between repositories -- so this was
       proved rather than assumed: a record carrying
       `<img src=x onerror="window.__pwned=1">` in its question, why, status,
       before/after, option label and annotation note renders every one as
       literal text (0 injected nodes, no handler fires), and stripping esc()
       turns the same record into 3 injected <img> and window.__pwned=1.
       Measured 2026-09-14 in a real browser. Escaping at the interpolation
       point is the mitigation; DOMPurify would add a dependency to a
       zero-dependency surface to re-solve a solved problem. */
    el("reference-body").innerHTML =  // nosec: every interpolated value passes through esc(); proved by mutation, see above
      "<p>Record <code>" + esc((DATA && DATA.id) || "") + "</code> declaring <code>" +
      esc((DATA && DATA.schema) || "") + "</code>." +
      (lc.savedAt ? " Last written " + esc(lc.savedAt) + "." : "") + "</p>" +
      "<h2 class=\"open-h1\">Notes and pins</h2>" +
      '<ul class="note-list">' + (live.length ? live.map(function (i) { return noteRow(i, false); }).join("")
        : '<li class="note-item">None.</li>') + "</ul>" +
      "<h2 class=\"open-h1\">Archived</h2>" +
      '<ul class="note-list">' + (hist.length ? hist.map(function (i) { return noteRow(i, true); }).join("")
        : '<li class="note-item">None.</li>') + "</ul>";
  }


  /* ============================================================== compares */

  var AREA_NONE = "Other decisions";

  function compareLabel(key) {
    var c = COMPARE_CHOICES.filter(function (x) { return x.key === key; })[0];
    return c ? c.label : String(key == null ? "" : key);
  }

  /* A second opinion speaks in its own words ("approve", "Revise"), so it is
     mapped onto the four answers only for colour; unknown words stay plain. */
  function verdictKey(v) {
    var s = String(v || "").trim().toLowerCase();
    if (s === "keep" || s === "keep-a" || s === "keep a") return "keep-a";
    if (s === "approve" || s === "approve-b" || s === "approve b") return "approve-b";
    if (s === "revise" || s === "revise-b" || s === "revise b") return "revise-b";
    if (s === "other" || s === "neither") return "other";
    return "";
  }

  function cNoteValue(r) {
    return Object.prototype.hasOwnProperty.call(cNotes, r.id) ? cNotes[r.id] : (r.freeText || "");
  }

  /* What the person sees as their answer: a commit in flight wins, then the
     recorded ruling, and a pending (noteless) click is reported separately. */
  function cShown(r) {
    if (cPending[r.id]) return cPending[r.id];
    if (cCommits[r.id]) return cCommits[r.id].chosen;
    return truthy(r.chosen) ? r.chosen : null;
  }
  function cRecorded(r) { return truthy(r.chosen) ? r.chosen : null; }

  function visualHtml(r, which) {
    var opt = r.compare[which === "a" ? "optionA" : "optionB"];
    var what = which === "a" ? "Option A" : "Option B";
    var entry = VISUALS[r.id + "#" + which] || null;
    var name = opt.visual ? safeVisual(opt.visual) : (entry && entry.file ? safeVisual(entry.file) : null);
    if (opt.visual && !name) {
      return '<p class="d-missing c-missing">' + esc(what) + " names a picture this page will not load. " +
        "Use a plain file name inside visuals/.</p>";
    }
    if (!name) {
      return '<p class="d-missing c-missing">' +
        esc((entry && entry.reason) || "No picture for this option yet.") + "</p>";
    }
    var src = esc("./visuals/" + name);
    if (/\.html$/i.test(name)) {
      /* sandbox="" : no scripts, opaque origin. The server also sends a
         sandbox CSP for .html visuals, so opening one directly is inert too. */
      return '<div class="c-frame c-wire"><iframe sandbox="" loading="lazy" src="' + src +
        '" title="' + esc(what + " wireframe: " + (opt.summary || r.title)) + '"></iframe></div>' +
        '<p class="c-cap">Wireframe · not functional</p>';
    }
    return '<div class="c-frame"><img src="' + src + '" alt="' +
      esc(what + ": " + (which === "a" ? "the current page" : "the proposed page") +
        (opt.summary ? ", " + opt.summary : "")) + '" loading="lazy"></div>' +
      (entry && entry.capturedAt ? '<p class="c-cap">' + esc("Captured " + entry.capturedAt) + "</p>" : "");
  }

  /* Numbers imply a sequence. Show them only when the record declares one
     ("ordered": true); otherwise the area and the main idea identify a card. */
  function ordered() { return !!(DATA && DATA.ordered === true); }

  function compareHtml(r, n, selectedView) {
    var c = r.compare, so = c.secondOpinion, num = ordered();
    var shortWhy = condense(r.why, 35, 2);
    var choices = COMPARE_CHOICES.map(function (ch) {
      return '<button type="button" class="c-choice" data-c="' + esc(ch.key) + '" data-cpick="' +
        esc(r.id) + "::" + esc(ch.key) + '" aria-pressed="false">' + esc(ch.label) + "</button>";
    }).join("");
    var second = "";
    if (so) {
      second = '<p class="c-second">' + esc(so.source || "Second opinion") + ": " +
        (so.verdict ? '<b data-v="' + esc(verdictKey(so.verdict)) + '">' +
          esc(verdictKey(so.verdict) ? compareLabel(verdictKey(so.verdict)) : so.verdict) + "</b>" : "") +
        (so.note ? (so.verdict ? " · " : "") + esc(so.note) : "") + "</p>";
    }
    return '<section class="c-dec" id="c-' + esc(r.id) + '" tabindex="-1" data-compare="' + esc(r.id) +
      '" aria-labelledby="ch-' + esc(r.id) + '">' +
      '<div class="c-head' + (num ? "" : " no-num") + '">' +
      (num ? '<span class="c-big" aria-hidden="true">' + n + "</span>" : "") +
      '<span class="c-area">' + (num ? "Decision " + n + (c.area ? " · " : "") : "") + esc(c.area || (num ? "" : "Decision")) +
      (c.headline ? " · " + esc(c.headline) : "") + "</span>" +
      '<h2 class="c-q" id="ch-' + esc(r.id) + '">' + esc(r.title) + "</h2>" +
      implementationHtml({ id: r.id, items: [r] }) +
      (shortWhy ? '<p class="c-why">' + esc(shortWhy) + "</p>" : "") + "</div>" +
      '<div class="c-pair">' +
      '<div class="c-side" data-side="a"><div class="c-opt-h"><span class="c-k c-k-a">A · Keep as is</span>' +
      '<span class="c-s">' + esc(c.optionA.summary || "What exists now.") + "</span></div>" + visualHtml(r, "a") + "</div>" +
      '<div class="c-side" data-side="b"><div class="c-opt-h"><span class="c-k c-k-b">B · Proposed</span>' +
      '<span class="c-s">' + esc(c.optionB.summary || "The proposed change.") + "</span></div>" + visualHtml(r, "b") + "</div>" +
      "</div>" +
      '<div class="c-resp">' +
      '<div class="c-choices" role="group" aria-label="' + esc("Your answer to decision " + n) + '">' + choices + "</div>" +
      '<label class="c-label" for="cn-' + esc(r.id) + '">Note. Required for Revise B (what to change) and Neither (what you want instead).</label>' +
      '<textarea class="c-note" id="cn-' + esc(r.id) + '" data-cnote="' + esc(r.id) + '" aria-describedby="ce-' + esc(r.id) + '">' +
      esc(cNoteValue(r)) + "</textarea>" +
      '<p class="c-err" id="ce-' + esc(r.id) + '" hidden></p>' +
      '<div class="c-foot"><button type="button" class="d-use c-record" data-crecord="' + esc(r.id) + '" hidden>Record</button>' +
      '<span class="c-saved" data-csaved="' + esc(r.id) + '" role="status" aria-live="polite"></span></div>' +
      second + "</div>" +
      '<a class="c-back" href="' + (selectedView ? '#selected-top' : '#compare-top') + '">Back to index</a>' +
      "</section>";
  }

  function compareStatusText(r) {
    var pend = cPending[r.id];
    if (pend) return { text: compareLabel(pend) + " · needs a note", c: "pending" };
    var shown = cShown(r);
    if (!shown) return { text: "No response yet", c: "" };
    return { text: compareLabel(shown) + (cNoteValue(r).trim() ? " · note" : ""), c: shown };
  }

  function groupsOf(list) {
    var order = [], by = {};
    list.forEach(function (r, i) {
      var g = r.compare.area || AREA_NONE;
      if (!by[g]) { by[g] = []; order.push(g); }
      by[g].push({ r: r, n: i + 1 });
    });
    return order.map(function (g) { return { name: g, items: by[g] }; });
  }

  function implementationHtml(set) {
    var state = implementationLane(DATA || {}, set);
    return '<div class="work-state work-' + state.key + '"><span class="work-tag">' +
      esc(state.label) + '</span>' + (state.evidence.length
        ? '<ul class="work-evidence">' + state.evidence.map(function (item) {
          return '<li>' + esc(item.detail) + (item.ref ? ' <code>' + esc(item.ref) + '</code>' : '') +
            (item.revision ? ' <span>Revision ' + esc(item.revision) + '</span>' : '') + '</li>';
        }).join("") + '</ul>' : '') + '</div>';
  }

  function selectedCardHtml(set, isOpen) {
    var state = implementationLane(DATA || {}, set);
    var selection = (DATA && DATA.groupSelections && DATA.groupSelections[set.id]) || {};
    var chosen = set.items.length > 1 ? selection.selected : (selection.selected || set.items[0].chosen);
    var proposal = selectedProposal(set, chosen);
    var title = set.items.length > 1 ? set.name : set.items[0].title;
    var label = proposal && proposal.summary ? proposal.summary
      : chosen === "current" || chosen === "keep-a" ? "Keep current"
      : chosen === "other" ? "Neither" : "Selected choice";
    return '<details class="selected-card" data-selected-card="' + esc(set.id) + '"' +
      (isOpen ? ' open' : '') + '>' +
      '<summary><span class="selected-card-text"><strong>' + esc(title) + '</strong>' +
      '<span class="selected-choice">' + esc(label) + '</span></span>' +
      '<span class="work-state work-' + state.key + '"><span class="work-tag">' + esc(state.label) +
      '</span></span></summary><div class="selected-card-body">' +
      (set.items.length > 1 ? groupHtml(set) : compareHtml(set.items[0], 1, true)) +
      '</div></details>';
  }

  function groupHtml(set) {
    var first = set.items[0];
    var saved = (DATA && DATA.groupSelections && DATA.groupSelections[set.id]) || {};
    var proposals = set.items.map(function (r) {
      var prior = cRecorded(r);
      return '<article class="g-option" data-goption="' + esc(r.id) + '">' +
        '<h3>' + esc(r.title.replace(/\?$/, "")) + '</h3>' +
        '<p class="g-change">' + esc(r.compare.optionB.summary || "Proposed version") + '</p>' +
        visualHtml(r, "b") +
        '<button type="button" class="g-pick" data-gpick="' + esc(set.id) + '" data-choice="' + esc(r.id) +
        '" aria-pressed="false">Choose this version</button>' +
        (prior ? '<p class="g-prior">Earlier feedback: ' + esc(compareLabel(prior)) +
          (cNoteValue(r).trim() ? ' · ' + esc(cNoteValue(r)) : "") + '</p>' : "") +
        '</article>';
    }).join("");
    return '<section class="g-set" id="g-' + esc(set.id) + '" tabindex="-1" data-group="' + esc(set.id) +
      '" style="--card-width:260px" aria-labelledby="gh-' + esc(set.id) + '">' +
      '<div class="g-heading"><div><p class="g-kicker">Compare ' + set.items.length + ' versions</p>' +
      '<h2 id="gh-' + esc(set.id) + '">' + esc(set.name) + '</h2>' + implementationHtml(set) + '</div>' +
      '<label class="g-size">Preview size <input type="range" min="200" max="360" step="20" value="260" data-gsize="' +
      esc(set.id) + '" aria-label="Preview size for ' + esc(set.name) + '"><output>260 px</output></label></div>' +
      '<p class="g-direction">Choose one version from this row. Scroll sideways to see the rest.</p>' +
      '<div class="g-strip" role="group" aria-label="' + esc(set.name) + ' versions">' +
      '<article class="g-current" data-goption="current"><h3>Current</h3>' +
      '<p>' + esc(first.compare.optionA.summary || "What exists now") + '</p>' +
      visualHtml(first, "a") +
      '<button type="button" class="g-pick" data-gpick="' + esc(set.id) +
      '" data-choice="current" aria-pressed="false">Keep current</button></article>' +
      proposals + '</div>' +
      '<div class="g-decision"><label for="gn-' + esc(set.id) + '">Comment (saved with your choice, or sent with Ask for new options)</label>' +
      '<textarea id="gn-' + esc(set.id) + '" data-gnote="' + esc(set.id) +
      '" placeholder="Comment, change request, or what new options should try">' + esc(gNotes[set.id] == null ? (saved.note || "") : gNotes[set.id]) + '</textarea>' +
      '<div class="g-actions"><button type="button" class="d-use" data-gsave="' + esc(set.id) + '">Save choice</button>' +
      '<button type="button" class="g-ask" data-gask="' + esc(set.id) + '" title="Saves your note as a request; the agent adds new versions to this row">Ask for new options</button></div>' +
      '<span class="g-status" data-gstatus="' + esc(set.id) + '" role="status" aria-live="polite"></span>' +
      '<p class="g-requests" data-greq="' + esc(set.id) + '"></p></div>' +
      '</section>';
  }

  function paintGroup(set) {
    var node = document.querySelector('[data-group="' + cssEsc(set.id) + '"]');
    if (!node) return;
    var saved = (DATA && DATA.groupSelections && DATA.groupSelections[set.id]) || {};
    var chosen = gPending[set.id] || saved.selected || null;
    node.querySelectorAll("[data-gpick]").forEach(function (button) {
      var on = button.getAttribute("data-choice") === chosen;
      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.closest("[data-goption]").classList.toggle("chosen", on);
    });
    var noteNode = node.querySelector("[data-gnote]");
    var noteNow = noteNode ? noteNode.value : "";
    var inSync = !!saved.selected && !gPending[set.id] && !gCommits[set.id] &&
      noteNow === (saved.note || "");
    var changed = !!chosen && !inSync && !gCommits[set.id];
    node.classList.toggle("g-is-saved", inSync);
    node.classList.toggle("g-is-unsaved", changed && !!gPending[set.id]);
    var save = node.querySelector("[data-gsave]");
    if (save) {
      save.disabled = !chosen || inSync || !!gCommits[set.id];
      save.textContent = gCommits[set.id] ? "Saving…" : (inSync ? "Saved \u2713" : "Save choice");
    }
    var status = node.querySelector("[data-gstatus]");
    if (status) {
      var err = gMsg[set.id] && gMsg[set.id].indexOf("Not saved") === 0;
      var label = saved.selected === "current" ? "Keep current"
        : (byId(saved.selected) ? String(byId(saved.selected).title || saved.selected).split(" \u00b7 ")[0] : saved.selected);
      status.textContent = err ? gMsg[set.id]
        : gCommits[set.id] ? "Saving\u2026"
        : inSync ? "\u2713 Saved: " + label + " at " + localTime(saved.ruledAt) + ". It is in the record file."
        : chosen && gPending[set.id] ? "Not saved yet. Press Save choice."
        : saved.selected ? "Comment changed. Press Save choice to keep it."
        : "No version chosen yet";
      status.className = "g-status" + (err ? " err" : inSync ? " ok" : changed ? " warn" : "");
    }
    var reqNode = node.querySelector("[data-greq]");
    if (reqNode) {
      var reqs = ((DATA && DATA.optionRequests) || []).filter(function (q) { return q.group === set.id; });
      var open = reqs.filter(function (q) { return q.status !== "done"; });
      reqNode.textContent = open.length
        ? "New options requested at " + localTime(open[open.length - 1].requestedAt) + ": \u201c" + open[open.length - 1].note + "\u201d. The agent adds them to this row."
        : "";
    }
    var ask = node.querySelector("[data-gask]");
    if (ask) ask.disabled = !noteNow.trim() || !!gCommits[set.id];
  }

  /* Built once per set of ids; afterwards only painted, so typing in a note is
     never interrupted by a re-render that replaces the field under the cursor. */
  function renderCompare() {
    var list = compareList();
    var sets = comparisonSets(list);
    var buckets = comparisonBuckets(DATA || {}, sets);
    var pendingItems = [];
    buckets.pending.forEach(function (set) { pendingItems = pendingItems.concat(set.items); });
    var grouped = buckets.pending.some(function (set) { return set.items.length > 1; });
    var sig = compareRenderSignature(list, DATA);
    var box = el("c-list");
    if (!box) return;
    document.body.classList.toggle("has-groups", grouped);
    var gallery = el("g-list");
    if (gallery) gallery.hidden = !buckets.pending.length;
    var empty = el("compare-empty");
    if (empty) empty.hidden = !list.length || !!buckets.pending.length;
    var old = el("legacy-compare");
    if (old) {
      old.hidden = !!list.length;
    }
    if (sig !== cSignature) {
      cSignature = sig;
      /* nosec: every value interpolated into the compare markup passes through
         esc(); visual file names additionally pass safeVisual(), a leaf-name
         allowlist. Same mitigation, and same mutation proof, as the cards. */
      el("c-jump").innerHTML = !ordered() ? "" : pendingItems.map(function (r, i) {  // nosec: esc() on every value
        return '<a href="#c-' + esc(r.id) + '" data-cjump="' + esc(r.id) + '">' + (i + 1) + "</a>";
      }).join("");
      document.body.classList.toggle("c-ordered", ordered());
      el("c-index").innerHTML = '<ul class="c-cards" aria-label="Decisions">' +  // nosec: esc() on every value
        groupsOf(pendingItems).map(function (g) {
          return g.items.map(function (it) {
            var head = it.r.compare.headline;
            return '<li><a class="c-card" href="#c-' + esc(it.r.id) + '">' +
              '<span class="c-cat">' + (ordered() ? '<span class="c-no">' + it.n + "</span> " : "") + esc(g.name) + "</span>" +
              '<span class="c-tt">' + esc(head || it.r.title) + "</span>" +
              (head ? '<span class="c-sub">' + esc(it.r.title) + "</span>" : "") +
              '<span class="c-st" data-cst="' + esc(it.r.id) + '"></span></a></li>';
          }).join("");
        }).join("") + "</ul>";
      box.innerHTML = ""; // nosec: constant empty markup clears the legacy duplicate.
      if (gallery) {
        gallery.innerHTML = buckets.pending.map(function (set) { // nosec: groupHtml/compareHtml escape record text and validate visual file names.
          return set.items.length > 1 ? groupHtml(set) : compareHtml(set.items[0], 1);
        }).join("");
      }
      var selectedList = el("selected-list");
      if (selectedList) {
        var openCards = {}, openLanes = {};
        selectedList.querySelectorAll("details[data-selected-card]").forEach(function (node) {
          openCards[node.getAttribute("data-selected-card")] = node.open;
        });
        selectedList.querySelectorAll("details[data-work-lane]").forEach(function (node) {
          openLanes[node.getAttribute("data-work-lane")] = node.open;
        });
        selectedList.innerHTML = [ // nosec: selectedCardHtml and nested comparison builders escape record text and validate visual file names.
          { key: "in-progress", label: "In progress", open: true },
          { key: "pending", label: "Pending", open: false },
          { key: "complete", label: "Complete", open: false }
        ].map(function (laneInfo) {
          var matching = buckets.selected.filter(function (set) {
            return implementationLane(DATA || {}, set).key === laneInfo.key;
          });
          var isOpen = Object.prototype.hasOwnProperty.call(openLanes, laneInfo.key)
            ? openLanes[laneInfo.key] : laneInfo.open;
          return '<details class="work-lane" data-work-lane="' + laneInfo.key + '"' +
            (isOpen ? ' open' : '') + '><summary><span>' + laneInfo.label +
            '</span><span class="work-count">' + matching.length + '</span></summary><div class="selected-cards">' +
            (matching.length ? matching.map(function (set) {
              return selectedCardHtml(set, openCards[set.id]);
            }).join("") : '<p class="work-empty">No choices here.</p>') + '</div></details>';
        }).join("");
      }
    }
    list.forEach(function (r) { paintCompare(r.id); });
    sets.forEach(paintGroup);
    paintProgress();
  }

  function byId(id) { return RULEABLES.filter(function (x) { return x.id === id && x.source === "compares"; })[0]; }

  function paintCompare(id) {
    var r = byId(id);
    var sec = document.querySelector('[data-compare="' + cssEsc(id) + '"]');
    if (!r || !sec) return;
    var shown = cShown(r), pend = cPending[id] || null;
    sec.querySelectorAll(".c-choice").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-c") === shown ? "true" : "false");
    });
    sec.querySelector('[data-side="a"]').classList.toggle("chosen", shown === "keep-a");
    sec.querySelector('[data-side="b"]').classList.toggle("chosen", shown === "approve-b" || shown === "revise-b");
    var note = sec.querySelector("[data-cnote]");
    var err = sec.querySelector(".c-err");
    var rec = sec.querySelector("[data-crecord]");
    var problem = pend ? compareNoteError(pend, note ? note.value : "") : null;
    if (note) note.setAttribute("aria-invalid", problem ? "true" : "false");
    if (err) {
      err.hidden = !problem;
      err.textContent = problem ? "Add a note to record " + compareLabel(pend) + ": " + problem + "." : "";
    }
    if (rec) {
      rec.hidden = !pend;
      rec.disabled = !!problem;
      rec.textContent = pend ? "Record " + compareLabel(pend) : "Record";
    }
    var saved = sec.querySelector("[data-csaved]");
    if (saved) {
      var m = cMsg[id];
      saved.textContent = m ? m.text : (cRecorded(r) ? "Recorded" + (r.ruledAt ? " " + r.ruledAt : "") : "");
      saved.className = "c-saved" + (m && m.err ? " err" : "");
    }
    var st = compareStatusText(r);
    document.querySelectorAll('[data-cst="' + cssEsc(id) + '"]').forEach(function (n) {
      n.textContent = st.text; n.setAttribute("data-c", st.c);
    });
    document.querySelectorAll('[data-cjump="' + cssEsc(id) + '"]').forEach(function (n) {
      n.setAttribute("data-c", st.c);
      n.setAttribute("aria-label", "Decision " + n.textContent + ": " + st.text);
    });
  }

  function paintProgress() {
    var sets = comparisonSets(compareList());
    var remaining = comparisonBuckets(DATA || {}, sets).pending.length;
    if (sets.some(function (set) { return set.items.length > 1; })) {
      var doneGroups = sets.filter(function (set) {
        return set.items.length > 1
          ? !!(DATA.groupSelections && DATA.groupSelections[set.id] && DATA.groupSelections[set.id].selected)
          : !!cRecorded(set.items[0]);
      }).length;
      var heading = el("compare-h1");
      if (heading) heading.textContent = remaining + (remaining === 1 ? " comparison" : " comparisons") + " to decide";
      el("c-done").textContent = String(doneGroups);
      el("c-total").textContent = String(sets.length);
      el("c-split").textContent = "Earlier A/B feedback stays with each version.";
      return;
    }
    var list = compareList(), done = 0, c = { "keep-a": 0, "approve-b": 0, "revise-b": 0, "other": 0 };
    list.forEach(function (r) {
      var k = cCommits[r.id] ? cCommits[r.id].chosen : cRecorded(r);
      if (k && Object.prototype.hasOwnProperty.call(c, k)) { done++; c[k]++; }
    });
    var h = el("compare-h1");
    if (h) h.textContent = remaining + (remaining === 1 ? " comparison" : " comparisons") + " to decide";
    var d = el("c-done"); if (d) d.textContent = String(done);
    var t = el("c-total"); if (t) t.textContent = String(list.length);
    var sp = el("c-split");
    if (sp) {
      sp.textContent = done ? c["approve-b"] + " approve B · " + c["revise-b"] + " revise B · " +
        c["keep-a"] + " keep A · " + c.other + " neither" : "";
    }
  }

  function cssEsc(s) {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(String(s));
    return String(s).replace(/["\\\n\r\f]/g, function (c) {
      return c === '"' || c === "\\" ? "\\" + c : "\\" + c.charCodeAt(0).toString(16) + " ";
    });
  }

  function setCMsg(id, text, isErr) {
    cMsg[id] = text ? { text: text, err: !!isErr } : null;
    paintCompare(id);
  }

  /* Local wall-clock time for people ("10:53 AM"); falls back to the raw stamp. */
  function localTime(stamp) {
    var s = String(stamp || "");
    var m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
    var d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : new Date(s);
    return isNaN(d.getTime()) ? s : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  var toastTimer = null;
  function toast(text, isErr) {
    var n = el("save-toast");
    if (!n) {
      n = document.createElement("div");
      n.id = "save-toast"; n.className = "save-toast";
      n.setAttribute("role", "status"); n.setAttribute("aria-live", "polite");
      document.body.appendChild(n);
    }
    n.textContent = text;
    n.classList.toggle("err", !!isErr);
    n.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.classList.remove("show"); }, isErr ? 6000 : 3000);
  }

  function clock(savedAt) {
    var m = /T(\d{2})(\d{2})(\d{2})Z$/.exec(String(savedAt || ""));
    return m ? m[1] + ":" + m[2] + ":" + m[3] + " UTC" : String(savedAt || "");
  }

  /* A ruling commits on the explicit click and nowhere else. */
  function commitCompare(id, key) {
    var r = byId(id);
    if (!r) return;
    var note = cNoteValue(r);
    /* An empty note is not written with the ruling: a cleared note reaches the
       file through the note autosave, which is the path that owns note text. */
    var mine = { source: "compares", chosen: key, freeText: note.trim() ? note : null,
      ruledAt: new Date().toISOString() };
    cCommits[id] = mine;
    delete cPending[id];
    setCMsg(id, "Saving…");
    putRecord("compare").then(function (j) {
      /* Report only what the file now holds. A newer click still queued owns
         the message; it will report when its own write lands. */
      if (!cCommits[id]) {
        var now = byId(id);
        setCMsg(id, now && cRecorded(now)
          ? "Saved " + compareLabel(now.chosen) + " at " + clock(j.savedAt) + "." : "");
      }
      render();
      navigateView("selected", true);
    }).catch(function (e) {
      /* Drop only THIS click. A newer one queued behind it must survive. */
      if (cCommits[id] === mine) {
        delete cCommits[id];
        setCMsg(id, "Not saved: " + e.message + ". Press " + compareLabel(key) + " again to retry.", true);
      }
      render();
    });
  }

  function onComparePick(id, key) {
    var r = byId(id);
    if (!r) return;
    var note = cNoteValue(r);
    if (compareNoteError(key, note)) {
      cPending[id] = key;
      setCMsg(id, "Not recorded yet.");
      paintProgress();
      var ta = el("cn-" + id);
      if (ta) ta.focus();
      return;
    }
    commitCompare(id, key);
  }

  function scheduleNoteSave(id) {
    if (cTimers[id]) clearTimeout(cTimers[id]);
    cTimers[id] = setTimeout(function () {
      setCMsg(id, "Saving note…");
      putRecord("notes").then(function (j) {
        setCMsg(id, "Note saved at " + clock(j.savedAt) + (cPending[id] ? ". " + compareLabel(cPending[id]) + " is not recorded until you press Record." : "."));
        render();
      }).catch(function (e) {
        setCMsg(id, "Note not saved: " + e.message, true);
      });
    }, 800);
  }

  function paintCounts() {
    var o = openList().length, r = ruledList().length;
    document.querySelectorAll('[data-count="open"]').forEach(function (n) { n.textContent = o ? String(o) : ""; });
    document.querySelectorAll('[data-count="ruled"]').forEach(function (n) { n.textContent = r ? String(r) : ""; });
    var cl = compareList(), buckets = comparisonBuckets(DATA || {}, comparisonSets(cl));
    var co = buckets.pending.length, chosen = buckets.selected.length;
    document.querySelectorAll('[data-count="compare"]').forEach(function (n) { n.textContent = co ? String(co) : ""; });
    document.querySelectorAll('[data-count="selected"]').forEach(function (n) { n.textContent = chosen ? String(chosen) : ""; });
    var ct = el("tab-compare");
    if (ct) ct.hidden = !cl.length;
    var st = el("tab-selected");
    if (st) st.hidden = !chosen;
  }

  function unsavedCount() {
    var n = comments.concat(annotations).filter(function (i) { return i.unsaved; }).length;
    return n + Object.keys(rulingDirty).length;
  }

  /* One quiet line at the foot. Nothing else reports save state in this view. */
  function paintFoot() {
    var f = el("quiet-foot");
    if (!f) return;
    var u = unsavedCount();
    var lc = (DATA && DATA.lifecycle) || {};
    f.textContent = u ? u + (u === 1 ? " unsaved change" : " unsaved changes")
      : (lc.serverSavedAt ? "Saved " + lc.serverSavedAt : (lc.savedAt ? "Saved " + lc.savedAt : ""));
    f.className = "quiet-foot" + (u ? " has-unsaved" : "");
    var b = el("save-rulings");
    if (b) b.disabled = !Object.keys(rulingDirty).length;
  }

  function render() { renderOpen(); renderRuled(); renderReference(); renderCompare(); paintCounts(); }

  /* ------------------------------------------------------------------ save */

  function memState(scope) {
    var rulings = {};
    var notes = {};
    Object.keys(cNoteDirty).forEach(function (id) {
      notes[id] = { source: "compares", freeText: cNotes[id] };
    });
    if (scope === "group") {
      return {
        previewComments: comments, annotations: annotations,
        history: (DATA && DATA.history) || [],
        deletedIds: deletedIds, dirty: dirtyIds, notes: notes,
        groupSelections: Object.assign({}, gCommits),
        optionRequests: gRequests.slice()
      };
    }
    if (scope === "compare") {
      Object.keys(cCommits).forEach(function (id) {
        var c = cCommits[id], r = byId(id), now = r ? cNoteValue(r) : "";
        rulings[id] = { source: c.source, chosen: c.chosen, ruledAt: c.ruledAt,
          freeText: now.trim() ? now : null, commit: c };
      });
      return {
        previewComments: comments, annotations: annotations,
        history: (DATA && DATA.history) || [],
        deletedIds: deletedIds, dirty: dirtyIds, rulings: rulings, notes: notes
      };
    }
    Object.keys(rulingDirty).forEach(function (id) {
      var r = RULEABLES.filter(function (x) { return x.id === id; })[0];
      if (!r) return;
      rulings[id] = {
        source: r.source, chosen: picks[id],
        freeText: texts[id] != null ? texts[id] : null,
        ruledAt: new Date().toISOString()
      };
    });
    return {
      previewComments: comments, annotations: annotations,
      history: (DATA && DATA.history) || [],
      deletedIds: deletedIds, dirty: dirtyIds, rulings: rulings, notes: notes
    };
  }

  function putRecord(scope) {
    var run = function () {
      /* Re-read disk FIRST. Another writer may have touched the file since this
         page loaded, and a blind overwrite would silently destroy their work. */
      return fetch(RECORD_URL, { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("could not re-read the record (HTTP " + r.status + ")");
          return r.json();
        })
        .then(function (disk) {
          var mem = memState(scope);
          var body = buildRecord(disk, mem, scope);
          return fetch(RECORD_URL, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body, null, 2)
          }).then(function (res) {
            return res.json().catch(function () { return null; }).then(function (j) {
              if (!saveAccepted(res.ok, j)) {
                throw new Error((j && j.error) || "the server did not confirm the write (HTTP " + res.status + ")");
              }
              DATA = body;
              DATA.lifecycle.serverSavedAt = j.savedAt;
              /* Provenance, per item, and only now. Anything still false is work
                 the file has never heard of. */
              comments.forEach(function (c) { c.savedToFile = true; c.unsaved = false; });
              annotations.forEach(function (a) { a.savedToFile = true; a.unsaved = false; });
              deletedIds = {}; dirtyIds = {};
              if (scope === "rulings") { rulingDirty = {}; recorded = {}; }
              if (scope === "compare") {
                Object.keys(mem.rulings).forEach(function (id) {
                  if (cCommits[id] === mem.rulings[id].commit) delete cCommits[id];
                });
              }
              if (scope === "group") {
                Object.keys(mem.groupSelections).forEach(function (id) {
                  if (gCommits[id] === mem.groupSelections[id]) {
                    delete gCommits[id];
                    delete gPending[id];
                  }
                });
              }
              /* Only a note whose text is unchanged since this write was built
                 is now in the file; one typed during the flight stays dirty. */
              Object.keys(mem.notes).forEach(function (id) {
                if (cNotes[id] === mem.notes[id].freeText) delete cNoteDirty[id];
              });
              RULEABLES = normalize(DATA);
              return j;
            });
          });
        });
    };
    putInFlight = (putInFlight || Promise.resolve()).then(run, run);
    return putInFlight;
  }

  /* Notes autosave; rulings never do. A ruling is a commitment and it goes to
     the file when the person says so. */
  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function () {
      putRecord("observations").then(function (j) {
        autosaveFails = 0;
        setStatus("Saved to the record at " + j.savedAt + " (" + j.bytes + " bytes).", "ok");
        render();
      }).catch(function (e) {
        autosaveFails++;
        setStatus("Not saved: " + e.message, "err");
        if (autosaveFails <= 6) setTimeout(scheduleAutosave, Math.min(30000, 1000 * Math.pow(2, autosaveFails)));
        render();
      });
    }, 2500);
  }

  /* ------------------------------------------------------------- preview */

  function setPreviewing(label, note) {
    var bar = el("pv-previewing");
    if (!bar) return;
    if (!label) { bar.hidden = true; bar.innerHTML = ""; return; }  // nosec: constant empty string, clears the bar
    bar.hidden = false;
    bar.innerHTML = "<span>Previewing: " + esc(label) + "</span>" +  // nosec: label and note both pass through esc()
      (note ? '<span class="pv-note">' + esc(note) + "</span>" : "") +
      '<button type="button" class="mini-btn" id="pv-clear">Stop previewing</button>';
    el("pv-clear").addEventListener("click", function () { overlay = null; applyOverlay(); });
  }

  function frameDoc() {
    var f = el("pv-frame");
    try { return f && f.contentDocument; } catch (e) { return null; }
  }

  function applyOverlay() {
    if (!overlay) { setPreviewing(null); return; }
    var r = RULEABLES.filter(function (x) { return x.id === overlay.id; })[0];
    if (!r) { setPreviewing(null); return; }
    var plan = overlayPlan(r, overlay.key);
    var label = r.title + " — " + overlay.key;
    if (plan.mode === "none") { setPreviewing(label, "this choice has no preview mapping"); return; }
    if (pvSource !== "live") { setPreviewing(label, "switch to Live to see this applied"); return; }
    if (plan.mode === "page") {
      if (plan.url) { el("pv-frame").src = plan.url; setPreviewing(label, "alternate page " + plan.url); }
      else setPreviewing(label, "that alternate page is not drafted yet");
      return;
    }
    var doc = frameDoc();
    if (!doc) { setPreviewing(label, "the preview is not readable from here"); return; }
    var node = plan.selector ? doc.querySelector(plan.selector) : null;
    if (!node) { setPreviewing(label, "could not find that section on the page"); return; }
    if (plan.mode === "hide") { node.style.display = "none"; setPreviewing(label); return; }
    if (plan.mode === "text") { node.textContent = plan.value; setPreviewing(label); return; }
    setPreviewing(label, "the page is already this way");
  }

  function loadPreview() {
    var f = el("pv-frame");
    if (!f) return;
    if (pvSource === "live" && liveOrigin !== null) {
      /* NOT "/": that path is the decisions app's own index, allowlisted ahead
         of the proxy, so pointing the preview at it rendered this surface
         inside itself and every overlay mutation then edited a nested copy of
         the page instead of the build being reviewed. `/__live/` is reserved by
         the server for the proxied origin root. */
      f.src = LIVE_ROOT;
    } else {
      f.srcdoc = "<!doctype html><meta charset=utf-8><body style=\"font:15px system-ui;padding:24px\">" +
        "<p>No mockup compositor is configured for this project.</p></body>";
    }
  }

  function loadLiveStatus() {
    return fetch(STATUS_URL, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s) return;
        liveOrigin = s.origin; liveSha = s.sha;
        var n = el("pv-sha");
        if (n) {
          n.textContent = s.sha
            ? "Live build · " + (s.branch || "?") + " @ " + s.sha + (s.committedAt ? " · " + s.committedAt : "")
            : "No live build";
        }
        var side = el("col-preview");
        if (side && s.origin) { side.hidden = false; el("shell").classList.add("has-preview"); }
      }).catch(function () { /* informational only; never blocks the surface */ });
  }

  /* -------------------------------------------------------------- events */

  function onPick(id, key) {
    picks[id] = key;
    /* Deliberately NOT rulingDirty: choosing an option is thinking out loud.
       Pressing "Use this" is the commitment, and that is what the file hears. */
    overlay = { id: id, key: key };
    render();
    applyOverlay();
  }

  document.addEventListener("click", function (ev) {
    var jump = ev.target.closest ? ev.target.closest('a[href^="#c-"],a[href^="#g-"]') : null;
    if (jump) {
      var destination = jump.getAttribute("href").slice(1);
      var target = el(destination);
      var view = target && target.closest(".view-selected") ? "selected" : "compare";
      if (target) showView(view);
      if (revealCompareTarget(target)) {
        ev.preventDefault();
        try { history.replaceState({ view: view }, "", "?view=" + view + "#" + encodeURIComponent(destination)); }
        catch (e) { /* file:// can refuse history updates; focus and scroll still work. */ }
      }
      return;
    }
    var t = ev.target.closest ? ev.target.closest("[data-pick],[data-use],[data-more],[data-tab],[data-pv],[data-cpick],[data-crecord],[data-gpick],[data-gsave],[data-gask]") : null;
    if (!t) return;
    if (t.hasAttribute("data-gpick")) {
      var groupId = t.getAttribute("data-gpick");
      gPending[groupId] = t.getAttribute("data-choice");
      gMsg[groupId] = "Choice ready to save";
      var set = comparisonSets(compareList()).filter(function (s) { return s.id === groupId; })[0];
      if (set) paintGroup(set);
      return;
    }
    if (t.hasAttribute("data-gsave")) {
      var saveId = t.getAttribute("data-gsave");
      var saved = (DATA.groupSelections || {})[saveId] || {};
      var selected = gPending[saveId] || saved.selected;
      if (!selected) return;
      var noteNode = el("gn-" + saveId);
      gCommits[saveId] = { selected: selected, note: noteNode ? noteNode.value : "",
        ruledAt: new Date().toISOString() };
      gNotes[saveId] = gCommits[saveId].note;
      gMsg[saveId] = "Saving…";
      putRecord("group").then(function (j) {
        gMsg[saveId] = "";
        toast("\u2713 Saved to the record at " + localTime(j && j.savedAt));
        renderCompare();
        paintCounts();
        navigateView("selected", true);
      }).catch(function (error) {
        delete gCommits[saveId];
        gMsg[saveId] = "Not saved: " + error.message;
        toast("Not saved: " + error.message, true);
        renderCompare();
      });
      return;
    }
    if (t.hasAttribute("data-gask")) {
      var askId = t.getAttribute("data-gask");
      var askNote = el("gn-" + askId);
      var text = askNote ? askNote.value.trim() : "";
      if (!text) return;
      var askSet = comparisonSets(compareList()).filter(function (s) { return s.id === askId; })[0];
      var req = { id: "req-" + askId + "-" + Date.now(), group: askId,
        area: askSet ? askSet.name : askId, note: text,
        requestedAt: new Date().toISOString(), status: "open" };
      gRequests.push(req);
      putRecord("group").then(function (j) {
        gRequests = gRequests.filter(function (q) { return q !== req; });
        toast("\u2713 Request saved at " + localTime(j && j.savedAt) + ". The agent will add new options.");
        renderCompare();
      }).catch(function (error) {
        gRequests = gRequests.filter(function (q) { return q !== req; });
        toast("Request not saved: " + error.message, true);
      });
      return;
    }
    if (t.hasAttribute("data-cpick")) {
      /* Split on the LAST "::": the ruling keys never contain it, an id may. */
      var cp = t.getAttribute("data-cpick"), at = cp.lastIndexOf("::");
      onComparePick(cp.slice(0, at), cp.slice(at + 2));
      return;
    }
    if (t.hasAttribute("data-crecord")) {
      var cid = t.getAttribute("data-crecord");
      if (cPending[cid] && !compareNoteError(cPending[cid], cNoteValue(byId(cid) || { id: cid }))) {
        commitCompare(cid, cPending[cid]);
      }
      return;
    }
    if (t.hasAttribute("data-tab")) {
      var v = t.getAttribute("data-tab");
      navigateView(v);
      return;
    }
    if (t.hasAttribute("data-pv")) {
      pvSource = t.getAttribute("data-pv");
      document.querySelectorAll("[data-pv]").forEach(function (b) {
        b.setAttribute("aria-pressed", b.getAttribute("data-pv") === pvSource ? "true" : "false");
      });
      loadPreview();
      return;
    }
    if (t.hasAttribute("data-more")) {
      var box = el("m-" + t.getAttribute("data-more"));
      var open = box.hidden;
      box.hidden = !open;
      t.setAttribute("aria-expanded", open ? "true" : "false");
      t.textContent = open ? "less" : "more";
      return;
    }
    if (t.hasAttribute("data-pick")) {
      var parts = t.getAttribute("data-pick").split("::");
      onPick(parts[0], parts.slice(1).join("::"));
      return;
    }
    if (t.hasAttribute("data-use")) {
      var id = t.getAttribute("data-use");
      if (picks[id] == null) return;
      recorded[id] = true;
      rulingDirty[id] = true;
      render();
      setStatus("Recorded. Press Save rulings to write it to the file.", "");
    }
  });

  document.addEventListener("input", function (ev) {
    var t = ev.target;
    if (t && t.hasAttribute && t.hasAttribute("data-gsize")) {
      var id = t.getAttribute("data-gsize");
      var set = document.querySelector('[data-group="' + cssEsc(id) + '"]');
      if (set) {
        set.style.setProperty("--card-width", t.value + "px");
        set.querySelector(".g-size output").textContent = t.value + " px";
      }
      return;
    }
    if (t && t.hasAttribute && t.hasAttribute("data-gnote")) {
      var gid = t.getAttribute("data-gnote");
      gNotes[gid] = t.value;
      /* Repaint only the buttons and status, never the textarea being typed in. */
      var gset = comparisonSets(compareList()).filter(function (s) { return s.id === gid; })[0];
      if (gset) paintGroup(gset);
      return;
    }
    if (t && t.hasAttribute && t.hasAttribute("data-cnote")) {
      var nid = t.getAttribute("data-cnote");
      cNotes[nid] = t.value;
      cNoteDirty[nid] = true;
      cMsg[nid] = { text: "Editing…", err: false };
      paintCompare(nid);
      scheduleNoteSave(nid);
      return;
    }
    if (t && t.hasAttribute && t.hasAttribute("data-text")) {
      texts[t.getAttribute("data-text")] = t.value;
      rulingDirty[t.getAttribute("data-text")] = true;
      paintFoot();
    }
  });

  window.addEventListener("popstate", function () {
    var v = (new URLSearchParams(location.search).get("view")) || "open";
    showView(v);
    revealHashTarget();
  });

  function revealHashTarget() {
    var id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { return false; }
    if (!/^[cg]-/.test(id)) return false;
    var target = el(id);
    if (!target) return false;
    showView(target.closest(".view-selected") ? "selected" : "compare");
    return revealCompareTarget(target);
  }

  function showView(v) {
    document.body.setAttribute("data-view", v);
    document.querySelectorAll(".tab").forEach(function (b) {
      if (b.getAttribute("data-tab") === v) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
  }

  function navigateView(v, focusHeading) {
    showView(v);
    try { history.pushState({ view: v }, "", "?view=" + v); } catch (e) { /* file:// */ }
    window.scrollTo(0, 0);
    if (focusHeading && v === "selected") {
      var heading = el("selected-h1");
      if (heading) heading.focus({ preventScroll: true });
    }
  }

  function boot() {
    var asked = new URLSearchParams(location.search).get("view");
    showView(asked || "open");

    el("save-rulings").addEventListener("click", function () {
      setStatus("Saving…", "");
      putRecord("rulings").then(function (j) {
        setStatus("Saved to the record at " + j.savedAt + " (" + j.bytes + " bytes). The server confirmed it.", "ok");
        render();
      }).catch(function (e) { setStatus("Not saved: " + e.message, "err"); });
    });
    var rf = el("pv-refresh");
    if (rf) rf.addEventListener("click", function () { loadPreview(); });

    fetch(VISUALS_URL, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) { if (m) VISUALS = m.items || m; })
      .catch(function () { /* a record with no captured visuals is normal */ })
      .then(function () { return fetch(RECORD_URL, { cache: "no-store" }); })
      .then(function (r) {
        if (!r.ok) throw new Error("could not read the record (HTTP " + r.status + ")");
        return r.json();
      })
      .then(function (rec) {
        DATA = rec;
        RULEABLES = normalize(rec);
        comments = (rec.previewComments || []).map(function (c) {
          c.savedToFile = true; c.unsaved = false; return c;
        });
        annotations = (rec.annotations || []).map(function (a) {
          a.savedToFile = true; a.unsaved = false; return a;
        });
        render();
        if (revealHashTarget()) return loadLiveStatus();
        /* An all-compare record opens on its saved choices when any exist. */
        if (!asked && compareList().length && !openList().length) {
          var buckets = comparisonBuckets(DATA, comparisonSets(compareList()));
          showView(buckets.selected.length ? "selected" : "compare");
        }
        return loadLiveStatus();
      })
      .then(function () { loadPreview(); })
      .catch(function (e) {
        el("open-h1").textContent = "This record could not be read";
        setStatus(e.message, "err");
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  api.scheduleAutosave = scheduleAutosave;
  api.putRecord = putRecord;
  return api;
});
