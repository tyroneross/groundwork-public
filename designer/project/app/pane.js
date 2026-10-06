/* Groundwork project pane.
 *
 * One page per repo. Everything shown here comes from GET /api/project (the
 * groundwork.project-snapshot/v1 read of <repo>/.groundwork/); everything a
 * person writes goes through the project server's routes into the same store,
 * so the CLI, agents and every other section read it on their next read.
 *
 * The answer flow is draft-then-Done, as on the decision board: typing saves a
 * DRAFT to the store (it survives a reload or a server restart and is not yet
 * handed to anyone); Done submits it. The save line under the box always says
 * which of those is true. Reading never changes a status.
 */
(function () {
  "use strict";

  var SECTIONS = ["decisions", "canvas", "saved-work", "spec", "memory"];
  var LABELS = { decisions: "Decisions", canvas: "Canvas", "saved-work": "Saved work",
    spec: "Spec", memory: "Memory", general: "General" };
  var POLL_MS = 4000, DRAFT_DEBOUNCE_MS = 600, RETRY_MS = 3000;

  var snap = null, section = "decisions", openBoard = null, notesScope = "all";
  var draft = { id: null, section: null, text: "", saved: null, timer: null, inFlight: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function hhmm(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function newId() {
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return "fb_" + Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  function api(method, path, body) {
    var init = { method: method, cache: "no-store", headers: {} };
    if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    return fetch(path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) throw new Error((j && j.error) || ("HTTP " + res.status));
        return j;
      });
    });
  }

  /* ------------------------------------------------------------ loading */

  function load() {
    return api("GET", "/api/project").then(function (s) {
      snap = s;
      var base = String(s.root || "").split("/").filter(Boolean).pop() || "project";
      $("project-title").textContent = "Groundwork · " + base;
      document.title = "Groundwork · " + base;
      $("top-save").textContent = "Saved in .groundwork/ · revision " + s.rev;
      $("top-save").removeAttribute("data-state");
      render();
    }).catch(function (e) {
      $("top-save").textContent = "Could not read the project: " + e.message;
      $("top-save").setAttribute("data-state", "error");
    });
  }

  /* ------------------------------------------------------------ sections */

  function setSection(next) {
    if (SECTIONS.indexOf(next) === -1) next = "decisions";
    if (next !== section) { flushDraft(); openBoard = null; }
    section = next;
    Array.prototype.forEach.call(document.querySelectorAll(".section-tab"), function (a) {
      if (a.getAttribute("data-section") === section) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    var cur = document.querySelector('.section-tab[aria-current="page"]');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest", inline: "nearest" });
    $("composer-h").textContent = "Comment on " + LABELS[section];
    loadDraftFor(section);
    render();
  }

  function render() {
    if (!snap) return;
    var body = $("section-body");
    var s = snap.sections || {};
    var html = "";
    if (section === "decisions") html = renderDecisions(s.decisions || []);
    else if (section === "canvas") html = renderCanvas(s.canvas || {});
    else if (section === "saved-work") html = renderSavedWork(s.savedWork || {});
    else if (section === "spec") html = renderSpec(s.spec || {});
    else html = renderMemory(s.memory || {});
    html += renderWarnings();
    /* Keep a live iframe alive across polls: re-rendering it would reload the
       board mid-answer. */
    var frame = body.querySelector("iframe");
    var keep = frame && frame.getAttribute("data-key") === frameKey();
    if (!keep) body.innerHTML = html;
    else {
      var info = body.querySelector("[data-live-info]");
      var fresh = document.createElement("div"); fresh.innerHTML = html;
      var freshInfo = fresh.querySelector("[data-live-info]");
      if (info && freshInfo) info.innerHTML = freshInfo.innerHTML;
    }
    renderNotes();
  }

  function frameKey() {
    if (section === "decisions" && openBoard) return "board:" + openBoard;
    if (section === "canvas") return "canvas";
    return "";
  }

  function renderWarnings() {
    var w = (snap.warnings || []).filter(function (x) { return x && x.code; });
    if (!w.length) return "";
    return '<h2 class="label">Needs attention</h2><ul class="group">' + w.map(function (x) {
      return '<li><span class="warn">' + esc(x.code) + "</span> " + '<span class="meta">' + esc(x.detail) + "</span></li>";
    }).join("") + "</ul>";
  }

  function boardTitle(b) { return b.title || b.slug; }

  function renderDecisions(boards) {
    if (openBoard) {
      var b = boards.filter(function (x) { return x.slug === openBoard; })[0];
      if (b) {
        return '<div class="board-bar"><button type="button" class="btn-secondary" data-action="close-board">All boards</button>' +
          '<span class="meta" data-live-info>' + esc(boardTitle(b)) + " · " + b.open + " open · " + b.ruled + " ruled</span></div>" +
          '<iframe class="frame frame-board" data-key="board:' + esc(b.slug) + '" title="Decision board ' + esc(boardTitle(b)) +
          '" src="/decisions/' + encodeURIComponent(b.slug) + '/"></iframe>';
      }
      openBoard = null;
    }
    if (!boards.length) {
      return '<h2 class="label">Boards</h2><p class="empty">No decision boards yet. Run: ' +
        "<code>python3 -m designer.decisions.decisions_build init &lt;repo&gt; --slug &lt;name&gt;</code></p>";
    }
    var out = '<h2 class="label">Boards</h2><ul class="group">' + boards.map(function (b) {
      var note = "";
      if (b.legacy) note = '<p class="warn">Not migrated yet — read-only until <code>groundwork project migrate</code> runs.</p>';
      if (b.conflict) note += '<p class="warn">Two copies differ: ' + esc(typeof b.conflict === "string" ? b.conflict : JSON.stringify(b.conflict)) + "</p>";
      if (!b.valid) note += '<p class="warn">This record has errors: ' + esc((b.errors || []).join("; ")) + "</p>";
      return '<li class="row"><div class="row-main"><div class="row-title">' + esc(boardTitle(b)) + '</div><div class="meta">' +
        b.open + " open · " + b.ruled + " ruled</div>" + note + "</div>" +
        '<button type="button" class="row-btn" data-action="open-board" data-slug="' + esc(b.slug) + '">Open board</button></li>';
    }).join("") + "</ul>";
    var ruled = [];
    boards.forEach(function (b) {
      (b.items || []).forEach(function (it) { if (it.lane === "ruled") ruled.push({ b: b, it: it }); });
    });
    ruled.sort(function (x, y) { return String(y.it.ruledAt || "").localeCompare(String(x.it.ruledAt || "")); });
    if (ruled.length) {
      out += '<h2 class="label">Latest answers</h2><ul class="group">' + ruled.slice(0, 8).map(function (r) {
        return '<li><div class="row-title">' + esc(r.it.title) + '</div><div class="meta">' + esc(r.it.ruling) +
          (r.it.ruledAt ? " · " + esc(hhmm(r.it.ruledAt)) : "") + " · " + esc(boardTitle(r.b)) + "</div>" +
          (r.it.note ? '<div class="note-text">' + esc(r.it.note) + "</div>" : "") + "</li>";
      }).join("") + "</ul>";
    }
    return out;
  }

  function renderCanvas(c) {
    if (!c.available) {
      return '<h2 class="label">Canvas</h2><p class="empty">No canvas found in .designdoc/mockups/ or mockups/. Start one with the canvas server; its page and notes appear here.</p>';
    }
    var out = '<h2 class="label">Canvas</h2><p class="meta" data-live-info>' + esc(c.htmlFile || "") + " · " + (c.rows || 0) +
      " canvas notes" + (c.invalidRows ? " · " + c.invalidRows + " unreadable lines skipped" : "") + "</p>";
    if (c.htmlFile) {
      out += '<iframe class="frame frame-canvas" data-key="canvas" sandbox="" title="Canvas preview" src="/canvas/file"></iframe>';
    } else {
      out += '<p class="empty">The canvas folder has no page yet.</p>';
    }
    return out;
  }

  function renderSavedWork(w) {
    var alts = w.alternatives || [];
    if (!w.available || !alts.length) {
      return '<h2 class="label">Saved designs</h2><p class="empty">No saved designs yet. Generate options in Designer; they appear here.</p>';
    }
    return '<h2 class="label">Saved designs</h2>' + (w.legacy ? '<p class="warn">Read from the old Designer folder until the next change moves it into .groundwork/.</p>' : "") +
      '<ul class="group">' + alts.map(function (a, i) {
        var sel = a.id === w.selectedId;
        return '<li class="row"><div class="row-main"><div class="row-title">Design ' + (i + 1) + (sel ? ' <span class="status-done">· selected</span>' : "") + "</div>" +
          '<div class="meta">' + esc(a.rationale || "No rationale recorded") + (a.createdAt ? " · " + esc(hhmm(a.createdAt)) : "") + "</div></div>" +
          (sel ? "" : '<button type="button" class="row-btn" data-action="select-design" data-id="' + esc(a.id) + '">Use this design</button>') + "</li>";
      }).join("") + "</ul>";
  }

  function renderSpec(s) {
    var arts = s.artifacts || [];
    if (!arts.length) return '<h2 class="label">Spec files</h2><p class="empty">No Spec files in .designdoc/ yet.</p>';
    return '<h2 class="label">Spec files</h2><ul class="group">' + arts.map(function (a) {
      return '<li><div class="row-title mono">' + esc(a.path) + '</div><div class="meta">' + esc(a.kind) + " · " + a.bytes + " bytes" +
        (a.mtime ? " · changed " + esc(new Date(a.mtime).toLocaleString()) : "") + "</div></li>";
    }).join("") + "</ul>";
  }

  function renderMemory(m) {
    var prefs = m.preferences || [];
    var active = prefs.filter(function (p) { return p.status === "active"; });
    var old = prefs.filter(function (p) { return p.status !== "active"; });
    var out = '<h2 class="label">Preferences</h2>' +
      '<form class="pref-form" id="pref-form"><label class="meta" for="pref-text">New preference</label>' +
      '<textarea id="pref-text" rows="2" maxlength="2000" required></textarea>' +
      '<label class="meta" for="pref-scope">Applies to</label><select id="pref-scope">' +
      ["repo", "decisions", "canvas", "saved-work", "spec"].map(function (k) {
        return '<option value="' + k + '">' + (k === "repo" ? "Whole project" : LABELS[k]) + "</option>";
      }).join("") + "</select>" +
      '<input type="hidden" id="pref-supersedes" value="">' +
      '<div class="form-bar"><button type="submit" class="btn-primary">Add preference</button>' +
      '<p class="save-line" id="pref-line" role="status" aria-live="polite"></p></div></form>';
    if (!active.length) out += '<p class="empty">No preferences recorded.</p>';
    else out += '<ul class="group">' + active.map(function (p) {
      return '<li class="row"><div class="row-main"><div class="note-text">' + esc(p.text) + '</div><div class="meta">' +
        esc(p.scope === "repo" ? "Whole project" : (LABELS[p.scope] || p.scope)) + " · from " + esc(p.provenance && p.provenance.source) + "</div></div>" +
        '<button type="button" class="row-btn" data-action="replace-pref" data-id="' + esc(p.id) + '">Replace</button></li>';
    }).join("") + "</ul>";
    if (old.length) out += "<details><summary>" + old.length + " replaced</summary><ul class=\"group\">" + old.map(function (p) {
      return '<li><div class="note-text">' + esc(p.text) + '</div><div class="meta">replaced</div></li>';
    }).join("") + "</ul></details>";
    return out;
  }

  /* ------------------------------------------------------------ notes list */

  function statusText(st) {
    if (st === "processed") return '<span class="status-done">read by agent</span>';
    if (st === "submitted") return '<span class="status-sent">sent</span>';
    return '<span class="status-draft">draft</span>';
  }

  function renderNotes() {
    Array.prototype.forEach.call(document.querySelectorAll(".btn-toggle"), function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-scope") === notesScope ? "true" : "false");
    });
    var items = ((snap && snap.feedback) || []).filter(function (f) {
      return f.status !== "draft" && (notesScope === "all" || f.section === section);
    }).slice().reverse();
    var list = $("notes-list");
    if (!items.length) {
      list.innerHTML = '<li class="empty">' + (notesScope === "all" ? "No notes in this project yet." : "No notes in this section yet.") + "</li>";
      return;
    }
    list.innerHTML = items.slice(0, 50).map(function (f) {
      return '<li><div class="note-text">' + esc(f.text) + '</div><div class="meta">' + esc(LABELS[f.section] || f.section) +
        " · " + statusText(f.status) + (f.submittedAt ? " · " + esc(hhmm(f.submittedAt)) : "") + "</div></li>";
    }).join("");
  }

  /* ------------------------------------------------------------ composer */

  function line(text, state) {
    var el = $("composer-line");
    el.textContent = text;
    if (state) el.setAttribute("data-state", state); else el.removeAttribute("data-state");
  }

  function loadDraftFor(sec) {
    var existing = ((snap && snap.feedback) || []).filter(function (f) {
      return f.status === "draft" && f.section === sec && /^fb_/.test(f.id);
    }).pop();
    draft = { id: existing ? existing.id : null, section: sec, text: existing ? existing.text : "",
      saved: existing ? existing.text : null, timer: null, inFlight: null };
    $("composer-text").value = draft.text;
    $("composer-done").disabled = !draft.text.trim();
    if (existing) line("Draft saved " + hhmm(existing.updatedAt) + " — not sent yet", "draft");
    else line("", null);
  }

  function saveDraft() {
    clearTimeout(draft.timer); draft.timer = null;
    var text = $("composer-text").value;
    if (!text.trim() || text === draft.saved) return Promise.resolve();
    if (!draft.id) draft.id = newId();
    var mine = draft;
    line("Saving…", null);
    mine.inFlight = api("PUT", "/api/feedback/" + encodeURIComponent(mine.id), { section: mine.section, text: text, target: null })
      .then(function (r) {
        mine.saved = text;
        if (mine === draft) line("Draft saved " + hhmm(r.savedAt || (r.item && r.item.updatedAt)) + " — not sent yet", "draft");
      })
      .catch(function () {
        if (mine === draft) { line("Not saved — retrying", "error"); draft.timer = setTimeout(saveDraft, RETRY_MS); }
      })
      .then(function () { mine.inFlight = null; });
    return mine.inFlight;
  }

  function flushDraft() { if (draft.timer || ($("composer-text").value !== draft.saved && $("composer-text").value.trim())) saveDraft(); }

  function done() {
    var text = $("composer-text").value;
    if (!text.trim()) return;
    $("composer-done").disabled = true;
    var wait = draft.inFlight || Promise.resolve();
    wait.then(function () { return text === draft.saved ? null : saveDraft(); }).then(function () {
      if (draft.saved !== text) throw new Error("draft not saved");
      return api("POST", "/api/feedback/" + encodeURIComponent(draft.id) + "/submit", { text: text });
    }).then(function (r) {
      var at = r.item && r.item.submittedAt;
      draft = { id: null, section: section, text: "", saved: null, timer: null, inFlight: null };
      $("composer-text").value = "";
      line("Sent " + hhmm(at) + " — every section, the CLI and agents can read it", "sent");
      return load();
    }).catch(function (e) {
      $("composer-done").disabled = false;
      line("Not sent: " + e.message, "error");
    });
  }

  /* ------------------------------------------------------------ actions */

  document.addEventListener("click", function (ev) {
    var t = ev.target.closest("[data-action], .btn-toggle, #composer-done, #snapshot-btn");
    if (!t) return;
    var act = t.getAttribute("data-action");
    if (t.id === "composer-done") return done();
    if (t.id === "snapshot-btn") {
      $("snapshot-line").textContent = "Saving snapshot…";
      return api("POST", "/api/snapshot", {}).then(function (r) {
        $("snapshot-line").textContent = "Snapshot saved: " + r.path;
      }).catch(function (e) { $("snapshot-line").textContent = "Snapshot failed: " + e.message; });
    }
    if (t.classList.contains("btn-toggle")) { notesScope = t.getAttribute("data-scope"); return renderNotes(); }
    if (act === "open-board") { openBoard = t.getAttribute("data-slug"); return render(); }
    if (act === "close-board") { openBoard = null; return load(); }
    if (act === "select-design") {
      t.disabled = true;
      return api("POST", "/api/workspace/select", { id: t.getAttribute("data-id") }).then(load)
        .catch(function (e) { t.disabled = false; alert("Could not select: " + e.message); });
    }
    if (act === "replace-pref") {
      var p = (((snap.sections || {}).memory || {}).preferences || []).filter(function (x) { return x.id === t.getAttribute("data-id"); })[0];
      if (!p) return;
      $("pref-text").value = p.text; $("pref-scope").value = p.scope; $("pref-supersedes").value = p.id;
      $("pref-line").textContent = "Editing a replacement; Add preference saves it and retires the old one.";
      $("pref-text").focus();
    }
  });

  document.addEventListener("submit", function (ev) {
    if (ev.target.id !== "pref-form") return;
    ev.preventDefault();
    var body = { text: $("pref-text").value, scope: $("pref-scope").value };
    var sup = $("pref-supersedes").value; if (sup) body.supersedes = sup;
    $("pref-line").textContent = "Saving…";
    api("POST", "/api/preferences", body).then(function () { return load(); }).then(function () {
      var l = $("pref-line"); if (l) l.textContent = "Saved — agents read it from the project contract";
    }).catch(function (e) { $("pref-line").textContent = "Not saved: " + e.message; });
  });

  $("composer-text").addEventListener("input", function () {
    var v = $("composer-text").value;
    $("composer-done").disabled = !v.trim();
    if (v !== draft.saved) line("Not saved yet", "draft");
    clearTimeout(draft.timer);
    draft.timer = setTimeout(saveDraft, DRAFT_DEBOUNCE_MS);
  });
  window.addEventListener("pagehide", flushDraft);
  window.addEventListener("hashchange", function () { setSection(location.hash.slice(1)); });

  setInterval(function () {
    if (document.visibilityState === "visible" && !document.querySelector("#pref-form textarea:focus")) load();
  }, POLL_MS);

  load().then(function () {
    var start = location.hash.slice(1);
    section = null;
    setSection(SECTIONS.indexOf(start) === -1 ? "decisions" : start);
  });
})();
