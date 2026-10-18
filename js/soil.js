/* =========================================================================
   SoilSim: CPU-authoritative deformable soil field + wheel/soil interaction
   + mud adhesion + longitudinal vehicle dynamics (pure JS, no THREE, no DOM).

   Field layout (interleaved Float32Array, 4 floats per cell, same layout is
   mirrored 1:1 into a float GPU texture by the renderer):
     [0] dh    vertical offset of the surface from the undeformed terrain, m
               (negative = rut / compression, positive = berm)
     [1] wet   surface wetness / water saturation 0..1
     [2] pack  compaction / polish of tyre pressed soil 0..1
     [3] churn loose churned mud (or mud smear on hard ground) 0..1

   Physical model (game-tuned Bekker-Wong / Janosi-Hanamoto):
     pressure-sinkage     p = k z^n, solved against load / (b * L(z))
     compaction drag      R_c = b k zf^(n+1)/(n+1)       (only the NEW compression)
     traction capacity    H_max = b L c + W tan(phi)     (soil shear)
     slip curve           H = H_max (1 - K/(iL) (1 - exp(-iL/K)))
     open / locked differential, mud clogged tread, belly drag, rut guidance
   ========================================================================= */
(function (global) {
  'use strict';

  var TYPE = { concrete: 0, forest: 1, sand: 2, clay: 3, swamp: 4, bridge: 5, snow: 6, grass: 7 };
  var PREF = 40000; // reference ground pressure, Pa (zRef is the sinkage at this pressure)
  var G = 9.81;

  var P = [];
  function def(id, o) {
    var base = {
      deform: true, zRef: 0.05, n: 0.8, cohesion: 5, tanPhi: 0.5, mu: 0.8, K: 0.015,
      compact: 0.5, maxDepth: 0.3, sticky: 0.3, dig: 0.6, slump: 1.0, settle: 0, biteSens: 0.3, visc: 0,
      baseWet: 0.3, poolCap: 0.5, roll0: 0.04, rollMul: 1.0, berm: 0.22, color: 0x6b4a2f, ttl: 60
    };
    for (var k in o) base[k] = o[k];
    P[id] = base;
  }
  def(TYPE.concrete, { biteSens: 0.1, deform: false, mu: 0.95, K: 0.004, roll0: 0.020, sticky: 0, baseWet: 0.0, poolCap: 0.0, color: 0x8a8f96, ttl: 0 });
  def(TYPE.bridge,   { biteSens: 0.2, deform: false, mu: 0.70, K: 0.006, roll0: 0.045, sticky: 0, baseWet: 0.0, poolCap: 0.0, color: 0x7a5a3a, ttl: 0 });
  def(TYPE.forest,   { visc: 0.004, zRef: 0.046, n: 0.8, cohesion: 9.0, tanPhi: 0.62, mu: 0.75, K: 0.012, compact: 0.55, maxDepth: 0.30, sticky: 0.35, dig: 0.55, slump: 1.1, settle: 0.0, baseWet: 0.30, poolCap: 0.55, roll0: 0.035, rollMul: 1.0, berm: 0.16, color: 0x6b4a2f, ttl: 90 });
  def(TYPE.grass,    { visc: 0.006, zRef: 0.029, n: 0.8, cohesion: 12.0, tanPhi: 0.66, mu: 0.75, K: 0.012, compact: 0.50, maxDepth: 0.18, sticky: 0.15, dig: 0.40, slump: 1.4, settle: 0.0, baseWet: 0.35, poolCap: 0.30, roll0: 0.050, rollMul: 1.0, berm: 0.10, color: 0x5d5530, ttl: 60 });
  def(TYPE.sand,     { biteSens: 0.2, visc: 0.030, zRef: 0.144, n: 1.0, cohesion: 0.8, tanPhi: 0.50, mu: 0.6, K: 0.020, compact: 0.75, maxDepth: 0.42, sticky: 0.03, dig: 1.0, slump: 0.55, settle: 0.0, baseWet: 0.08, poolCap: 0.0, roll0: 0.075, rollMul: 3.2, berm: 0.24, color: 0xc79a5b, ttl: 240 });
  def(TYPE.clay,     { biteSens: 0.85, visc: 0.040, zRef: 0.661, n: 0.6, cohesion: 8.0, tanPhi: 0.28, mu: 0.5, K: 0.020, compact: 0.20, maxDepth: 0.55, sticky: 1.0, dig: 0.7, slump: 0.50, settle: 0.010, baseWet: 0.70, poolCap: 0.95, roll0: 0.052, rollMul: 3.6, berm: 0.30, color: 0x6a3f24, ttl: 900 });
  def(TYPE.swamp,    { biteSens: 1.0, visc: 0.070, zRef: 3.253, n: 0.5, cohesion: 6.0, tanPhi: 0.24, mu: 0.3, K: 0.050, compact: 0.05, maxDepth: 0.58, sticky: 0.85, dig: 0.65, slump: 0.12, settle: 0.060, baseWet: 1.0, poolCap: 1.0, roll0: 0.110, rollMul: 4.2, berm: 0.20, color: 0x4a3b2a, ttl: 900 });
  def(TYPE.snow,     { biteSens: 0.9, visc: 0.030, zRef: 0.396, n: 1.3, cohesion: 3.0, tanPhi: 0.44, mu: 0.42, K: 0.030, compact: 0.85, maxDepth: 0.55, sticky: 0.25, dig: 0.8, slump: 0.80, settle: 0.0, baseWet: 0.30, poolCap: 0.0, roll0: 0.055, rollMul: 3.2, berm: 0.22, color: 0xeef3f8, ttl: 240 });

  // Fallback для любых неопределённых или выходящих за границы типов почвы
  var fallbackParam = P[TYPE.concrete];
  for (var pi = -128; pi <= 128; pi++) {
    if (!P[pi]) P[pi] = fallbackParam;
  }
  P[undefined] = fallbackParam;
  P[NaN] = fallbackParam;

  // inverse Janosi curve: fraction f -> x = i L / K, with f(x) = 1 - (1 - exp(-x)) / x
  var INV_N = 128;
  var INV = new Float32Array(INV_N + 1);
  (function () {
    function f(x) { return x < 1e-6 ? x * 0.5 : 1 - (1 - Math.exp(-x)) / x; }
    var x = 0, fi = 0;
    for (var k = 0; k <= INV_N; k++) {
      var target = Math.min(0.995, k / INV_N);
      // monotone search
      var lo = 0, hi = 400;
      for (var it = 0; it < 40; it++) { var mid = 0.5 * (lo + hi); if (f(mid) < target) lo = mid; else hi = mid; }
      INV[k] = 0.5 * (lo + hi);
    }
  })();
  function invJanosi(frac) { // frac in [0,1] -> x
    if (frac <= 0) return 0;
    var t = Math.min(0.995, frac) * INV_N;
    var k = Math.floor(t);
    if (k >= INV_N) return INV[INV_N];
    return INV[k] + (INV[k + 1] - INV[k]) * (t - k);
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smooth(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  // cheap deterministic value noise
  function hash2(i, j) { var h = (i * 374761393 + j * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
  function vnoise(x, z) {
    var i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
    fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    var a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }

  /* ------------------------------------------------------------------ */
  function SoilSim(o) {
    this.originX = o.originX; this.originZ = o.originZ;
    this.sizeX = o.sizeX; this.sizeZ = o.sizeZ;
    var cpm = o.cellsPerMeter || 10;
    this.NX = Math.round(o.sizeX * cpm);
    this.NZ = Math.round(o.sizeZ * cpm);
    this.cell = o.sizeX / this.NX;
    this.inv = 1 / this.cell;
    this.cellArea = this.cell * this.cell;
    this.data = new Float32Array(this.NX * this.NZ * 4);
    this.typeMap = new Uint8Array(this.NX * this.NZ);

    this.TS = 16;
    this.TX = Math.ceil(this.NX / this.TS);
    this.TZ = Math.ceil(this.NZ / this.TS);
    var nt = this.TX * this.TZ;
    this.tileDirty = new Uint8Array(nt);
    this.tileTTL = new Float32Array(nt); // in 60 Hz frame equivalents, decremented by real time (see relax)
    this.tileActive = new Uint8Array(nt);
    this.active = new Int32Array(nt);
    this.activeCount = 0;
    this.dirtyList = new Int32Array(nt);
    this.dirtyCount = 0;
    this.frame = 0;

    this._bermIdx = new Int32Array(1024);
    this._bermW = new Float32Array(1024);
    this._pr = { t: 0, wet: 0, pack: 0, churn: 0, dh: 0, dhF: 0, dhR: 0, dhL: 0, dhRt: 0, dhC: 0 };
    this._tmp = { dh: 0, wet: 0, pack: 0, churn: 0 };

    if (o.typeAt) this.init(o.typeAt, o.wetBias);
  }

  SoilSim.TYPE = TYPE;
  SoilSim.PARAMS = P;

  SoilSim.prototype.init = function (typeAt, wetBias) {
    var NX = this.NX, NZ = this.NZ, d = this.data, tm = this.typeMap, cell = this.cell;
    for (var j = 0; j < NZ; j++) {
      var z = this.originZ + (j + 0.5) * cell;
      for (var i = 0; i < NX; i++) {
        var x = this.originX + (i + 0.5) * cell;
        var t = typeAt(x, z) | 0;
        var c = j * NX + i;
        tm[c] = t;
        var pr = P[t];
        var n1 = vnoise(x * 0.35, z * 0.35), n2 = vnoise(x * 1.7 + 11.3, z * 1.7 + 4.1);
        var wet = pr.baseWet + (n1 - 0.5) * 0.30 * (pr.baseWet > 0.05 ? 1 : 0.3) + (n2 - 0.5) * 0.10;
        if (wetBias) wet += wetBias(x, z);
        if (pr.baseWet >= 0.99) wet = 0.92 + 0.08 * n1;
        var q = c * 4;
        d[q] = 0; d[q + 1] = clamp(wet, 0, 1); d[q + 2] = 0; d[q + 3] = 0;
      }
    }
  };

  SoilSim.prototype.typeAtXZ = function (x, z) {
    var i = Math.floor((x - this.originX) * this.inv), j = Math.floor((z - this.originZ) * this.inv);
    if (i < 0) i = 0; else if (i >= this.NX) i = this.NX - 1;
    if (j < 0) j = 0; else if (j >= this.NZ) j = this.NZ - 1;
    return this.typeMap[j * this.NX + i];
  };

  // bilinear dh / wet / pack / churn
  SoilSim.prototype.sample = function (x, z, out) {
    var NX = this.NX, NZ = this.NZ, d = this.data;
    var fx = (x - this.originX) * this.inv - 0.5, fz = (z - this.originZ) * this.inv - 0.5;
    var i0 = Math.floor(fx), j0 = Math.floor(fz);
    var tx = fx - i0, tz = fz - j0;
    var i1 = i0 + 1, j1 = j0 + 1;
    if (i0 < 0) i0 = 0; else if (i0 >= NX) i0 = NX - 1;
    if (i1 < 0) i1 = 0; else if (i1 >= NX) i1 = NX - 1;
    if (j0 < 0) j0 = 0; else if (j0 >= NZ) j0 = NZ - 1;
    if (j1 < 0) j1 = 0; else if (j1 >= NZ) j1 = NZ - 1;
    var a = (j0 * NX + i0) * 4, b = (j0 * NX + i1) * 4, c = (j1 * NX + i0) * 4, e = (j1 * NX + i1) * 4;
    var w00 = (1 - tx) * (1 - tz), w10 = tx * (1 - tz), w01 = (1 - tx) * tz, w11 = tx * tz;
    out.dh = d[a] * w00 + d[b] * w10 + d[c] * w01 + d[e] * w11;
    out.wet = d[a + 1] * w00 + d[b + 1] * w10 + d[c + 1] * w01 + d[e + 1] * w11;
    out.pack = d[a + 2] * w00 + d[b + 2] * w10 + d[c + 2] * w01 + d[e + 2] * w11;
    out.churn = d[a + 3] * w00 + d[b + 3] * w10 + d[c + 3] * w01 + d[e + 3] * w11;
    return out;
  };

  SoilSim.prototype.getDH = function (x, z) {
    var NX = this.NX, NZ = this.NZ, d = this.data;
    var fx = (x - this.originX) * this.inv - 0.5, fz = (z - this.originZ) * this.inv - 0.5;
    var i0 = Math.floor(fx), j0 = Math.floor(fz);
    var tx = fx - i0, tz = fz - j0;
    var i1 = i0 + 1, j1 = j0 + 1;
    if (i0 < 0) i0 = 0; else if (i0 >= NX) i0 = NX - 1;
    if (i1 < 0) i1 = 0; else if (i1 >= NX) i1 = NX - 1;
    if (j0 < 0) j0 = 0; else if (j0 >= NZ) j0 = NZ - 1;
    if (j1 < 0) j1 = 0; else if (j1 >= NZ) j1 = NZ - 1;
    var a = d[(j0 * NX + i0) * 4], b = d[(j0 * NX + i1) * 4], c = d[(j1 * NX + i0) * 4], e = d[(j1 * NX + i1) * 4];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + e * tx) * tz;
  };

  // average dh over a tyre footprint (3 samples across the width) - used for ride height
  SoilSim.prototype.footprintDH = function (x, z, hdg, b) {
    var rx = Math.cos(hdg) * b * 0.3, rz = -Math.sin(hdg) * b * 0.3;
    return (this.getDH(x, z) * 2 + this.getDH(x + rx, z + rz) + this.getDH(x - rx, z - rz)) * 0.25;
  };

  SoilSim.prototype._markTile = function (ti, tj, ttl) {
    if (ti < 0 || tj < 0 || ti >= this.TX || tj >= this.TZ) return;
    var t = tj * this.TX + ti;
    if (!this.tileDirty[t]) { this.tileDirty[t] = 1; this.dirtyList[this.dirtyCount++] = t; }
    if (ttl > this.tileTTL[t]) this.tileTTL[t] = ttl;
    if (!this.tileActive[t] && ttl > 0) { this.tileActive[t] = 1; this.active[this.activeCount++] = t; }
  };
  SoilSim.prototype._markRect = function (i0, j0, i1, j1, ttl) {
    var TS = this.TS;
    var ti0 = Math.floor(i0 / TS), ti1 = Math.floor(i1 / TS), tj0 = Math.floor(j0 / TS), tj1 = Math.floor(j1 / TS);
    for (var tj = tj0; tj <= tj1; tj++) for (var ti = ti0; ti <= ti1; ti++) this._markTile(ti, tj, ttl);
  };

  // Calls cb(i0, j0, i1, j1) (inclusive cell rects) for every tile changed since the last call (row-merged).
  SoilSim.prototype.flushDirty = function (cb) {
    var n = this.dirtyCount;
    if (!n) return 0;
    var TX = this.TX, TS = this.TS, NX = this.NX, NZ = this.NZ;
    var list = this.dirtyList;
    // sort-free row merge: bucket by tile row
    var arr = Array.prototype.slice.call(list, 0, n).sort(function (a, b) { return a - b; });
    var calls = 0;
    var k = 0;
    while (k < n) {
      var t0 = arr[k], tj = Math.floor(t0 / TX), ti0 = t0 - tj * TX, ti1 = ti0;
      k++;
      while (k < n && arr[k] === arr[k - 1] + 1 && Math.floor(arr[k] / TX) === tj) { ti1 = arr[k] - tj * TX; k++; }
      cb(ti0 * TS, tj * TS, Math.min(NX - 1, ti1 * TS + TS - 1), Math.min(NZ - 1, tj * TS + TS - 1));
      calls++;
    }
    for (var m = 0; m < n; m++) this.tileDirty[list[m]] = 0;
    this.dirtyCount = 0;
    return calls;
  };

  /* ---------------------------- soil mechanics ---------------------------- */
  // contact length of a loaded tyre / rigid wheel sunk by z
  function contactLen(R, z) { var L0 = 0.55 * R; return Math.sqrt(L0 * L0 + 8 * R * z); }

  // effective reference sinkage for the soil state
  function zRefEff(pr, wet, pack, churn) {
    var z = pr.zRef * (0.55 + 0.9 * wet) / (0.55 + 0.9 * pr.baseWet);
    z *= (1 + 0.8 * churn);
    z /= (1 + 2.0 * pack);
    return z;
  }

  // equilibrium sinkage for vertical load F (N) on a tyre (R, b)
  function solveSinkage(pr, zr, F, R, b) {
    var k = PREF / Math.pow(zr, pr.n);
    var lo = 0, hi = pr.maxDepth;
    var gh = k * Math.pow(hi, pr.n) - F / (b * contactLen(R, hi));
    if (gh < 0) return hi; // bottomed out
    for (var it = 0; it < 14; it++) {
      var mid = 0.5 * (lo + hi);
      var g = k * Math.pow(mid, pr.n) - F / (b * contactLen(R, mid));
      if (g < 0) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  /* Wheel state: ws = SoilSim.newWheelState() persisted per wheel */
  SoilSim.newWheelState = function () {
    return {
      mud: 0, dig: 0, hasLast: false, lastX: 0, lastZ: 0,
      slip: 0, spin: 0, zEq: 0, L: 0.4, cap: 0, roll: 0, climb: 0, t: 0, wet: 0, pack: 0, churn: 0,
      sink: 0, lat: 0, soilR: 0, shed: 0, inWater: 0, dirSign: 1
    };
  };

  // Read the soil under a wheel and compute capacities / resistances. Cheap (no writes).
  SoilSim.prototype.contact = function (ws, x, z, hdg, R, b, W, fp, bite) {
    var pr0 = this._pr, NX = this.NX, NZ = this.NZ, d = this.data, tm = this.typeMap;
    var sinH = Math.sin(hdg), cosH = Math.cos(hdg);
    var hb = b * 0.5, hl = Math.max(0.2, 0.55 * R * 0.5 + 0.1);
    var inv = this.inv, ox = this.originX, oz = this.originZ;
    var sumDh = 0, sumWet = 0, sumPack = 0, sumChurn = 0, dhF = 0, dhR = 0, dhL = 0, dhRt = 0, cnt = 0;
    var cI = -1;
    for (var a = -1; a <= 1; a++) {
      for (var s = -1; s <= 1; s++) {
        var u = a * hb * 0.7, f = s * hl;
        var px = x + cosH * u + sinH * f, pz = z - sinH * u + cosH * f;
        var i = Math.floor((px - ox) * inv), j = Math.floor((pz - oz) * inv);
        if (i < 0) i = 0; else if (i >= NX) i = NX - 1;
        if (j < 0) j = 0; else if (j >= NZ) j = NZ - 1;
        var c = j * NX + i, q = c * 4;
        sumDh += d[q]; sumWet += d[q + 1]; sumPack += d[q + 2]; sumChurn += d[q + 3]; cnt++;
        if (s === 1) dhF += d[q]; else if (s === -1) dhR += d[q];
        if (a === -1) dhL += d[q]; else if (a === 1) dhRt += d[q];
        if (a === 0 && s === 0) cI = c;
      }
    }
    var inv9 = 1 / cnt;
    var t = (typeof this.typeAtXZ === 'function') ? this.typeAtXZ(x, z) : (tm ? tm[cI] : 0);
    if (typeof t !== 'number' || isNaN(t)) t = 0;
    pr0.t = t;
    pr0.dh = sumDh * inv9; pr0.wet = sumWet * inv9; pr0.pack = sumPack * inv9; pr0.churn = sumChurn * inv9;
    pr0.dhF = dhF / 3; pr0.dhR = dhR / 3; pr0.dhL = dhL / 3; pr0.dhRt = dhRt / 3;
    if (typeof this.sample === 'function' && typeof global.currentMapId !== 'undefined' && global.currentMapId !== 'taiga') {
      this.sample(x, z, pr0);
    }
    var pr = P[t] || P[TYPE.concrete];
    ws.t = t; ws.wet = pr0.wet; ws.pack = pr0.pack; ws.churn = pr0.churn;
    var mud = ws.mud;
    var clog = 1 - 0.42 * smooth(0.2, 0.85, mud);
    bite = 1 - (1 - bite) * pr.biteSens; // road tyres only suffer on soft ground

    if (!pr.deform) {
      var wetFilm = clamp(pr0.wet, 0, 1);
      ws.zEq = 0; ws.L = 0.55 * R; ws.climb = 0;
      var mu = pr.mu * (1 - 0.30 * wetFilm) * (1 - 0.28 * smooth(0.1, 0.9, mud) - 0.15 * pr0.churn);
      ws.cap = Math.max(0.05 * W, mu * W * bite);
      ws.roll = W * pr.roll0 * (1 + 0.4 * mud);
      ws.K = pr.K;
      return ws;
    }

    var zr = zRefEff(pr, pr0.wet, pr0.pack, pr0.churn);
    var F = W * fp;
    var z = solveSinkage(pr, zr, F, R, b);
    ws.zEq = z;
    var L = contactLen(R, z);
    ws.L = L;
    var k = PREF / Math.pow(zr, pr.n);
    // only the NEW compression costs energy; an existing rut is nearly free to roll in
    // (in the direction of travel: when reversing out of a hole the cells behind are the ones to roll into / climb out of)
    var dhLead = ws.dirSign < 0 ? pr0.dhR : pr0.dhF;
    var Cfront = Math.max(0, -dhLead);
    var zf = Math.max(0, z - Cfront);
    var Rc = pr.rollMul * b * k * Math.pow(zf, pr.n + 1) / (pr.n + 1);
    // stepping out of a hole dug by wheel spin / climbing the front wall of the rut
    var wall = Math.max(0, (dhLead - pr0.dh) - z * 1.15); // only the excess over the equilibrium sinkage is a wall to climb
    var hW = Math.min(wall, 0.45 * R);
    var climb = W * Math.sqrt(2 * hW / R) / Math.max(0.35, 1 - hW / R);
    ws.climb = climb;
    ws.roll = W * pr.roll0 * (1 + 0.3 * mud) + Rc + climb * 0.5;

    // shear strength
    var dWet = Math.max(0, pr0.wet - pr.baseWet);
    var coh = pr.cohesion * 1000 * (1 + 0.8 * pr0.pack) * (1 - 0.35 * dWet) * (1 - 0.5 * pr0.churn);
    var tanPhi = pr.tanPhi * (1 - 0.30 * dWet) * (1 - 0.35 * pr0.churn);
    var cap = (b * L * coh + W * tanPhi) * bite * clog;
    ws.cap = Math.max(0.04 * W, cap);
    ws.K = pr.K;
    return ws;
  };

  // slip ratio (display scale 0..1.3) for a wheel that is asked to deliver `frac` of its capacity
  SoilSim.slipFromFraction = function (frac, K, L) {
    if (frac >= 0.985) return 1.0 + Math.min(0.3, (frac - 0.985) * 20);
    var x = invJanosi(frac);
    var i = x * K / Math.max(0.2, L);
    return clamp(i * 1.8, 0, 1.0);
  };

  /* ------------------------------ mud adhesion ----------------------------- */
  // returns mass of mud shed this step (0..1 units) so the caller can spawn flung clods
  SoilSim.prototype.updateMud = function (ws, dt, surfSpeed, slip, inWater, rolling) {
    var t = ws.t, pr = P[t];
    var mud = ws.mud;
    var shed = 0;
    if (inWater > 0.01) {
      var wash = 0.7 * inWater * dt;
      shed += Math.min(mud, wash) * 0.3; // mostly washed away, a little flung
      mud -= Math.min(mud, wash);
    }
    // pickup in sticky, wet soil; deeper sinkage = more tread contact with mud
    if (pr.sticky > 0 && pr.deform) {
      var depthK = clamp(ws.zEq / (0.12) + 0.25 + ws.dig * 2.0, 0.25, 1.4);
      var wetK = 0.30 + 0.70 * clamp(ws.wet, 0, 1);
      var churnK = 1 + 0.7 * ws.churn;
      var moveK = 0.35 + 0.65 * Math.min(1, (surfSpeed) / 1.6);
      var rate = 0.19 * pr.sticky * wetK * churnK * depthK * moveK * (1 - 0.65 * smooth(0.6, 1.1, mud));
      mud = Math.min(1.15, mud + rate * dt);
    }
    // centrifugal throw-off: surface speed above ~5.5 m/s sheds the loosely held mud, wheelspin sheds more
    var vCrit = 4.8 + 2.4 * (pr.deform ? pr.sticky : 0.2);
    if (surfSpeed > vCrit && mud > 0.02) {
      var over = surfSpeed - vCrit;
      var s = Math.min(mud, (0.045 * over * over + 0.05 * over) * mud * dt * 1.3);
      mud -= s; shed += s;
    }
    if (slip > 0.5 && mud > 0.02) {
      var s2 = Math.min(mud, mud * (slip - 0.4) * 0.55 * dt);
      mud -= s2; shed += s2;
    }
    // hard ground scrapes the tread slowly and the tyre leaves a mud smear (handled by stamp)
    if (!pr.deform && mud > 0) {
      var clean = (pr.mu > 0.8 ? 0.055 : 0.035) * dt * (0.4 + Math.min(1, surfSpeed / 3));
      var c2 = Math.min(mud, clean);
      mud -= c2; ws.smear = c2;
    } else ws.smear = 0;
    ws.mud = Math.max(0, mud);
    ws.shed = shed;
    return shed;
  };

  /* ------------------------------ wheel stamping --------------------------- */
  // Press the wheel into the soil along the segment last->now. dt in seconds.
  SoilSim.prototype.stamp = function (ws, x, z, hdg, R, b, slip, dt) {
    var NX = this.NX, NZ = this.NZ, d = this.data, tm = this.typeMap;
    var cell = this.cell, inv = this.inv, ox = this.originX, oz = this.originZ;
    var dist = 0, steps = 1;
    var lx = x, lz = z;
    if (ws.hasLast && Math.hypot(x - ws.lastX, z - ws.lastZ) > 4) ws.hasLast = false; // teleport, reset or vehicle switch
    if (ws.hasLast) { lx = ws.lastX; lz = ws.lastZ; dist = Math.hypot(x - lx, z - lz); steps = Math.min(14, Math.max(1, Math.ceil(dist / 0.07))); }
    ws.lastX = x; ws.lastZ = z; ws.hasLast = true;

    var t0 = ws.t, pr = P[t0];
    var zEq = ws.zEq, L = ws.L;
    var hb = b * 0.5, hl = Math.max(0.18, L * 0.5);
    var ext = 0.32;
    var sinH = Math.sin(hdg), cosH = Math.cos(hdg);

    // digging while the wheel spins in soft ground; the hole is left behind as the wheel moves on
    if (pr.deform) {
      var soft = clamp(0.35 + 0.65 * ws.wet, 0, 1) * (1 - 0.6 * clamp(ws.pack, 0, 1)) * (1 + 0.6 * ws.churn);
      if (slip > 0.55) {
        var room = Math.max(0, pr.maxDepth - zEq);
        ws.dig = Math.min(room, ws.dig + pr.dig * soft * (slip - 0.55) / 0.45 * dt * 0.22);
      }
      ws.dig *= Math.exp(-dist / 0.55);
      if (slip < 0.3) ws.dig *= Math.exp(-dt * 0.6);
    } else ws.dig = 0;

    var targetC = pr.deform ? Math.min(pr.maxDepth, zEq + ws.dig) : 0;
    var aFrame = 1 - Math.exp(-dt * 16);
    var aSub = 1 - Math.pow(1 - aFrame, 1 / steps);
    var churnAdd = slip > 0.45 ? clamp((slip - 0.45) / 0.55, 0, 1) : 0;

    var bermI = this._bermIdx, bermW = this._bermW;
    var minI = NX, maxI = -1, minJ = NZ, maxJ = -1;
    var smear = ws.smear || 0;
    var smearAmt = ws.mud > 0.02 || smear > 0 ? Math.min(1, smear * 25 + ws.mud * 0.2) : 0;

    for (var s = 0; s < steps; s++) {
      var tt = (s + 1) / steps;
      var cx = lx + (x - lx) * tt, cz = lz + (z - lz) * tt;
      var ext2 = hb + ext;
      var rad = Math.hypot(ext2, hl + 0.1);
      var i0 = Math.max(0, Math.floor((cx - rad - ox) * inv)), i1 = Math.min(NX - 1, Math.floor((cx + rad - ox) * inv));
      var j0 = Math.max(0, Math.floor((cz - rad - oz) * inv)), j1 = Math.min(NZ - 1, Math.floor((cz + rad - oz) * inv));
      var nB = 0, volL = 0, volR = 0, wSumL = 0, wSumR = 0;
      for (var j = j0; j <= j1; j++) {
        var pz = oz + (j + 0.5) * cell - cz;
        for (var i = i0; i <= i1; i++) {
          var px = ox + (i + 0.5) * cell - cx;
          var u = px * cosH - pz * sinH;      // lateral (right +)
          var f = px * sinH + pz * cosH;      // longitudinal (forward +)
          var au = Math.abs(u), af = Math.abs(f);
          if (au > ext2 || af > hl) continue;
          var c = j * NX + i, q = c * 4;
          if (au <= hb) {
            var wu = au < hb * 0.8 ? 1 : (hb - au) / (hb * 0.2);
            var wf = af < hl * 0.85 ? 1 : (hl - af) / (hl * 0.15);
            var w = wu * wf;
            if (w <= 0) continue;
            var tc = tm[c], pc = P[tc];
            if (pc.deform && targetC > 0.002) {
              var C = -d[q];
              var delta = targetC - C;
              if (delta > 0) {
                var dd = delta * w * aSub;
                d[q] -= dd;
                var vol = dd * this.cellArea;
                if (u < 0) volL += vol * (1 - pc.compact); else volR += vol * (1 - pc.compact);
              }
              // compaction and churn
              var pk = d[q + 2];
              d[q + 2] = pk + (1 - pk) * Math.min(1, 0.85 * w * aSub);
              if (churnAdd > 0) {
                var ch = d[q + 3];
                d[q + 3] = Math.min(1, ch + churnAdd * (0.35 + 0.65 * d[q + 1]) * w * aSub * 0.9);
              }
              // water collects in deep ruts of soils that can hold it
              if (pc.poolCap > 0) {
                var depth = -d[q];
                var tgt = pc.poolCap * smooth(0.035, 0.15, depth);
                if (tgt > d[q + 1]) d[q + 1] += (tgt - d[q + 1]) * 0.22 * w;
              }
            } else if (!pc.deform) {
              // hard ground: mud smear and wet footprints
              if (smearAmt > 0) d[q + 3] = Math.min(1, d[q + 3] + smearAmt * 0.6 * w);
              if (ws.wet > 0.0 && ws.inWater > 0.01) d[q + 1] = Math.min(1, d[q + 1] + 0.5 * w);
            }
            if (i < minI) minI = i; if (i > maxI) maxI = i; if (j < minJ) minJ = j; if (j > maxJ) maxJ = j;
          } else if (targetC > 0.01 && nB < 1000) {
            // berm candidate strip beside the tyre
            var tb = (au - hb) / ext;
            var wb = Math.sin(Math.min(1, tb * 1.0 + 0.0) * Math.PI) ;
            wb = (0.15 + wb) * (af < hl * 0.9 ? 1 : (hl - af) / (hl * 0.1));
            if (wb > 0 && tm[c] !== TYPE.concrete && P[tm[c]].deform) {
              bermI[nB] = c; bermW[nB] = wb * (u < 0 ? -1 : 1); nB++;
              if (u < 0) wSumL += wb; else wSumR += wb;
            }
          }
        }
      }
      // deposit displaced soil on both sides
      if (nB > 0) {
        for (var m = 0; m < nB; m++) {
          var cc = bermI[m], wgt = bermW[m], neg = wgt < 0;
          var wa = neg ? -wgt : wgt;
          var share = neg ? (wSumL > 0 ? volL / wSumL : 0) : (wSumR > 0 ? volR / wSumR : 0);
          var add = share * wa / this.cellArea * 0.92;
          var qq = cc * 4, bp = P[tm[cc]];
          var cur = d[qq];
          var nv = Math.min(bp.berm, cur + add);
          if (nv > cur) {
            d[qq] = nv;
            d[qq + 3] = Math.min(1, d[qq + 3] + 0.25 * wa);
          }
          var ci = cc % NX, cj = (cc - ci) / NX;
          if (ci < minI) minI = ci; if (ci > maxI) maxI = ci; if (cj < minJ) minJ = cj; if (cj > maxJ) maxJ = cj;
        }
      }
    }
    if (maxI >= 0) this._markRect(minI, minJ, maxI, maxJ, pr.ttl || 30);
  };

  // The belly of a high-centred vehicle shaves the hump between the ruts: cells higher than the body bottom
  // are pressed down (baseAt(x, z) returns the undeformed terrain height).
  SoilSim.prototype.plow = function (x, z, hdg, halfW, halfL, bodyBottomY, baseAt, rate, slopeZ) {
    slopeZ = slopeZ || 0; // body-bottom plane tilt along the heading (rise per metre forward)
    var NX = this.NX, NZ = this.NZ, d = this.data, tm = this.typeMap, cell = this.cell, inv = this.inv;
    var sinH = Math.sin(hdg), cosH = Math.cos(hdg);
    var rad = Math.hypot(halfW, halfL);
    var i0 = Math.max(0, Math.floor((x - rad - this.originX) * inv)), i1 = Math.min(NX - 1, Math.floor((x + rad - this.originX) * inv));
    var j0 = Math.max(0, Math.floor((z - rad - this.originZ) * inv)), j1 = Math.min(NZ - 1, Math.floor((z + rad - this.originZ) * inv));
    var any = false, minI = NX, maxI = -1, minJ = NZ, maxJ = -1;
    for (var j = j0; j <= j1; j++) {
      var pz = this.originZ + (j + 0.5) * cell;
      for (var i = i0; i <= i1; i++) {
        var px = this.originX + (i + 0.5) * cell;
        var dx = px - x, dz = pz - z;
        var u = dx * cosH - dz * sinH, f = dx * sinH + dz * cosH;
        if (Math.abs(u) > halfW || Math.abs(f) > halfL) continue;
        var c = j * NX + i;
        if (!P[tm[c]].deform) continue;
        var q = c * 4;
        var limit = bodyBottomY + slopeZ * f - baseAt(px, pz);
        if (d[q] > limit) {
          d[q] += (limit - d[q]) * rate;
          d[q + 2] = Math.min(1, d[q + 2] + 0.1 * rate);
          any = true;
          if (i < minI) minI = i; if (i > maxI) maxI = i; if (j < minJ) minJ = j; if (j > maxJ) maxJ = j;
        }
      }
    }
    if (any) this._markRect(minI, minJ, maxI, maxJ, 60);
    return any;
  };

  // small splat of flung mud landing on the ground (from the fling particle system)
  SoilSim.prototype.splat = function (x, z, size) {
    var i = Math.floor((x - this.originX) * this.inv), j = Math.floor((z - this.originZ) * this.inv);
    if (i < 1 || j < 1 || i >= this.NX - 1 || j >= this.NZ - 1) return;
    var NX = this.NX, d = this.data;
    var r = Math.max(1, Math.round(size * this.inv * 0.8));
    for (var dj = -r; dj <= r; dj++) for (var di = -r; di <= r; di++) {
      var ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= NX || jj >= this.NZ) continue;
      var f = 1 - Math.hypot(di, dj) / (r + 0.5);
      if (f <= 0) continue;
      var q = (jj * NX + ii) * 4;
      d[q + 3] = Math.min(1, d[q + 3] + f * 0.7);
      d[q + 1] = Math.min(1, d[q + 1] + f * 0.2);
    }
    this._markRect(i - r, j - r, i + r, j + r, 0);
  };

  /* ------------------------- relaxation (slump / flow) ---------------------- */
  SoilSim.prototype.relax = function (dt) {
    this.frame++;
    var NX = this.NX, NZ = this.NZ, d = this.data, tm = this.typeMap, TS = this.TS, TX = this.TX;
    var frame = this.frame, cnt = this.activeCount, act = this.active;
    var inv = this.inv, wr = 0;
    var dtS = dt * 4; // each active tile is processed every 4th frame
    var ttlDec = dt * 240; // 4 frames at 60 Hz per processing interval, but in real time (frame-rate independent)
    for (var a = 0; a < cnt; a++) {
      var t = act[a];
      var ttl = this.tileTTL[t];
      if (ttl <= 0) { this.tileActive[t] = 0; continue; }
      act[wr++] = t;
      if (((a + frame) & 3) !== 0) { continue; }
      this.tileTTL[t] = ttl > ttlDec ? ttl - ttlDec : 0;
      var tj = Math.floor(t / TX), ti = t - tj * TX;
      var i0 = ti * TS, j0 = tj * TS, i1 = Math.min(NX - 1, i0 + TS - 1), j1 = Math.min(NZ - 1, j0 + TS - 1);
      var changed = false;
      for (var j = Math.max(1, j0); j <= Math.min(NZ - 2, j1); j++) {
        for (var i = Math.max(1, i0); i <= Math.min(NX - 2, i1); i++) {
          var c = j * NX + i, q = c * 4;
          var pr = P[tm[c]];
          if (!pr.deform) continue;
          var h0 = d[q];
          var hl = d[q - 4], hr = d[q + 4], hd = d[q - NX * 4], hu = d[q + NX * 4];
          var wet = d[q + 1];
          var gx = (hr - hl) * 0.5 * inv, gz = (hu - hd) * 0.5 * inv;
          var g = Math.sqrt(gx * gx + gz * gz);
          var slope = pr.slump * (1.15 - 0.55 * wet) * (1 + 1.2 * d[q + 2]);
          var nh = h0;
          if (g > slope) {
            var lap = (hl + hr + hd + hu) * 0.25 - h0;
            var rate = Math.min(0.22, 5.0 * dtS * Math.min(1.5, (g - slope) / (g + 0.001) + 0.15));
            nh += lap * rate;
          }
          if (pr.settle > 0 && h0 !== 0) {
            // fluid soils slowly flow back level; only the wet ones, and the deepest ruts keep their shape longer
            nh -= nh * Math.min(0.3, pr.settle * dtS * (0.3 + 0.7 * wet) * (1 - 0.7 * d[q + 2]));
          }
          if (nh !== h0) { d[q] = nh; changed = true; }
          // churned mud settles, water slowly evaporates back to the base wetness of the soil
          var ch = d[q + 3];
          if (ch > 0.001) { d[q + 3] = ch - ch * Math.min(0.3, dtS * (pr.deform ? 0.02 : 0.01)); changed = true; }
          var bw = pr.baseWet;
          if (wet > bw + 0.005 && pr.poolCap > 0) { d[q + 1] = wet - Math.min(wet - bw, dtS * 0.004); changed = true; }
        }
      }
      if (changed && !this.tileDirty[t]) { this.tileDirty[t] = 1; this.dirtyList[this.dirtyCount++] = t; }
    }
    this.activeCount = wr;
  };

  /* ----------------------------- vehicle dynamics -------------------------- */
  // V: { mass, speed, slope, belly (0..1), winch (N), hcg }
  // wheels[k]: { x, z, hdg, radius, width, isFront, driven, axle, localZ, s: wheel state }
  // I: { throttle: -1..1, brake, handbrake, awd (bool), diffLock, lowGear }
  // cfg: { power, maxSpeed, lowMaxSpeed, torqueMult, sinkFactor, tireBite, hasAWD, clearance }
  SoilSim.prototype.vehicleStep = function (V, wheels, I, cfg, dt, out) {
    var N = wheels.length;
    var m = V.mass;
    var v = V.speed;
    var fp = Math.pow(cfg.sinkFactor || 1, 0.8);
    var bite = cfg.tireBite != null ? cfg.tireBite : 1;

    // per-wheel loads with longitudinal weight transfer (acceleration and slope shift weight to the rear)
    var dirSgn = v > 0.1 ? 1 : (v < -0.1 ? -1 : (I.throttle < -0.01 ? -1 : 1)); // direction of travel (or of the pedal when standing)
    var shift = clamp(0.30 * ((V.accelPrev || 0) / G + V.slope), -0.3, 0.3);
    var zmax = 0.001;
    for (var k = 0; k < N; k++) zmax = Math.max(zmax, Math.abs(wheels[k].localZ));
    var Wtot = m * G / Math.sqrt(1 + V.slope * V.slope);
    var sumCap = 0, sumRoll = 0, sumSteerGrip = 0, nFront = 0, loadSum = 0;
    for (k = 0; k < N; k++) {
      var w = wheels[k];
      w.s.dirSign = dirSgn;
      var Wi = Wtot / N * (1 - shift * (w.localZ / zmax));
      Wi = Math.max(0.15 * Wtot / N, Wi);
      w.W = Wi;
      this.contact(w.s, w.x, w.z, w.hdg, w.radius, w.width, Wi, fp, bite);
      var prv = P[w.s.t];
      if (prv.visc > 0) { var rv = Wi * prv.visc * Math.abs(v) * Math.min(1, w.s.zEq / 0.1) * (1 + 0.5 * w.s.mud); w.s.roll += rv; }
      sumCap += w.s.cap; sumRoll += w.s.roll; loadSum += Wi;
      if (w.isFront) { sumSteerGrip += Math.min(1, w.s.cap / (Wi * 0.9)); nFront++; }
    }

    // engine thrust request
    var thr = I.throttle;
    var vTop = I.lowGear ? Math.max(2.5, cfg.lowMaxSpeed * 0.45) : cfg.maxSpeed * 0.5;
    var a0 = cfg.power * 0.14 * (I.lowGear ? cfg.torqueMult : 1);
    var Fe = 0;
    var braking = false;
    if (thr > 0.01) {
      if (v < -0.3) braking = true; // reversing and asked forward: brake first
      else Fe = m * a0 * Math.max(0, 1 - Math.max(0, v) / vTop) * thr;
    } else if (thr < -0.01) {
      if (v > 0.3) braking = true;
      else Fe = -m * a0 * 0.7 * Math.max(0, 1 - Math.max(0, -v) / (vTop * 0.45)) * (-thr);
    }
    var dir = Fe > 0 ? 1 : (Fe < 0 ? -1 : 0);
    var FeAbs = Math.abs(Fe);
    if (!I.awd && cfg.hasAWD) FeAbs *= 0.65;

    // drive distribution (open differential per axle, or locked)
    var nDriven = 0, i, axles = out.axleTmp;
    for (i = 0; i < out.axleTmp.length; i++) { axles[i] = null; }
    var drivenCount = 0;
    for (k = 0; k < N; k++) { wheels[k].isDrv = wheels[k].driven && (!wheels[k].isFront || I.awd); if (wheels[k].isDrv) drivenCount++; }
    var thrustTotal = 0, slipTotal = 0;
    for (k = 0; k < N; k++) { wheels[k].s.thrust = 0; }
    if (drivenCount > 0 && FeAbs > 1) {
      // group by axle id
      var maxAx = 0;
      for (k = 0; k < N; k++) if (wheels[k].axle > maxAx) maxAx = wheels[k].axle;
      var nAxD = 0;
      if (out.axCap.length <= maxAx) { out.axCap = new Float64Array(maxAx + 1); out.axCnt = new Int32Array(maxAx + 1); out.axMin = new Float64Array(maxAx + 1); }
      var axCap = out.axCap, axCnt = out.axCnt, axMin = out.axMin;
      for (i = 0; i <= maxAx; i++) { axCap[i] = 0; axCnt[i] = 0; axMin[i] = 1e12; }
      for (k = 0; k < N; k++) if (wheels[k].isDrv) { var a = wheels[k].axle; axCap[a] += wheels[k].s.cap; axCnt[a]++; axMin[a] = Math.min(axMin[a], wheels[k].s.cap); }
      for (i = 0; i <= maxAx; i++) if (axCnt[i] > 0) nAxD++;
      var capAll = 0;
      for (k = 0; k < N; k++) if (wheels[k].isDrv) capAll += wheels[k].s.cap;
      if (I.diffLock) {
        var Ftot = Math.min(FeAbs, capAll * 0.995);
        for (k = 0; k < N; k++) if (wheels[k].isDrv) {
          var wsk = wheels[k].s;
          var Fk = Ftot * wsk.cap / capAll;
          var fr = FeAbs > capAll ? 1.0 : Fk / wsk.cap;
          wsk.thrust = Fk;
          wsk.slip = SoilSim.slipFromFraction(FeAbs > capAll ? 0.99 : fr, wsk.K, wsk.L);
        }
        thrustTotal = Ftot;
      } else {
        var axDemand = FeAbs / nAxD;
        for (k = 0; k < N; k++) if (wheels[k].isDrv) {
          var wk = wheels[k], sk = wk.s, ax = wk.axle;
          var each = axDemand / axCnt[ax];
          var weakest = axMin[ax];
          var lim = Math.min(each, weakest); // open diff: torque equal on both wheels, weaker wheel limits
          sk.thrust = lim;
          var frac = each > weakest * 0.985 ? (sk.cap <= weakest * 1.001 ? 1.0 : Math.min(1.0, weakest / sk.cap)) : each / sk.cap;
          if (each > weakest * 0.985 && sk.cap > weakest * 1.001) frac = Math.min(0.92, weakest / sk.cap);
          sk.slip = SoilSim.slipFromFraction(frac, sk.K, sk.L);
          thrustTotal += lim;
        }
      }
    }
    for (k = 0; k < N; k++) { var sw = wheels[k].s; if (!(wheels[k].isDrv && FeAbs > 1)) { sw.slip = 0; } slipTotal += sw.slip; }

    // brakes are limited by tyre grip too
    var Fbrake = 0;
    if (braking) Fbrake = m * 5.5;
    if (I.handbrake) Fbrake = Math.max(Fbrake, m * 9.0);
    Fbrake = Math.min(Fbrake, sumCap * 0.97);

    // resistances
    var sgn = v > 0.02 ? 1 : (v < -0.02 ? -1 : 0);
    var Fair = 1.4 * v * Math.abs(v) * Math.sqrt(m / 2000);
    var bellyMu = 0.9;
    var Fbelly = m * G * bellyMu * V.belly;
    var Fslope = -m * G * V.slope / Math.sqrt(1 + V.slope * V.slope);
    var Feb = (thr === 0 && !braking) ? m * 0.35 * Math.min(1, Math.abs(v) / 2.5) : 0;
    var resist = sumRoll + Fbelly + Feb;
    var Fext = Fslope - Fair * 1.0 + (V.winch || 0);
    var Fthrust = dir * thrustTotal;

    var meff = m * 1.10;
    var vNew;
    if (sgn === 0 && Math.abs(Fthrust + Fext) <= resist + Fbrake) {
      vNew = 0; // static friction holds the vehicle
    } else {
      var drive = Fthrust + Fext;
      var dirR = sgn !== 0 ? sgn : (drive > 0 ? 1 : -1);
      var Fnet = drive - dirR * (resist + Fbrake);
      vNew = v + Fnet / meff * dt;
      if (sgn !== 0 && vNew * sgn < 0) vNew = 0; // resistances can only stop the vehicle, not reverse it
    }
    V.accelPrev = (vNew - v) / Math.max(dt, 1e-4);
    out.speed = vNew;
    out.thrust = thrustTotal;
    out.resist = resist;
    out.cap = sumCap;
    out.slipTotal = slipTotal;
    out.steerGrip = nFront > 0 ? clamp(sumSteerGrip / nFront, 0.22, 1) : 1;
    out.fbelly = Fbelly;
    out.dragCoef = resist / (m * G);
    return out;
  };

  SoilSim.makeStepOut = function () {
    return { axleTmp: new Array(8), axCap: new Float64Array(8), axCnt: new Int32Array(8), axMin: new Float64Array(8),
      speed: 0, thrust: 0, resist: 0, cap: 0, slipTotal: 0, steerGrip: 1, fbelly: 0, dragCoef: 0 };
  };

  // rut guidance: lateral push (m/s^2, right = +) from the slope of the rut walls under the wheels
  SoilSim.prototype.rutPush = function (wheels, mass) {
    var sumF = 0, sumFront = 0, sumRear = 0, nF = 0, nR = 0;
    for (var k = 0; k < wheels.length; k++) {
      var w = wheels[k], s = w.s, pr = P[s.t];
      if (!pr || !pr.deform) continue;
      var dhL = this._latSample(w, -1), dhR = this._latSample(w, 1);
      var grad = (dhR - dhL) / (w.width + 0.5); // >0: right side higher -> push left (negative)
      var hold = 0.55 * (1 - 0.5 * clamp(s.pack, 0, 1)) * (0.4 + 0.6 * clamp(s.wet, 0, 1));
      var F = -grad * w.W * hold;
      sumF += F;
      if (w.isFront) { sumFront += F; nF++; } else { sumRear += F; nR++; }
    }
    return { lat: sumF / mass, yaw: (nF ? sumFront / nF : 0) - (nR ? sumRear / nR : 0) };
  };
  SoilSim.prototype._latSample = function (w, side) {
    var off = w.width * 0.5 + 0.18;
    var x = w.x + Math.cos(w.hdg) * off * side, z = w.z - Math.sin(w.hdg) * off * side;
    return this.getDH(x, z);
  };

  global.SoilSim = SoilSim;
  if (typeof module !== 'undefined' && module.exports) module.exports = SoilSim;
})(typeof window !== 'undefined' ? window : globalThis);
