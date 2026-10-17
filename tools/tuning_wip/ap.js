// Autopilot + fixed-step headless simulator injected into the page (see run.mjs)
(function () {
  const DT = 1 / 60;
  let cb = (typeof animate === "function") ? animate : null;
  window.requestAnimationFrame = function (f) { cb = f; return 1; };
  const AP = window.AP = { t: 0, log: [], done: false, reason: '', cfg: null };
  const clampf = (v, a, b) => v < a ? a : (v > b ? b : v);
  const BOUNDS = [-60, -35, -10, 18, 45, 58, 80];
  const BNAMES = ['forest', 'sand', 'clay', 'swamp', 'bridge', 'snow', 'finish'];

  AP.setup = function (idx, o) {
    o = o || {};
    AP.o = o;
    renderer.render = function () {};
    if (postFX) postFX.render = function () {};
    clock.getDelta = function () { return (AP.o && AP.o.dt) || DT; };
    switchVehicle(idx);
    // fresh soil + wheel states
    if (!o.keepSoil) SOIL.init(soilTypeAt);
    vehicleModelGroups.forEach(m => m.wheelsData.forEach(w => { w.s = SoilSim.newWheelState(); }));
    resetTruck();
    const z0 = o.startZ != null ? o.startZ : -80;
    truckPos.set(0, 0, z0);
    truckPos.y = getTerrainHeight(0, z0);
    truckHeading = 0; truckSpeed = 0; truckPitch = 0; truckRoll = 0;
    throttleState = 0; rutVLat = 0; bellyAmount = 0; soilV.accelPrev = 0;
    if (isDiffLock) toggleDiffLock();
    if (isLowGear) toggleLowGear();
    AP.t = 0; AP.log = []; AP.done = false; AP.reason = '';
    AP.sec = {}; AP.maxRut = 0; AP.minGap = 9; AP.maxPitchStep = 0; AP.maxYStep = 0; AP.maxJump = 0; AP.nan = false;
    AP.maxSink = 0; AP.maxBelly = 0; AP.maxPit = 0; AP.maxRol = 0; AP.stuckT = 0; AP.lastS = -1; AP.rec = { mode: 'fwd', t: 0 };
    AP.prev = { pitch: 0, y: truckPos.y, x: truckPos.x, z: truckPos.z };
    AP.idx = idx; AP.name = currentVehicleConfig.id;
    AP.maxZ = z0; AP.minZ = z0; AP.winchUsed = 0;
    AP.slowT = 0;
    return { name: AP.name, y: truckPos.y };
  };

  function wantDiff(w) { if (currentVehicleConfig.hasDiffLock && isDiffLock !== w) toggleDiffLock(); }
  function wantLow(w) { if (isLowGear !== w) toggleLowGear(); }

  function control() {
    const o = AP.o, z = truckPos.z, x = truckPos.x;
    // technique by sector
    if (o.tech !== 'none') {
      const dl = o.diffFrom != null ? (z >= o.diffFrom) : (z > -37);
      const lg = o.lowFrom != null ? (z >= o.lowFrom) : (z > -12);
      wantDiff(dl); wantLow(lg);
    }
    // steering: P-controller toward x=0
    const rec = AP.rec;
    let steerOn = true;
    if (rec.mode === 'rev') steerOn = false;
    const tgt = clampf(-0.10 * x, -0.28, 0.28);
    const e = tgt - truckHeading;
    if (steerOn) { keys.left = e > 0.025; keys.right = e < -0.025; } else { keys.left = false; keys.right = false; }
    // stuck recovery by rocking
    if (o.rock) {
      const v = Math.abs(truckSpeed);
      if (rec.mode === 'fwd') {
        if (v < 0.35) AP.slowT += DT; else AP.slowT = 0;
        if (AP.slowT > o.rockAfter) { rec.mode = 'rev'; rec.t = 0; AP.slowT = 0; }
      } else {
        rec.t += DT;
        if (rec.t > o.rockRev) { rec.mode = 'fwd'; rec.t = 0; AP.slowT = 0; }
      }
    }
    keys.forward = rec.mode === 'fwd'; keys.backward = rec.mode === 'rev';
    // winch use
    if (o.winch) {
      const v = Math.abs(truckSpeed);
      if (!winchActive) {
        AP.wslow = (AP.wslow || 0) + (v < 0.35 && z > o.winchZ0 ? DT : 0);
        if (v >= 0.35) AP.wslow = 0;
        if (AP.wslow > o.winchAfter && AP.winchUsed < 4) { rec.mode = 'fwd'; toggleWinch(); if (winchActive) AP.winchUsed++; AP.wslow = 0; AP.winchStart = AP.t; AP.winchStartZ = z; }
      } else {
        // keep throttle on while winching
        rec.mode = 'fwd';
      }
    }
    if (o.vmax && keys.forward && Math.abs(truckSpeed) * 3.6 > o.vmax) keys.forward = false;
    if (o.fixedThrottle != null) { keys.forward = o.fixedThrottle > 0; keys.backward = o.fixedThrottle < 0; }
    if (o.noSteer) { keys.left = false; keys.right = false; }
  }

  function sample(force) {
    const sw = activeWheels._sim || [];
    let slip = 0, nd = 0, sink = 0, mud = 0, maxSinkW = 0;
    for (const e of sw) { const s = e.s; if (e.isDrv) { slip += s.slip; nd++; } sink += s.zEq + s.dig; mud += s.mud; maxSinkW = Math.max(maxSinkW, s.zEq + s.dig); }
    const n = sw.length || 1;
    const gap = truckPos.y - getTerrainHeight(truckPos.x, truckPos.z);
    AP.maxSink = Math.max(AP.maxSink, maxSinkW);
    AP.maxBelly = Math.max(AP.maxBelly, bellyAmount); AP.maxPit = Math.max(AP.maxPit||0, Math.abs(truckPitch)*57.3); AP.maxRol = Math.max(AP.maxRol||0, Math.abs(truckRoll)*57.3);
    AP.minGap = Math.min(AP.minGap, gap);
    return {
      t: +AP.t.toFixed(1), x: +truckPos.x.toFixed(2), z: +truckPos.z.toFixed(2), v: +(truckSpeed * 3.6).toFixed(1),
      hdg: +truckHeading.toFixed(3), pit: +(-truckPitch * 57.3).toFixed(1), rol: +(truckRoll * 57.3).toFixed(1),
      slip: +(nd ? slip / nd : 0).toFixed(2), sink: +(sink / n).toFixed(3), mud: +(mud / n).toFixed(2), belly: +bellyAmount.toFixed(2),
      gap: +gap.toFixed(2), thr: +soilStepOut.thrust.toFixed(0), res: +soilStepOut.resist.toFixed(0), cap: +soilStepOut.cap.toFixed(0),
      sl: +soilV.slope.toFixed(3), dig: +(sw.reduce((a,e)=>a+e.s.dig,0)/n).toFixed(2), cl: +(sw.reduce((a,e)=>a+e.s.climb,0)/n).toFixed(0), ty: sw[0] ? sw[0].s.t : -1, dl: isDiffLock ? 1 : 0, lg: isLowGear ? 1 : 0, w: winchActive ? 1 : 0, m: AP.rec.mode
    };
  }

  function rutScan() {
    const d = SOIL.data, NX = SOIL.NX;
    const i0 = Math.max(0, Math.floor((truckPos.x - 3 - SOIL.originX) * SOIL.inv)), i1 = Math.min(NX - 1, Math.floor((truckPos.x + 3 - SOIL.originX) * SOIL.inv));
    const j0 = Math.max(0, Math.floor((truckPos.z - 4 - SOIL.originZ) * SOIL.inv)), j1 = Math.min(SOIL.NZ - 1, Math.floor((truckPos.z + 4 - SOIL.originZ) * SOIL.inv));
    let mn = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const v = d[(j * NX + i) * 4]; if (v < mn) mn = v; }
    return -mn;
  }

  AP.step = function (n) {
    const o = AP.o;
    for (let i = 0; i < n && !AP.done; i++) {
      control();
      cb();
      const dtc = (o && o.dt) || DT;
      AP.t += dtc;
      // sanity
      if (!isFinite(truckPos.x + truckPos.y + truckPos.z + truckSpeed + truckPitch + truckRoll + truckHeading)) { AP.nan = true; AP.done = true; AP.reason = 'NaN'; break; }
      const p = AP.prev;
      const jump = Math.hypot(truckPos.x - p.x, truckPos.z - p.z);
      AP.maxJump = Math.max(AP.maxJump, jump / dtc - Math.abs(truckSpeed));
      AP.maxPitchStep = Math.max(AP.maxPitchStep, Math.abs(truckPitch - p.pitch) * 57.3);
      AP.maxYStep = Math.max(AP.maxYStep, Math.abs(truckPos.y - p.y));
      p.pitch = truckPitch; p.y = truckPos.y; p.x = truckPos.x; p.z = truckPos.z;
      AP.maxZ = Math.max(AP.maxZ, truckPos.z); AP.minZ = Math.min(AP.minZ, truckPos.z);
      for (let b = 0; b < BOUNDS.length; b++) if (AP.sec[BNAMES[b]] == null && truckPos.z >= BOUNDS[b]) AP.sec[BNAMES[b]] = +AP.t.toFixed(1);
      if ((i & 63) === 0) AP.maxRut = Math.max(AP.maxRut, rutScan());
      const sIdx = Math.floor(AP.t / (o.logEvery || 1));
      if (sIdx !== AP.lastS) { AP.lastS = sIdx; AP.log.push(sample()); }
      if (expeditionFinished || (o.stopZ != null && truckPos.z >= o.stopZ)) { AP.done = true; AP.reason = expeditionFinished ? 'finish' : 'stopZ'; }
      if (AP.t >= o.tmax) { AP.done = true; AP.reason = 'timeout'; }
    }
    return { t: AP.t, done: AP.done, reason: AP.reason, z: truckPos.z, v: truckSpeed * 3.6 };
  };

  AP.result = function () {
    return {
      vEnd: +(truckSpeed*3.6).toFixed(1), zEnd: +truckPos.z.toFixed(1), id: AP.name, idx: AP.idx, t: +AP.t.toFixed(1), reason: AP.reason, passed: passedCount, maxZ: +AP.maxZ.toFixed(1), minZ: +AP.minZ.toFixed(1), sec: AP.sec,
      maxRut: +AP.maxRut.toFixed(2), maxSink: +AP.maxSink.toFixed(2), minGap: +AP.minGap.toFixed(2), maxBelly: +AP.maxBelly.toFixed(2),
      maxPit: +(AP.maxPit||0).toFixed(1), maxRol: +(AP.maxRol||0).toFixed(1), maxPitchStep: +AP.maxPitchStep.toFixed(2), maxYStep: +AP.maxYStep.toFixed(3), maxJump: +AP.maxJump.toFixed(2), nan: AP.nan, winchUsed: AP.winchUsed, log: AP.log
    };
  };
  window.__apReady = true;
})();
