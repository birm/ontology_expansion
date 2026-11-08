"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n == null ? "–" : n.toLocaleString());
const PAGE = 100;
const PATH_BADGE = { in_gold: "badge-ghost", seed_maps_to: "badge-ghost", narrower: "badge-success", broader: "badge-warning",
  sibling: "badge-warning", no_std: "badge-ghost", umls_only: "badge-info" };
const JUDGE_BADGE = { yes: "badge-success", unsure: "badge-warning", no: "badge-error" };

let IDX, SET, cache = {};
const st = { ds: "synpuf", on: new Set(), k: 2, qual: true, tab: "All", limit: PAGE, rows: [] };

async function getJSON(url) {
  if (!cache[url]) cache[url] = fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.json(); });
  return cache[url];
}

function readHash() {
  return Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
}
function writeHash() {
  const p = $("preset").value;
  const h = new URLSearchParams({ set: SET.slug, ds: st.ds, ...(p !== "custom" ? { p } : { t: [...st.on].join(","), k: st.k, q: +st.qual }) });
  history.replaceState(null, "", "#" + h);
}

function applyPreset(id) {
  const p = IDX.presets.find((x) => x.id === id);
  if (!p) return;
  st.on = new Set(p.types); st.k = p.k; st.qual = p.qual;
  syncToggles();
}
function matchPreset() {
  const p = IDX.presets.find((x) => x.k === st.k && x.qual === st.qual && x.types.length === st.on.size && x.types.every((t) => st.on.has(t)));
  return p ? p.id : "custom";
}

function buildControls() {
  $("dataset").innerHTML = IDX.datasets.map((d) => `<option value="${d.id}">${esc(d.label)}</option>`).join("");
  $("preset").innerHTML = IDX.presets.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join("") + `<option value="custom" disabled>Custom</option>`;
  const groups = {};
  for (const [t, [g, label, rule]] of Object.entries(IDX.edge_types)) (groups[g] ||= []).push(
    `<label class="label cursor-pointer justify-start gap-2 py-0.5" title="${esc(rule)}">
       <input type="checkbox" class="toggle toggle-xs toggle-primary" data-t="${t}"><span class="label-text">${esc(label)}</span></label>` +
    (t === "hier_consensus" ? `<div class="flex items-center gap-2 pl-8"><span class="text-xs opacity-70">k ≥</span>
       <input id="k" type="range" min="2" max="4" step="1" class="range range-xs w-24"><span id="k-val" class="text-xs"></span></div>` : ""));
  groups["Filter"] = [`<label class="label cursor-pointer justify-start gap-2 py-0.5" title="Drop names where the set's term follows 'due to', 'without', 'history of', 'sequela of' …">
       <input id="qual" type="checkbox" class="toggle toggle-xs"><span class="label-text">drop "due to / without / history of" + term</span></label>`];
  $("toggles").innerHTML = Object.entries(groups).map(([g, items]) =>
    `<div><div class="text-xs font-semibold uppercase opacity-60 mb-1">${esc(g)}</div>${items.join("")}</div>`).join("");

  $("toggles").addEventListener("change", (e) => {
    const t = e.target.dataset.t;
    if (t) e.target.checked ? st.on.add(t) : st.on.delete(t);
    if (e.target.id === "qual") st.qual = e.target.checked;
    $("preset").value = matchPreset();
    refresh();
  });
  $("toggles").addEventListener("input", (e) => {
    if (e.target.id === "k") { st.k = +e.target.value; $("k-val").textContent = st.k; $("preset").value = matchPreset(); refresh(); }
  });
  $("preset").addEventListener("change", (e) => { applyPreset(e.target.value); refresh(); });
  $("dataset").addEventListener("change", (e) => { st.ds = e.target.value; refresh(); });
  $("more").addEventListener("click", () => { st.limit += PAGE; renderRows(); });
  $("search").addEventListener("input", renderSetList);
  $("sets").addEventListener("click", (e) => {
    const a = e.target.closest("[data-slug]");
    if (a) { e.preventDefault(); $("nav").checked = false; loadSet(a.dataset.slug); }
  });
  $("tabs").addEventListener("click", (e) => {
    const a = e.target.closest("[data-tab]");
    if (a) { st.tab = a.dataset.tab; st.limit = PAGE; renderTable(); }
  });
  $("rows").addEventListener("click", (e) => {
    const tr = e.target.closest("[data-cid]");
    if (tr) showWhy(tr.dataset.cid);
  });
  $("info-body").innerHTML = IDX.datasets.map((d) =>
    `<li><a class="link font-medium" href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.label)}</a> · ${fmt(d.persons)} patients<br>
       <span class="opacity-70">${esc(d.source)}. ${esc(d.license)}.</span></li>`).join("") +
    `<li><span class="font-medium">Concept sets</span><br><span class="opacity-70">Published study concept sets (Oxford OmopConceptSetLibrary, OHDSI study repos); citation per set.</span></li>
     <li><span class="font-medium">Vocabularies</span><br><span class="opacity-70">OMOP vocabularies (Athena). UMLS-derived edge types and CUI counts only; no UMLS content is redistributed. PHOEBE recommendations (OHDSI).</span></li>
     <li><span class="font-medium">Judge</span><br><span class="opacity-70">Local LLM, strict membership (same / subtype); shown where an addition was judged.</span></li>`;
}

