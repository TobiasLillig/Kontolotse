/* ============================================================
   Kontolotse — Frontend-Logik (v1.0)
   Umlaute, dd.mm.yyyy, Vertragsprüfung
   ============================================================ */

// Theme System: light / auto / dark
let _themeMode = localStorage.getItem("theme") || "auto"; // "light", "auto", "dark"
function applyTheme() {
    let theme;
    if (_themeMode === "auto") {
        const h = new Date().getHours();
        theme = (h >= 7 && h < 19) ? "light" : "dark";
    } else {
        theme = _themeMode;
    }
    document.documentElement.setAttribute("data-theme", theme);
    updateThemeKnob();
    // Logo-Umschaltung
    document.querySelectorAll(".theme-dark-only").forEach(el => el.style.display = theme==="dark"?"block":"none");
    document.querySelectorAll(".theme-light-only").forEach(el => el.style.display = theme==="light"?"block":"none");
}
function setTheme(mode) {
    _themeMode = mode;
    localStorage.setItem("theme", mode);
    applyTheme();
}
function cycleTheme() {
    const order = ["light", "auto", "dark"];
    const idx = order.indexOf(_themeMode);
    setTheme(order[(idx + 1) % 3]);
}
function updateThemeKnob() {
    const knob = document.getElementById("theme-knob");
    if (!knob) return;
    if (_themeMode === "light") knob.style.left = "2px";
    else if (_themeMode === "auto") knob.style.left = "15px";
    else knob.style.left = "28px";
}
// Apply immediately (before DOM ready) to prevent flash
applyTheme();

const API = {
    async get(url) { 
        const r = await fetch(url); 
        if(!r.ok) throw new Error(`API ${r.status}`);
        return r.json(); 
    },
    async post(url, data) {
        const r = await fetch(url, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(data) });
        return r.json();
    },
    async put(url, data) {
        const r = await fetch(url, { method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify(data) });
        return r.json();
    },
    async del(url) { return (await fetch(url, {method:"DELETE"})).json(); },
};

let cachedKonten = [], cachedKategorien = [], selectedTopfId = null;

// Universelles natives Bestätigungs-Modal (ersetzt confirm())
function nativeConfirm(title, text, buttons) {
    return new Promise(resolve => {
        document.getElementById("confirm-modal-title").textContent = title;
        document.getElementById("confirm-modal-text").textContent = text;
        const btnContainer = document.getElementById("confirm-modal-buttons");
        btnContainer.innerHTML = "";
        buttons.forEach(btn => {
            const el = document.createElement("button");
            el.className = `btn ${btn.class || "btn-ghost"}`;
            el.textContent = btn.label;
            el.style.padding = "10px 20px";
            el.onclick = () => {
                document.getElementById("confirm-modal").classList.add("hidden");
                resolve(btn.value);
            };
            btnContainer.appendChild(el);
        });
        document.getElementById("confirm-modal").classList.remove("hidden");
    });
}
window.confirmModalCancel = () => {
    document.getElementById("confirm-modal").classList.add("hidden");
};

// Robustes Modal-Schließen: Nur wenn mousedown UND mouseup beide auf dem Overlay waren
let _modalMouseDownTarget = null;
document.addEventListener("mousedown", e => { _modalMouseDownTarget = e.target; });
document.addEventListener("mouseup", e => {
    if (!_modalMouseDownTarget || _modalMouseDownTarget !== e.target) { _modalMouseDownTarget = null; return; }
    const el = e.target;
    if (!el.classList.contains("modal-overlay")) { _modalMouseDownTarget = null; return; }
    const id = el.id;
    const closeMap = {
        "edit-modal": () => saveEditVertrag(),         // Außerhalb klicken = Speichern
        "new-vertrag-modal": () => addVertrag(),       // Außerhalb klicken = Speichern
        "topf-popup": () => {                         // Außerhalb klicken = Absenden wenn Betrag da
            const b = parseFloat(document.getElementById("tp-betrag").value);
            if (b && b > 0) executeTopfPopup();
            else closeTopfPopup();
        },
        "confirm-modal": () => confirmModalCancel(),
        "pruef-modal": () => closePruefModal(),
        "startup-modal": () => closeStartupModal(),
    };
    if (closeMap[id]) closeMap[id]();
    else el.classList.add("hidden");
    _modalMouseDownTarget = null;
});

async function refreshKonten() { cachedKonten = await API.get("/api/konten"); }
async function refreshKategorien() { cachedKategorien = await API.get("/api/kategorien"); }

function euro(a) { return new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(a); }

// Datum: yyyy-mm-dd → dd.mm.yyyy
function fmtDate(iso) {
    if (!iso || iso.length < 10) return "–";
    const [y,m,d] = iso.substring(0,10).split("-");
    return `${d}.${m}.${y}`;
}
// Monat: yyyy-mm → MM/yyyy
function fmtMonat(ym) {
    if (!ym || ym.length < 7) return "–";
    const [y,m] = ym.split("-");
    return `${m}/${y}`;
}

function toast(msg, type="success") {
    const c = document.getElementById("toast-container");
    const el = document.createElement("div");
    el.className = `toast ${type}`; el.textContent = msg;
    c.appendChild(el); setTimeout(()=>{el.style.opacity='0';el.style.transition='opacity 0.3s';setTimeout(()=>el.remove(),300);}, 4000);
}

