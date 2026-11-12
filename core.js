// ---- SETUP: paste your Firebase Realtime Database URL, e.g.
// "https://my-club-default-rtdb.asia-southeast1.firebasedatabase.app"
// Leave "" to test locally (scorer + overlay in the same browser only).
const DB_URL = "https://livecricketapp-d3bd7-default-rtdb.firebaseio.com/";
const KEY = "cricket_match";

let BPO = 6; // balls per over, set per match
const setBpo = S => { BPO = (S && S.bpo) || 6; };
const overs = b => Math.floor(b / BPO) + "." + (b % BPO);

// Turn one innings (a list of events) into totals and live state.
function calc(inn) {
  const r = { runs: 0, w: 0, balls: 0, bat: {}, bowl: {}, st: inn.striker || null, non: inn.non || null, bw: inn.bowler || null, over: [], last: null, pr: 0, pb: 0, nb: false, facer: null, lastOut: null };
  const B = n => r.bat[n] || (r.bat[n] = { r: 0, b: 0 });
  const W = n => r.bowl[n] || (r.bowl[n] = { b: 0, r: 0, w: 0 });
  if (r.st) B(r.st); if (r.non) B(r.non);
  let fresh = false;
  (inn.ev || []).forEach(e => {
    r.last = e;
    if (e.t === "bat") { if (!r.st) r.st = e.name; else r.non = e.name; B(e.name); return; }
    if (e.t === "bowl") { r.bw = e.name; r.nb = false; return; }
    if (e.t === "swap") { [r.st, r.non] = [r.non, r.st]; return; }
    if (fresh) { r.over = []; fresh = false; }
    const wdnb = e.ex === "wd" || e.ex === "nb";
    const tot = e.runs + (wdnb ? 1 : 0);
    r.runs += tot; r.pr += tot; if (!wdnb) r.pb++;
    r.facer = r.st;
    if (r.st) {
      const s = B(r.st);
      if (e.ex !== "wd") s.b++;
      if (!e.ex || e.ex === "nb") { s.r += e.runs; if (e.runs === 4) s.f = (s.f || 0) + 1; if (e.runs === 6) s.x = (s.x || 0) + 1; }
    }
    const bo = W(r.bw || "?");
    if (e.ex !== "b" && e.ex !== "lb") bo.r += tot;
    if (!wdnb) { r.balls++; bo.b++; }
    if (e.w) {
      r.w++; if (!e.ro) bo.w++;
      r.lastOut = e.out === "non" ? r.non : r.st;
      if (e.out === "non") { if (r.non) B(r.non).out = true; r.non = null; }
      else { if (r.st) B(r.st).out = true; r.st = null; }
      r.pr = 0; r.pb = 0;
    }
    r.over.push(e.w ? "W" : e.ex === "wd" ? "Wd" + (e.runs || "") : e.ex === "nb" ? "Nb" + (e.runs || "") : e.ex ? e.ex.toUpperCase() + e.runs : e.runs === 0 ? "\u2022" : String(e.runs));
    if (!e.w && ((e.runs % 2 === 1) !== !!e.fs)) [r.st, r.non] = [r.non, r.st];
    if (!wdnb && r.balls % BPO === 0) { [r.st, r.non] = [r.non, r.st]; fresh = true; r.nb = true; }
  });
  return r;
}

const teamName = (S, i) => [S.a, S.b][(S.first + i) % 2];