function syncToggles() {
  for (const el of $("toggles").querySelectorAll("[data-t]")) el.checked = st.on.has(el.dataset.t);
  $("qual").checked = st.qual; $("k").value = st.k; $("k-val").textContent = st.k;
}

function renderSetList() {
  const q = $("search").value.trim().toLowerCase();
  $("sets").innerHTML = IDX.sets.filter((s) => !q || s.name.toLowerCase().includes(q)).map((s) =>
    `<li><a data-slug="${s.slug}" class="${SET && SET.slug === s.slug ? "active" : ""}">
       <span class="truncate">${esc(s.name)}</span><span class="badge badge-ghost badge-xs">${esc(s.domain || "?")}</span></a></li>`).join("");
}

async function loadSet(slug) {
  SET = await getJSON(`data/sets/${slug}.json`);
  SET._add = new Map(Object.entries(SET.add).map(([k, v]) => [+k, v]));
  $("set-name").textContent = SET.name;
  $("set-meta").innerHTML = `${esc(SET.library)} · ${esc(SET.domain)}` +
    (SET.doi ? ` · <a class="link" href="https://doi.org/${esc(SET.doi)}" target="_blank" rel="noopener">${esc(SET.doi)}</a>` : "") +
    (SET.url ? ` · <a class="link" href="${esc(SET.url)}" target="_blank" rel="noopener">source</a>` : "");
  st.tab = "All";
  renderSetList();
  refresh();
}

function compute() {
  const by = new Map();
  for (const e of SET.edges) {
    const [, dst, t, det] = e;
    if (!st.on.has(t)) continue;
    if (t === "hier_consensus" && det.split("+").length < st.k) continue;
    if (st.qual && SET._add.get(dst)[1] === 1) continue;
    (by.get(dst) || by.set(dst, []).get(dst)).push(e);
  }
  const cnt = (SET.counts && SET.counts[st.ds]) || {};
  st.rows = [...by].map(([cid, edges]) => {
    const c = SET.concepts[cid] || ["?", "?", "", "?", "", ""];
    const n = cnt[cid] || [0, 0, 0];
    return { cid, edges, c, n };
  }).sort((a, b) => b.n[0] - a.n[0] || b.n[1] - a.n[1] || a.c[0].localeCompare(b.c[0]));
}

function refresh() {
  compute();
  st.limit = PAGE;
  writeHash();
  const pid = $("preset").value;
  const gp = (SET.gold_persons || {})[st.ds];
  $("st-base").textContent = fmt(SET.gold_size) + " concepts";
  $("st-base-p").textContent = gp != null ? `${fmt(gp)} patients` : "";
  $("st-add").textContent = fmt(st.rows.length);
  $("st-add-d").textContent = `${fmt(st.rows.filter((r) => r.n[0] > 0).length)} with patients`;
  const exact = pid !== "custom" ? ((SET.preset_new || {})[st.ds] || {})[pid] : undefined;
  if (pid !== "custom") { $("st-new").textContent = fmt(exact || 0); $("st-new-d").textContent = "not in baseline"; }
  else { $("st-new").textContent = "≥ " + fmt(Math.max(0, ...st.rows.map((r) => r.n[2]))); $("st-new-d").textContent = "lower bound (custom)"; }
  renderTable();
}

function renderTable() {
  const dom = {};
  for (const r of st.rows) dom[r.c[3]] = (dom[r.c[3]] || 0) + 1;
  if (st.tab !== "All" && !dom[st.tab]) st.tab = "All";
  const tabs = [["All", st.rows.length], ...Object.entries(dom).sort((a, b) => b[1] - a[1])];
  $("tabs").innerHTML = tabs.map(([d, n]) =>
    `<a role="tab" data-tab="${esc(d)}" class="tab flex-nowrap whitespace-nowrap ${d === st.tab ? "tab-active" : ""}">${esc(d)} <span class="badge badge-ghost badge-sm ml-1">${n}</span></a>`).join("");
  renderRows();
}

function renderRows() {
  const rows = st.tab === "All" ? st.rows : st.rows.filter((r) => r.c[3] === st.tab);
  const T = IDX.edge_types;
  $("rows").innerHTML = rows.slice(0, st.limit).map((r) => {
    const a = SET._add.get(r.cid);
    const types = [...new Set(r.edges.map((e) => e[2]))];
    return `<tr class="hover cursor-pointer" data-cid="${r.cid}">
      <td class="max-w-xs"><div class="truncate" title="${esc(r.c[0])}">${esc(r.c[0])}</div></td>
      <td class="whitespace-nowrap text-xs opacity-80">${esc(r.c[1])} ${esc(r.c[2])}</td>
      <td>${types.map((t) => `<span class="badge badge-outline badge-sm whitespace-nowrap">${esc(T[t][1])}</span>`).join(" ")}</td>
      <td><span class="badge badge-sm whitespace-nowrap ${PATH_BADGE[a[0]] || ""}">${esc(IDX.omop_path[a[0]])}</span></td>
      <td class="text-right tabular-nums">${r.n[0] ? fmt(r.n[0]) : "–"}</td>
      <td class="text-right tabular-nums">${r.n[2] ? fmt(r.n[2]) : "–"}</td></tr>`;
  }).join("") || `<tr><td colspan="6" class="text-center opacity-60">No additions</td></tr>`;
  $("more").classList.toggle("hidden", rows.length <= st.limit);
  $("more").textContent = `Show more (${fmt(rows.length - st.limit)})`;
}