function rhythmusLabel(r) {
    return {monatlich:"Monatlich",quartalsweise:"Quartalsweise",
        halbjaehrlich:"Halbjährlich",jaehrlich:"Jährlich",
        zweijaehrlich:"Zweijährlich"}[r]||r;
}
function monatsBetrag(b,r) {
    return b / ({monatlich:1,quartalsweise:3,halbjaehrlich:6,jaehrlich:12,zweijaehrlich:24}[r]||1);
}
function buildKontoOptions(sel, selId, includeAll, onlyHaupt) {
    sel.innerHTML = "";
    if (includeAll) { const o=document.createElement("option"); o.value=""; o.textContent="Alle Konten"; sel.appendChild(o); }
    cachedKonten.filter(k => !onlyHaupt || k.typ==="hauptkonto").forEach(k => {
        const o = document.createElement("option");
        o.value = k.id; o.textContent = k.name + (k.typ==="hauptkonto"?" (Haupt)":"");
        if (k.id===selId) o.selected=true; sel.appendChild(o);
    });
}
function buildKategorieOptions(sel, val) {
    sel.innerHTML = "";
    cachedKategorien.forEach(k => {
        const o=document.createElement("option"); o.value=k; o.textContent=k;
        if(k===val) o.selected=true; sel.appendChild(o);
    });
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
const sections = ["dashboard","vertraege","kontostand","einzahlungen","toepfe","simulation","kalender","einstellungen","hilfe"];

let _dashClickCount = 0, _dashClickTimer = null;
function navigateTo(section) {
    // Debug-Modus: 10x schnell auf Dashboard klicken
    if(section === "dashboard") {
        _dashClickCount++;
        clearTimeout(_dashClickTimer);
        _dashClickTimer = setTimeout(() => _dashClickCount = 0, 3000);
        if(window.getSelection) window.getSelection().removeAllRanges();
        if(_dashClickCount >= 10) {
            _dashClickCount = 0;
            const dbg = document.getElementById("nav-debug");
            if(dbg) { dbg.classList.remove("hidden"); toast("🐛 Debug-Modus aktiviert."); }
        }
    }
    sections.forEach(s => {
        const el=document.getElementById(`section-${s}`);
        if(el) el.classList.toggle("hidden", s!==section);
    });
    document.querySelectorAll(".nav-item").forEach(el => {
        el.classList.toggle("active", el.dataset.section===section);
    });
    ({dashboard:loadDashboard, vertraege:loadVertraege, kontostand:loadKontostand,
      einzahlungen:loadEinzahlungen, toepfe:loadToepfe, simulation:loadSimulation, kalender:loadKalender, einstellungen:loadEinstellungen})[section]?.();
}

// ---------------------------------------------------------------------------
// Prüf-Hinweis (dauerhaft unten rechts)
// ---------------------------------------------------------------------------
// Globale Suche
let _globalSearchCache = {vertraege:[], toepfe:[]};
async function globalSearchRefresh() {
    _globalSearchCache.vertraege = await API.get("/api/vertraege");
    _globalSearchCache.toepfe = cachedKonten.filter(k => k.typ === "topf");
}
function globalSearch(q) {
    const box = document.getElementById("global-search-results");
    if (!q || q.length < 1) { box.classList.add("hidden"); return; }
    q = q.toLowerCase();
    const vt = _globalSearchCache.vertraege.filter(v =>
        (v.name||"").toLowerCase().includes(q) ||
        (v.vertragspartner||"").toLowerCase().includes(q) ||
        (v.bemerkung||"").toLowerCase().includes(q) ||
        (v.kategorie||"").toLowerCase().includes(q)
    ).slice(0, 8);
    const tp = _globalSearchCache.toepfe.filter(t =>
        (t.name||"").toLowerCase().includes(q)
    ).slice(0, 5);
    if (!vt.length && !tp.length) {
        box.innerHTML = '<div style="padding:16px;color:var(--text-muted);text-align:center;">Keine Treffer</div>';
        box.classList.remove("hidden"); return;
    }
    let html = "";
    if (vt.length) {
        html += '<div style="padding:6px 12px;font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;">Verträge</div>';
        html += vt.map(v => `<div class="global-search-item" onclick="document.getElementById('global-search').value='';document.getElementById('global-search-results').classList.add('hidden');navigateTo('vertraege');setTimeout(()=>editVertrag(${v.id}),200);" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
            <div><strong>${v.name}</strong>${v.vertragspartner?` <span style="color:var(--text-muted);font-size:0.78rem;">· ${v.vertragspartner}</span>`:''}<br><span class="badge badge-neutral" style="font-size:0.65rem;">${v.kategorie}</span></div>
            <span class="amount negative">${euro(v.betrag)}</span>
        </div>`).join("");
    }
    if (tp.length) {
        html += '<div style="padding:6px 12px;font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;">Töpfe</div>';
        html += tp.map(t => `<div class="global-search-item" onclick="document.getElementById('global-search').value='';document.getElementById('global-search-results').classList.add('hidden');navigateTo('toepfe');setTimeout(()=>selectTopf(${t.id}),200);" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;">
            <strong>${t.name}</strong>
            <span>${euro(t.saldo)}</span>
        </div>`).join("");
    }
    box.innerHTML = html;
    box.classList.remove("hidden");
}
// Close search on click outside
document.addEventListener("click", e => {
    const box = document.getElementById("global-search-results");
    const input = document.getElementById("global-search");
    if (box && input && !box.contains(e.target) && e.target !== input) {
        box.classList.add("hidden");
    }
});
// Hover effect
document.addEventListener("mouseover", e => {
    if (e.target.closest(".global-search-item")) e.target.closest(".global-search-item").style.background = "var(--bg-secondary)";
});
document.addEventListener("mouseout", e => {
    if (e.target.closest(".global-search-item")) e.target.closest(".global-search-item").style.background = "";
});

function filterVertraege() {
    const text = (document.getElementById("vt-filter-text")?.value || "").toLowerCase();
    const kat = document.getElementById("vt-filter-kat")?.value || "";
    const rows = document.querySelectorAll("#vertraege-tbody tr");
    rows.forEach(row => {
        const content = row.textContent.toLowerCase();
        const rowKat = row.dataset.kategorie || "";
        const matchText = !text || content.includes(text);
        const matchKat = !kat || rowKat === kat;
        row.style.display = (matchText && matchKat) ? "" : "none";
    });
}

function updatePruefHinweis(vertraege) {
    let badge = document.getElementById("pruef-badge");
    const faellig = vertraege.filter(v => v.aktiv && v.pruefung_faellig);
    if (faellig.length === 0) {
        if (badge) badge.classList.add("hidden");
        return;
    }
    if (!badge) {
        badge = document.createElement("div");
        badge.id = "pruef-badge";
        badge.className = "pruef-badge";
        badge.onclick = () => navigateTo("vertraege");
        document.body.appendChild(badge);
    }
    badge.classList.remove("hidden");
    badge.innerHTML = `⚠ ${faellig.length} ${faellig.length === 1 ? "Vertrag" : "Verträge"} sollte${faellig.length === 1 ? "" : "n"} geprüft werden`;
}

// ---------------------------------------------------------------------------
// Dashboard: Konfigurierbares Kachel-System
// ---------------------------------------------------------------------------
const DASH_TILES_AVAILABLE = {
    kontostand:     {label:"🏦 Kontostand"},
    toepfe_saldo:   {label:"Guthaben Töpfe"},
    aktive_vt:      {label:"Aktive Verträge"},
    fixkosten_vt:   {label:"Monatl. Fixkosten (Verträge)"},
    fixkosten_tp:   {label:"Monatl. Topf-Zuweisungen"},
    einzahlungen:   {label:"Monatl. Einzahlungen"},
    deckung:        {label:"Monatl. Über-/Unterschuss"},
    sicherheitspuffer:{label:"Sicherheitspuffer"},
    engpass:        {label:"Engpass-Prognose (24 Mon.)"},
    ueberschuss:    {label:"Kontoüberschuss"},
    vertragsalarm_k:{label:"🔔 Vertragsalarme"},
    dauerauftrag_k: {label:"Dauerauftrags-Empf."},
};
const DASH_DEFAULT = ["kontostand","toepfe_saldo","aktive_vt","fixkosten_vt","fixkosten_tp","einzahlungen","deckung","sicherheitspuffer","engpass","ueberschuss","vertragsalarm_k","dauerauftrag_k"];
let dashEditMode = false;
function getDashTiles() {
    try {
        const s=localStorage.getItem("dash_tiles_v3");
        if(s) { 
            const arr=JSON.parse(s).map(k => k && DASH_TILES_AVAILABLE[k] ? k : null);
            while(arr.length<12) arr.push(null); 
            // If all null (invalid old data), reset to default
            if(!arr.some(Boolean)) throw new Error("reset");
            return arr.slice(0,12); 
        }
    } catch(e){ localStorage.removeItem("dash_tiles_v3"); }
    const arr = [...DASH_DEFAULT];
    while(arr.length<12) arr.push(null);
    return arr.slice(0,12);
}
function saveDashTiles(t) { while(t.length<12) t.push(null); try { localStorage.setItem("dash_tiles_v3",JSON.stringify(t.slice(0,12))); } catch(e){} }
function getActiveTiles() { return getDashTiles().filter(Boolean); }
function toggleDashEdit() {
    dashEditMode=!dashEditMode;
    document.getElementById("dash-tiles").classList.toggle("editing",dashEditMode);
    document.getElementById("dash-edit-btn").textContent=dashEditMode?"✅":"✏️";
    loadDashboard(); // re-renders tiles AND loads data
}
function removeDashTile(key) { const s=getDashTiles(); const i=s.indexOf(key); if(i>=0) s[i]=null; saveDashTiles(s); renderDashTiles(); loadDashboard(); }
function removeDashTileAt(idx) { const s=getDashTiles(); s[idx]=null; saveDashTiles(s); renderDashTiles(); loadDashboard(); }
async function addDashTileAt(slotIdx) {
    const cur=getDashTiles().filter(Boolean), avail=Object.keys(DASH_TILES_AVAILABLE).filter(k=>!cur.includes(k));
    if(!avail.length){toast("Alle Kacheln sind bereits aktiv.");return;}
    
    // Load live data for previews
    let previewValues = {};
    try {
        const st=await API.get("/api/status"), vt=await API.get("/api/vertraege"), ez=await API.get("/api/einzahlungen");
        const toepfe=cachedKonten.filter(k=>k.typ==="topf");
        const monVt=vt.filter(v=>v.aktiv).reduce((s,v)=>s+monatsBetrag(v.betrag,v.rhythmus),0);
        const monTp=toepfe.reduce((s,t)=>s+(t.monatlicher_betrag||0),0);
        const monEz=ez.filter(e=>e.typ==="fest").reduce((s,e)=>s+e.betrag,0);
        const pf=parseFloat((await API.get("/api/parameter")).sicherheitspuffer)||100;
        previewValues = {
            kontostand: euro(st.kontostand_gesamt),
            toepfe_saldo: euro(st.kontostand_toepfe),
            aktive_vt: String(st.aktive_vertraege),
            fixkosten_vt: euro(monVt),
            fixkosten_tp: euro(monTp),
            einzahlungen: euro(monEz),
            deckung: euro(monEz - monVt - monTp),
            sicherheitspuffer: pf > 0 ? euro(pf) : "Nicht eingestellt",
            engpass: "...",
            ueberschuss: "...",
            vertragsalarm_k: `${vt.filter(v=>v.vertragsalarm&&v.aktiv).length} Alarm(e)`,
            dauerauftrag_k: euro(Math.abs(monVt + monTp - monEz)),
        };
    } catch(e) {}
    
    const modal = document.getElementById("confirm-modal");
    document.getElementById("confirm-modal-title").textContent = "Kachel hinzufügen";
    document.getElementById("confirm-modal-text").textContent = "";
    const btnContainer = document.getElementById("confirm-modal-buttons");
    btnContainer.innerHTML = "";
    btnContainer.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:10px;max-height:60vh;overflow-y:auto;width:100%;";
    avail.forEach(k => {
        const d = DASH_TILES_AVAILABLE[k];
        const btn = document.createElement("div");
        btn.style.cssText = "background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius);padding:16px;cursor:pointer;text-align:center;transition:all 0.15s;";
        btn.innerHTML = `<div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;margin-bottom:6px;">${d.label}</div><div style="font-family:var(--font-mono);font-weight:700;font-size:1.2rem;color:var(--text-primary);">${previewValues[k] || '–'}</div>`;
        btn.onmouseenter = () => btn.style.borderColor = "var(--accent)";
        btn.onmouseleave = () => btn.style.borderColor = "var(--border)";
        btn.onclick = () => {
            modal.classList.add("hidden");
            btnContainer.style.cssText = "";
            const s=getDashTiles(); s[slotIdx]=k; saveDashTiles(s); renderDashTiles(); loadDashboard();
            toast(`"${d.label}" hinzugefügt.`);
        };
        btnContainer.appendChild(btn);
    });
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-ghost";
    cancelBtn.textContent = "Abbrechen";
    cancelBtn.style.gridColumn = "1/-1";
    cancelBtn.onclick = () => { modal.classList.add("hidden"); btnContainer.style.cssText = ""; };
    btnContainer.appendChild(cancelBtn);
    modal.classList.remove("hidden");
}

const DASH_TILE_NAV = {
    kontostand: "simulation", toepfe_saldo: "toepfe", einzahlungen: "einzahlungen",
    fixkosten_tp: "toepfe", fixkosten_vt: "vertraege", aktive_vt: "vertraege",
    dauerauftrag_k: "einzahlungen", vertragsalarm_k: "vertraege",
};

function renderDashTiles() {
    const grid=document.getElementById("dash-tiles"), slots=getDashTiles();
    let h="";
    for(let i=0; i<12; i++) {
        const key = slots[i];
        if(key && DASH_TILES_AVAILABLE[key]) {
            const d=DASH_TILES_AVAILABLE[key];
            const cl=dashEditMode?`<button class="tile-close" onclick="event.stopPropagation();removeDashTileAt(${i})">✕</button>`:"";
            const nav=DASH_TILE_NAV[key]&&!dashEditMode?` onclick="navigateTo('${DASH_TILE_NAV[key]}')" style="cursor:pointer;"`:"";
            h+=`<div class="dash-tile" data-tile="${key}" data-slot="${i}" ${dashEditMode?'draggable="true"':''}${nav}>${cl}<div class="tile-label">${d.label}</div><div id="dash-${key}" class="tile-value neutral">–</div><div id="dash-${key}-sub" class="tile-sub" style="display:none;"></div><div class="tile-info"><span>i</span><div class="tile-info-text" id="dash-${key}-info"></div></div></div>`;
        } else if(dashEditMode) {
            h+=`<div class="dash-tile-add" data-slot="${i}" onclick="addDashTileAt(${i})">+</div>`;
        } else {
            // Empty slot - still takes space to maintain grid position
            h+=`<div class="dash-tile-empty"></div>`;
        }
    }
    grid.innerHTML=h;
    
    // Drag & Drop setup
    if(dashEditMode) {
        grid.querySelectorAll(".dash-tile[draggable]").forEach(tile => {
            tile.addEventListener("dragstart", e => {
                e.dataTransfer.setData("text/plain", tile.dataset.slot);
                tile.style.opacity = "0.4";
                setTimeout(() => tile.classList.add("dragging"), 0);
            });
            tile.addEventListener("dragend", e => {
                tile.style.opacity = "1";
                tile.classList.remove("dragging");
                grid.querySelectorAll(".dash-tile,.dash-tile-add").forEach(t => t.classList.remove("drag-over"));
            });
            tile.addEventListener("dragover", e => {
                e.preventDefault();
                tile.classList.add("drag-over");
            });
            tile.addEventListener("dragleave", () => {
                tile.classList.remove("drag-over");
            });
            tile.addEventListener("drop", e => {
                e.preventDefault();
                const fromSlot = parseInt(e.dataTransfer.getData("text/plain"));
                const toSlot = parseInt(tile.dataset.slot);
                if(isNaN(fromSlot) || isNaN(toSlot) || fromSlot===toSlot) return;
                const slots = getDashTiles();
                // Swap the two slots
                const tmp = slots[fromSlot];
                slots[fromSlot] = slots[toSlot];
                slots[toSlot] = tmp;
                saveDashTiles(slots);
                renderDashTiles();
                loadDashboard();
            });
        });
        // Also make + slots drop targets
        grid.querySelectorAll(".dash-tile-add").forEach(slot => {
            slot.addEventListener("dragover", e => { e.preventDefault(); slot.classList.add("drag-over"); });
            slot.addEventListener("dragleave", () => slot.classList.remove("drag-over"));
            slot.addEventListener("drop", e => {
                e.preventDefault();
                const fromSlot = parseInt(e.dataTransfer.getData("text/plain"));
                const toSlot = parseInt(slot.dataset.slot);
                if(isNaN(fromSlot) || isNaN(toSlot)) return;
                const slots = getDashTiles();
                slots[toSlot] = slots[fromSlot];
                slots[fromSlot] = null;
                saveDashTiles(slots);
                renderDashTiles();
                loadDashboard();
            });
        });
    }
}

async function loadDashboard() {
    await refreshKonten();
    renderDashTiles();
    const st=await API.get("/api/status"), vt=await API.get("/api/vertraege"), ez=await API.get("/api/einzahlungen");
    const params=await API.get("/api/parameter");
    const tiles=getActiveTiles();
    const toepfe=cachedKonten.filter(k=>k.typ==="topf");
    const monVt=st.echte_monatl_fixkosten||vt.filter(v=>v.aktiv).reduce((s,v)=>s+monatsBetrag(v.betrag,v.rhythmus),0);
    const monTp=toepfe.reduce((s,t)=>s+(t.monatlicher_betrag||0),0);
    const monEz=ez.filter(e=>e.typ==="fest").reduce((s,e)=>s+e.betrag,0);
    const puffer=parseFloat(params.sicherheitspuffer)||0;
    const kontoname=params.kontoname||"Fixkostenkonto";
    const aktDatum=params.kontostand_aktualisiert;
    const set=(k,v,c,s)=>{const e=document.getElementById(`dash-${k}`);if(e){e.innerHTML=v;e.className=`tile-value ${c||"neutral"}`;}const ie=document.getElementById(`dash-${k}-info`);if(ie&&s)ie.textContent=s;const se=document.getElementById(`dash-${k}-sub`);if(se&&s)se.textContent=s;};

    // Kontostand: mit dynamischem Kontonamen + Aktualisierungsdatum
    if(tiles.includes("kontostand")){
        const lbl=document.querySelector('[data-tile="kontostand"] .tile-label');
        if(lbl) lbl.textContent=`🏦 ${kontoname}`;
        set("kontostand",euro(st.kontostand_gesamt),st.kontostand_gesamt>=0?"positive":"negative",
            aktDatum?`Aktualisiert am ${fmtDate(aktDatum)}`:"");
    }
    if(tiles.includes("toepfe_saldo")){const a=toepfe.length;set("toepfe_saldo",euro(st.kontostand_toepfe),"neutral",`${a} ${a===1?"Topf":"Töpfe"}`);}
    if(tiles.includes("aktive_vt")) set("aktive_vt",st.aktive_vertraege,"neutral",`${vt.length} gesamt`);
    if(tiles.includes("fixkosten_vt")) set("fixkosten_vt",euro(monVt),"neutral","Verträge");
    if(tiles.includes("fixkosten_tp")) set("fixkosten_tp",euro(monTp),"neutral",`${toepfe.filter(t=>t.monatlicher_betrag>0).length} Töpfe`);
    if(tiles.includes("einzahlungen")) set("einzahlungen",euro(monEz),"neutral",`${ez.filter(e=>e.typ==="fest").length} Einzahlungen`);
    // Deckung = Einzahlungen - Verträge - Töpfe (monatlicher Über/Unterschuss, OHNE Puffer)
    if(tiles.includes("deckung")){
        const d=monEz-monVt-monTp;
        set("deckung",euro(d),d>=0?"positive":"negative","Einzahlungen − Verträge − Töpfe");
    }
    // Sicherheitspuffer-Kachel: Prüft ob minimaler Saldo über dem Puffer bleibt
    // Überschuss-Kachel: Was über Puffer hinaus auf dem Konto liegt
    // Engpass-Kachel: Wann wird Saldo negativ
    // Alle nutzen die gleichen Simulationsdaten
    let simData = null;
    try { simData = await API.get("/api/simulation"); if(!simData.ok) simData=null; } catch(e){}
    
    if(tiles.includes("sicherheitspuffer")){
        if(puffer > 0 && simData) {
            const fehlbetrag = puffer - simData.min_saldo;
            if(simData.min_saldo >= puffer) {
                set("sicherheitspuffer", euro(puffer), "positive",
                    `Min. ${euro(simData.min_saldo)} — ${euro(simData.min_saldo - puffer)} Reserve ✓`);
            } else if(simData.min_saldo < 0) {
                set("sicherheitspuffer", `${euro(fehlbetrag)}<br><span style="font-size:0.75rem;font-weight:400;">einzahlen</span>`, "negative",
                    `Saldo wird negativ (${euro(simData.min_saldo)})`);
            } else {
                set("sicherheitspuffer", `${euro(fehlbetrag)}<br><span style="font-size:0.75rem;font-weight:400;">einzahlen</span>`, "negative",
                    `Min. ${euro(simData.min_saldo)} unterschreitet Puffer`);
            }
        } else if(puffer > 0) {
            set("sicherheitspuffer", euro(puffer), "neutral", "Simulation nicht verfügbar");
        } else {
            set("sicherheitspuffer", "–", "neutral", "In Einstellungen konfigurieren");
        }
    }
    // Kontoüberschuss = Wie weit ist der tiefste Punkt über dem Puffer?
    // Wenn min_saldo genau auf dem Puffer liegt → 0€ Überschuss
    // Wenn min_saldo 500€ über dem Puffer → 500€ könnte man entnehmen
    if(tiles.includes("ueberschuss")){
        if(simData) {
            const u = simData.min_saldo - puffer;
            set("ueberschuss", u > 0 ? euro(u) : "Kein Überschuss",
                u > 0 ? "positive" : "neutral",
                u > 0 ? `Min. Saldo ${euro(simData.min_saldo)} − ${euro(puffer)} Puffer` : 
                    u === 0 ? "Puffer exakt gedeckt" : `${euro(Math.abs(u))} unter Puffer`);
        } else {
            set("ueberschuss", "–", "neutral", "Simulation nicht verfügbar");
        }
    }
    // Vertragsalarm als kleine Kachel
    if(tiles.includes("vertragsalarm_k")){
        const al=vt.filter(v=>v.vertragsalarm&&v.aktiv);
        set("vertragsalarm_k",al.length>0?`${al.length} Alarm${al.length>1?"e":""}`:"Keine","neutral",
            al.length?al[0].vertragsalarm_text?.substring(0,40)+"...":"Keine aktiven Alarme ✓");
    }
    // Dauerauftrag-Empfehlung (kleine Kachel): Verträge + Töpfe, OHNE Puffer
    // Puffer ist einmalig auf dem Konto, nicht monatlich
    if(tiles.includes("dauerauftrag_k")){
        const gesamtDiff = monVt + monTp - monEz;
        if(gesamtDiff > 0.01){
            const sollBetrag = monEz + gesamtDiff;
            set("dauerauftrag_k",`+${euro(gesamtDiff)}`,"negative",`Dauerauftrag um ${euro(gesamtDiff)} auf ${euro(sollBetrag)} erhöhen`);
        } else if(gesamtDiff < -0.01) {
            const sollBetrag = monEz + gesamtDiff;
            set("dauerauftrag_k",euro(Math.abs(gesamtDiff)),"positive",`Könnte um ${euro(Math.abs(gesamtDiff))} auf ${euro(sollBetrag)} gesenkt werden`);
        } else {
            set("dauerauftrag_k","Keine","positive","Einzahlung deckt Bedarf ✓");
        }
    }
    // Engpass
    if(tiles.includes("engpass")){
        if(simData){const n=simData.monate.find(m=>m.endsaldo<0);if(n){set("engpass",fmtMonat(n.monat),"negative",`Endsaldo: ${euro(n.endsaldo)}`);}else{set("engpass","Keiner","positive","24 Monate positiv ✓");}renderDashBarChart(simData.monate.slice(0,12));}
    } else {
        if(simData) renderDashBarChart(simData.monate.slice(0,12));
    }
    
    // === DASHBOARD WARNBANNER (jede Warnung = eigener Banner) ===
    const warnContainer = document.getElementById("dash-warnungen");
    if(warnContainer) {
        let banners = [];
        
        // 1) Dauerauftrags-Empfehlung
        let dauerauftragDiff = 0;
        try {
            const da = await API.get("/api/dauerauftraege");
            for(const d of da) {
                if(d.differenz > 0) {
                    dauerauftragDiff += d.differenz;
                    const sollBetrag = Math.ceil((d.monatliche_einnahmen + d.differenz) * 100) / 100;
                    let detail = `Verträge: ${euro(d.monatliche_kosten - (d.topf_zuweisungen||0))}`;
                    if(d.topf_zuweisungen) detail += ` + Töpfe: ${euro(d.topf_zuweisungen)}`;
                    detail += ` − Einzahlung: ${euro(d.monatliche_einnahmen)}`;
                    banners.push({
                        msg:`<strong>⚠ Dauerauftrag anpassen:</strong> ${d.konto_name} — um ${euro(d.differenz)} erhöhen auf <strong>${euro(sollBetrag)}/Mon.</strong> <span style="font-size:0.78rem;color:var(--text-muted);">(${detail})</span>`,
                        color:"orange",
                        navBtn:{label:"Anpassen", target:"einzahlungen"}
                    });
                }
            }
        } catch(e){}
        
        // 2) Saldo/Puffer-Warnung — NACH Dauerauftrag-Korrektur
        if(simData) {
            const pufferGerissen = simData.min_saldo < puffer;
            if(simData.warnung_negativ || (pufferGerissen && puffer > 0)) {
                // Wenn Dauerauftrag zu niedrig: min_saldo in der Simulation ist verzerrt
                // weil das monatliche Defizit sich über Monate aufstaut.
                // Nach DA-Korrektur verbessert sich min_saldo um ca. dauerauftragDiff * Monate_bis_min
                let korrigierterMin = simData.min_saldo;
                if(dauerauftragDiff > 0 && simData.min_saldo_datum) {
                    // Monate vom Start bis zum Minimum
                    const heute = new Date();
                    const minDat = new Date(simData.min_saldo_datum);
                    const monBisMin = Math.max(1, Math.round((minDat - heute) / (30.44 * 86400000)));
                    korrigierterMin = simData.min_saldo + dauerauftragDiff * monBisMin;
                }
                
                let fb = puffer > 0 ? puffer - korrigierterMin : Math.abs(Math.min(0, korrigierterMin));
                fb = Math.ceil(Math.max(0, fb) * 100) / 100;
                
                if(fb > 0) {
                    let msg = "";
                    if(dauerauftragDiff > 0) {
                        msg = `<strong>⚠ Einmalige Einzahlung nötig:</strong> Nach Dauerauftrag-Anpassung noch <strong>${euro(fb)}</strong> einmalig einzahlen${puffer>0?`, damit der Puffer von ${euro(puffer)} hält`:''}.`;
                    } else if(puffer > 0) {
                        msg = `<strong>⚠ ${simData.warnung_negativ?'Saldo wird negativ!':'Puffer-Warnung:'}</strong> Min. ${euro(simData.min_saldo)} am ${fmtDate(simData.min_saldo_datum)}. → ${euro(fb)} einzahlen, damit der Puffer von ${euro(puffer)} hält.`;
                    } else {
                        msg = `<strong>⚠ Saldo wird negativ!</strong> Min. ${euro(simData.min_saldo)} am ${fmtDate(simData.min_saldo_datum)}. → Mindestens ${euro(fb)} einzahlen.`;
                    }
                    banners.push({msg, color:"red", einzahlung:{betrag:fb}});
                }
            }
        }
        
        // 3) Vertragsalarme
        const alarme = vt.filter(v=>v.vertragsalarm&&v.aktiv);
        for(const a of alarme) {
            banners.push({
                msg:`<strong>🔔 Vertragsalarm:</strong> <span style="cursor:pointer;text-decoration:underline;" onclick="navigateTo('vertraege');setTimeout(()=>editVertrag(${a.id}),200);">${a.name}</span> — ${a.vertragsalarm_text}`,
                color:"orange"
            });
        }
        
        // Banner rendern
        if(banners.length) {
            warnContainer.innerHTML = banners.map(b => {
                const borderColor = b.color==="red" ? "var(--red)" : "var(--orange)";
                const bgColor = b.color==="red" ? "var(--red-bg)" : "var(--orange-bg)";
                let btnsHtml = "";
                if(b.einzahlung) {
                    btnsHtml = `<button class="btn btn-primary btn-sm" onclick="dashBannerEinzahlung(${b.einzahlung.betrag})" style="white-space:nowrap;">✅ Überweisung erledigt</button>`;
                }
                if(b.navBtn) {
                    btnsHtml = `<button class="btn btn-primary btn-sm" onclick="navigateTo('${b.navBtn.target}')" style="white-space:nowrap;">${b.navBtn.label}</button>`;
                }
                return `<div style="border:1px solid ${borderColor};background:${bgColor};border-radius:var(--radius);padding:12px 18px;display:flex;align-items:center;gap:14px;">
                    <div style="flex:1;font-size:0.88rem;">${b.msg}</div>${btnsHtml}</div>`;
            }).join("");
        } else {
            warnContainer.innerHTML = "";
        }
    }

    // Fixed cards below grid (Charts only)
    try{renderDashDonutChart(vt.filter(v=>v.aktiv));}catch(e){}
    const dbEl=document.getElementById("dash-db-pfad");if(dbEl)dbEl.textContent=st.db_pfad;
    await globalSearchRefresh();
    updatePruefHinweis(vt);
    // Schnellstart ausblenden wenn bereits dismissed
    const ssCard = document.getElementById("schnellstart-card");
    if(ssCard) {
        try {
            const p = await API.get("/api/parameter");
            if(p.schnellstart_ausgeblendet === "1") ssCard.style.display = "none";
        } catch(e){}
    }
}

async function dismissSchnellstart() {
    await API.put("/api/parameter", {schnellstart_ausgeblendet: "1"});
    const el = document.getElementById("schnellstart-card");
    if(el) el.style.display = "none";
    toast("Schnellstart ausgeblendet.");
}

// ---------------------------------------------------------------------------
// Dashboard Charts
// ---------------------------------------------------------------------------
let dashBarChart = null, dashDonutChart = null;

function renderDashBarChart(monate) {
    const canvas = document.getElementById("dash-chart-bar");
    if (!canvas) return;
    if (dashBarChart) dashBarChart.destroy();

    dashBarChart = new Chart(canvas, {
        type: "bar",
        data: {
            labels: monate.map(m => fmtMonat(m.monat)),
            datasets: [
                {
                    label: "Einnahmen", data: monate.map(m => m.einnahmen),
                    backgroundColor: "rgba(74,222,128,0.6)", borderColor: "rgba(74,222,128,1)",
                    borderWidth: 1, borderRadius: 4,
                },
                {
                    label: "Ausgaben", data: monate.map(m => m.ausgaben),
                    backgroundColor: "rgba(248,113,113,0.6)", borderColor: "rgba(248,113,113,1)",
                    borderWidth: 1, borderRadius: 4,
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: "#8b90a5", font: {size: 11} } },
                tooltip: { callbacks: { label: ctx => ctx.dataset.label + ": " + euro(ctx.parsed.y) } }
            },
            scales: {
                x: { ticks: {color:"#5c6078", font:{size:10}}, grid: {color:"rgba(46,51,72,0.5)"} },
                y: { ticks: {color:"#5c6078", callback: v => euro(v), font:{size:10}}, grid: {color:"rgba(46,51,72,0.5)"} }
            }
        }
    });
}

