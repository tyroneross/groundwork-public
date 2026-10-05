// The iterate workspace stays self-contained: the server embeds these styles,
// markup and controller alongside its existing canvas/decision handlers.
export const workspaceStyles = `
  :root{--rail:316px}
  body.has-nav{--nav:196px}body.has-nav.nav-collapsed{--nav:68px}
  body.nav-collapsed .gwnav-body{display:block}
  .gwnav-body{padding:12px 8px}.gwnav-title{padding:16px 16px 4px}
  .section-link{display:flex;align-items:center;gap:10px;width:100%;min-height:44px;padding:10px;border:0;border-radius:8px;background:transparent;color:var(--ink-2);font:inherit;text-align:left;cursor:pointer}
  .section-link[aria-current=page]{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent)}
  .section-icon{display:grid;place-items:center;flex:none;width:28px;height:28px;border:1px solid var(--line);border-radius:7px;font-size:12px;font-weight:700}
  body.nav-collapsed .section-label{display:none}body.nav-collapsed .section-link{justify-content:center;padding:8px 0}
  .workspace-bar{padding:10px 16px}#workspaceTitle{font-size:15px}
  .section-views{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 16px;background:var(--panel);border-bottom:1px solid var(--line);flex:none}
  .view-tabs{display:flex;gap:4px;flex-wrap:wrap}.section-views button,.section-views select{font:inherit;font-size:13px;min-height:44px;border:1px solid var(--line);border-radius:8px;padding:8px 12px;background:var(--surface);color:var(--ink);cursor:pointer;max-width:100%}
  .section-views button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
  .screen-picker{display:flex;align-items:center;gap:8px;margin-left:auto;min-width:0;font-size:12px;color:var(--ink-2)}.screen-picker select{min-width:0;max-width:260px}
  .screen-previews{flex:1;min-height:0;overflow:auto;padding:24px;background:var(--surface)}
  .screen-previews[hidden],#frame[hidden]{display:none}
  .preview-heading{display:flex;justify-content:space-between;align-items:start;gap:16px;margin-bottom:20px}.preview-heading h1{font-size:22px;letter-spacing:-.03em;margin:0 0 6px}.preview-heading p{font-size:13px;color:var(--ink-2);margin:0}
  .preview-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:18px}
  .screen-card{min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .screen-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px}.screen-card h2{font-size:14px;margin:0;overflow-wrap:anywhere}
  .screen-card button{font:inherit;font-size:12px;min-height:44px;border:1px solid var(--line);border-radius:7px;padding:8px 10px;background:var(--surface);color:var(--ink);cursor:pointer}
  .screen-thumbnail{height:205px;overflow:hidden;border-block:1px solid var(--line);background:white;position:relative}
  .screen-thumbnail iframe{display:block;border:0;width:1024px;height:720px;transform-origin:top left;pointer-events:none;position:absolute;left:0;top:0}
  .screen-feedback{padding:12px 14px}.screen-ratings{display:flex;gap:6px;margin-bottom:10px}.screen-ratings button{flex:1;min-width:0}.screen-ratings button[aria-pressed=true]{color:var(--accent);border-color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent)}
  .screen-feedback label{display:block;font-size:12px;color:var(--ink-2);margin-bottom:6px}.screen-feedback textarea{width:100%;box-sizing:border-box;min-height:70px;font:inherit;font-size:13px;padding:9px;border:1px solid var(--line);border-radius:7px;color:var(--ink);background:var(--surface);resize:vertical}
  .screen-save-status{display:flex;align-items:center;gap:8px;min-height:30px;font-size:11px;color:var(--ink-2);margin:6px 0 0}.screen-save-status button{min-height:44px}
  .rail .eyebrow{font-size:11px}.rail section{padding:18px}.rail .brand{font-size:15px}.composer-title{font-size:13px}.rail textarea{font-size:14px}
  @media(max-width:860px){
    .section-views{display:none;padding:6px 8px;gap:6px}.section-views button,.section-views select{padding:6px 8px}.screen-picker{margin-left:0;flex:1}.screen-picker span{display:none}.screen-picker select{width:100%;max-width:none;min-height:44px;font:inherit;font-size:16px;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:8px}.workspace-bar .screen-picker{order:-1}
    .screen-previews{padding:14px}.preview-heading{margin-bottom:14px}.preview-heading h1{font-size:19px}.screen-feedback textarea,.rail textarea{font-size:16px}
    body.nav-collapsed .section-label{display:inline}body.nav-collapsed .section-link{justify-content:start;padding:8px}.gwnav-body{padding:8px}
  }
`;

