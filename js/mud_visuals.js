/* ============================================================================
 * mud_visuals.js  -  mud-caked wheels, dirty vehicle bodies, flung mud
 * three.js r128, classic script (no modules). Everything is procedural, no
 * external images, works from file://.
 *
 * Globals defined (all internals live in one IIFE; also mirrored on window.MudVisuals):
 *
 *   createMudShell(radius, width, opts?) -> { mesh, update(mud, colorHex, wetness, time), material }
 *   makeDirtUniforms(opts?)              -> { uDirt, uDirtColor, uDirtWet, uTruckInv, uSeed, uDirtHeight, uDirtBody, uDirtWheels }
 *   patchVehicleDirt(root, dirtUniforms, opts?) -> { patched, already, skipped, cloned }
 *   setDirtState(dirtUniforms, dirt, colorHex, wetness)
 *   setDirtWheels(dirtUniforms, root, wheelObjects, radii?)   (optional, improves "behind the wheel" bias)
 *   createMudFling(scene, opts?)         -> { spawn(kind,x,y,z,vx,vy,vz,size,colorHex?), update(dt), setLandCallback(fn), count, ... }
 *
 * See the block comment above each function for details.
 * ========================================================================== */
(function (global) {
  'use strict';

  if (typeof THREE === 'undefined') { throw new Error('mud_visuals.js: THREE (r128) must be loaded first'); }
  var MV = global.MudVisuals = global.MudVisuals || {};
  if (MV.__loaded) { console.warn('mud_visuals.js loaded twice, keeping the first copy'); return; }
  MV.__loaded = true;
  MV.version = '1.0.0';
  MV.stats = { dirtWraps: 0, dirtClones: 0, shellsCreated: 0, shellGeometries: 0 };

  var clamp01 = function (x) { return x < 0 ? 0 : (x > 1 ? 1 : x); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };

  /* =========================================================================
   * 1. MUD SHELL  (mud caked on the tyre)
   * ========================================================================= */

  // --- GLSL: shell vertex shader (displacement = level set of a lumpy field) ---
  var SHELL_VERT_PARS = [
    'uniform float uMud;',
    'uniform float uMudTime;',
    'uniform vec3  uMudSeed;',
    'uniform vec4  uMudDim;   // x radius, y half width of the shell, z lug count, w lug phase of the +x row',
    'uniform float uMudCap;   // half width of the tyre cylinder (side wall)',
    'varying float vMudS;',
    'float mvsH(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }',
    'float mvsN(vec3 p){',
    '  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  float a = mvsH(i), b = mvsH(i + vec3(1.0,0.0,0.0)), c = mvsH(i + vec3(0.0,1.0,0.0)), d = mvsH(i + vec3(1.0,1.0,0.0));',
    '  float e = mvsH(i + vec3(0.0,0.0,1.0)), g = mvsH(i + vec3(1.0,0.0,1.0)), h = mvsH(i + vec3(0.0,1.0,1.0)), k = mvsH(i + vec3(1.0,1.0,1.0));',
    '  return mix(mix(mix(a,b,f.x), mix(c,d,f.x), f.y), mix(mix(e,g,f.x), mix(h,k,f.x), f.y), f.z);',
    '}',
    '// lumpiness of the mud layer, 0 = valley, 1 = clump top',
    'float mvsShape(vec3 p, float crust){',
    '  vec3 q = p + uMudSeed;',
    '  float th = atan(p.z, p.y);',
    '  float ex = abs(p.x) / uMudDim.y;',
    '  float ph = uMudDim.w * smoothstep(-0.05, 0.05, p.x);',
    '  float gap = 0.5 - 0.5 * cos(uMudDim.z * th + ph);',          // 1 between lugs
    '  float big = mvsN(q * 4.6);',
    '  float mid = mvsN(q * 10.5 + vec3(3.7));',
    '  float low = mvsN(q * 2.3 + vec3(9.1));',
    '  float clump = smoothstep(0.32, 0.72, big * 0.62 + mid * 0.38);',
    '  float sL = 0.50 * gap + 0.32 * clump + 0.18 * low;',          // early: fills the tread gaps
    '  float sH = 0.34 + 0.50 * clump + 0.16 * low;',                        // late: free standing clumps
    '  float s = mix(sL, sH, crust);',
    '  s *= 1.0 - 0.80 * smoothstep(0.55, 1.0, ex + (low - 0.5) * 0.45);',                // thinner towards the side wall
    '  return s;',
    '}'
  ].join('\n');

  var SHELL_VERT_MAIN = [
    'vec3 mvsP0 = position;',
    'vec3 mvsN0 = normalize(normal);',
    'float mvsM  = clamp(uMud, 0.0, 1.0);',
    'float mvsCr = smoothstep(0.25, 1.0, mvsM);',
    'float mvsA  = mix(0.034, 0.100, mvsCr);',                       // amplitude, metres (max +8.8 cm, -1.3 cm threshold = +7.5 cm)
    'float mvsB  = mvsA * mix(1.05, 0.15, smoothstep(0.0, 0.5, mvsM));',
    'float mvsS0 = mvsShape(mvsP0, mvsCr);',
    'float mvsD0 = mvsA * mvsS0 - mvsB;',
    'vec3 mvsTT = normalize(vec3(0.0, -mvsP0.z, mvsP0.y));',
    'vec3 mvsTS = normalize(cross(mvsN0, mvsTT));',
    'float mvsE = 0.012;',
    'float mvsDT = (mvsA * mvsShape(mvsP0 + mvsTT * mvsE, mvsCr) - mvsB - mvsD0) / mvsE;',
    'float mvsDS = (mvsA * mvsShape(mvsP0 + mvsTS * mvsE, mvsCr) - mvsB - mvsD0) / mvsE;',
    'vec3 mvsNN = normalize(mvsN0 - mvsDT * mvsTT - mvsDS * mvsTS);',
    '// drips: a few tongues of mud sliding down the side wall',
    'float mvsEx = abs(mvsP0.x) / uMudDim.y;',
    'float mvsTh = atan(mvsP0.z, mvsP0.y);',
    'float mvsDn = mvsN(vec3(cos(mvsTh), sin(mvsTh), sign(mvsP0.x) * 0.5) * 2.2 + uMudSeed * 0.37);',
    'float mvsDrip = smoothstep(0.64, 0.86, mvsDn) * smoothstep(0.78, 0.98, mvsEx) * smoothstep(0.45, 0.85, mvsM);',
    'float mvsDl = max(mvsD0, -0.012);',                             // below the rubber -> hidden (no z-fighting)
    'mvsDl = max(mvsDl, 0.012 * mvsDrip);',
    'vec3 mvsPos = mvsP0 + mvsN0 * mvsDl;',
    'float mvsRho = length(mvsPos.yz);',
    'float mvsLen = uMudDim.x * 0.20 * mvsDrip * (0.88 + 0.12 * sin(uMudTime * 0.8 + mvsTh * 5.0));',
    'mvsPos.yz *= max(mvsRho - mvsLen, 0.05) / mvsRho;',
    'mvsPos.x = mix(mvsPos.x, sign(mvsPos.x) * (uMudCap + 0.004 + 0.012 * mvsDrip), mvsDrip);',
    'vMudS = mvsS0;'
  ].join('\n');

  var SHELL_FRAG_PARS = [
    'uniform float uMudWet;',
    'varying float vMudS;'
  ].join('\n');

  var SHELL_FRAG_COLOR = [
    '{',
    '  float mvT = smoothstep(0.12, 0.88, vMudS);',
    '  vec3 mvC = diffuseColor.rgb;',
    '  vec3 mvDry = mvC * 1.25 + vec3(0.02, 0.016, 0.008);',        // dried crust on the clump tops
    '  vec3 mvWet = mvC * 0.62;',                                      // wet, dark valleys
    '  diffuseColor.rgb = mix(mvWet, mvDry, mvT * (1.0 - 0.55 * uMudWet));',
    '}'
  ].join('\n');

  var SHELL_FRAG_ROUGH = 'roughnessFactor = clamp(roughnessFactor + (vMudS - 0.5) * 0.30 * (1.0 - 0.5 * uMudWet), 0.18, 1.0);';

  // --- geometry (shared per (radius,width) size class) ---
  var shellGeoCache = {};
  var SHELL_NTHETA = 72, SHELL_NS = 22;

  function buildShellGeometry(radius, width) {
    var rTop = radius * 0.97 + 0.003;                 // tread of createWheelMesh = 0.97 r
    var rEnd = radius * 0.72;                         // lower end of the shell on the shoulder
    var hw = Math.max(width * 0.5 + 0.012, width * 0.34 + radius * 0.16);
    var H = rTop - rEnd;
    var N = 5.0, e2 = 2.0 / N;
    var nT = SHELL_NTHETA, nS = SHELL_NS;
    var vc = (nT + 1) * (nS + 1);
    var pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3);
    // profile (x, rho) and its outward normal
    var px = [], pr = [], nx = [], nr = [];
    for (var j = 0; j <= nS; j++) {
      var phi = (j / nS - 0.5) * Math.PI;
      var sn = Math.sin(phi), cs = Math.cos(phi);
      var asn = Math.abs(sn), acs = Math.abs(cs);
      px.push(hw * (sn < 0 ? -1 : 1) * Math.pow(asn, e2));
      pr.push(rEnd + H * Math.pow(acs, e2));
      // gradient of |x/hw|^N + |(rho-rEnd)/H|^N
      var ux = px[j] / hw, ur = (pr[j] - rEnd) / H;
      var gX = (ux < 0 ? -1 : 1) * Math.pow(Math.abs(ux), N - 1) / hw;
      var gR = (ur < 0 ? -1 : 1) * Math.pow(Math.abs(ur), N - 1) / H;
      var gl = Math.hypot(gX, gR) || 1;
      nx.push(gX / gl); nr.push(gR / gl);
    }
    var o = 0;
    for (var i = 0; i <= nT; i++) {
      var th = (i / nT) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      for (var jj = 0; jj <= nS; jj++) {
        pos[o] = px[jj]; pos[o + 1] = pr[jj] * c; pos[o + 2] = pr[jj] * s;
        nor[o] = nx[jj]; nor[o + 1] = nr[jj] * c; nor[o + 2] = nr[jj] * s;
        o += 3;
      }
    }
    var idx = new Uint16Array(nT * nS * 6);
    var k = 0;
    for (var a = 0; a < nT; a++) {
      for (var b = 0; b < nS; b++) {
        var i00 = a * (nS + 1) + b, i10 = (a + 1) * (nS + 1) + b, i01 = i00 + 1, i11 = i10 + 1;
        idx[k++] = i00; idx[k++] = i10; idx[k++] = i01;
        idx[k++] = i10; idx[k++] = i11; idx[k++] = i01;
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    // the vertex shader pushes vertices out by up to ~9 cm and drips hang lower: keep culling honest
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), Math.hypot(hw, rTop) + 0.14);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-hw - 0.05, -rTop - 0.12, -rTop - 0.12), new THREE.Vector3(hw + 0.05, rTop + 0.12, rTop + 0.12));
    g.userData.mudShell = { hw: hw, cap: width * 0.5, radius: radius, width: width };
    MV.stats.shellGeometries++;
    return g;
  }

  function getShellGeometry(radius, width) {
    var key = radius.toFixed(3) + '_' + width.toFixed(3);
    var g = shellGeoCache[key];
    if (!g) { g = shellGeoCache[key] = buildShellGeometry(radius, width); }
    return g;
  }

  var shellSeedCounter = 1;
  // brown soils are rendered darker than their albedo hex (the game's lights are bright); snow / sand stay light
  function soilScale(c) {
    var lum = 0.30 * c.r + 0.59 * c.g + 0.11 * c.b;
    var t = clamp01((lum - 0.15) / 0.40); t = t * t * (3 - 2 * t);
    return 0.55 + 0.45 * t;
  }

  /**
   * createMudShell(radius, width, opts?)
   *   radius, width : tyre radius / width in metres, same numbers as createWheelMesh(radius, width, ...)
   *   opts.lugCount : number of lug pairs of the tyre (default 14, chrome_cap wheels use 12)
   *   opts.seed     : number, per instance noise seed (default: counter)
   *   opts.castShadow : bool (default false, the tyre already casts a shadow of the same size)
   *
   * Add result.mesh as a child of the wheel's spinGroup (local X = axle), then every frame
   *   shell.update(mud01, soilColorHex, wetness01, timeSeconds)
   * mud01 <= 0.004 hides the mesh (visible=false, zero cost).
   * One BufferGeometry (3168 triangles) is shared by all shells with the same (radius,width);
   * each shell owns a cheap MeshStandardMaterial (all share one GL program).
   */
  function createMudShell(radius, width, opts) {
    opts = opts || {};
    var geo = getShellGeometry(radius, width);
    var info = geo.userData.mudShell;
    var seed = (opts.seed !== undefined ? opts.seed : (shellSeedCounter++ * 1.618 + 0.37));
    var lugCount = opts.lugCount || 14;
    var u = {
      uMud: { value: 0 },
      uMudTime: { value: 0 },
      uMudWet: { value: 0.5 },
      uMudSeed: { value: new THREE.Vector3(Math.sin(seed * 12.9898) * 43.7585 % 53.0, Math.sin(seed * 78.233) * 43758.5453 % 47.0, Math.sin(seed * 37.719) * 12345.6789 % 59.0) },
      uMudDim: { value: new THREE.Vector4(radius, info.hw, lugCount, -lugCount * 0.11) },
      uMudCap: { value: info.cap }
    };
    var mat = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9, metalness: 0.0 });
    mat.customProgramCacheKey = function () { return 'mudShell1'; };
    mat.onBeforeCompile = function (shader) {
      for (var k in u) { shader.uniforms[k] = u[k]; }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + SHELL_VERT_PARS)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + SHELL_VERT_MAIN + '\nobjectNormal = mvsNN;')
        .replace('#include <begin_vertex>', 'vec3 transformed = mvsPos;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + SHELL_FRAG_PARS)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + SHELL_FRAG_COLOR)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + SHELL_FRAG_ROUGH);
    };
    var mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'mudShell';
    mesh.visible = false;
    mesh.castShadow = !!opts.castShadow;
    mesh.receiveShadow = true;
    mesh.userData.noDirt = true;     // never run the body-dirt patch over a mud shell
    mesh.userData.isMudShell = true;
    MV.stats.shellsCreated++;

    var lastHex = -1, lastWet = -1;
    var tmp = new THREE.Color();
    function update(mud, colorHex, wetness, time) {
      if (!(mud > 0.004)) { mesh.visible = false; return; }
      mesh.visible = true;
      var w = wetness === undefined ? 0.5 : clamp01(wetness);
      u.uMud.value = mud > 1 ? 1 : mud;
      u.uMudTime.value = time || 0;
      if (colorHex !== undefined && (colorHex !== lastHex || w !== lastWet)) {
        lastHex = colorHex; lastWet = w;
        mat.color.setHex(colorHex); mat.color.multiplyScalar(soilScale(mat.color) * (1.0 - 0.30 * w));   // wet mud is darker
        mat.roughness = 0.95 - 0.60 * w;                               // 0.95 dry -> 0.35 wet
        u.uMudWet.value = w;
      } else if (colorHex === undefined && w !== lastWet) {
        lastWet = w; mat.roughness = 0.95 - 0.60 * w; u.uMudWet.value = w;
      }
    }
    return { mesh: mesh, update: update, material: mat, uniforms: u, geometry: geo };
  }

  /* =========================================================================
   * 2. VEHICLE BODY DIRT  (splatter mask in the vehicle frame)
   * ========================================================================= */

  var DIRT_VERT_PARS = [
    'uniform mat4 uTruckInv;',
    'varying vec3 vDirtP;',
    'varying vec3 vDirtN;'
  ].join('\n');

  // after project_vertex: `transformed` and `objectNormal` exist (also for skinned/morphed meshes)
  var DIRT_VERT_MAIN = [
    '{',
    '  vec4 mvdW = vec4(transformed, 1.0);',
    '  #ifdef USE_INSTANCING',
    '    mvdW = instanceMatrix * mvdW;',
    '  #endif',
    '  mvdW = modelMatrix * mvdW;',
    '  vDirtP = (uTruckInv * mvdW).xyz;',
    '  mat3 mvdR = mat3(uTruckInv[0].xyz, uTruckInv[1].xyz, uTruckInv[2].xyz) * mat3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz);',
    '  vDirtN = mvdR * objectNormal;',
    '}'
  ].join('\n');

  var DIRT_FRAG_PARS = [
    'uniform float uDirt;',
    'uniform vec3  uDirtColor;',
    'uniform float uDirtWet;',
    'uniform float uSeed;',
    'uniform float uDirtHeight;',
    'uniform vec4  uDirtBody;        // x: z of the body centre, y: half length, z: half width, w: unused',
    'uniform vec4  uDirtWheels[8];   // xyz wheel centre in the vehicle frame, w radius (0 = unused slot)',
    'varying vec3 vDirtP;',
    'varying vec3 vDirtN;',
    'float mvdHt = 0.0;              // thickness of the mud layer in metres (drives the bump)',
    'float mvdH(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }',
    'vec3 mvdH3(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }',
    'float mvdN(vec3 p){',
    '  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  float a = mvdH(i), b = mvdH(i + vec3(1.0,0.0,0.0)), c = mvdH(i + vec3(0.0,1.0,0.0)), d = mvdH(i + vec3(1.0,1.0,0.0));',
    '  float e = mvdH(i + vec3(0.0,0.0,1.0)), g = mvdH(i + vec3(1.0,0.0,1.0)), h = mvdH(i + vec3(0.0,1.0,1.0)), k = mvdH(i + vec3(1.0,1.0,1.0));',
    '  return mix(mix(mix(a,b,f.x), mix(c,d,f.x), f.y), mix(mix(e,g,f.x), mix(h,k,f.x), f.y), f.z);',
    '}',
    '// painted splat: one blob per cell, appears when k passes the cell threshold, then grows. returns (hard, soft)',
    'vec2 mvdSplat(vec3 q, float cs, float sd, float k){',
    '  vec3 g = q / cs; vec3 ci = floor(g); vec3 f = g - ci;',
    '  vec3 h = mvdH3(ci + sd);',
    '  vec3 h2 = mvdH3(ci * 1.91 + sd + 2.7);',
    '  float thr = mvdH(ci * 1.37 + sd + 5.17);',
    '  vec3 c = 0.30 + 0.40 * h;',
    '  float grow = smoothstep(thr, thr + 0.35, k);',
    '  float r = (0.10 + 0.14 * h2.z) * grow;',
    '  vec3 d = (f - c) * (0.72 + 0.56 * h2);',                             // random ellipse
    '  float dist = length(d) + (mvdN(q * 14.0 + sd) - 0.5) * 0.10 + (mvdN(q * 31.0 + sd) - 0.5) * 0.05;',
    '  float on = step(0.002, r);',
    '  return vec2((1.0 - smoothstep(r - 0.03, r + 0.012, dist)) * on, (1.0 - smoothstep(r - 0.16, r + 0.01, dist)) * on);',
    '}',
    'float mvdProx(vec3 p){',
    '  float best = 0.0;',
    '  for (int i = 0; i < 8; i++) {',
    '    vec4 w = uDirtWheels[i];',
    '    if (w.w > 0.0) {',
    '      vec3 d = p - w.xyz;',
    '      float back = -d.z / w.w;',
    '      float along = smoothstep(-1.1, 0.2, back) * (1.0 - smoothstep(0.9, 4.2, back));',
    '      float up = 1.0 - smoothstep(1.2, 3.6, p.y / w.w);',
    '      float lat = 1.0 - smoothstep(1.2, 3.2, abs(d.x) / w.w);',
    '      best = max(best, along * up * lat);',
    '    }',
    '  }',
    '  return best;',
    '}',
    'void mvdApply(inout vec3 col, inout float rough, inout float metal){',
    '  vec3 p = vDirtP;',
    '  vec3 n = normalize(vDirtN);',
    '  float H = max(uDirtHeight, 0.2);',
    '  float a = clamp(uDirt, 0.0, 1.0);',
    '  vec3 sd = vec3(uSeed * 7.31, uSeed * 3.17, uSeed * 5.53);',
    '  vec3 q = p + sd;',
    '  float zb = (uDirtBody.x - p.z) / max(uDirtBody.y, 0.2);',
    '  float rear = smoothstep(-0.1, 1.0, zb);',
    '  float prox = mvdProx(p);',
    '  // domain warped fbm: big painted continents with ragged edges',
    '  vec3 wv = vec3(mvdN(q * 1.7 + 3.1), mvdN(q * 1.7 + 7.7), mvdN(q * 1.7 + 11.3)) - 0.5;',
    '  vec3 qw = q + wv * 0.40;',
    '  float n1 = mvdN(qw * 2.1);',
    '  float n2 = mvdN(vec3(qw.x * 5.6, qw.y * 3.6, qw.z * 5.6) + 4.1);',
    '  float n3 = mvdN(vec3(qw.x * 15.0, qw.y * 4.6, qw.z * 15.0) + 9.2);',
    '  float fbm = n1 * 0.50 + n2 * 0.30 + n3 * 0.20;',
    '  float topFace = smoothstep(0.5, 0.95, n.y);',
    '  float hgt = 1.0 - smoothstep(0.22 * H, 1.0 * H, p.y);',
    '  float W = clamp(hgt * (0.78 + 0.22 * rear) + prox * 0.55 * (1.0 - smoothstep(0.7 * H, 1.5 * H, p.y)), 0.0, 1.0);',
    '  W *= 1.0 - 0.35 * topFace;',
    '  float P = a * W;',
    '  // 1. continents: threshold of (height weight + noise); rises with the dirt amount',
    '  float lowW = 1.0 - smoothstep(0.7 * H, 1.45 * H, p.y);',
    '  float Fv = W + (fbm - 0.5) * 1.15;',
    '  float thr = 1.0 - 0.86 * pow(a, 0.85);',
    '  float gate = smoothstep(0.0, 0.06, a);',
    '  float cov = smoothstep(thr, thr + 0.035, Fv) * gate * lowW;',
    '  float covSoft = smoothstep(thr - 0.01, thr + 0.12, Fv) * gate * lowW;',
    '  float depth = clamp((Fv - thr) * 2.0, 0.0, 1.0);',
    '  // 2. flung splats, big -> small',
    '  vec2 sp1 = mvdSplat(q, 0.80, 11.0, (P * 1.60 + 0.12 * gate) * lowW);',
    '  vec2 sp2 = mvdSplat(q + 17.0, 0.34, 23.0, (P * 1.50 + 0.12 * gate) * lowW);',
    '  vec2 sp3 = mvdSplat(q + 41.0, 0.14, 37.0, (P * 1.35 + 0.05 * gate) * lowW);',
    '  float spH = max(sp1.x, max(sp2.x, sp3.x));',
    '  float spS = max(sp1.y, max(sp2.y, sp3.y));',
    '  // 3. streaks running down and back from the wheel arches',
    '  float sv = mvdN(vec3(q.x * 9.0, q.y * 0.9, q.z * 9.0) + 3.3);',
    '  float sh = mvdN(vec3(q.x * 7.0, q.y * 9.0, q.z * 0.8) + 8.8);',
    '  float thrS = 0.76 - 0.26 * P;',
    '  float st = max(smoothstep(thrS, thrS + 0.025, sv), smoothstep(thrS, thrS + 0.025, sh));',
    '  st *= smoothstep(0.30, 0.55, P) * clamp(prox + 0.5 * rear + 0.2, 0.0, 1.0);',
    '  float M = max(cov, max(spH, st));',
    '  // thickness: thick in the middle of continents, thin at the edges and in small splats',
    '  float thick = clamp(max(depth, spH * 0.55 + 0.1 * st) + (n2 - 0.5) * 0.5, 0.0, 1.0);',
    '  mvdHt = max(covSoft, max(spS * 0.8, st * 0.6)) * (0.006 + 0.012 * thick) * gate;',
    '  // colour: dry = lighter and matte, wet = darker and glossy',
    '  float mvdPatch = mvdN(q * 3.1 + 21.0);',
    '  float mvdLum = dot(uDirtColor, vec3(0.30, 0.59, 0.11));',
    '  vec3 mvdBase = uDirtColor * (0.55 + 0.45 * smoothstep(0.15, 0.55, mvdLum));',
    '  vec3 dryC = mvdBase * (0.80 + 0.40 * thick) * (0.88 + 0.24 * mvdPatch);',
    '  vec3 wetC = mvdBase * (0.43 + 0.27 * thick) * (0.90 + 0.20 * mvdPatch);',
    '  vec3 mud = mix(dryC, wetC, uDirtWet);',
    '  mud *= 0.84 + 0.30 * smoothstep(0.0, 0.8 * H, p.y);',
    '  // thin film of grime on the lower body',
    '  float film = a * hgt * 0.30 * (1.0 - M);',
    '  col = mix(col, mix(col, mud, 0.55), film);',
    '  col = mix(col, mud, M * 0.97);',
    '  float glossy = mix(0.96, 0.30, uDirtWet * (0.55 + 0.45 * thick));',
    '  rough = mix(rough, glossy, clamp(M * 0.97 + film * 0.5, 0.0, 1.0));',
    '  metal = mix(metal, 0.0, M);',
    '}',
    'vec3 mvdBump(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir){',
    '  vec3 sx = dFdx(surfPos); vec3 sy = dFdy(surfPos);',
    '  vec3 r1 = cross(sy, surfNorm); vec3 r2 = cross(surfNorm, sx);',
    '  float det = dot(sx, r1) * faceDir;',
    '  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);',
    '  return normalize(abs(det) * surfNorm - grad);',
    '}'
  ].join('\n');

  var DIRT_FRAG_APPLY = 'if (uDirt > 0.002) { mvdApply(diffuseColor.rgb, roughnessFactor, metalnessFactor); }';
  var DIRT_FRAG_BUMP = 'if (uDirt > 0.002 && mvdHt > 0.0) { normal = mvdBump(-vViewPosition, normal, vec2(dFdx(mvdHt), dFdy(mvdHt)), faceDirection); }';

  function injectDirt(shader, u) {
    for (var k in u) {
      if (k.charAt(0) === 'u' && u[k] && u[k].value !== undefined) { shader.uniforms[k] = u[k]; }
    }
    var vs = shader.vertexShader, fs = shader.fragmentShader;
    if (vs.indexOf('#include <project_vertex>') < 0 || fs.indexOf('#include <metalnessmap_fragment>') < 0) { return; } // not a Standard-style shader
    shader.vertexShader = vs
      .replace('#include <common>', '#include <common>\n' + DIRT_VERT_PARS)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + DIRT_VERT_MAIN);
    shader.fragmentShader = fs
      .replace('#include <common>', '#include <common>\n' + DIRT_FRAG_PARS)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + DIRT_FRAG_APPLY)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + String.fromCharCode(10) + DIRT_FRAG_BUMP);
  }

  /**
   * makeDirtUniforms(opts?) -> object of {value} uniforms, ONE per vehicle (shared by all of its materials).
   *   opts.height : uDirtHeight, metres above the ground where the splatter fades out (default 1.4)
   *   opts.seed   : uSeed (default random)
   *   opts.bodyCenterZ / bodyHalfLength / bodyHalfWidth : vehicle frame (z forward). Used for the "rear" bias
   *                 (default 0 / 2.5 / 1.0). Pass the real numbers for best results.
   * Drive it with setDirtState(u, dirt01, colorHex, wetness01) each frame (or write the .value fields yourself).
   */
  function makeDirtUniforms(opts) {
    opts = opts || {};
    var wheels = [];
    for (var i = 0; i < 8; i++) { wheels.push(new THREE.Vector4(0, 0, 0, 0)); }
    return {
      uDirt: { value: 0 },
      uDirtColor: { value: new THREE.Color(0x5a3a22) },
      uDirtWet: { value: 0.5 },
      uTruckInv: { value: new THREE.Matrix4() },
      uSeed: { value: opts.seed !== undefined ? opts.seed : Math.random() * 50 },
      uDirtHeight: { value: opts.height || 1.4 },
      uDirtBody: { value: new THREE.Vector4(opts.bodyCenterZ || 0, opts.bodyHalfLength || 2.5, opts.bodyHalfWidth || 1.0, 0) },
      uDirtWheels: { value: wheels }
    };
  }

  /** setDirtState(u, dirt01, colorHex, wetness01): colorHex/wetness optional */
  function setDirtState(u, dirt, colorHex, wetness) {
    u.uDirt.value = clamp01(dirt);
    if (colorHex !== undefined) { u.uDirtColor.value.setHex(colorHex); }
    if (wetness !== undefined) { u.uDirtWet.value = clamp01(wetness); }
  }

  var _v3a = new THREE.Vector3(), _m4a = new THREE.Matrix4();
  /**
   * setDirtWheels(u, root, wheelObjects, radii)
   *   Tells the dirt shader where the wheels are (stronger splatter behind and above them).
   *   wheelObjects: up to 8 Object3D (the wheel groups), radii: a number or an array (default 0.5).
   *   Positions are taken from the objects' world matrices relative to root, so call it once after the
   *   vehicle is built (wheel positions in the vehicle frame do not change when only the spin changes).
   */
  function setDirtWheels(u, root, wheelObjects, radii) {
    root.updateWorldMatrix(true, true);
    _m4a.copy(root.matrixWorld).invert();
    for (var i = 0; i < 8; i++) {
      var w = u.uDirtWheels.value[i];
      if (wheelObjects && i < wheelObjects.length) {
        _v3a.setFromMatrixPosition(wheelObjects[i].matrixWorld).applyMatrix4(_m4a);
        var r = (typeof radii === 'number') ? radii : (radii && radii[i] !== undefined ? radii[i] : 0.5);
        w.set(_v3a.x, _v3a.y, _v3a.z, r);
      } else { w.set(0, 0, 0, 0); }
    }
  }

  var _anySet = (typeof WeakSet !== 'undefined');
  var patchedMaterials = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;  // material -> dirtUniforms it was patched for

  function ancestorNoDirt(obj, root) {
    for (var o = obj; o; o = o.parent) {
      if (o.userData && o.userData.noDirt) { return true; }
      if (o === root) { break; }
    }
    return false;
  }

  function materialEligible(m) {
    if (!m || !m.isMeshStandardMaterial) { return false; }
    if (m.transparent === true) { return false; }                       // glass
    if (m.userData && m.userData.noDirt) { return false; }
    if (m.emissive && m.emissiveIntensity > 0) {                         // lamps stay clean
      var e = m.emissive; if ((e.r + e.g + e.b) * m.emissiveIntensity > 0.15) { return false; }
    }
    return true;
  }

  function patchMaterialDirt(mat, u) {
    var prev = mat.onBeforeCompile;
    var prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.call(mat) : '';
    var wrapper = function (shader, renderer) {
      if (typeof prev === 'function') { prev.call(this, shader, renderer); }
      injectDirt(shader, u);
    };
    wrapper.__mvDirt = true; wrapper.__mvU = u; wrapper.__mvPrev = prev;
    mat.onBeforeCompile = wrapper;
    mat.customProgramCacheKey = function () { return 'mvdirt1|' + prevKey; };
    mat.needsUpdate = true;
    if (patchedMaterials) { patchedMaterials.set(mat, u); }
    MV.stats.dirtWraps++;
  }

  function isPatchedFor(mat, u) {
    var f = mat.onBeforeCompile;
    return !!(f && f.__mvDirt && f.__mvU === u);
  }
  function isPatchedAny(mat) {
    var f = mat.onBeforeCompile;
    return !!(f && f.__mvDirt);
  }

  // keep uTruckInv exact: refresh it right before each patched mesh is drawn (no 1-frame lag)
  function hookMesh(mesh, u, root) {
    var cur = mesh.onBeforeRender;
    if (cur && cur.__mvHook && cur.__mvU === u) { return; }
    var base = (cur && cur.__mvHook) ? cur.__mvPrev : cur;
    var last = u.__mvLast || (u.__mvLast = new Float32Array(16).fill(NaN));
    var hook = function (renderer, scene, camera, geometry, material, group) {
      var e = root.matrixWorld.elements, same = true;
      for (var i = 0; i < 16; i++) { if (e[i] !== last[i]) { same = false; break; } }
      if (!same) { for (var j = 0; j < 16; j++) { last[j] = e[j]; } u.uTruckInv.value.copy(root.matrixWorld).invert(); }
      if (base) { base.call(this, renderer, scene, camera, geometry, material, group); }
    };
    hook.__mvHook = true; hook.__mvU = u; hook.__mvPrev = base;
    mesh.onBeforeRender = hook;
  }

  /**
   * patchVehicleDirt(root, dirtUniforms, opts?)
   *   Traverses all Meshes under `root` and patches their MeshStandardMaterial/MeshPhysicalMaterial (also
   *   material arrays) so that the albedo/roughness/metalness blend towards uDirtColor in a splatter mask
   *   computed from the fragment's position in the vehicle frame (inverse of root.matrixWorld, y up, z forward).
   *
   *   Skipped: meshes with userData.noDirt (on the mesh or on ANY ancestor up to root, e.g. flag the wheel
   *   spinGroup), materials with userData.noDirt, transparent materials (glass), strongly emissive materials
   *   (lamps), non-Standard materials (Basic/Lambert/Phong/Shader).
   *   IMPORTANT: flag the wheels (userData.noDirt = true on every wheel spinGroup) - the mask is fixed in the
   *   vehicle frame and would look like it slides over a rotating tyre. Mud shells are flagged automatically.
   *
   *   Idempotent and safe to call again:
   *     - already patched materials (same uniforms) are left alone (one onBeforeCompile wrapper only),
   *     - so a later call after an async GLB load only patches the new materials,
   *     - a material that is patched for ANOTHER vehicle (Group.clone() shares materials!) or that is also used by a
   *       noDirt mesh is cloned for this vehicle (mesh.material is replaced by the clone; clones are cached per call),
   *     - an existing onBeforeCompile (from other modules) is chained, not replaced.
   *   Returns { patched, already, skipped, cloned } counts (materials).
   *   Per-vehicle per-frame work: setDirtState(...) only; uTruckInv is refreshed automatically right before
   *   each patched mesh is drawn (opts.manualMatrix = true disables that, then write u.uTruckInv.value yourself).
   */
  function patchVehicleDirt(root, u, opts) {
    opts = opts || {};
    var res = { patched: 0, already: 0, skipped: 0, cloned: 0 };
    if (!root || !u) { return res; }
    root.updateWorldMatrix(true, true);
    // materials also used by meshes that must stay clean
    var cleanUsers = new Set();
    root.traverse(function (o) {
      if (o.isMesh && ancestorNoDirt(o, root)) {
        var ms = Array.isArray(o.material) ? o.material : [o.material];
        for (var i = 0; i < ms.length; i++) { if (ms[i]) { cleanUsers.add(ms[i]); } }
      }
    });
    var cloneMap = new Map(), seen = new Set();
    root.traverse(function (o) {
      if (!o.isMesh || !o.material) { return; }
      if (ancestorNoDirt(o, root)) { res.skipped++; return; }
      var multi = Array.isArray(o.material);
      var list = multi ? o.material : [o.material];
      var any = false;
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (!materialEligible(m)) { if (m && !seen.has(m)) { seen.add(m); res.skipped++; } continue; }
        var needClone = (isPatchedAny(m) && !isPatchedFor(m, u)) || cleanUsers.has(m);
        if (needClone) {
          var c = cloneMap.get(m);
          if (!c) { c = m.clone(); cloneMap.set(m, c); res.cloned++; MV.stats.dirtClones++; patchMaterialDirt(c, u); res.patched++; }
          list[i] = c; m = c;
        } else if (isPatchedFor(m, u)) {
          if (!seen.has(m)) { seen.add(m); res.already++; }
        } else {
          patchMaterialDirt(m, u); seen.add(m); res.patched++;
        }
        any = true;
      }
      if (!multi) { o.material = list[0]; }
      if (any && !opts.manualMatrix) { hookMesh(o, u, root); }
    });
    u.__mvRoot = root;
    return res;
  }

  /* =========================================================================
   * 3. MUD FLING  (pooled instanced clods)
   * ========================================================================= */

  var flingGeo = null;
  function getFlingGeometry() {
    if (flingGeo) { return flingGeo; }
    var g = new THREE.IcosahedronGeometry(1, 0);             // 20 flat faces, non-indexed
    var p = g.attributes.position, map = {}, i, key, j;
    var seed = 7;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (i = 0; i < p.count; i++) {
      key = p.getX(i).toFixed(3) + ',' + p.getY(i).toFixed(3) + ',' + p.getZ(i).toFixed(3);
      if (!map[key]) { map[key] = { s: 0.74 + rnd() * 0.40, dx: (rnd() - 0.5) * 0.18, dy: (rnd() - 0.5) * 0.18, dz: (rnd() - 0.5) * 0.18 }; }
      j = map[key];
      p.setXYZ(i, (p.getX(i) * j.s + j.dx) * 1.0, (p.getY(i) * j.s + j.dy) * 0.80, (p.getZ(i) * j.s + j.dz) * 1.0);   // slightly squashed
    }
    g.computeVertexNormals();                                 // non-indexed -> flat face normals
    g.computeBoundingSphere();
    flingGeo = g;
    return g;
  }

  var KIND = {
    clod: { id: 0, color: 0x5a3a22, tone: 1.0, size: 0.10, drag: 0.15, grav: 1.0, spin: 10, life: [3.5, 6.0], flat: 0.30, spread: 1.9, gloss: 0.05, jitter: 0.12, grow: 0 },
    wet:  { id: 1, color: 0x4a3b2a, tone: 0.85, size: 0.05, drag: 0.06, grav: 1.0, spin: 0,  life: [2.5, 4.0], flat: 0.12, spread: 2.4, gloss: 0.85, jitter: 0.10, grow: 0 },
    snow: { id: 2, color: 0xeef3f8, tone: 1.0, size: 0.12, drag: 2.2,  grav: 0.45, spin: 3, life: [1.2, 2.2], flat: 0.45, spread: 1.7, gloss: 0.0,  jitter: 0.05, grow: 0.9 },
    sand: { id: 3, color: 0xc79a5b, tone: 1.0, size: 0.04, drag: 1.5,  grav: 0.9,  spin: 5, life: [0.8, 1.6], flat: 0.35, spread: 1.6, gloss: 0.0,  jitter: 0.08, grow: 0 }
  };
  var KIND_LIST = [KIND.clod, KIND.wet, KIND.snow, KIND.sand];
  var KIND_NAMES = ['clod', 'wet', 'snow', 'sand'];

  var ST = 26;      // floats per particle
  var O_X = 0, O_VX = 3, O_Q = 6, O_W = 10, O_SIZE = 13, O_KIND = 14, O_AGE = 15, O_LIFE = 16, O_STATE = 17,
      O_T = 18, O_SX = 19, O_SY = 20, O_SZ = 21, O_GY = 22, O_NX = 23, O_AX = 24;
  // layout: pos(3) vel(3) quat(4) angvel(3) size kind age life state tland sx sy sz groundY, nx(2 slots used for terrain normal xz), spare

  /**
   * createMudFling(scene, opts?) -> { spawn, update, setLandCallback, count, mesh, clear, dispose }
   *   opts.count      : pool size (default 480)
   *   opts.getHeight  : function(x, z) -> ground height (default: flat 0)
   *   opts.landCallback : function(x, z, size, colorHex), called once when a clod hits the ground
   *   opts.castShadow : bool (default false)
   *   opts.maxDt      : clamp for update dt (default 0.05)
   * spawn(kind, x, y, z, vx, vy, vz, size, colorHex?)
   *   kind: 'clod' | 'wet' | 'snow' | 'sand';  v in m/s (world);  size ~ radius of the blob in metres
   *   (defaults: clod 0.10, wet 0.05, snow 0.12, sand 0.04; pass size 0/undefined for the default);
   *   colorHex optional (default per kind). Returns true if spawned. When the pool is full the oldest splat is reused.
   * update(dt): one call per frame; loops over live instances only (0 live -> mesh hidden, no draw call).
   * count: live instances (getter).
   */
  function createMudFling(scene, opts) {
    opts = opts || {};
    var N = opts.count || 480;
    var getHeight = opts.getHeight || function () { return 0; };
    var landCb = opts.landCallback || null;
    var maxDt = opts.maxDt || 0.05;

    var geo = getFlingGeometry().clone();
    var gloss = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
    gloss.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aGloss', gloss);

    var mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0.0 });
    mat.customProgramCacheKey = function () { return 'mudFling1'; };
    mat.onBeforeCompile = function (shader) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aGloss;\nvarying float vGloss;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGloss = aGloss;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGloss;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.20, vGloss);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vec3(0.20, 0.19, 0.24);');   // lifted, slightly cool shadows
    };

    var mesh = new THREE.InstancedMesh(geo, mat, N);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.castShadow = !!opts.castShadow;
    mesh.receiveShadow = false;
    mesh.name = 'mudFling';
    mesh.userData.noDirt = true;
    if (scene) { scene.add(mesh); }

    var S = new Float32Array(N * ST);
    var M = mesh.instanceMatrix.array, C = mesh.instanceColor.array, G = gloss.array;
    var live = 0;
    var tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpCol = new THREE.Color();
    var UP = new THREE.Vector3(0, 1, 0);
    var seedR = 12345;
    function rnd() { seedR = (seedR * 16807) % 2147483647; return seedR / 2147483647; }

    function kill(i) {
      live--;
      if (i !== live) {
        var a = i * ST, b = live * ST;
        for (var k = 0; k < ST; k++) { S[a + k] = S[b + k]; }
        C[i * 3] = C[live * 3]; C[i * 3 + 1] = C[live * 3 + 1]; C[i * 3 + 2] = C[live * 3 + 2];
        G[i] = G[live];
      }
    }

    function spawn(kindName, x, y, z, vx, vy, vz, size, colorHex) {
      var kd = KIND[kindName] || KIND.clod;
      if (live >= N) {                                       // pool full: recycle the oldest splat, else the oldest flyer
        var best = -1, bestAge = -1, i;
        for (i = 0; i < live; i++) {
          var o = i * ST;
          var score = (S[o + O_STATE] === 1 ? 1000 : 0) + S[o + O_AGE];
          if (score > bestAge) { bestAge = score; best = i; }
        }
        kill(best < 0 ? 0 : best);
      }
      var o2 = live * ST, id = live;
      live++;
      var sz = (size > 0 ? size : kd.size);
      S[o2] = x; S[o2 + 1] = y; S[o2 + 2] = z;
      S[o2 + 3] = vx; S[o2 + 4] = vy; S[o2 + 5] = vz;
      // random orientation
      tmpQ.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5 + 1e-3).normalize();
      S[o2 + 6] = tmpQ.x; S[o2 + 7] = tmpQ.y; S[o2 + 8] = tmpQ.z; S[o2 + 9] = tmpQ.w;
      var sp = kd.spin * (0.5 + rnd());
      tmpV.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar(sp);
      S[o2 + 10] = tmpV.x; S[o2 + 11] = tmpV.y; S[o2 + 12] = tmpV.z;
      S[o2 + O_SIZE] = sz; S[o2 + O_KIND] = kd.id; S[o2 + O_AGE] = 0;
      S[o2 + O_LIFE] = kd.life[0] + (kd.life[1] - kd.life[0]) * rnd();
      S[o2 + O_STATE] = 0; S[o2 + O_T] = 0;
      S[o2 + O_SX] = 0.85 + rnd() * 0.40; S[o2 + O_SY] = 0.75 + rnd() * 0.40; S[o2 + O_SZ] = 0.85 + rnd() * 0.40;
      S[o2 + O_GY] = 0;
      // colour (+-10 % brightness for a hand painted look)
      var hx = (colorHex !== undefined ? colorHex : kd.color);
      tmpCol.setHex(hx);
      var br = (0.92 + rnd() * 0.18) * soilScale(tmpCol) * kd.tone;
      C[id * 3] = Math.min(1, tmpCol.r * br); C[id * 3 + 1] = Math.min(1, tmpCol.g * br); C[id * 3 + 2] = Math.min(1, tmpCol.b * br);
      S[o2 + O_AX] = hx;   // original soil colour for the land callback
      G[id] = kd.gloss;
      return true;
    }

    function land(o, kd) {
      var x = S[o], z = S[o + 2];
      var gy = getHeight(x, z);
      S[o + 1] = gy + 0.004;
      S[o + O_GY] = gy;
      S[o + O_STATE] = 1; S[o + O_T] = 0;
      // orientation: flat on the ground, tilted to the terrain normal, random yaw
      var e = 0.35;
      var hx = getHeight(x + e, z) - getHeight(x - e, z), hz = getHeight(x, z + e) - getHeight(x, z - e);
      tmpV.set(-hx, 2 * e, -hz).normalize();
      tmpQ.setFromUnitVectors(UP, tmpV);
      tmpQ2.setFromAxisAngle(UP, rnd() * 6.2831853);
      tmpQ.multiply(tmpQ2);
      S[o + 6] = tmpQ.x; S[o + 7] = tmpQ.y; S[o + 8] = tmpQ.z; S[o + 9] = tmpQ.w;
      S[o + 3] = 0; S[o + 4] = 0; S[o + 5] = 0;
      if (landCb) { landCb(x, z, S[o + O_SIZE], S[o + O_AX] | 0); }
    }

    function update(dt) {
      if (dt > maxDt) { dt = maxDt; }
      if (dt <= 0) { return; }
      var i = 0, o, kd, st, sz, sx, sy, sc, vx, vy, vz, t, age, life, k;
      while (i < live) {
        o = i * ST;
        kd = KIND_LIST[S[o + O_KIND] | 0];
        sz = S[o + O_SIZE];
        age = S[o + O_AGE] += dt;
        life = S[o + O_LIFE];
        if (S[o + O_STATE] === 0) {
          // ---- flight ----
          vx = S[o + 3]; vy = S[o + 4]; vz = S[o + 5];
          k = 1 - kd.drag * dt; if (k < 0) { k = 0; }
          vx *= k; vy *= k; vz *= k;
          vy -= 9.81 * kd.grav * dt;
          var nx = S[o] + vx * dt, ny = S[o + 1] + vy * dt, nz = S[o + 2] + vz * dt;
          S[o + 3] = vx; S[o + 4] = vy; S[o + 5] = vz;
          S[o] = nx; S[o + 1] = ny; S[o + 2] = nz;
          sc = sz * (1 + kd.grow * Math.min(age, 1.2) * 0.7);          // snow puffs expand
          sx = sc * S[o + O_SX]; sy = sc * S[o + O_SY]; var szz = sc * S[o + O_SZ];
          var gy = getHeight(nx, nz);
          if (ny - sy * 0.55 <= gy) {
            land(o, kd);
            st = 1;
          } else if (age > life + 8 || ny < -50) {
            kill(i); continue;
          }
          if (S[o + O_STATE] === 0) {
            if (kd.id === 1) {                                          // liquid: stretched along the velocity
              var sp = Math.sqrt(vx * vx + vy * vy + vz * vz) + 1e-4;
              var dx = vx / sp, dy = vy / sp, dz = vz / sp;
              // basis: z = dir, x = normalize(up x z), y = z x x
              var bx = dz, by = 0, bz = -dx;                             // up(0,1,0) x dir = (dz, 0, -dx)
              var bl = Math.sqrt(bx * bx + bz * bz);
              if (bl < 1e-4) { bx = 1; bz = 0; bl = 1; }
              bx /= bl; bz /= bl;
              var cx = dy * bz - dz * by, cy = dz * bx - dx * bz, cz = dx * by - dy * bx;   // dir x b
              var st2 = 1 + Math.min(sp * 0.06, 1.4);
              var ox = o + 0;
              var mo = i * 16;
              M[mo] = bx * sx; M[mo + 1] = by * sx; M[mo + 2] = bz * sx; M[mo + 3] = 0;
              M[mo + 4] = cx * sy; M[mo + 5] = cy * sy; M[mo + 6] = cz * sy; M[mo + 7] = 0;
              M[mo + 8] = dx * szz * st2; M[mo + 9] = dy * szz * st2; M[mo + 10] = dz * szz * st2; M[mo + 11] = 0;
              M[mo + 12] = nx; M[mo + 13] = ny; M[mo + 14] = nz; M[mo + 15] = 1;
              i++; continue;
            }
            // tumble: q += 0.5 dt (w * q)
            var qx = S[o + 6], qy = S[o + 7], qz = S[o + 8], qw = S[o + 9];
            var wx = S[o + 10], wy = S[o + 11], wz = S[o + 12];
            var h = 0.5 * dt;
            var dqx = h * (wx * qw + wy * qz - wz * qy);
            var dqy = h * (wy * qw + wz * qx - wx * qz);
            var dqz = h * (wz * qw + wx * qy - wy * qx);
            var dqw = h * (-wx * qx - wy * qy - wz * qz);
            qx += dqx; qy += dqy; qz += dqz; qw += dqw;
            var ql = 1 / Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
            qx *= ql; qy *= ql; qz *= ql; qw *= ql;
            S[o + 6] = qx; S[o + 7] = qy; S[o + 8] = qz; S[o + 9] = qw;
            writeQuatMatrix(M, i * 16, qx, qy, qz, qw, sx, sy, szz, nx, ny, nz);
            i++; continue;
          }
          // landed this frame: fall through to the splat branch below
        }
        // ---- splat on the ground ----
        t = S[o + O_T] += dt;
        var qx2 = S[o + 6], qy2 = S[o + 7], qz2 = S[o + 8], qw2 = S[o + 9];
        var fl = 1 + kd.grow * 0.5;
        var squash = 1 - Math.exp(-t * 28);                              // fast flattening
        var spread = kd.spread * (kd.id === 1 ? (1 + 0.8 * (1 - Math.exp(-t * 9))) : 1);
        var flatY = kd.flat;
        var csz = sz * fl;
        var sxx = csz * (S[o + O_SX] + (spread * S[o + O_SX] - S[o + O_SX]) * squash);
        var syy = csz * (S[o + O_SY] + (flatY * S[o + O_SY] - S[o + O_SY]) * squash);
        var szz2 = csz * (S[o + O_SZ] + (spread * S[o + O_SZ] - S[o + O_SZ]) * squash);
        // fade: shrink during the last 45 % of the life, and the sand/snow disperse faster
        var f = t / life;
        if (f >= 1) { kill(i); continue; }
        var shrink = f > 0.55 ? 1 - ((f - 0.55) / 0.45) : 1;
        shrink = shrink * shrink * (3 - 2 * shrink);
        sxx *= shrink; syy *= shrink; szz2 *= shrink;
        // the squashed blob sits on the ground
        writeQuatMatrix(M, i * 16, qx2, qy2, qz2, qw2, sxx, syy, szz2, S[o], S[o + O_GY] + 0.004 + syy * 0.35, S[o + 2]);
        i++;
      }
      mesh.count = live;
      mesh.visible = live > 0;
      if (live > 0) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
        gloss.needsUpdate = true;
      }
    }

    function writeQuatMatrix(m, mo, x, y, z, w, sx, sy, sz, px, py, pz) {
      var x2 = x + x, y2 = y + y, z2 = z + z;
      var xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
      m[mo] = (1 - (yy + zz)) * sx; m[mo + 1] = (xy + wz) * sx; m[mo + 2] = (xz - wy) * sx; m[mo + 3] = 0;
      m[mo + 4] = (xy - wz) * sy; m[mo + 5] = (1 - (xx + zz)) * sy; m[mo + 6] = (yz + wx) * sy; m[mo + 7] = 0;
      m[mo + 8] = (xz + wy) * sz; m[mo + 9] = (yz - wx) * sz; m[mo + 10] = (1 - (xx + yy)) * sz; m[mo + 11] = 0;
      m[mo + 12] = px; m[mo + 13] = py; m[mo + 14] = pz; m[mo + 15] = 1;
    }

    var api = {
      spawn: spawn,
      update: update,
      setLandCallback: function (fn) { landCb = fn || null; },
      setGetHeight: function (fn) { getHeight = fn || function () { return 0; }; },
      clear: function () { live = 0; mesh.count = 0; mesh.visible = false; },
      dispose: function () { if (mesh.parent) { mesh.parent.remove(mesh); } geo.dispose(); mat.dispose(); },
      mesh: mesh,
      capacity: N,
      kinds: KIND_NAMES.slice()
    };
    Object.defineProperty(api, 'count', { get: function () { return live; }, enumerable: true });
    return api;
  }

  /* ------------------------------------------------------------------------- */
  global.createMudShell = createMudShell;
  global.makeDirtUniforms = makeDirtUniforms;
  global.patchVehicleDirt = patchVehicleDirt;
  global.setDirtState = setDirtState;
  global.setDirtWheels = setDirtWheels;
  global.createMudFling = createMudFling;
  MV.createMudShell = createMudShell; MV.makeDirtUniforms = makeDirtUniforms; MV.patchVehicleDirt = patchVehicleDirt;
  MV.setDirtState = setDirtState; MV.setDirtWheels = setDirtWheels; MV.createMudFling = createMudFling;
  MV.KINDS = KIND;
})(typeof window !== 'undefined' ? window : this);