function detail(t, det) {
  if (t.startsWith("cui_")) { const [a, b] = det.split(">"); return `CUIs ${a} → ${b}`; }
  if (t === "hier_consensus") { const f = det.split("+"); return `k = ${f.length}: ${f.join(", ")}`; }
  return det;
}
function cname(cid) {
  if (!cid) return `<span class="italic">set name “${esc(SET.name)}”</span>`;
  const c = SET.concepts[cid];
  return c ? `${esc(c[0])} <span class="opacity-60 text-xs">${esc(c[1])} ${esc(c[2])}</span>` : `concept ${cid}`;
}

function showWhy(cidStr) {
  const cid = +cidStr, r = st.rows.find((x) => x.cid === cid);
  const c = r.c, a = SET._add.get(cid), T = IDX.edge_types;
  const flags = [];
  if (a[1] === 1) flags.push(`<span class="badge badge-error badge-sm">set term after qualifier</span>`);
  else if (a[1] === 2) flags.push(`<span class="badge badge-warning badge-sm">qualifier</span>`);
  if (a[2]) flags.push(`<span class="badge badge-warning badge-sm">compound (and / with / or)</span>`);
  if (c[5] === "C") flags.push(`<span class="badge badge-ghost badge-sm">classification</span>`);
  const judge = a[3] ? `<span class="badge badge-sm ${JUDGE_BADGE[a[3][0]] || ""}">judge: ${esc(a[3][0])} (${esc(a[3][1])})</span>` : "";
  const counts = IDX.datasets.map((d) => {
    const n = ((SET.counts || {})[d.id] || {})[cid];
    return `<tr><td>${esc(d.label)}</td><td class="text-right">${fmt(n ? n[0] : 0)}</td><td class="text-right">${fmt(n ? n[2] : 0)}</td><td class="text-right">${fmt(n ? n[1] : 0)}</td></tr>`;
  }).join("");
  $("why-body").innerHTML = `
    <h3 class="font-semibold pr-8">${esc(c[0])}</h3>
    <div class="text-xs opacity-70 mb-3">${esc(c[1])} ${esc(c[2])} · ${esc(c[3])} · ${esc(c[4])} ·
      <a class="link" href="https://athena.ohdsi.org/search-terms/terms/${cid}" target="_blank" rel="noopener">${cid}</a></div>
    <ul class="timeline timeline-vertical timeline-compact">
      ${r.edges.map((e, i) => `<li>${i ? "<hr>" : ""}
        <div class="timeline-middle">●</div>
        <div class="timeline-end timeline-box text-sm w-full">
          <div>${cname(e[0])}</div>
          <div class="mt-1"><span class="badge badge-primary badge-sm">${esc(T[e[2]][0])}: ${esc(T[e[2]][1])}</span>
            <span class="text-xs opacity-80">${esc(T[e[2]][2])}${e[3] ? " · " + esc(detail(e[2], e[3])) : ""}</span></div>
        </div><hr></li>`).join("")}
      <li><hr><div class="timeline-middle">◆</div><div class="timeline-end timeline-box text-sm font-medium">${esc(c[0])}</div></li>
    </ul>
    <div class="flex flex-wrap gap-1 my-3">
      <span class="badge badge-sm ${PATH_BADGE[a[0]] || ""}">OMOP: ${esc(IDX.omop_path[a[0]])}</span>${judge}${flags.join("")}
    </div>
    <table class="table table-xs"><thead><tr><th></th><th class="text-right">Patients</th><th class="text-right">New</th><th class="text-right">Records</th></tr></thead><tbody>${counts}</tbody></table>`;
  $("why").showModal();
}

(async function init() {
  IDX = await getJSON("data/index.json");
  IDX.datasets ||= [];
  if (matchMedia("(max-width: 640px)").matches) $("edges").open = false;
  buildControls();
  const h = readHash();
  st.ds = IDX.datasets.some((d) => d.id === h.ds) ? h.ds : (IDX.datasets[0] || {}).id;
  $("dataset").value = st.ds;
  if (h.t != null) {
    st.on = new Set(h.t.split(",").filter((t) => IDX.edge_types[t])); st.k = +h.k || 2; st.qual = h.q === "1";
    syncToggles(); $("preset").value = matchPreset();
  } else {
    const p = IDX.presets.some((x) => x.id === h.p) ? h.p : IDX.presets[0].id;
    $("preset").value = p; applyPreset(p);
  }
  renderSetList();
  const first = IDX.sets.find((s) => s.slug === h.set) || IDX.sets[0];
  await loadSet(first.slug);
})();