function renderDashDonutChart(vertraege) {
    const canvas = document.getElementById("dash-chart-donut");
    if (!canvas) return;
    if (dashDonutChart) dashDonutChart.destroy();

    // Monatliche Beträge pro Kategorie summieren
    const katSummen = {};
    vertraege.forEach(v => {
        const kat = v.kategorie || "Sonstige";
        const mon = monatsBetrag(v.betrag, v.rhythmus);
        katSummen[kat] = (katSummen[kat] || 0) + mon;
    });

    // Sortieren nach Betrag
    const sorted = Object.entries(katSummen).sort((a, b) => b[1] - a[1]);
    const labels = sorted.map(s => s[0]);
    const data = sorted.map(s => Math.round(s[1] * 100) / 100);

    // Farben
    const farben = [
        "#6c7bd4","#f87171","#4ade80","#facc15","#fb923c","#a78bfa",
        "#38bdf8","#f472b6","#34d399","#fbbf24","#818cf8","#fb7185",
        "#22d3ee","#a3e635"
    ];

    dashDonutChart = new Chart(canvas, {
        type: "doughnut",
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: farben.slice(0, labels.length),
                borderColor: "rgba(30,33,48,0.8)",
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            cutout: "55%",
            plugins: {
                legend: {
                    position: "right",
                    labels: { color: "#8b90a5", font: {size: 10}, padding: 8, boxWidth: 12 }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const total = ctx.dataset.data.reduce((a,b) => a+b, 0);
                            const pct = Math.round(ctx.parsed / total * 100);
                            return `${ctx.label}: ${euro(ctx.parsed)} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Verträge
// ---------------------------------------------------------------------------
let editingVertragId = null, editFromPruef = false;

async function loadVertraege() {
    await Promise.all([refreshKonten(), refreshKategorien()]);
    const vt = await API.get("/api/vertraege");
    buildKategorieOptions(document.getElementById("v-kategorie"),"Sonstige");
    buildKontoOptions(document.getElementById("v-konto"),1,false);

    const tbody = document.getElementById("vertraege-tbody");
    if(!vt.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-state"><div class="icon">📋</div><p>Noch keine Verträge.</p></td></tr>`;
        document.getElementById("vertraege-summe").textContent = euro(0);
        document.getElementById("vertraege-jahres").textContent = euro(0);
        updatePruefHinweis(vt);
        return;
    }

    tbody.innerHTML = vt.map(v=>{
        let pruefIcon = "⚠";
        if (v.pruefung_faellig && v.naechste_pruefung) {
            const np = new Date(v.naechste_pruefung);
            const diff = (new Date() - np) / 86400000;
            if (diff >= 0 && diff < 35) pruefIcon = "📆";
        }
        const alarmBtn = v.vertragsalarm
            ? `<button class="btn btn-sm" style="background:rgba(251,146,60,0.15);border:1px solid var(--orange);color:var(--orange);font-size:0.7rem;padding:2px 6px;margin-right:4px;" onclick="event.stopPropagation();showAlarmModal(${v.id})" title="${v.vertragsalarm_text||'Vertragsalarm'}">🔔</button>`
            : '';
        const pruefBtn = v.pruefung_faellig
            ? `<button class="btn btn-warn btn-sm" onclick="event.stopPropagation();vertragGeprueft(${v.id})" title="${pruefIcon === '📆' ? 'Wiedervorlage' : 'Prüfung fällig!'}">${pruefIcon}</button>`
            : `<span class="btn-placeholder"></span>`;
        const paInfo = v.naechste_preisaenderung
            ? `<br><span class="badge badge-orange">→ ${euro(v.naechste_preisaenderung.neuer_betrag)} ab ${fmtDate(v.naechste_preisaenderung.ab_datum)}</span>`
            : "";
        const endInfo = v.enddatum
            ? `<br><span class="text-muted" style="font-size:0.72rem;">Endet am ${fmtDate(v.enddatum)}${v.abgelaufen?' (abgelaufen)':''}</span>`
            : "";
        return `<tr class="${v.aktiv?'':'inactive-row'} clickable-row" onclick="editVertrag(${v.id})" data-kategorie="${v.kategorie}">
            <td><strong>${v.name}</strong>${[v.vertragspartner,v.bemerkung].filter(Boolean).length?`<br><span class="text-muted" style="font-size:0.72rem;">${[v.vertragspartner,v.bemerkung].filter(Boolean).join(' · ')}</span>`:''}${paInfo}${endInfo}</td>
            <td><span class="badge badge-neutral">${v.kategorie}</span></td>
            <td>${v.konto_name||"–"}</td>
            <td class="amount negative">${euro(v.betrag)}</td>
            <td>${rhythmusLabel(v.rhythmus)}</td>
            <td class="amount negative">${euro(monatsBetrag(v.betrag,v.rhythmus))}</td>
            <td><span class="badge ${v.aktiv?'badge-green':'badge-red'}">${v.aktiv?'Aktiv':'Inaktiv'}</span></td>
            <td class="text-muted" style="font-size:0.75rem;">${v.letzte_pruefung ? fmtDate(v.letzte_pruefung) : '–'}</td>
            <td class="actions-cell" style="white-space:nowrap;">
                ${alarmBtn}${pruefBtn}
            </td>
        </tr>`;
    }).join("");

    const sum = vt.filter(v=>v.aktiv).reduce((s,v)=>s+monatsBetrag(v.betrag,v.rhythmus),0);
    document.getElementById("vertraege-summe").textContent = euro(sum);
    const jhr = vt.filter(v=>v.aktiv).reduce((s,v)=>s+v.betrag*(12/({monatlich:1,quartalsweise:3,halbjaehrlich:6,jaehrlich:12,zweijaehrlich:24}[v.rhythmus]||1)),0);
    document.getElementById("vertraege-jahres").textContent = euro(jhr);

    // Filter-Bar
    if (!document.getElementById("vt-filter-bar")) {
        const filterBar = document.createElement("div");
        filterBar.id = "vt-filter-bar";
        filterBar.style.cssText = "display:flex;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);align-items:center;";
        filterBar.innerHTML = `
            <input type="text" id="vt-filter-text" placeholder="Suche Name, Partner, Bemerkung..." oninput="filterVertraege()" style="flex:2;padding:6px 12px;font-size:0.82rem;background:var(--bg-secondary);border:1px solid var(--border);color:var(--text-primary);border-radius:var(--radius-sm);">
            <select id="vt-filter-kat" onchange="filterVertraege()" style="flex:1;padding:6px 10px;font-size:0.82rem;background:var(--bg-secondary);border:1px solid var(--border);color:var(--text-primary);border-radius:var(--radius-sm);">
                <option value="">Alle Kategorien</option>
            </select>
            <button onclick="document.getElementById('vt-filter-text').value='';document.getElementById('vt-filter-kat').value='';filterVertraege();" style="background:none;border:none;cursor:pointer;font-size:1.1rem;padding:4px 8px;opacity:0.5;" title="Filter zurücksetzen">✕</button>`;
        const tableWrap = document.querySelector("#section-vertraege .table-wrap");
        if (tableWrap) tableWrap.parentNode.insertBefore(filterBar, tableWrap);
    }
    const katSel = document.getElementById("vt-filter-kat");
    const curKat = katSel.value;
    katSel.innerHTML = '<option value="">Alle Kategorien</option>';
    [...new Set(vt.map(v=>v.kategorie))].sort().forEach(k => {
        const o = document.createElement("option"); o.value=k; o.textContent=k;
        if(k===curKat) o.selected=true;
        katSel.appendChild(o);
    });
    filterVertraege();

    updatePruefHinweis(vt);
}

// Kategorie-Watcher: Versicherungstyp ein/ausblenden
function watchKategorie(selectId, groupId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.addEventListener("change", () => {
        const grp = document.getElementById(groupId);
        if (grp) grp.style.display = sel.value === "Versicherungen" ? "block" : "none";
    });
}
// Kategorie-Vorschlag anhand Name
const KATEGORIE_KEYWORDS = {
    "Versicherungen": ["versicherung","haftpflicht","kasko","rechtsschutz","lebensversicherung","berufsunfähigkeit","unfall"],
    "Grundversorgung": ["strom","gas","wasser","heizung","stadtwerke","energie","fernwärme"],
    "Wohnen": ["miete","hausgeld","grundsteuer","müll","abfall","schornstein","immobilie"],
    "Unterhaltung und Medien": ["netflix","disney","spotify","amazon prime","dazn","youtube","sky","apple tv","audible","zeitung","abo"],
    "Kommunikation": ["telekom","vodafone","o2","1&1","mobilfunk","internet","telefon","handy","glasfaser"],
    "Mobilität": ["adac","kfz","tanken","leasing","bahn","bahncard","scooter","roller"],
    "Finanzen": ["kredit","darlehen","sparplan","depot","bank","girokonto","kreditkarte","bausparer"],
    "Gesundheit": ["krankenkasse","fitnessstudio","fitness","gym","zahnarzt","brille","apotheke"],
    "Kinder": ["kindergarten","kita","schule","nachhilfe","musikschule","sportverein"],
    "Abonnements": ["abo","mitgliedschaft","lizenz","software","cloud","office","icloud"],
    "Sparen und Vorsorge": ["sparplan","etf","rente","riester","rürup","altersvorsorge"],
    "Spenden und Mitgliedschaften": ["spende","verein","mitglied","drk","wwf","greenpeace"]
};

function autoFillAbbuchungstag(prefix) {
    const sd = document.getElementById(prefix + "-startdatum").value;
    const at = document.getElementById(prefix + "-abbuchungstag");
    if (sd && at && !at.value) {
        at.value = parseInt(sd.split("-")[2]);
    }
}

function suggestKategorie(name) {
    if (!name) return null;
    const lower = name.toLowerCase();
    for (const [kat, keywords] of Object.entries(KATEGORIE_KEYWORDS)) {
        if (keywords.some(kw => lower.includes(kw))) return kat;
    }
    return null;
}

function setupNameKategorieSuggest(nameId, katId) {
    const nameEl = document.getElementById(nameId);
    if (!nameEl) return;
    nameEl.addEventListener("blur", () => {
        const suggested = suggestKategorie(nameEl.value);
        const katEl = document.getElementById(katId);
        if (suggested && katEl && katEl.value === "Sonstige") {
            katEl.value = suggested;
            katEl.dispatchEvent(new Event("change"));
            toast(`Kategorie "${suggested}" vorgeschlagen.`);
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    watchKategorie("v-kategorie", "v-versicherung-group");
    watchKategorie("ev-kategorie", "ev-versicherung-group");
    setupNameKategorieSuggest("v-name", "v-kategorie");
    setupNameKategorieSuggest("ev-name", "ev-kategorie");
    // Datums-Validierung: max 4-stelliges Jahr
    document.addEventListener("change", e => {
        if (e.target.type === "date" && e.target.value) {
            const parts = e.target.value.split("-");
            if (parts[0] && parts[0].length > 4) {
                e.target.value = parts[0].slice(0,4) + "-" + parts[1] + "-" + parts[2];
            }
        }
    });
});

async function openNewVertragModal() {
    await Promise.all([refreshKonten(), refreshKategorien()]);
    ["v-name","v-betrag","v-startdatum","v-bemerkung","v-enddatum"].forEach(id=>document.getElementById(id).value="");
    document.getElementById("v-rhythmus").value="monatlich";
    document.getElementById("v-versicherungstyp").value="";
    document.getElementById("v-versicherung-group").style.display="none";
    document.getElementById("v-vertragspartner").value="";
    document.getElementById("v-mindestlaufzeit").value="";
    document.getElementById("v-kuendigungsfrist").value="2";
    document.getElementById("v-abbuchungstag").value="";
    buildKategorieOptions(document.getElementById("v-kategorie"));
    buildKontoOptions(document.getElementById("v-konto"), null, false);
    const dhPanel = document.getElementById("datum-hilfe-panel");
    if (dhPanel) dhPanel.classList.add("hidden");
    document.getElementById("new-vertrag-modal").classList.remove("hidden");
}

async function addVertrag() {
    const d = {
        name: document.getElementById("v-name").value.trim(),
        kategorie: document.getElementById("v-kategorie").value,
        konto_id: parseInt(document.getElementById("v-konto").value),
        betrag: parseFloat(document.getElementById("v-betrag").value),
        startdatum: document.getElementById("v-startdatum").value,
        rhythmus: document.getElementById("v-rhythmus").value,
        bemerkung: document.getElementById("v-bemerkung").value.trim(),
        enddatum: document.getElementById("v-enddatum").value || null,
        versicherungstyp: document.getElementById("v-versicherungstyp").value || null,
        vertragspartner: document.getElementById("v-vertragspartner").value.trim(),
        mindestlaufzeit_ende: document.getElementById("v-mindestlaufzeit").value || null,
        kuendigungsfrist_monate: parseInt(document.getElementById("v-kuendigungsfrist").value) || 2,
        abbuchungstag: document.getElementById("v-abbuchungstag").value ? parseInt(document.getElementById("v-abbuchungstag").value) : null,
    };
    if(!d.name||!d.betrag||!d.startdatum){toast("Pflichtfelder ausfüllen.","error");return;}
    await API.post("/api/vertraege", d);
    document.getElementById("new-vertrag-modal").classList.add("hidden");
    // Datumshilfe zurücksetzen
    const dhPanel = document.getElementById("datum-hilfe-panel");
    if (dhPanel) { dhPanel.classList.add("hidden"); }
    const dhInputs = document.getElementById("datum-hilfe-inputs");
    if (dhInputs) { dhInputs.querySelectorAll("input[type=date]").forEach(i => i.remove()); }
    const dhResult = document.getElementById("datum-hilfe-result");
    if (dhResult) dhResult.textContent = "";
    toast("Vertrag gespeichert!"); loadVertraege();
}

async function editVertrag(id, fromPruef=false) {
    editFromPruef = fromPruef;
    const vt = await API.get("/api/vertraege");
    const v = vt.find(x=>x.id===id); if(!v) return;
    editingVertragId = id;
    document.getElementById("edit-modal").classList.remove("hidden");
    document.getElementById("ev-name").value = v.name;
    buildKategorieOptions(document.getElementById("ev-kategorie"), v.kategorie);
    buildKontoOptions(document.getElementById("ev-konto"), v.konto_id, false);
    document.getElementById("ev-betrag").value = v.betrag;
    document.getElementById("ev-startdatum").value = v.startdatum;
    document.getElementById("ev-rhythmus").value = v.rhythmus;
    document.getElementById("ev-bemerkung").value = v.bemerkung||"";
    document.getElementById("ev-aktiv").checked = v.aktiv===1;
    document.getElementById("ev-pruef-intervall").value = v.pruef_intervall_monate || 12;
    document.getElementById("ev-letzte-pruefung").textContent = v.letzte_pruefung ? fmtDate(v.letzte_pruefung) : "–";
    document.getElementById("ev-enddatum").value = v.enddatum || "";
    document.getElementById("ev-vertragspartner").value = v.vertragspartner || "";
    document.getElementById("ev-mindestlaufzeit").value = v.mindestlaufzeit_ende || "";
    document.getElementById("ev-kuendigungsfrist").value = v.kuendigungsfrist_monate || 2;
    document.getElementById("ev-abbuchungstag").value = v.abbuchungstag || "";
    // Versicherungstyp
    const vGrp = document.getElementById("ev-versicherung-group");
    if (v.kategorie === "Versicherungen") {
        vGrp.style.display = "block";
        document.getElementById("ev-versicherungstyp").value = v.versicherungstyp || "";
    } else {
        vGrp.style.display = "none";
        document.getElementById("ev-versicherungstyp").value = "";
    }
    // Preisänderungen laden
    loadPreisaenderungen(id, v.preisaenderungen || []);
    // Nächsten Fälligkeitstermin als Vorschlag laden
    try {
        const termine = await API.get(`/api/vertraege/${id}/naechste-termine?anzahl=1`);
        if (termine.length) document.getElementById("ev-pa-datum").value = termine[0];
    } catch(e) {}
}

async function saveEditVertrag() {
    if(!editingVertragId) return;
    const d = {
        name: document.getElementById("ev-name").value.trim(),
        kategorie: document.getElementById("ev-kategorie").value,
        konto_id: parseInt(document.getElementById("ev-konto").value),
        betrag: parseFloat(document.getElementById("ev-betrag").value),
        startdatum: document.getElementById("ev-startdatum").value,
        rhythmus: document.getElementById("ev-rhythmus").value,
        bemerkung: document.getElementById("ev-bemerkung").value.trim(),
        aktiv: document.getElementById("ev-aktiv").checked?1:0,
        pruef_intervall_monate: parseInt(document.getElementById("ev-pruef-intervall").value) || 12,
        enddatum: document.getElementById("ev-enddatum").value || null,
        versicherungstyp: document.getElementById("ev-versicherungstyp").value || null,
        vertragspartner: document.getElementById("ev-vertragspartner").value.trim(),
        mindestlaufzeit_ende: document.getElementById("ev-mindestlaufzeit").value || null,
        kuendigungsfrist_monate: parseInt(document.getElementById("ev-kuendigungsfrist").value) || 2,
        abbuchungstag: document.getElementById("ev-abbuchungstag").value ? parseInt(document.getElementById("ev-abbuchungstag").value) : null,
    };
    if(!d.name||!d.betrag||!d.startdatum){toast("Pflichtfelder ausfüllen.","error");return;}
    const vid = editingVertragId;
    const fromPruef = editFromPruef;
    await API.put(`/api/vertraege/${vid}`, d);
    closeEditModal(); toast("Vertrag aktualisiert!");
    // Wenn aus Prüfung heraus geöffnet: automatisch als geprüft markieren
    if (fromPruef) {
        await API.put(`/api/vertraege/${vid}/geprueft`, {});
        toast("Prüfdatum auf heute gesetzt. ✅");
    } else if (d.pruef_intervall_monate > 0) {
        // Prüfen ob der User die Frage deaktiviert hat
        const params = await API.get("/api/parameter");
        if (params.pruef_reset_fragen !== "0") {
            const reset = await nativeConfirm("Prüfdatum zurücksetzen?",
                "Vertrag wurde geändert. Soll das Prüfdatum auf heute zurückgesetzt werden?\n\nJA → Nächste Prüfung in " + d.pruef_intervall_monate + " Monaten\nNEIN → Bisheriger Zeitraum bleibt",
                [{label:"Ja, zurücksetzen", class:"btn-primary", value:"yes"}, {label:"Nein", class:"btn-ghost", value:"no"}, {label:"Nie wieder fragen", class:"btn-ghost", value:"never"}]
            );
            if (reset === "yes") await API.put(`/api/vertraege/${vid}/geprueft`, {});
            if (reset === "never") await API.put("/api/parameter", {pruef_reset_fragen: "0"});
        }
    }
    loadVertraege();
    const vt = await API.get("/api/vertraege");
    updatePruefHinweis(vt);
}

function closeEditModal() { document.getElementById("edit-modal").classList.add("hidden"); editingVertragId=null; }

async function vertragInTopf() {
    if (!editingVertragId) return;
    const vt = await API.get("/api/vertraege");
    const v = vt.find(x => x.id === editingVertragId);
    if (!v) return;

    // Berechnung: anteilig angespartes Geld
    const heute = new Date();
    const rhythmusMonate = {monatlich:1,quartalsweise:3,halbjaehrlich:6,jaehrlich:12,zweijaehrlich:24}[v.rhythmus] || 1;
    const monatlich = v.betrag / rhythmusMonate;

    // Letzte und nächste Fälligkeit finden
    let termine = [];
    try { termine = await API.get(`/api/vertraege/${v.id}/naechste-termine?anzahl=2`); } catch(e) {}
    let naechsterTermin = termine.length ? new Date(termine[0]) : null;
    let monateVerstrichen = 0;
    let startSaldo = 0;

    if (naechsterTermin) {
        const msBisTermin = naechsterTermin - heute;
        const monateBis = Math.max(0, msBisTermin / (1000*60*60*24*30.44));
        monateVerstrichen = Math.max(0, rhythmusMonate - monateBis);
        startSaldo = Math.round(monatlich * monateVerstrichen * 100) / 100;
    }

    const monatlZuw = Math.round(monatlich * 100) / 100;
    const naechstStr = naechsterTermin ? fmtDate(naechsterTermin.toISOString().slice(0,10)) : "unbekannt";

    const ok = await nativeConfirm(
        "Vertrag in Topf umwandeln",
        `${v.name} (${euro(v.betrag)} / ${rhythmusLabel(v.rhythmus)})

` +
        `Berechnung:
` +
        `• Monatlicher Rücklagebedarf: ${euro(monatlZuw)}
` +
        `• Nächste Fälligkeit: ${naechstStr}
` +
        `• Seit letzter Abbuchung vergangen: ~${Math.round(monateVerstrichen)} Monate
` +
        `• Bereits angesparter Anteil: ${euro(startSaldo)}

` +
        `Es wird ein Topf "${v.name}" erstellt mit:
` +
        `• Startsaldo: ${euro(startSaldo)}
` +
        `• Monatliche Zuweisung: ${euro(monatlZuw)}
` +
        `• Der Vertrag wird deaktiviert.`,
        [{label:"Umwandeln", class:"btn-primary", value:true}, {label:"Abbrechen", class:"btn-ghost", value:false}]
    );
    if (!ok) return;

    // Topf erstellen - Name eindeutig machen
    let topfName = v.name;
    const existingNames = cachedKonten.map(k => k.name);
    if (existingNames.includes(topfName)) {
        let suffix = 2;
        while (existingNames.includes(`${v.name} (${suffix})`)) suffix++;
        topfName = `${v.name} (${suffix})`;
    }
    const res = await API.post("/api/konten", {
        name: topfName,
        typ: "topf",
        saldo: startSaldo,
        monatlicher_betrag: monatlZuw,
        zuweisung_startdatum: naechsterErster()
    });
    if (!res.ok) { toast("Fehler beim Erstellen des Topfs.", "error"); return; }

    // Vertrag deaktivieren
    await API.put(`/api/vertraege/${editingVertragId}`, {
        ...v, aktiv: 0, bemerkung: (v.bemerkung ? v.bemerkung + " | " : "") + "→ Topf umgewandelt"
    });
    closeEditModal();
    toast(`"${v.name}" in Topf umgewandelt! Startsaldo: ${euro(startSaldo)}`);
    await refreshKonten();
    selectedTopfId = res.id;
    navigateTo("toepfe");
    loadVertraege();
}

async function showAlarmModal(id) {
    const vt = await API.get("/api/vertraege");
    const v = vt.find(x => x.id === id);
    if (!v) return;
    const action = await nativeConfirm(
        "🔔 Vertragsalarm",
        `${v.name}${v.vertragspartner ? ' ('+v.vertragspartner+')' : ''}\n\n${v.vertragsalarm_text}\n\nWas möchtest du tun?`,
        [
            {label:"✏️ Vertrag bearbeiten", class:"btn-primary", value:"edit"},
            {label:"✅ Geprüft, verlängern", class:"btn-ghost", value:"extend"},
            {label:"🔕 Alarm entfernen", class:"btn-ghost", value:"remove"}
        ]
    );
    if (action === "edit") { navigateTo("vertraege"); setTimeout(()=>editVertrag(id),200); }
    else if (action === "extend") {
        // Neue Laufzeit: 12 Monate ab jetzt
        const neuDatum = new Date();
        neuDatum.setFullYear(neuDatum.getFullYear() + 1);
        await API.put(`/api/vertraege/${id}/alarm-bestaetigen`, {neue_mindestlaufzeit_ende: neuDatum.toISOString().slice(0,10)});
        toast("Laufzeit um 12 Monate verlängert.");
        loadVertraege(); loadDashboard();
    } else if (action === "remove") {
        await API.put(`/api/vertraege/${id}/alarm-bestaetigen`, {});
        toast("Vertragsalarm entfernt.");
        loadVertraege(); loadDashboard();
    }
}

async function pruefungMarkieren() {
    if(!editingVertragId) return;
    await API.put(`/api/vertraege/${editingVertragId}/pruefung-markieren`, {});
    closeEditModal();
    toast("Vertrag zur Prüfung markiert. ⚠");
    loadVertraege();
}

async function deleteVertrag(id) {
    const ok = await nativeConfirm("Vertrag löschen?", "Dieser Vertrag wird unwiderruflich gelöscht.", [{label:"Löschen", class:"btn-danger", value:true}, {label:"Abbrechen", class:"btn-ghost", value:false}]);
    if(!ok) return;
    await API.del(`/api/vertraege/${id}`); toast("Vertrag gelöscht."); loadVertraege();
}

async function deleteVertragFromModal() {
    if(!editingVertragId) return;
    const ok = await nativeConfirm("Vertrag löschen?", "Dieser Vertrag wird unwiderruflich gelöscht.\nAlle zugehörigen Preisänderungen werden ebenfalls entfernt.", [{label:"Endgültig löschen", class:"btn-danger", value:true}, {label:"Abbrechen", class:"btn-ghost", value:false}]);
    if(!ok) return;
    await API.del(`/api/vertraege/${editingVertragId}`);
    closeEditModal(); toast("Vertrag gelöscht."); loadVertraege();
}

// ---------------------------------------------------------------------------
// Vertragsprüfung Modal
// ---------------------------------------------------------------------------
let pruefVertragId = null;

function vertragGeprueft(id) {
    API.get("/api/vertraege").then(vt => {
        const v = vt.find(x => x.id === id);
        if (!v) return;
        pruefVertragId = id;
        document.getElementById("pruef-modal-name").textContent = v.name;
        let info = `${euro(v.betrag)} · ${rhythmusLabel(v.rhythmus)} · ${v.kategorie}`;
        if (v.pruef_grund) info += `\n${v.pruef_grund}`;
        document.getElementById("pruef-modal-info").textContent = info;
        document.getElementById("pruef-modal").classList.remove("hidden");
    });
}

function closePruefModal() {
    document.getElementById("pruef-modal").classList.add("hidden");
    pruefVertragId = null;
}

async function pruefungBestaetigen() {
    if (!pruefVertragId) return;
    await API.put(`/api/vertraege/${pruefVertragId}/geprueft`, {});
    closePruefModal();
    toast("Vertrag als geprüft markiert. ✅");
    loadVertraege();
    const vt = await API.get("/api/vertraege");
    updatePruefHinweis(vt);
}

async function pruefungAendern() {
    if (!pruefVertragId) return;
    const id = pruefVertragId;
    closePruefModal();
    editVertrag(id, true);
}

async function pruefungSpaeter() {
    if (!pruefVertragId) return;
    await API.put(`/api/vertraege/${pruefVertragId}/spaeter-vorlegen`, {});
    closePruefModal();
    toast("Wird in ca. 30 Tagen erneut vorgelegt. 🔔");
    loadVertraege();
    const vt = await API.get("/api/vertraege");
    updatePruefHinweis(vt);
}

// ---------------------------------------------------------------------------
// Startdatum-Hilfe (Durchschnitt berechnen)
// ---------------------------------------------------------------------------
function toggleDatumHilfe() {
    const rhythmus = document.getElementById("v-rhythmus").value;
    if (rhythmus !== "monatlich") {
        toast("Die Datumshilfe ist nur für monatliche Buchungen verfügbar.", "error");
        return;
    }
    const el = document.getElementById("datum-hilfe-panel");
    el.classList.toggle("hidden");
    if (!el.classList.contains("hidden") && el.querySelectorAll("input[type=date]").length === 0) {
        addDatumHilfeInput();
        addDatumHilfeInput();
    }
}

function addDatumHilfeInput() {
    const container = document.getElementById("datum-hilfe-inputs");
    const input = document.createElement("input");
    input.type = "date";
    input.className = "datum-hilfe-input";
    container.insertBefore(input, container.querySelector(".datum-hilfe-btns"));
}

function berechneDurchschnittsDatum() {
    const inputs = document.querySelectorAll("#datum-hilfe-inputs input[type=date]");
    const tage = [];
    inputs.forEach(inp => {
        if (inp.value) {
            const d = new Date(inp.value);
            tage.push(d.getDate()); // Nur den Tag im Monat nehmen
        }
    });
    if (tage.length < 2) { toast("Mindestens 2 Daten eingeben.", "error"); return; }

    // Durchschnittlichen Tag im Monat berechnen
    const avg = Math.round(tage.reduce((a, b) => a + b, 0) / tage.length);
    const avgTag = Math.min(avg, 28); // Sicherheit für Feb

    // Nächsten Termin mit diesem Tag bestimmen
    const heute = new Date();
    let monat = heute.getMonth();
    let jahr = heute.getFullYear();
    let termin = new Date(jahr, monat, avgTag);
    if (termin <= heute) {
        monat++;
        if (monat > 11) { monat = 0; jahr++; }
        termin = new Date(jahr, monat, avgTag);
    }

    const iso = termin.toISOString().slice(0, 10);
    document.getElementById("v-startdatum").value = iso;
    document.getElementById("datum-hilfe-result").innerHTML =
        `Eingaben: ${tage.join("., ")}. → Durchschnitt: <strong>${avgTag}.</strong> des Monats → Startdatum ${fmtDate(iso)}`;
    toast(`Startdatum auf den ${avgTag}. gesetzt!`);
}

function resetDatumHilfe() {
    const container = document.getElementById("datum-hilfe-inputs");
    container.querySelectorAll("input[type=date]").forEach(i => i.remove());
    document.getElementById("datum-hilfe-result").textContent = "";
    addDatumHilfeInput();
    addDatumHilfeInput();
}

// ---------------------------------------------------------------------------
// Preisänderungen
// ---------------------------------------------------------------------------
function loadPreisaenderungen(vertragId, paList) {
    const container = document.getElementById("ev-pa-list");
    if (!paList.length) {
        container.innerHTML = '<div class="text-muted" style="padding:8px 0;">Keine geplanten Änderungen.</div>';
    } else {
        container.innerHTML = paList.map(pa =>
            `<div class="pa-row">
                <span class="pa-betrag">${euro(pa.neuer_betrag)}</span>
                <span class="pa-datum">ab ${fmtDate(pa.ab_datum)}</span>
                <span class="text-muted">${pa.bemerkung||""}</span>
                <button class="btn btn-danger btn-sm" onclick="deletePreisaenderung(${pa.id},${vertragId})" style="margin-left:auto;">×</button>
            </div>`
        ).join("");
    }
    // Store current vertrag_id for adding
    container.dataset.vertragId = vertragId;
}

async function addPreisaenderung() {
    const container = document.getElementById("ev-pa-list");
    const vertragId = parseInt(container.dataset.vertragId);
    const betrag = parseFloat(document.getElementById("ev-pa-betrag").value);
    const datum = document.getElementById("ev-pa-datum").value;
    const bemerkung = document.getElementById("ev-pa-bemerkung").value.trim();
    if (!betrag || !datum) { toast("Betrag und Datum angeben.", "error"); return; }
    await API.post("/api/preisaenderungen", { vertrag_id: vertragId, neuer_betrag: betrag, ab_datum: datum, bemerkung });
    document.getElementById("ev-pa-betrag").value = "";
    document.getElementById("ev-pa-datum").value = "";
    document.getElementById("ev-pa-bemerkung").value = "";
    toast("Preisänderung gespeichert!");
    // Prüfdatum reset anbieten
    const intervall = parseInt(document.getElementById("ev-pruef-intervall").value) || 0;
    if (intervall > 0) {
        const params = await API.get("/api/parameter");
        if (params.pruef_reset_fragen !== "0") {
            const reset = await nativeConfirm("Prüfdatum zurücksetzen?",
                "Preisänderung wurde hinterlegt. Soll das Prüfdatum auf heute zurückgesetzt werden?",
                [{label:"Ja", class:"btn-primary", value:"yes"}, {label:"Nein", class:"btn-ghost", value:"no"}, {label:"Nie wieder fragen", class:"btn-ghost", value:"never"}]
            );
            if (reset === "yes") {
                await API.put(`/api/vertraege/${vertragId}/geprueft`, {});
                toast("Prüfdatum zurückgesetzt.");
            }
            if (reset === "never") await API.put("/api/parameter", {pruef_reset_fragen: "0"});
        }
    }
    // Reload
    const pa = await API.get(`/api/preisaenderungen/${vertragId}`);
    loadPreisaenderungen(vertragId, pa);
}

async function deletePreisaenderung(paId, vertragId) {
    await API.del(`/api/preisaenderungen/${paId}`);
    toast("Preisänderung gelöscht.");
    const pa = await API.get(`/api/preisaenderungen/${vertragId}`);
    loadPreisaenderungen(vertragId, pa);
}

// ---------------------------------------------------------------------------
// Excel-Import
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Kontostand
// ---------------------------------------------------------------------------
async function loadKontostand() {
    await refreshKonten();
    const haupt = cachedKonten.find(k=>k.typ==="hauptkonto");
    const toepfe = cachedKonten.filter(k=>k.typ==="topf").reduce((s,k)=>s+k.saldo,0);
    const fix = haupt?Math.round(haupt.saldo*100)/100:0;
    document.getElementById("ks-bank-gesamt").textContent = euro(fix+toepfe);
    document.getElementById("ks-toepfe-reserviert").textContent = euro(toepfe);
    document.getElementById("ks-fix-verfuegbar").textContent = euro(fix);
    document.getElementById("ks-fix-verfuegbar").className = `value ${fix>=0?"positive":"negative"}`;
    document.getElementById("ks-saldo").value = (fix+toepfe).toFixed(2);
}

async function saveSaldo() {
    const bank = parseFloat(document.getElementById("ks-saldo").value);
    if(isNaN(bank)){toast("Gültigen Betrag eingeben.","error");return;}
    const toepfe = cachedKonten.filter(k=>k.typ==="topf").reduce((s,k)=>s+k.saldo,0);
    const haupt = cachedKonten.find(k=>k.typ==="hauptkonto");
    if(haupt) await API.put(`/api/konten/${haupt.id}`,{saldo: bank-toepfe});
    toast("Kontostand aktualisiert!"); loadKontostand();
}

// ---------------------------------------------------------------------------
// Einzahlungen
// ---------------------------------------------------------------------------
let editingEinzahlungId = null;

async function loadEinzahlungen() {
    await refreshKonten();
    const ez = await API.get("/api/einzahlungen");
    const tbody = document.getElementById("einzahlungen-tbody");
    if(!ez.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-state"><div class="icon">💰</div><p>Noch keine Einzahlungen.</p></td></tr>`;
        document.getElementById("einzahlungen-summe").textContent = euro(0); return;
    }
    tbody.innerHTML = ez.map(e=>`
        <tr>
            <td><strong>${e.bezeichnung}</strong></td>
            <td class="amount positive">+ ${euro(e.betrag)}</td>
            <td>${e.typ==="fest"?`Am ${e.tag_im_monat}. des Monats`:e.datum?fmtDate(e.datum):"–"}</td>
            <td><span class="badge ${e.typ==="fest"?"badge-green":"badge-yellow"}">${e.typ==="fest"?"Fest":"Manuell"}</span></td>
            <td class="actions-cell">
                <button class="btn btn-ghost btn-sm" onclick="editEinzahlung(${e.id})">Bearbeiten</button>
                <button class="btn btn-danger btn-sm" onclick="deleteEinzahlung(${e.id})">Löschen</button>
            </td>
        </tr>`).join("");
    document.getElementById("einzahlungen-summe").textContent = euro(ez.filter(e=>e.typ==="fest").reduce((s,e)=>s+e.betrag,0));
    // Dauerauftrags-Empfehlung anzeigen
    try {
        const da = await API.get("/api/dauerauftraege");
        const empfEl = document.getElementById("einzahlungen-empfehlung");
        if(empfEl) {
            const defizit = da.reduce((s,d) => s + Math.max(0, d.differenz), 0);
            if(defizit > 0) {
                const aktSumme = ez.filter(e=>e.typ==="fest").reduce((s,e)=>s+e.betrag,0);
                const sollSumme = Math.ceil((aktSumme + defizit) * 100) / 100;
                empfEl.innerHTML = ` · <strong style="color:var(--orange);">Empfohlen: ${euro(sollSumme)}</strong> <span style="font-size:0.78rem;">(+${euro(defizit)})</span>`;
            } else {
                empfEl.innerHTML = ` · <span style="color:var(--green);">✅ Deckung OK</span>`;
            }
        }
    } catch(e){}
}

async function addEinzahlung() {
    const haupt = cachedKonten.find(k=>k.typ==="hauptkonto");
    const d = {
        bezeichnung: document.getElementById("e-bezeichnung").value.trim(),
        betrag: parseFloat(document.getElementById("e-betrag").value),
        tag_im_monat: parseInt(document.getElementById("e-tag").value)||null,
        typ: document.getElementById("e-typ").value,
        konto_id: haupt ? haupt.id : 1,
    };
    if(!d.bezeichnung||!d.betrag){toast("Pflichtfelder ausfüllen.","error");return;}
    await API.post("/api/einzahlungen", d);
    ["e-bezeichnung","e-betrag","e-tag"].forEach(id=>document.getElementById(id).value="");
    document.getElementById("e-typ").value="fest";
    toast("Einzahlung gespeichert!"); loadEinzahlungen();
}

async function editEinzahlung(id) {
    const ez = await API.get("/api/einzahlungen");
    const e = ez.find(x => x.id === id);
    if (!e) return;
    editingEinzahlungId = id;
    document.getElementById("einzahlung-modal").classList.remove("hidden");
    document.getElementById("ee-bezeichnung").value = e.bezeichnung;
    document.getElementById("ee-betrag").value = e.betrag;
    document.getElementById("ee-tag").value = e.tag_im_monat || "";
    document.getElementById("ee-typ").value = e.typ;
}

async function saveEditEinzahlung() {
    if (!editingEinzahlungId) return;
    const haupt = cachedKonten.find(k=>k.typ==="hauptkonto");
    const d = {
        bezeichnung: document.getElementById("ee-bezeichnung").value.trim(),
        betrag: parseFloat(document.getElementById("ee-betrag").value),
        tag_im_monat: parseInt(document.getElementById("ee-tag").value) || null,
        typ: document.getElementById("ee-typ").value,
        konto_id: haupt ? haupt.id : 1,
    };
    if (!d.bezeichnung || !d.betrag) { toast("Pflichtfelder ausfüllen.", "error"); return; }
    await API.put("/api/einzahlungen/" + editingEinzahlungId, d);
    closeEinzahlungModal();
    toast("Einzahlung aktualisiert!"); loadEinzahlungen();
}

function closeEinzahlungModal() {
    document.getElementById("einzahlung-modal").classList.add("hidden");
    editingEinzahlungId = null;
}

async function deleteEinzahlung(id) {
    const ok = await nativeConfirm("Einzahlung löschen?", "Diese Einzahlung wird unwiderruflich gelöscht.", [{label:"Löschen", class:"btn-danger", value:true}, {label:"Abbrechen", class:"btn-ghost", value:false}]);
    if(!ok) return;
    await API.del(`/api/einzahlungen/${id}`); toast("Gelöscht."); loadEinzahlungen();
}

// ---------------------------------------------------------------------------
// Virtuelle Töpfe
// ---------------------------------------------------------------------------
async function loadToepfe() {
    await refreshKonten();
    // Default-Startdatum: 1. des aktuellen Monats
    const sd = document.getElementById("t-startdatum");
    if (sd && !sd.value) sd.value = new Date().toISOString().slice(0,8) + "01";
    const toepfe = cachedKonten.filter(k=>k.typ==="topf").sort((a,b)=>a.name.localeCompare(b.name));
    const list = document.getElementById("toepfe-list");
    const gesamt = toepfe.reduce((s,t)=>s+t.saldo,0);
    document.getElementById("toepfe-gesamt").textContent = euro(gesamt);

    if(!toepfe.length) {
        list.innerHTML = `<div class="empty-state" style="padding:24px"><p>Noch keine Töpfe.</p></div>`;
        document.getElementById("topf-detail").innerHTML = "";
        selectedTopfId = null; return;
    }
    if(selectedTopfId && !toepfe.find(t=>t.id===selectedTopfId)) selectedTopfId=null;
    if(!selectedTopfId) selectedTopfId = toepfe[0].id;

    list.innerHTML = toepfe.map(t=>`
        <div class="topf-list-item ${t.id===selectedTopfId?'active':''}" onclick="selectTopf(${t.id})">
            <div class="topf-list-name">${t.name}</div>
            <div class="topf-list-saldo ${t.saldo>=0?'positive':'negative'}">${euro(t.saldo)}</div>
            <div class="topf-list-sub">${t.monatlicher_betrag>0?`+${euro(t.monatlicher_betrag)}/Mon.${t.zuweisung_startdatum?' ab '+fmtDate(t.zuweisung_startdatum):''}`:'Kein Zufluss'}</div>
        </div>`).join("");

    loadTopfDetail(selectedTopfId);
}

async function selectTopf(id) { selectedTopfId = id; await loadToepfe(); }

async function loadTopfDetail(id) {
    const topf = cachedKonten.find(k=>k.id===id);
    if(!topf) { document.getElementById("topf-detail").innerHTML=""; return; }
    const trans = await API.get(`/api/transaktionen?konto_id=${id}`);

    document.getElementById("topf-detail").innerHTML = `
        <div class="topf-detail-header">
            <div>
                <h3>${topf.name}</h3>
                <div class="topf-detail-saldo ${topf.saldo>=0?'positive':'negative'}">${euro(topf.saldo)}</div>
                <div class="text-muted" style="font-size:0.82rem;">${topf.monatlicher_betrag>0?`+${euro(topf.monatlicher_betrag)}/Mon.${topf.zuweisung_startdatum?' ab '+fmtDate(topf.zuweisung_startdatum):''}`:'Kein monatlicher Zufluss'}</div>
            </div>
            <div class="topf-actions">
                <button class="btn btn-primary btn-sm" onclick="showTopfPopup('einzahlung',${id})" title="Einzahlen">+ Einzahlen</button>
                <button class="btn btn-ghost btn-sm" onclick="showTopfPopup('entnahme',${id})" title="Entnehmen">&minus; Entnehmen</button>
                <button class="btn btn-ghost btn-sm" onclick="showTopfPopup('umbuchung',${id})" title="Umbuchen">&#8644; Umbuchen</button>
                <button class="btn btn-ghost btn-sm" onclick="openTopfZuweisungModal(${id})" title="Zuweisung ändern">⚙ Zuweisung</button>
                <button class="btn btn-danger btn-sm" onclick="deleteTopf(${id})" title="Topf löschen">Topf löschen</button>
            </div>
        </div>
        <h4 style="margin:20px 0 12px;font-size:0.9rem;color:var(--text-muted);">Buchungsverlauf</h4>
        <div style="flex:1;overflow-y:auto;min-height:0;">
        ${trans.length ? `<table class="topf-trans-table">
            <thead><tr><th>Datum</th><th>Typ</th><th>Von/Nach</th><th>Betrag</th><th>Beschreibung</th></tr></thead>
            <tbody>${trans.map(t => {
                const isIn = t.nach_konto_id === id;
                const partner = isIn ? t.von_konto_name : t.nach_konto_name;
                const typL = {einzahlung:"Einzahlung",entnahme:"Entnahme",umbuchung:"Umbuchung",abbuchung:"Abbuchung"}[t.typ]||t.typ;
                return `<tr style="cursor:pointer;" onclick="openEditTransaktion(${t.id},${id},${JSON.stringify(t.datum).replace(/"/g,'&quot;')},${t.betrag},${JSON.stringify(t.beschreibung||'').replace(/"/g,'&quot;')},${JSON.stringify(typL).replace(/"/g,'&quot;')})">
                    <td>${fmtDate(t.datum)}</td><td><span class="badge ${isIn?'badge-green':'badge-red'}">${typL}</span></td>
                    <td>${partner||"–"}</td><td class="amount ${isIn?'positive':'negative'}">${isIn?'+':'-'} ${euro(t.betrag)}</td>
                    <td>${t.beschreibung||"–"}</td></tr>`;
            }).join("")}</tbody></table>` : '<div class="empty-state" style="padding:24px"><p>Noch keine Buchungen.</p></div>'}
        </div>`;
}

async function addTopf() {
    const name = document.getElementById("t-name").value.trim();
    const saldo = parseFloat(document.getElementById("t-saldo").value)||0;
    const monatlich = parseFloat(document.getElementById("t-monatlich").value)||0;
    const startdatum = document.getElementById("t-startdatum").value || null;
    if(!name){toast("Name eingeben.","error");return;}
    const res = await API.post("/api/konten",{name,typ:"topf",saldo,monatlicher_betrag:monatlich,zuweisung_startdatum:startdatum});
    if(!res.ok){toast("Fehler: Name existiert bereits?","error");return;}
    document.getElementById("new-topf-modal").classList.add("hidden");
    selectedTopfId = res.id; toast(`Topf "${name}" angelegt!`); loadToepfe();
}

async function deleteTopf(id) {
    const topf = cachedKonten.find(k=>k.id===id);
    if(!topf) return;
    
    if(topf.saldo > 0) {
        // Saldo vorhanden → Auswahl: in anderen Topf oder auflösen
        const andereToepfe = cachedKonten.filter(k=>k.typ==="topf"&&k.id!==id);
        const optionen = [{label:"Saldo auflösen (verfällt)", class:"btn-danger", value:"aufloesen"}];
        if(andereToepfe.length) optionen.unshift({label:"In anderen Topf verschieben", class:"btn-primary", value:"verschieben"});
        optionen.push({label:"Abbrechen", class:"btn-ghost", value:false});
        
        const wahl = await nativeConfirm("Topf löschen?", 
            `Topf "${topf.name}" hat noch ${euro(topf.saldo)} Guthaben.`, optionen);
        if(!wahl) return;
        
        if(wahl === "verschieben" && andereToepfe.length) {
            // Ziel-Topf auswählen
            const zielOptionen = andereToepfe.map(t => ({label:`${t.name} (${euro(t.saldo)})`, class:"btn-ghost", value:t.id}));
            zielOptionen.push({label:"Abbrechen", class:"btn-ghost", value:false});
            const zielId = await nativeConfirm("Ziel-Topf wählen", `${euro(topf.saldo)} wird umgebucht:`, zielOptionen);
            if(!zielId) return;
            await API.post("/api/umbuchung", {von_konto_id:id, nach_konto_id:zielId, betrag:topf.saldo, beschreibung:`Topf "${topf.name}" aufgelöst`});
        }
        // Bei "aufloesen" wird einfach gelöscht — Saldo verfällt (virtuelles Geld)
    } else if(topf.saldo < 0) {
        const ok = await nativeConfirm("Topf löschen?", 
            `Topf "${topf.name}" hat ${euro(topf.saldo)} (negativ). Wird aufgelöst.`, 
            [{label:"Löschen", class:"btn-danger", value:true}, {label:"Abbrechen", class:"btn-ghost", value:false}]);
        if(!ok) return;
    } else {
        const ok = await nativeConfirm("Topf löschen?", 
            `Topf "${topf.name}" wird gelöscht.`, 
            [{label:"Löschen", class:"btn-danger", value:true}, {label:"Abbrechen", class:"btn-ghost", value:false}]);
        if(!ok) return;
    }
    
    const res = await API.del(`/api/konten/${id}`);
    if(!res.ok){toast(res.error||"Fehler","error");return;}
    selectedTopfId = null; toast(`Topf "${topf.name}" gelöscht.`); await refreshKonten(); loadToepfe();
}

async function openEditTransaktion(txId, topfId, datum, betrag, beschreibung, typLabel) {
    const modal = document.getElementById("confirm-modal");
    document.getElementById("confirm-modal-title").textContent = `Buchung bearbeiten — ${typLabel}`;
    document.getElementById("confirm-modal-text").innerHTML = `
        <div class="form-grid" style="gap:12px;">
            <div class="form-group">
                <label>Datum</label>
                <input type="date" id="edit-tx-datum" value="${datum}">
            </div>
            <div class="form-group">
                <label>Betrag (€)</label>
                <input type="number" id="edit-tx-betrag" step="0.01" min="0.01" value="${betrag.toFixed(2)}">
            </div>
            <div class="form-group" style="grid-column:1/-1;">
                <label>Beschreibung</label>
                <input type="text" id="edit-tx-beschreibung" value="${beschreibung}">
            </div>
        </div>`;
    const btnContainer = document.getElementById("confirm-modal-buttons");
    btnContainer.innerHTML = "";
    
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-primary";
    saveBtn.textContent = "Speichern";
    saveBtn.onclick = async () => {
        const newBetrag = parseFloat(document.getElementById("edit-tx-betrag").value);
        if (!newBetrag || newBetrag <= 0) { toast("Betrag muss positiv sein.", "error"); return; }
        await API.put(`/api/transaktionen/${txId}`, {
            betrag: newBetrag,
            beschreibung: document.getElementById("edit-tx-beschreibung").value,
            datum: document.getElementById("edit-tx-datum").value
        });
        modal.classList.add("hidden");
        toast("Buchung aktualisiert.");
        await refreshKonten();
        loadTopfDetail(topfId);
        loadToepfe();
    };
    
    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-danger";
    delBtn.textContent = "Löschen";
    delBtn.onclick = async () => {
        const ok = await nativeConfirm("Buchung löschen?", "Diese Buchung wird unwiderruflich gelöscht.", 
            [{label:"Löschen", class:"btn-danger", value:true}, {label:"Abbrechen", class:"btn-ghost", value:false}]);
        if (!ok) return;
        await API.del(`/api/transaktionen/${txId}`);
        modal.classList.add("hidden");
        toast("Buchung gelöscht.");
        await refreshKonten();
        loadTopfDetail(topfId);
        loadToepfe();
    };
    
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-ghost";
    cancelBtn.textContent = "Abbrechen";
    cancelBtn.onclick = () => modal.classList.add("hidden");
    
    btnContainer.appendChild(saveBtn);
    btnContainer.appendChild(delBtn);
    btnContainer.appendChild(cancelBtn);
    modal.classList.remove("hidden");
}

async function saveTopfZuweisung(id) {
    const betrag = parseFloat(document.getElementById("topf-zuw-betrag").value) || 0;
    const datum = document.getElementById("topf-zuw-datum").value || null;
    await API.put(`/api/konten/${id}`, {monatlicher_betrag: betrag, zuweisung_startdatum: datum});
    document.getElementById("topf-zuweisung-modal").classList.add("hidden");
    toast("Zuweisung aktualisiert!");
    await refreshKonten();
    loadToepfe();
}

function naechsterErster() {
    const d = new Date();
    d.setMonth(d.getMonth() + 1); d.setDate(1);
    return d.toISOString().slice(0, 10);
}

function openTopfZuweisungModal(id) {
    const topf = cachedKonten.find(k => k.id === id);
    if (!topf) return;
    document.getElementById("topf-zuw-name").textContent = topf.name;
    document.getElementById("topf-zuw-betrag").value = topf.monatlicher_betrag || 0;
    // Wenn bestehendes Datum in der Vergangenheit liegt → nächsten 1. vorschlagen
    let datum = topf.zuweisung_startdatum;
    if(datum && datum < new Date().toISOString().slice(0,10)) datum = naechsterErster();
    document.getElementById("topf-zuw-datum").value = datum || naechsterErster();
    document.getElementById("topf-zuw-id").value = id;
    document.getElementById("topf-zuweisung-modal").classList.remove("hidden");
}

function openNewTopfModal() {
    document.getElementById("t-name").value = "";
    document.getElementById("t-saldo").value = "0";
    document.getElementById("t-monatlich").value = "0";
    document.getElementById("t-startdatum").value = naechsterErster();
    document.getElementById("new-topf-modal").classList.remove("hidden");
}

// Topf-Popup
let topfPopupAction = null, topfPopupKontoId = null;

function showTopfPopup(action, kontoId) {
    topfPopupAction = action; topfPopupKontoId = kontoId;
    const topf = cachedKonten.find(k=>k.id===kontoId);
    document.getElementById("topf-popup").classList.remove("hidden");
    // Focus auf Betrag + Enter zum Absenden
    setTimeout(() => {
        const betragInput = document.getElementById("tp-betrag");
        betragInput.value = "";
        betragInput.focus();
    }, 50);
    document.getElementById("tp-title").textContent =
        action==="einzahlung" ? `Einzahlung in "${topf.name}"` :
        action==="entnahme" ? `Entnahme aus "${topf.name}"` :
        `Umbuchung von "${topf.name}"`;
    document.getElementById("tp-betrag").value = "";
    document.getElementById("tp-beschreibung").value = "";
    document.getElementById("tp-datum").value = new Date().toISOString().slice(0,10);
    const zielGroup = document.getElementById("tp-ziel-group");
    if(action==="umbuchung") {
        zielGroup.classList.remove("hidden");
        const sel = document.getElementById("tp-ziel"); sel.innerHTML = "";
        cachedKonten.filter(k=>k.id!==kontoId).forEach(k => {
            const o=document.createElement("option"); o.value=k.id;
            o.textContent=k.name+(k.typ==="hauptkonto"?" (Haupt)":""); sel.appendChild(o);
        });
    } else { zielGroup.classList.add("hidden"); }
}

function closeTopfPopup() { document.getElementById("topf-popup").classList.add("hidden"); topfPopupAction=null; topfPopupKontoId=null; }

// Topf-Popup: Enter-Flow (Betrag → Beschreibung → Absenden)
document.addEventListener("keydown", e => {
    // +/- Shortcuts in Topf-Übersicht
    if (selectedTopfId && !e.target.closest("input,select,textarea") &&
        document.getElementById("section-toepfe") && !document.getElementById("section-toepfe").classList.contains("hidden")) {
        if (e.key === "+" || e.key === "=") { e.preventDefault(); showTopfPopup("einzahlung", selectedTopfId); return; }
        if (e.key === "-") { e.preventDefault(); showTopfPopup("entnahme", selectedTopfId); return; }
    }
    // ESC schließt alle offenen Modals/Popups
    if (e.key === "Escape") {
        const modals = ["topf-popup","edit-modal","new-vertrag-modal","new-topf-modal","topf-zuweisung-modal","pruef-modal","confirm-modal","startup-modal"];
        for (const id of modals) {
            const el = document.getElementById(id);
            if (el && !el.classList.contains("hidden")) { el.classList.add("hidden"); e.preventDefault(); return; }
        }
    }
    // Enter in Topf-Popup
    if (document.getElementById("topf-popup").classList.contains("hidden")) return;
    if (e.key !== "Enter") return;
    e.preventDefault();
    const active = document.activeElement;
    if (active && active.id === "tp-betrag") {
        document.getElementById("tp-beschreibung").focus();
    } else {
        executeTopfPopup();
    }
});

async function executeTopfPopup() {
    const betrag = parseFloat(document.getElementById("tp-betrag").value);
    const beschreibung = document.getElementById("tp-beschreibung").value.trim();
    const datum = document.getElementById("tp-datum").value;
    if(!betrag||betrag<=0){toast("Gültigen Betrag eingeben.","error");return;}
    let res;
    if(topfPopupAction==="umbuchung") {
        res = await API.post("/api/umbuchung",{von_konto_id:topfPopupKontoId, nach_konto_id:parseInt(document.getElementById("tp-ziel").value), betrag, beschreibung, datum});
    } else {
        res = await API.post("/api/topf-buchung",{konto_id:topfPopupKontoId, typ:topfPopupAction, betrag, beschreibung, datum});
    }
    if(!res.ok){toast(res.error||"Fehler","error");return;}
    closeTopfPopup();
    toast(topfPopupAction==="einzahlung"?"Einzahlung gebucht!":topfPopupAction==="entnahme"?"Entnahme gebucht!":"Umbuchung durchgeführt!");
    loadToepfe();
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
let simChart = null;

async function loadSimulation() {
    const loading = document.getElementById("sim-loading");
    const content = document.getElementById("sim-content");
    loading.classList.remove("hidden"); content.classList.add("hidden");
    try {
        const res = await fetch("/api/simulation");
        const data = await res.json();
        if (!data.ok) { loading.textContent = "Fehler: " + (data.error || "Unbekannt"); return; }
        loading.classList.add("hidden"); content.classList.remove("hidden");
        const el = id => document.getElementById(id);

        el("sim-startsaldo").textContent = euro(data.startsaldo);
        el("sim-startsaldo").className = "value " + (data.startsaldo >= 0 ? "positive" : "negative");
        el("sim-min-saldo").textContent = euro(data.min_saldo);
        el("sim-min-saldo").className = "value " + (data.min_saldo >= 0 ? "positive" : "negative");
        el("sim-min-datum").textContent = "am " + fmtDate(data.min_saldo_datum);

        const endS = data.monate.length ? data.monate[data.monate.length-1].endsaldo : 0;
        el("sim-endsaldo").textContent = euro(endS);
        el("sim-endsaldo").className = "value " + (endS >= 0 ? "positive" : "negative");
        // Debug-Info in Konsole
        if (data.debug) {
            const d = data.debug;
            console.log(`Simulation: Σ Ein: ${d.total_einnahmen}, Σ Aus: ${d.total_ausgaben}, Diff: ${d.total_einnahmen - d.total_ausgaben} | ${d.einzahlung_termine_count} Einz., ${d.vertrag_termine_count} Vertr. | ${d.heute}→${d.bis}`);
            console.log(`Topf-Debug: ${d.topf_konten_count} Töpfe, ${d.topf_konten_mit_betrag} mit Betrag, ${d.topf_termine_count} Termine, keys: ${d.tage_keys}, erster_smt: ${d.erster_tag_smt}, letzter_smt: ${d.letzter_tag_smt}, letzter_saldo: ${d.letzter_tag_saldo}`);
        }

        const simPuffer = parseFloat((await API.get("/api/parameter")).sicherheitspuffer) || 0;
        const pufferGerissen = data.min_saldo < simPuffer;
        const warnEl = el("sim-warnung");
        
        // Berechne: Wie viel muss einmalig aufs Konto, damit min_saldo >= puffer?
        const fehlbetrag = simPuffer - data.min_saldo;
        
        if (data.warnung_negativ || (pufferGerissen && simPuffer > 0)) {
            let msg = "";
            let einzahlBetrag = 0;
            if (data.warnung_negativ && simPuffer > 0 && pufferGerissen) {
                einzahlBetrag = fehlbetrag;
                msg = `<strong>Achtung:</strong> Der Saldo wird negativ! Minimaler Saldo: ${euro(data.min_saldo)} am ${fmtDate(data.min_saldo_datum)}.<br>`
                    + `<strong>Empfehlung:</strong> ${euro(fehlbetrag)} einmalig auf das Konto einzahlen, damit der Puffer von ${euro(simPuffer)} gehalten wird.`;
            } else if (data.warnung_negativ) {
                einzahlBetrag = Math.abs(data.min_saldo);
                msg = `<strong>Achtung:</strong> Der Saldo wird negativ! Minimaler Saldo: ${euro(data.min_saldo)} am ${fmtDate(data.min_saldo_datum)}.<br>`
                    + `<strong>Empfehlung:</strong> Mindestens ${euro(einzahlBetrag)} einmalig auf das Konto einzahlen.`;
            } else {
                einzahlBetrag = fehlbetrag;
                msg = `<strong>Achtung:</strong> Der Sicherheitspuffer von ${euro(simPuffer)} wird unterschritten (Min: ${euro(data.min_saldo)} am ${fmtDate(data.min_saldo_datum)}).<br>`
                    + `<strong>Empfehlung:</strong> ${euro(fehlbetrag)} einmalig auf das Konto einzahlen.`;
            }
            el("sim-warnung-text").innerHTML = msg;
            const btn = el("sim-warnung-btn");
            btn.classList.remove("hidden");
            btn.dataset.betrag = Math.ceil(einzahlBetrag * 100) / 100; // Aufrunden auf Cent
            warnEl.classList.remove("hidden");
        } else {
            warnEl.classList.add("hidden");
        }

        renderSimChart(data.tage, simPuffer);

        el("sim-monate-tbody").innerHTML = data.monate.map(m =>
            `<tr><td><strong>${fmtMonat(m.monat)}</strong></td>
            <td class="amount">${euro(m.startsaldo)}</td>
            <td class="amount positive">+ ${euro(m.einnahmen)}</td>
            <td class="amount negative">- ${euro(m.ausgaben)}</td>
            <td class="amount ${m.netto>=0?'positive':'negative'}">${euro(m.netto)}</td>
            <td class="amount ${m.endsaldo>=0?'positive':'negative'}">${euro(m.endsaldo)}</td>
            <td><span class="badge ${m.status==='ok'?'badge-green':'badge-red'}">${m.status==='ok'?'OK':'Negativ'}</span></td></tr>`
        ).join("");
    } catch(e) { loading.textContent = "Fehler: " + e.message; }
}

async function simUeberweisungErledigt() {
    const btn = document.getElementById("sim-warnung-btn");
    const betrag = parseFloat(btn.dataset.betrag);
    if (!betrag || betrag <= 0) return;
    const ok = await nativeConfirm("Überweisung bestätigen?", 
        `${euro(betrag)} wird dem Kontostand hinzugebucht.`, 
        [{label:"Bestätigen", class:"btn-primary", value:true}, {label:"Abbrechen", class:"btn-ghost", value:false}]);
    if (!ok) return;
    const haupt = cachedKonten.find(k => k.typ === "hauptkonto");
    if (haupt) {
        await API.put(`/api/konten/${haupt.id}`, {saldo: haupt.saldo + betrag});
        await API.put("/api/parameter", {kontostand_aktualisiert: new Date().toISOString().slice(0,10)});
        toast(`${euro(betrag)} dem Kontostand zugebucht!`);
        await refreshKonten();
        loadSimulation();
    }
}

async function dashBannerEinzahlung(betrag) {
    if (!betrag || betrag <= 0) return;
    const ok = await nativeConfirm("Überweisung bestätigen?", 
        `${euro(betrag)} wird dem Kontostand hinzugebucht.`, 
        [{label:"Bestätigen", class:"btn-primary", value:true}, {label:"Abbrechen", class:"btn-ghost", value:false}]);
    if (!ok) return;
    const haupt = cachedKonten.find(k => k.typ === "hauptkonto");
    if (haupt) {
        await API.put(`/api/konten/${haupt.id}`, {saldo: haupt.saldo + betrag});
        await API.put("/api/parameter", {kontostand_aktualisiert: new Date().toISOString().slice(0,10)});
        toast(`${euro(betrag)} dem Kontostand zugebucht!`);
        await refreshKonten();
        loadDashboard();
    }
}

function renderSimChart(tage, puffer) {
    const canvas = document.getElementById("sim-chart");
    if (!canvas) return;
    puffer = puffer || 0;
    
    // Smart Sampling: Alle Tage mit Buchungen behalten + Monats-1./15. als Stützpunkte
    const sampled = tage.filter((t, i) => {
        if (t.anzahl_buchungen > 0) return true; // Buchungstage immer
        const d = t.datum.substring(8,10); // Tag im Monat
        if (d === "01" || d === "15") return true; // 1. und 15. als Stützpunkte
        if (i === 0 || i === tage.length - 1) return true; // Erster und letzter Tag
        return false;
    });
    if (simChart) simChart.destroy();
    
    // X-Achsen-Labels: Jeden 2. Monat beschriften für Lesbarkeit
    let monthIdx = 0;
    const labels = sampled.map(t => {
        const d = t.datum.substring(8,10);
        if (d === "01") {
            monthIdx++;
            if (monthIdx % 2 === 1) {
                const [j,m] = t.datum.split("-");
                const mn = ["","Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"][parseInt(m)];
                return `${mn} ${j}`;
            }
        }
        return "";
    });
    
    // Check if topf data exists and differs
    const hasToepfe = sampled.some(t => t.saldo_mit_toepfen != null && Math.abs(t.saldo_mit_toepfen - t.saldo) > 0.01);
    console.log("Chart: hasToepfe=", hasToepfe, "sampled[last]=", sampled.length ? {s:sampled[sampled.length-1].saldo, st:sampled[sampled.length-1].saldo_mit_toepfen} : "empty");
    
    const datasets = [];
    
    if(hasToepfe) {
        datasets.push({
            label: "Inkl. Töpfe", data: sampled.map(t => t.saldo),
            borderColor: "#6c7bd4", backgroundColor: "rgba(108,123,212,0.08)",
            fill: true, tension: 0.1, pointRadius: 0, borderWidth: 1.5, order: 2,
        });
        datasets.push({
            label: "Nur Verträge", data: sampled.map(t => t.saldo_mit_toepfen),
            borderColor: "rgba(148,163,214,0.6)", backgroundColor: "transparent",
            fill: false, tension: 0.1, pointRadius: 0, borderWidth: 1.5, borderDash: [6,3], order: 1,
        });
    } else {
        datasets.push({
            label: "Saldo", data: sampled.map(t => t.saldo),
            borderColor: "#6c7bd4", backgroundColor: "rgba(108,123,212,0.08)",
            fill: true, tension: 0.1, pointRadius: 0, borderWidth: 1.5, order: 2,
        });
    }
    
    datasets.push({
        label: "Nulllinie", data: sampled.map(() => 0),
        borderColor: "rgba(248,113,113,0.4)", borderDash: [5,5], borderWidth: 1, pointRadius: 0, fill: false, order: 3,
    });
    
    // Puffer-Area
    if (puffer > 0) {
        datasets.push({
            label: "_puffer_base", data: sampled.map(() => 0),
            borderWidth: 0, pointRadius: 0, fill: false, order: 0,
        });
        datasets.push({
            label: `Sicherheitspuffer (${euro(puffer)})`, data: sampled.map(() => puffer),
            borderColor: "rgba(74,222,128,0.5)", borderWidth: 1.5, borderDash: [4,4],
            pointRadius: 0, 
            backgroundColor: "rgba(74,222,128,0.10)",
            fill: "-1",
            order: 0,
        });
    }
    
    simChart = new Chart(canvas, {
        type: "line",
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: {display: puffer > 0 || hasToepfe, labels: {filter: item => !item.text.startsWith("_") && item.text !== "Nulllinie", color: "#8b90a5", font:{size:11}}}, tooltip: { 
                callbacks: { 
                    title: ctx => { const idx = ctx[0].dataIndex; return fmtDate(sampled[idx].datum); },
                    label: ctx => {
                        if(ctx.dataset.label === "Saldo") return `Saldo: ${euro(ctx.parsed.y)}`;
                        if(ctx.dataset.label === "Inkl. Töpfe") return `Inkl. Töpfe: ${euro(ctx.parsed.y)}`;
                        if(ctx.dataset.label === "Nur Verträge") return `Nur Verträge: ${euro(ctx.parsed.y)}`;
                        if(ctx.dataset.label.startsWith("Sicherheitspuffer")) return `Puffer: ${euro(ctx.parsed.y)}`;
                        return null;
                    }
                } 
            } },
            scales: {
                x: { ticks: {color:"#5c6078", maxTicksLimit:14, font:{size:11}, autoSkip:false, maxRotation:0, callback: function(val,idx){const l=this.getLabelForValue(val);return l||null;}}, grid: {color:"rgba(46,51,72,0.5)", lineWidth: function(ctx){return labels[ctx.index]?"1":"0";}} },
                y: { 
                    ticks: {
                        color:"#5c6078", 
                        font:{size:11},
                        callback: v => new Intl.NumberFormat("de-DE",{notation:"compact"}).format(v)+" €",
                    }, 
                    grid: {color:"rgba(46,51,72,0.5)"},
                    afterDataLimits: function(axis) {
                        // Gleichmäßige Schritte berechnen
                        const range = axis.max - axis.min;
                        const steps = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
                        let step = steps.find(s => range / s <= 10) || Math.ceil(range / 8 / 100) * 100;
                        axis.options.ticks.stepSize = step;
                        axis.min = Math.floor(axis.min / step) * step;
                        axis.max = Math.ceil(axis.max / step) * step;
                    }
                }
            },
            interaction: {mode:"index",intersect:false},
        }
    });
}

// ---------------------------------------------------------------------------
// Kalender / Heatmap
// ---------------------------------------------------------------------------
let calJahr = new Date().getFullYear(), calMonat = new Date().getMonth() + 1;

const MONATSNAMEN = ["","Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

async function loadKalender() {
    const data = await API.get(`/api/kalender?jahr=${calJahr}&monat=${calMonat}`);
    if (!data.ok) return;

    document.getElementById("cal-monat-label").textContent = MONATSNAMEN[data.monat] + " " + data.jahr;

    const grid = document.getElementById("cal-days");
    grid.innerHTML = "";

    // Leere Zellen vor dem 1.
    for (let i = 0; i < data.wochentag_start; i++) {
        grid.innerHTML += '<div class="cal-cell cal-empty"></div>';
    }

    // Heute als ISO
    const heuteISO = new Date().toISOString().slice(0,10);

    data.tage.forEach(t => {
        const tag = parseInt(t.datum.split("-")[2]);
        const isHeute = t.datum === heuteISO;
        const div = document.createElement("div");
        div.className = `cal-cell cal-level-${t.level}${isHeute ? " cal-heute" : ""}${t.ist_faelligkeitstag ? " cal-faellig" : ""}${t.ist_unsicher ? " cal-unsicher" : ""}${t.ist_feiertag ? " cal-feiertag" : ""}${t.ist_wochenend_original ? " cal-bankfrei" : ""}`;
        // Wochentag prüfen (0=Mo..6=So) — Sa/So immer bankfrei stylen
        const datum = new Date(t.datum);
        const wd = datum.getDay(); // 0=So, 6=Sa
        if (wd === 0 || wd === 6) div.classList.add("cal-bankfrei");

        if (t.ist_wochenend_original || wd === 0 || wd === 6 || t.ist_feiertag) {
            if (t.ist_wochenend_original) {
                div.innerHTML = `<span class="cal-tag-nr">${tag}</span><div class="cal-bankfrei-icons"><span>✕</span><span>🔒</span></div>`;
                div.title = "Buchung auf bankfreien Tag → verschoben auf nächsten Bankwerktag";
            } else if (wd === 0 || wd === 6) {
                div.innerHTML = `<span class="cal-tag-nr">${tag}</span><div class="cal-bankfrei-icons"><span>🔒</span></div>`;
                div.title = "Wochenende — keine Buchungen";
            } else {
                // Feiertag unter der Woche ohne verschobene Buchung
                div.innerHTML = `<span class="cal-tag-nr">${tag}</span><span class="cal-feiertag-label">Feiertag</span>`;
                div.title = "Feiertag — keine Buchungen";
            }
        } else {
            div.innerHTML = `<span class="cal-tag-nr">${tag}</span>` +
                (t.anzahl > 0 ? `<span class="cal-tag-count">${t.anzahl}x</span>` : "");
        }
        div.onclick = () => showCalDetail(t);
        grid.appendChild(div);
    });

    // Detail ausblenden
    document.getElementById("cal-detail").style.display = "none";
    const ph = document.getElementById("cal-detail-placeholder");
    if (ph) ph.style.display = "block";
}

function calNav(offset) {
    calMonat += offset;
    if (calMonat > 12) { calMonat = 1; calJahr++; }
    if (calMonat < 1) { calMonat = 12; calJahr--; }
    loadKalender();
}

function showCalDetail(tag) {
    const detail = document.getElementById("cal-detail");
    const placeholder = document.getElementById("cal-detail-placeholder");
    detail.style.display = "block";
    if (placeholder) placeholder.style.display = "none";
    document.getElementById("cal-detail-title").textContent = fmtDate(tag.datum);

    if (tag.buchungen.length === 0) {
        document.getElementById("cal-detail-body").innerHTML =
            '<div style="color:var(--text-muted);padding:12px;">Keine Buchungen an diesem Tag.</div>';
        return;
    }

    let html = '<table style="width:100%;"><thead><tr><th>Name</th><th>Typ</th><th>Betrag</th></tr></thead><tbody>';
    tag.buchungen.forEach(b => {
        const isEin = b.typ === "einnahme";
        html += `<tr>
            <td>${b.name}${b.kategorie ? ' <span class="badge badge-neutral">' + b.kategorie + '</span>' : ''}</td>
            <td><span class="badge ${isEin ? 'badge-green' : 'badge-red'}">${isEin ? 'Einnahme' : 'Ausgabe'}</span></td>
            <td class="amount ${isEin ? 'positive' : 'negative'}">${isEin ? '+' : '-'} ${euro(b.betrag)}</td>
        </tr>`;
    });
    html += '</tbody></table>';

    if (tag.summe_ausgaben > 0 || tag.summe_einnahmen > 0) {
        html += `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);font-size:0.85rem;">`;
        if (tag.summe_einnahmen > 0) html += `<span class="positive">Einnahmen: ${euro(tag.summe_einnahmen)}</span> &nbsp; `;
        if (tag.summe_ausgaben > 0) html += `<span class="negative">Ausgaben: ${euro(tag.summe_ausgaben)}</span>`;
        html += `</div>`;
    }

    document.getElementById("cal-detail-body").innerHTML = html;
}

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------
async function loadEinstellungen() {
    const params = await API.get("/api/parameter");
    document.getElementById("param-sicherheitstage").value = params.sicherheitstage || "2";
    document.getElementById("param-sicherheitstage-vor").value = params.sicherheitstage_vor || "1";
    document.getElementById("param-kontoname").value = params.kontoname || "Fixkostenkonto";
    document.getElementById("param-sicherheitspuffer").value = params.sicherheitspuffer || "100";
    document.getElementById("param-pruef-intervall").value = params.pruef_intervall_standard || "12";
    document.getElementById("param-kfz-pruefmonat").value = params.kfz_pruefmonat || "11";
    document.getElementById("param-moped-pruefmonat").value = params.moped_pruefmonat || "1";
    document.getElementById("param-pruef-reset-fragen").checked = params.pruef_reset_fragen !== "0";
    document.getElementById("param-kontostand-schaetzen").checked = params.kontostand_schaetzen !== "0";
    // DB-Pfad
    try {
        const st = await API.get("/api/status");
        document.getElementById("dash-db-pfad").textContent = st.db_pfad || "–";
    } catch(e) {}
    // Kategorien laden
    await loadKategorienList();
}

async function saveEinstellungen() {
    const d = {
        sicherheitstage: document.getElementById("param-sicherheitstage").value,
        sicherheitstage_vor: document.getElementById("param-sicherheitstage-vor").value,
        kontoname: document.getElementById("param-kontoname").value.trim() || "Fixkostenkonto",
        sicherheitspuffer: document.getElementById("param-sicherheitspuffer").value,
        pruef_intervall_standard: document.getElementById("param-pruef-intervall").value,
        kfz_pruefmonat: document.getElementById("param-kfz-pruefmonat").value,
        moped_pruefmonat: document.getElementById("param-moped-pruefmonat").value,
        pruef_reset_fragen: document.getElementById("param-pruef-reset-fragen").checked ? "1" : "0",
        kontostand_schaetzen: document.getElementById("param-kontostand-schaetzen").checked ? "1" : "0",
    };
    await API.put("/api/parameter", d);
    toast("Einstellungen gespeichert!");
}

async function loadKategorienList() {
    const kats = await API.get("/api/kategorien");
    const container = document.getElementById("kat-list");
    if (!kats.length) {
        container.innerHTML = '<div class="text-muted" style="padding:8px;">Keine Kategorien.</div>';
    } else {
        container.innerHTML = kats.map(k => {
            const locked = k === "Versicherungen";
            return `<div class="pa-row">
                <span style="flex:1;">${k}${locked ? ' <span style="font-size:0.7rem;opacity:0.5;">🔒</span>' : ''}</span>
                ${locked ? '' : `<button class="btn btn-danger btn-sm" onclick="deleteKategorie('${k.replace(/'/g, "\\'")}')" style="margin-left:auto;">×</button>`}
            </div>`;
        }).join("");
    }
    // Vorschläge anzeigen (fehlende Standard-Kategorien)
    const vorschlaege = [
        "Versicherungen","Grundversorgung","Wohnen","Unterhaltung und Medien","Kommunikation",
        "Mobilität","Finanzen","Gesundheit","Kinder","Haustiere","Abonnements","Sparen und Vorsorge",
        "Spenden und Mitgliedschaften","Sonstige"
    ];
    const fehlend = vorschlaege.filter(v => !kats.includes(v));
    const sugContainer = document.getElementById("kat-suggestions");
    if (sugContainer) {
        if (fehlend.length > 0) {
            sugContainer.innerHTML = '<div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:6px;">Vorschläge:</div>' +
                fehlend.map(k => `<button class="btn btn-ghost btn-sm" style="margin:2px;font-size:0.72rem;padding:3px 10px;" onclick="quickAddKategorie('${k}')">${k}</button>`).join("");
        } else {
            sugContainer.innerHTML = "";
        }
    }
}

async function quickAddKategorie(name) {
    const res = await API.post("/api/kategorien", {name});
    if (!res.ok) { toast(res.error || "Fehler", "error"); return; }
    toast(`"${name}" hinzugefügt!`);
    await refreshKategorien();
    loadKategorienList();
}

async function addKategorie() {
    const name = document.getElementById("kat-new-name").value.trim();
    if (!name) { toast("Name eingeben.", "error"); return; }
    const res = await API.post("/api/kategorien", {name});
    if (!res.ok) { toast(res.error || "Fehler", "error"); return; }
    document.getElementById("kat-new-name").value = "";
    toast(`Kategorie "${name}" hinzugefügt!`);
    await refreshKategorien();
    loadKategorienList();
}

async function deleteKategorie(name) {
    if (name === "Versicherungen") {
        toast("Die Kategorie 'Versicherungen' kann nicht gelöscht werden (wird für KFZ/Moped-Prüflogik benötigt).", "error");
        return;
    }
    const ok = await nativeConfirm("Kategorie löschen?", `Kategorie "${name}" wirklich löschen?\nVerträge mit dieser Kategorie behalten sie als Text.`, [{label:"Löschen", class:"btn-danger", value:true}, {label:"Abbrechen", class:"btn-ghost", value:false}]);
    if(!ok) return;
    const res = await API.del(`/api/kategorien/${encodeURIComponent(name)}`);
    if (!res.ok) { toast(res.error || "Fehler", "error"); return; }
    if (res.vertraege_betroffen > 0) {
        toast(`Kategorie "${name}" entfernt. ${res.vertraege_betroffen} Vertrag/Verträge behalten diese Kategorie.`, "error");
    } else {
        toast(`Kategorie "${name}" gelöscht.`);
    }
    await refreshKategorien();
    loadKategorienList();
}

// ---------------------------------------------------------------------------
// Debug
// ---------------------------------------------------------------------------
async function debugPruefungFaellig() {
    const res = await API.post("/api/debug/pruefung-faellig", {});
    if (res.ok) {
        toast('Debug: "' + res.vertrag + '" auf prüffällig gesetzt.');
        if (document.getElementById("section-vertraege") && !document.getElementById("section-vertraege").classList.contains("hidden")) {
            loadVertraege();
        }
        const vt = await API.get("/api/vertraege");
        updatePruefHinweis(vt);
    } else {
        toast(res.error || "Fehler", "error");
    }
}

async function debugAllePruefungFaellig() {
    const res = await API.post("/api/debug/alle-pruefung-faellig", {});
    if (res.ok) {
        toast(`Debug: ${res.anzahl} Verträge auf prüffällig gesetzt.`);
        if (document.getElementById("section-vertraege") && !document.getElementById("section-vertraege").classList.contains("hidden")) {
            loadVertraege();
        }
        const vt = await API.get("/api/vertraege");
        updatePruefHinweis(vt);
    } else {
        toast(res.error || "Fehler", "error");
    }
}

// ---------------------------------------------------------------------------
// Startup: Kontostand-Popup
// ---------------------------------------------------------------------------
async function showStartupModal(zuv) {
    document.getElementById("startup-saldo").addEventListener("keydown", e => {
        if (e.key === "Enter") saveStartupSaldo();
    });
    const haupt = cachedKonten.find(k => k.typ === "hauptkonto");
    const toepfe = cachedKonten.filter(k => k.typ === "topf").reduce((s, k) => s + k.saldo, 0);
    const bankGesamt = haupt ? haupt.saldo : 0;

    // Schätzung laden (wenn aktiviert)
    const params = await API.get("/api/parameter");
    const schaetzenAktiv = params.kontostand_schaetzen !== "0";
    try {
        if (schaetzenAktiv) {
            const s = await API.get("/api/kontostand-schaetzung");
            document.getElementById("startup-saldo").value = s.schaetzung ? s.schaetzung.toFixed(2) : (bankGesamt ? bankGesamt.toFixed(2) : "");
            document.getElementById("startup-info").innerHTML =
                `Gespeicherter Stand: <strong>${euro(s.letzter_stand)}</strong><br>` +
                `Geschätzt seit ${fmtDate(s.seit)}: <span style="color:var(--green);">+${euro(s.einnahmen_monat)}</span> Einnahmen, ` +
                `<span style="color:var(--red);">-${euro(s.ausgaben_monat)}</span> Ausgaben<br>` +
                `→ <strong>Geschätzter Stand: ${euro(s.schaetzung)}</strong>`;
        } else {
            document.getElementById("startup-saldo").value = bankGesamt ? bankGesamt.toFixed(2) : "";
            document.getElementById("startup-info").innerHTML =
                `Aktueller Stand: <strong>${euro(bankGesamt)}</strong>`;
        }
    } catch(e) {
        document.getElementById("startup-saldo").value = bankGesamt ? bankGesamt.toFixed(2) : "";
        document.getElementById("startup-info").innerHTML =
            `Aktueller Stand: <strong>${euro(bankGesamt)}</strong> (davon ${euro(toepfe)} in Töpfen)`;
    }
    // Sicherheits-Warnung wenn unsicherer Tag
    const warnEl = document.getElementById("startup-warnung");
    if (warnEl && zuv && (zuv.ist_buchungstag || zuv.ist_unsicher)) {
        const details = (zuv.details || []).map(d =>
            `${d.name}: ${d.typ === "einnahme" ? "+" : "-"}${euro(d.betrag)} am ${fmtDate(d.datum)}`
        ).join("\n");
        warnEl.innerHTML = zuv.ist_buchungstag
            ? `<div style="background:rgba(248,113,113,0.12);border:1px solid rgba(248,113,113,0.3);border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:0.82rem;">
                ⚠️ <strong>Heute ist ein Buchungstag!</strong><br>
                Es stehen noch ${zuv.offene_buchungen} Buchung(en) aus. Dein Kontostand könnte sich noch ändern.<br>
                <span style="color:var(--text-muted);">Nächster sicherer Tag: ${fmtDate(zuv.naechster_sicherer_tag)}</span>
               </div>`
            : `<div style="background:rgba(251,146,60,0.12);border:1px solid rgba(251,146,60,0.3);border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:0.82rem;">
                🔔 <strong>Sicherheitsfenster aktiv</strong><br>
                In den nächsten Tagen stehen ${zuv.offene_buchungen} Buchung(en) an.<br>
                <span style="color:var(--text-muted);">Nächster sicherer Tag: ${fmtDate(zuv.naechster_sicherer_tag)}</span>
               </div>`;
    } else if (warnEl) {
        warnEl.innerHTML = "";
    }
    document.getElementById("startup-modal").classList.remove("hidden");
}

function closeStartupModal() {
    document.getElementById("startup-modal").classList.add("hidden");
}

async function saveStartupSaldo() {
    const bank = parseFloat(document.getElementById("startup-saldo").value);
    if (isNaN(bank)) { toast("Gültigen Betrag eingeben.", "error"); return; }
    const haupt = cachedKonten.find(k => k.typ === "hauptkonto");
    // Kontostand = was auf der Bank steht (Töpfe sind virtuell, nicht abziehen)
    if (haupt) await API.put(`/api/konten/${haupt.id}`, {saldo: bank});
    await API.put("/api/parameter", {kontostand_aktualisiert: new Date().toISOString().slice(0,10)});
    closeStartupModal();
    toast("Kontostand aktualisiert!");
    await refreshKonten();
    loadDashboard();
}

// ---------------------------------------------------------------------------
// Server beenden
// ---------------------------------------------------------------------------
async function serverBeenden() {
    const ok = await nativeConfirm("Server beenden?", "Kontolotse wird geschlossen.", [{label:"Beenden", class:"btn-danger", value:true}, {label:"Abbrechen", class:"btn-ghost", value:false}]);
    if(!ok) return;
    try {
        await API.post("/api/server/beenden", {});
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#8b90a5;font-size:1.2rem;"><div style="text-align:center;"><h2 style="margin-bottom:12px;">Server beendet</h2><p>Du kannst dieses Fenster jetzt schließen.</p></div></div>';
    } catch(e) {
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#8b90a5;font-size:1.2rem;"><div style="text-align:center;"><h2 style="margin-bottom:12px;">Server beendet</h2><p>Du kannst dieses Fenster jetzt schließen.</p></div></div>';
    }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
    // Nav-Listener ZUERST registrieren, damit Navigation immer funktioniert
    document.querySelectorAll(".nav-item").forEach(el => {
        if (el.dataset.section) el.addEventListener("click", (e) => {
            e.preventDefault();
            navigateTo(el.dataset.section);
        });
        el.style.userSelect = "none";
        el.style.webkitUserSelect = "none";
    });

    // Daten laden (darf fehlschlagen)
    try { await Promise.all([refreshKonten(), refreshKategorien()]); } catch(e) { console.error("Init data load failed:", e); }
    
    // Loading Screen ausblenden, App einblenden
    const appShell = document.getElementById("app-shell");
    const loadingScreen = document.getElementById("loading-screen");
    if(appShell) appShell.style.display = "";
    // Warte bis Fortschrittsbalken fertig ist (min 2s)
    const minWait = new Promise(r => setTimeout(r, 2000));
    await minWait;
    if(loadingScreen) {
        loadingScreen.style.opacity = "0";
        setTimeout(() => loadingScreen.remove(), 500);
    }
    
    navigateTo("dashboard");

    // Erster Start: Disclaimer
    try {
        const params = await API.get("/api/parameter");
        if(params && params.erststart_erledigt !== "1") {
            await showDisclaimer();
            await API.put("/api/parameter", {erststart_erledigt: "1"});
        }
    } catch(e) { console.log("Disclaimer check skipped:", e); }

    // Startup: Kontostand-Popup
    try {
        const zuv = await API.get("/api/zuverlaessigkeit");
        showStartupModal(zuv);
    } catch(e) {
        try { showStartupModal(null); } catch(e2) {}
    }
});

function showDisclaimer() {
    return new Promise(resolve => {
        const modal = document.getElementById("confirm-modal");
        document.getElementById("confirm-modal-title").textContent = "";
        const isDark = document.documentElement.getAttribute("data-theme") !== "light";
        document.getElementById("confirm-modal-text").innerHTML = `
            <div style="text-align:center;margin-bottom:16px;">
                <img src="/static/logo.png" alt="Kontolotse" style="width:180px;margin:0 auto;">
            </div>
            <div style="font-size:0.88rem;line-height:1.7;color:var(--text-secondary);">
                <p style="margin-bottom:12px;">Dein persönlicher Finanzplaner — verwalte <strong>Verträge, Fixkosten und Spartöpfe</strong> und simuliere den Saldoverlauf deines Bankkontos über 24 Monate.</p>
                <p style="margin-bottom:12px;"><strong>Bitte beachte:</strong></p>
                <p style="margin-bottom:8px;">• Die App ist ein <strong>Planungswerkzeug</strong>, kein Buchhaltungsprogramm. Alle Berechnungen basieren auf den von dir eingegebenen Daten und sind <strong>Prognosen, keine Garantien</strong>.</p>
                <p style="margin-bottom:8px;">• Die App ersetzt <strong>keine professionelle Finanzberatung</strong>.</p>
                <p style="margin-bottom:8px;">• Deine Daten werden <strong>ausschließlich lokal</strong> auf deinem Gerät gespeichert.</p>
                <p style="margin-bottom:8px;">• Erstelle regelmäßig <strong>Backups</strong> deiner Datenbank (Einstellungen → System).</p>
                <p style="margin-top:16px;font-size:0.78rem;color:var(--text-muted);">Mit Klick auf „Verstanden" akzeptierst du diese Hinweise.</p>
            </div>`;
        const btnContainer = document.getElementById("confirm-modal-buttons");
        btnContainer.innerHTML = "";
        const btn = document.createElement("button");
        btn.className = "btn btn-primary";
        btn.textContent = "Verstanden — Los geht's!";
        btn.onclick = () => { modal.classList.add("hidden"); resolve(); };
        btnContainer.appendChild(btn);
        modal.classList.remove("hidden");
    });
}