// Everything the overlay needs, including target, required rate and result.
function summary(S) {
  setBpo(S);
  const c = calc(S.inns[S.cur]);
  const out = { c, team: teamName(S, S.cur), max: S.overs * BPO, target: null, result: "" };
  const sqd = (S.sq && S.sq[(S.first + S.cur) % 2]) || [];
  out.maxW = sqd.length > 1 ? Math.min(10, sqd.length - 1) : 10;
  if (S.cur === 1) {
    const c1 = calc(S.inns[0]);
    out.target = c1.runs + 1;
    const need = out.target - c.runs, left = out.max - c.balls;
    out.need = need; out.left = left;
    out.rrr = left > 0 ? (need * BPO / left).toFixed(2) : "-";
    const chaser = teamName(S, 1), setter = teamName(S, 0);
    if (c.runs >= out.target) out.result = chaser + " won by " + (out.maxW - c.w) + " wkts";
    else if (left <= 0 || c.w >= out.maxW) out.result = need === 1 ? "Match tied" : setter + " won by " + (need - 1) + " runs";
  }
  out.crr = c.balls ? (c.runs * BPO / c.balls).toFixed(2) : "0.00";
  out.color = [S.ca || "#3fa66b", S.cb || "#f2b134"][(S.first + S.cur) % 2];
  const ev = S.inns[S.cur].ev, e = ev[ev.length - 1];
  let t = null;
  if (e && e.t === "ball") t = e.w ? (e.ro ? "RUN OUT" : "WICKET") : e.ex === "wd" ? "WIDE" : e.ex === "nb" ? "NO BALL" : (!e.ex && e.runs === 6) ? "SIX" : (!e.ex && e.runs === 4) ? "FOUR" : null;
  const who = t === "WICKET" || t === "RUN OUT" ? c.lastOut : c.facer, bs = who && c.bat[who];
  out.evt = { n: S.cur * 1000 + ev.length, text: t, who, r: bs ? bs.r : 0, b: bs ? bs.b : 0 };
  out.done = c.balls >= out.max || c.w >= out.maxW || (S.cur === 1 && c.runs >= out.target);
  if (S.cur === 0 && out.done) out.result = "Innings complete: " + out.team + " " + c.runs + "/" + c.w;
  return out;
}

// Save: always locally, and to Firebase when DB_URL is set.
async function save(S) {
  localStorage.setItem(KEY, JSON.stringify(S));
  if (DB_URL) { try { await fetch(DB_URL + "/match.json", { method: "PUT", body: JSON.stringify(S) }); } catch (e) { console.warn("sync failed", e); } }
}

// Load the latest state (Firebase first, then local).
async function load() {
  if (DB_URL) { try { const r = await fetch(DB_URL + "/match.json"); return await r.json(); } catch (e) {} }   // null = cleared; local copy only if offline
  const l = localStorage.getItem(KEY);
  return l ? JSON.parse(l) : null;
}


// ---- tournament stats ----
const PTS = { run: 1, wicket: 25 };   // player-of-the-series points: change the weights here

function outcome(S) {
  if (S.cur !== 1) return null;
  const m = summary(S); if (!m.result) return null;
  const r1 = calc(S.inns[0]).runs, r2 = m.c.runs;
  return { text: m.result, winner: r2 > r1 ? teamName(S, 1) : r2 < r1 ? teamName(S, 0) : null };
}

function matchStats(S) {
  setBpo(S);
  const P = {};
  const get = (team, name) => P[team + "|" + name] || (P[team + "|" + name] = { team, name, runs: 0, balls: 0, f: 0, x: 0, outs: 0, wk: 0, bb: 0, br: 0 });
  [0, 1].forEach(i => {
    const inn = S.inns[i]; if (!inn || !(inn.ev && inn.ev.length)) return;
    const c = calc(inn), bt = teamName(S, i), bl = teamName(S, i + 1);
    Object.keys(c.bat).forEach(n => { const p = get(bt, n), s = c.bat[n]; p.runs += s.r; p.balls += s.b; p.f += s.f || 0; p.x += s.x || 0; p.outs += s.out ? 1 : 0; });
    Object.keys(c.bowl).forEach(n => { if (n === "?") return; const p = get(bl, n), s = c.bowl[n]; p.wk += s.w; p.bb += s.b; p.br += s.r; });
  });
  Object.values(P).forEach(p => p.pts = p.runs * PTS.run + p.wk * PTS.wicket);
  return P;
}