export const workspaceMarkup = `
  <div class="section-views" aria-label="Views within this section">
    <div class="view-tabs" id="sectionViews"></div>
    <label class="screen-picker" id="screenPicker"><span>Screen</span><select id="workspaceScreenSelect" aria-label="Canvas screen"></select></label>
  </div>
  <div class="screen-previews" id="screenPreviews" hidden>
    <div class="preview-heading"><div><h1>Screen previews</h1><p>Review each screen. Feedback saves for the agent to read.</p></div></div>
    <button type="button" id="refreshPreviews" class="chip">Refresh screen previews</button>
    <p id="feedbackLoadStatus" role="status" hidden></p>
    <div class="preview-grid" id="previewGrid"></div>
  </div>`;

export function installWorkspace({ h, homeUrl, homeTitle, workspaceUrl, frameUrl, isHome, navigateCanvas, getActiveCanvas, post, addLocal }) {
  const nav = document.getElementById('gwnav');
  const views = document.getElementById('sectionViews');
  const picker = document.getElementById('workspaceScreenSelect');
  const previews = document.getElementById('screenPreviews');
  const frame = document.getElementById('frame');
  const grid = document.getElementById('previewGrid');
  const mobileWorkspace = matchMedia('(max-width:860px)');
  const pickerLabel = document.getElementById('screenPicker');
  const sectionViews = document.querySelector('.section-views');
  const bar = document.querySelector('.workspace-bar');
  const tools = document.querySelector('.mobile-tools-body');
  const wrap = document.querySelector('.wrap');
  function arrangeWorkspace() {
    if (mobileWorkspace.matches) { bar.prepend(pickerLabel); tools.append(nav, views); }
    else { sectionViews.append(views, pickerLabel); wrap.prepend(nav); }
    document.getElementById('workspaceTools').open = !mobileWorkspace.matches;
  }
  mobileWorkspace.addEventListener('change', arrangeWorkspace); arrangeWorkspace();
  const storageKey = 'gw-workspace:' + homeUrl;
  const drafts = readStorage(storageKey + ':screen-drafts', {});
  const feedback = new Map();
  const seenJournalRows = new Set();
  const cards = new Map();
  let sections = [{ label: 'Design', design: true, items: [{ label: homeTitle, url: homeUrl }] }];
  let section = sections[0];
  let view = 'canvas';
  let hydrating = true;
  let hydrationRevision = 0;
  let reviewStatusAvailable = true;
  function readStorage(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } }
  function saveDrafts() { try { localStorage.setItem(storageKey + ':screen-drafts', JSON.stringify(drafts)); } catch {} }
  function keyOf(url) { return isHome(url) ? homeUrl : workspaceUrl(url); }
  function activate(target) {
    section = target; view = 'canvas';
    document.getElementById('workspaceTools').open = !mobileWorkspace.matches;
    const current = keyOf(getActiveCanvas().url);
    if (!section.items.some(item => keyOf(item.url) === current)) navigateCanvas(section.items[0].url, section.items[0].label);
    renderViews(); sync();
    document.body.classList.remove('pages-open');
    document.getElementById('pagesToggle').setAttribute('aria-expanded', 'false');
  }
  function setView(next) { view = next; sync(); document.getElementById('workspaceTools').open = !mobileWorkspace.matches; }
  function renderViews() {
    views.replaceChildren(); picker.replaceChildren();
    document.getElementById('screenPicker').hidden = false;
    if (section.design) {
      for (const [id, label] of [['canvas', 'Canvas'], ['previews', 'Screen previews']]) {
        const button = h('button', { type: 'button', 'data-view': id }, label);
        button.addEventListener('click', () => setView(id)); views.append(button);
      }

    } else {
      for (const item of section.items) {
        const button = h('button', { type: 'button', 'data-url': keyOf(item.url) }, item.label);
        button.addEventListener('click', () => navigateCanvas(item.url, item.label)); views.append(button);
      }
    }
    for (const item of section.items) picker.append(h('option', { value: keyOf(item.url) }, item.label));
  }
  picker.addEventListener('change', () => {
    const item = section.items.find(item => keyOf(item.url) === picker.value);
    if (item) { view = 'canvas'; navigateCanvas(item.url, item.label); sync(); }
  });
  function renderNav() {
    const body = document.getElementById('gwnavBody'); body.replaceChildren();
    sections.forEach((target, index) => {
      const button = h('button', { type: 'button', class: 'section-link', title: target.label, 'aria-label': target.label, 'data-section': String(index) },
        h('span', { class: 'section-icon', 'aria-hidden': 'true' }, target.label.slice(0, 2).toUpperCase()), h('span', { class: 'section-label' }, target.label));
      button.addEventListener('click', () => activate(target)); body.append(button);
    });
  }
  function sync() {
    const active = keyOf(getActiveCanvas().url);
    const matched = sections.find(target => target.items.some(item => keyOf(item.url) === active));
    if (matched && !section.items.some(item => keyOf(item.url) === active)) { section = matched; view = 'canvas'; renderViews(); }
    for (const button of nav.querySelectorAll('[data-section]')) {
      if (sections[Number(button.dataset.section)] === section) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
    for (const button of views.children) button.setAttribute('aria-pressed', String(section.design ? button.dataset.view === view : button.dataset.url === active));
    picker.value = active;
    const showPreviews = section.design && view === 'previews';
    frame.hidden = showPreviews; previews.hidden = !showPreviews;
    if (showPreviews) renderCards();
  }
  function renderCards() {
    const design = sections.find(target => target.design);
    if (!design) return;
    for (const item of design.items) {
      const key = keyOf(item.url);
      if (cards.has(key)) continue;
      const card = h('article', { class: 'screen-card', 'data-screen-url': key });
      const open = h('button', { type: 'button', 'aria-label': 'Open ' + item.label }, 'Open screen');
      open.addEventListener('click', () => { section = design; view = 'canvas'; navigateCanvas(item.url, item.label); renderViews(); sync(); });
      const thumbnail = h('div', { class: 'screen-thumbnail' });
      const preview = h('iframe', { src: frameUrl(key), title: item.label + ' static preview', sandbox: 'allow-same-origin', tabindex: '-1', loading: 'lazy', 'aria-hidden': 'true' });
      thumbnail.append(preview);
      const scale = () => { preview.style.transform = 'scale(' + thumbnail.clientWidth / 1024 + ')'; };
      new ResizeObserver(scale).observe(thumbnail);
      const ratings = h('div', { class: 'screen-ratings', 'aria-label': 'Feedback for ' + item.label });
      const note = h('textarea', { id: 'screen-note-' + cards.size, placeholder: 'What should change?' });
      const statusText = h('span');
      const retry = h('button', { type: 'button', hidden: '' }, 'Retry save');
      const status = h('p', { class: 'screen-save-status', role: 'status', 'aria-live': 'polite' }, statusText, retry);
      const state = { item, key, note, ratings, statusText, retry, timer: null, saving: false, preview, revision: 0 };
      cards.set(key, state);
      for (const [value, label] of [['keep', 'Keep'], ['revise', 'Revise'], ['unsure', 'Unsure']]) {
        const button = h('button', { type: 'button', 'data-rating': value, 'aria-pressed': 'false' }, label);
        button.addEventListener('click', () => {
          drafts[key] = { ...(drafts[key] || {}), rating: value, note: note.value }; state.revision++; saveDrafts(); updateCard(state); schedule(state, 0);
        }); ratings.append(button);
      }
      note.addEventListener('input', () => {
        drafts[key] = { ...(drafts[key] || {}), note: note.value }; state.revision++; saveDrafts(); updateCard(state); schedule(state, 700);
      });
      retry.addEventListener('click', () => save(state));
      card.append(h('div', { class: 'screen-card-head' }, h('h2', {}, item.label), open), thumbnail,
        h('div', { class: 'screen-feedback' }, ratings, h('label', { for: note.id }, 'Quick note'), note, status));
      grid.append(card); updateCard(state);
    }
  }
  function updateCard(state) {
    const saved = feedback.get(state.key) || {};
    const draft = drafts[state.key];
    if (document.activeElement !== state.note) state.note.value = draft?.note ?? saved.note ?? '';
    for (const button of state.ratings.children) button.setAttribute('aria-pressed', String(button.dataset.rating === (draft?.rating ?? saved.rating)));
    if (!state.saving) state.retry.hidden = !draft;
    if (!state.saving) state.statusText.textContent = draft ? 'Draft retained on this browser' : saved.ts ? !reviewStatusAvailable ? 'Saved · review status unavailable' : saved.reviewed ? 'Reviewed by agent' : 'Saved · awaiting agent review' : hydrating ? 'Loading saved feedback…' : 'No feedback yet';
  }
  function schedule(state, ms) { clearTimeout(state.timer); state.timer = setTimeout(() => save(state), ms); }
  async function save(state) {
    if (state.saving || !drafts[state.key]) return;
    const draft = { ...drafts[state.key] };
    const revision = state.revision;
    const saved = feedback.get(state.key) || {};
    const rating = draft.rating ?? saved.rating;
    const note = draft.note ?? saved.note ?? '';
    if (!rating && !note.trim()) { state.statusText.textContent = 'Draft cleared; saved feedback is unchanged'; return; }
    hydrationRevision++; // A read started before this save must not restore older feedback.
    state.saving = true; state.retry.hidden = true; state.statusText.textContent = 'Saving…';
    const text = [rating ? 'Screen review: ' + rating : '', note.trim()].filter(Boolean).join('\n');
    const ok = await post({ kind: 'comment', source: 'screen-preview', reviewRating: rating, reviewNote: note, text, canvasUrl: state.key, canvasLabel: state.item.label });
    state.saving = false;
    if (!ok) { state.statusText.textContent = 'Save unconfirmed · draft retained'; state.retry.hidden = false; hydrate(); return; }
    feedback.set(state.key, { rating, note, ts: true });
    if (revision === state.revision) delete drafts[state.key];
    saveDrafts(); updateCard(state);
    if (revision !== state.revision) schedule(state, 0);
    hydrate();
  }
  async function hydrate() {
    // Saves refresh on completion. Background reads cannot overwrite a POST
    // still in flight, or the focused note/newer browser draft.
    if ([...cards.values()].some(state => state.saving)) return;
    const revision = ++hydrationRevision;
    const status = document.getElementById('feedbackLoadStatus');
    try {
      const response = await fetch('/__canvas/feedback', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error('journal unavailable');
      const data = await response.json();
      if (revision !== hydrationRevision) return;
      const rows = data.rows || [];
      const checkpoint = data.reviewedThroughId ? rows.findIndex(row => row.id === data.reviewedThroughId) : -1;
      reviewStatusAvailable = data.reviewStatusAvailable === true;
      feedback.clear();
      rows.forEach((row, index) => {
        if (row.source === 'screen-preview' && row.canvasUrl) feedback.set(keyOf(row.canvasUrl), { rating: row.reviewRating, note: row.reviewNote ?? row.text ?? '', ts: row.ts, reviewed: checkpoint >= index });
        if (row.kind !== 'toggle' && !seenJournalRows.has(row.id)) {
          seenJournalRows.add(row.id);
          addLocal(row.kind || 'feedback', (row.canvasLabel ? row.canvasLabel + ': ' : '') + (row.text || row.value || '(saved choice)'), row.component, false);
        }
      });
      status.hidden = !data.invalidRows && reviewStatusAvailable;
      status.textContent = !reviewStatusAvailable ? 'Saved feedback is shown. Agent review status could not be read.' : data.invalidRows ? 'Some journal rows could not be read. Valid saved feedback is shown.' : '';
    } catch {
      if (revision !== hydrationRevision) return;
      reviewStatusAvailable = false;
      status.hidden = false; status.textContent = 'Saved feedback could not be loaded. Drafts are retained; reload to retry.';
    }
    hydrating = false; for (const state of cards.values()) updateCard(state);
  }
  async function loadNav() {
    try {
      const response = await fetch('/__canvas/nav', { cache: 'no-store' });
      const data = await response.json();
      const groups = Array.isArray(data.groups) ? data.groups.filter(group => group.items?.length) : [];
      if (!groups.length) return;
      let designIndex = groups.findIndex(group => /design|screens?|pages?/i.test(group.label || ''));
      sections = groups.map((group, index) => ({ label: index === designIndex ? 'Design' : group.label || 'Section ' + (index + 1), design: index === designIndex, items: group.items }));
      if (designIndex < 0) { sections.unshift({ label: 'Design', design: true, items: [{ label: homeTitle, url: homeUrl }] }); designIndex = 0; }
      const design = sections.find(target => target.design);
      if (!design.items.some(item => isHome(item.url))) design.items.unshift({ label: homeTitle, url: homeUrl });
      design.items = design.items.filter((item, index, items) => items.findIndex(other => keyOf(other.url) === keyOf(item.url)) === index);
      section = design;
      document.getElementById('gwnavTitle').textContent = data.title || 'Workspace';
      renderNav(); renderViews(); nav.hidden = false; document.body.classList.add('has-nav'); document.getElementById('pagesToggle').hidden = false;
      const toggle = document.getElementById('gwnavToggle');
      let collapsed = readStorage(storageKey + ':compact', false);
      function applyCompact() {
        document.body.classList.toggle('nav-collapsed', collapsed);
        toggle.setAttribute('aria-expanded', String(!collapsed)); toggle.setAttribute('aria-label', collapsed ? 'Expand navigation' : 'Collapse navigation'); toggle.textContent = collapsed ? '›' : '‹';
      }
      toggle.addEventListener('click', () => { collapsed = !collapsed; try { localStorage.setItem(storageKey + ':compact', JSON.stringify(collapsed)); } catch {} applyCompact(); });
      applyCompact(); sync();
    } catch { /* A missing optional nav keeps the primary canvas usable. */ }
  }
  function refreshPreviews() {
    for (const state of cards.values()) { const url = new URL(frameUrl(state.key), location.href); url.searchParams.set('t', Date.now()); state.preview.src = url.href; }
  }
  document.getElementById('refreshPreviews').addEventListener('click', refreshPreviews);
  renderViews(); sync(); loadNav(); hydrate();
  return { sync, refreshPreviews, refreshFeedback: hydrate };
}