function tournament(recs) {
  const P = {}, T = {};
  recs.forEach(r => {
    const S = r.S; S.inns.forEach(i => i.ev = i.ev || []);
    Object.values(matchStats(S)).forEach(m => {
      const k = m.team + "|" + m.name;
      const p = P[k] || (P[k] = { team: m.team, name: m.name, mat: 0, runs: 0, balls: 0, f: 0, x: 0, outs: 0, hs: 0, wk: 0, bb: 0, br: 0, ov: 0, bw: 0, bwr: 0 });
      p.mat++; p.runs += m.runs; p.balls += m.balls; p.f += m.f; p.x += m.x; p.outs += m.outs; p.hs = Math.max(p.hs, m.runs);
      p.wk += m.wk; p.bb += m.bb; p.br += m.br; p.ov += m.bb / BPO;
      if (m.wk > p.bw || (m.wk === p.bw && m.wk > 0 && m.br < p.bwr)) { p.bw = m.wk; p.bwr = m.br; }
    });
    [S.a, S.b].forEach(n => T[n] = T[n] || { name: n, p: 0, w: 0, l: 0, t: 0, rs: 0, of: 0, rc: 0, ob: 0 });
    const o = r.outcome;
    if (o) {
      // net run rate inputs: an all-out innings counts as the full quota of overs
      [0, 1].forEach(i => {
        const c = calc(S.inns[i]), bt = teamName(S, i), bl = teamName(S, i + 1);
        const sqd = (S.sq && S.sq[(S.first + i) % 2]) || [], mw = sqd.length > 1 ? Math.min(10, sqd.length - 1) : 10;
        const chased = i === 1 && c.runs > calc(S.inns[0]).runs;
        const ov = (c.w >= mw && !chased ? S.overs * BPO : c.balls) / BPO;
        T[bt].rs += c.runs; T[bt].of += ov; T[bl].rc += c.runs; T[bl].ob += ov;
      });
      T[S.a].p++; T[S.b].p++;
      if (o.winner) { T[o.winner].w++; T[o.winner === S.a ? S.b : S.a].l++; } else { T[S.a].t++; T[S.b].t++; }
    }
  });
  Object.values(T).forEach(t => t.nrr = (t.of ? t.rs / t.of : 0) - (t.ob ? t.rc / t.ob : 0));
  const players = Object.values(P);
  players.forEach(p => p.pts = p.runs * PTS.run + p.wk * PTS.wicket);
  const top = f => players.slice().sort(f)[0];
  const awards = {
    runs: top((a, b) => b.runs - a.runs || a.balls - b.balls),
    wkts: top((a, b) => b.wk - a.wk || a.br - b.br),
    series: top((a, b) => b.pts - a.pts || b.runs - a.runs)
  };
  const fin = recs.filter(r => r.final).pop();
  awards.final = fin ? { motm: fin.motm, match: fin.S.a + " v " + fin.S.b, text: fin.outcome ? fin.outcome.text : "" } : null;
  return { players, teams: Object.values(T), awards };
}


// ---- tournaments (each saved match belongs to one tournament) ----
const TOURS_KEY = "cricket_tours", CUR_KEY = "cricket_cur_tour";
async function dbGet(p) { if (!DB_URL) return null; try { return await (await fetch(DB_URL + "/" + p + ".json")).json(); } catch (e) { return null; } }
async function dbPut(p, v) { if (DB_URL) { try { await fetch(DB_URL + "/" + p + ".json", { method: "PUT", body: JSON.stringify(v) }); } catch (e) {} } }
async function getTours() {
  let t = await dbGet("tours");
  if (!t) { const l = localStorage.getItem(TOURS_KEY); t = l ? JSON.parse(l) : null; }
  const list = Object.values(t || {}).filter(Boolean);
  if (!list.some(x => x.id === "t0")) {   // matches saved before tournaments existed belong to t0
    const nm = (await dbGet("tournament")) || localStorage.getItem("cricket_tournament_name") || "Cricket Tournament";
    list.push({ id: "t0", name: nm, date: 0 });
  }
  return list.sort((a, b) => b.date - a.date);
}
async function getCurTour() { return (await dbGet("currentTour")) || localStorage.getItem(CUR_KEY) || "t0"; }
async function putTour(t) {
  const l = JSON.parse(localStorage.getItem(TOURS_KEY) || "{}"); l[t.id] = t; localStorage.setItem(TOURS_KEY, JSON.stringify(l));
  await dbPut("tours/" + t.id, t);
}
async function startTour(name) {
  const old = (await getTours()).find(x => x.id === "t0"); if (old) await putTour(old);   // keep the first tournament's name stable
  const t = { id: "t" + Date.now(), name, date: Date.now() };
  await putTour(t); localStorage.setItem(CUR_KEY, t.id); await dbPut("currentTour", t.id);
  return t;
}


// Clear the live match (and optionally the registered teams) when a new tournament starts.
async function resetDetails(clearTeams) {
  localStorage.removeItem(KEY);
  if (DB_URL) { try { await fetch(DB_URL + "/match.json", { method: "DELETE" }); } catch (e) {} }
  if (clearTeams) {
    localStorage.removeItem("cricket_teams");
    if (DB_URL) { try { await fetch(DB_URL + "/teams.json", { method: "DELETE" }); } catch (e) {} }
  }
}
