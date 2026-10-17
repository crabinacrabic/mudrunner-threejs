/* ============================================================================
   look.js  --  "Over the Hill" look module (sky, fog, lighting, post-processing)
   three.js r128, plain classic script, no modules, no external files.

   Globals defined (everything else lives inside this IIFE):
     createSkyDome(opts)                       -> { mesh, update(camera, sunDir), uniforms, ... }
     createPostFX(renderer, scene, camera, o)  -> { render(), setSize(w,h,pr), params, enabled, dispose(), ... }
     OVER_THE_HILL_LOOK                        -> tuned constants (display-space colours, light numbers, post params)
     applyLook(scene, renderer, lights, look, skyDome)
     OTHLook                                   -> small namespace: installFogGradient(), restoreFog(), neutralPost(), ...

   Colour-space contract (r128, outputEncoding = LinearEncoding, kept):
     every colour in this file is a raw "display" colour exactly as the game authors them (THREE.Color(0xRRGGBB)
     has no colour management in r128).  Tone mapping stays where it is today: inside every standard material
     (renderer.toneMapping = ACESFilmic, renderer.toneMappingExposure), applied BEFORE fog.  The post pipeline
     therefore renders the scene into a half-float target WITHOUT touching renderer.toneMapping and does NOT tone-map
     again in the composite: tone mapping happens exactly once, in the materials, so postFX on / postFX off give the
     same image (bloom 0, neutral grade).  See createPostFX for the verified r128 facts.
   ============================================================================ */
(function (global) {
  'use strict';
  var THREE = global.THREE;
  if (!THREE) { throw new Error('look.js: THREE (r128) must be loaded first'); }

  /* ------------------------------------------------------------------------
     0. Constants
     ------------------------------------------------------------------------ */
  var OVER_THE_HILL_LOOK = {
    name: 'over-the-hill',
    /* Display-space colours (what you see on screen). */
    sky: {
      zenith:   0x74b9ee,   // pale cyan-blue
      mid:      0xb3d9f6,   // very pale blue between zenith and the pink band
      horizon:  0xf2dcc8,   // soft pink/peach band; MUST equal fog.color (applyLook keeps them equal)
      sunColor: 0xffe7b0,
      sunIntensity: 1.35,   // >1 on purpose: HDR core, feeds the bloom (clips to pale yellow-white without post)
      sunSize: 0.036,       // angular radius of the disc, radians (~2 deg)
      haloColor: 0xffc9b0,
      haloStrength: 0.62,
      glowColor: 0xffb9a0,  // low horizon glow on the sun side
      glowStrength: 0.20,
      mountains: {
        enabled: true,
        far:  0xc7aed0,     // lavender-pink, low contrast
        mid:  0xb596c4,
        near: 0x9a80b4,
        height: 1.0,        // multiplier on ridge heights
        haze: 0.34          // 0..1: how much the colours are pulled toward the horizon colour
      }
    },
    fog: {
      color:      0xf2dcc8, // far / horizon colour (== sky.horizon)
      nearColor:  0xf8d2a6, // warm peach used for thin haze (compile-time constant of the patched fog chunk)
      density:    0.0072,   // FogExp2 (game was 0.0055)
      gradient:   true,     // patch THREE.ShaderChunk.fog_fragment with the two-colour depth gradient
      gradientEnd: 0.80     // fog factor at which the gradient reaches the far colour
    },
    background: 0xf2dcc8,
    hemi: { sky: 0x9db4ff, ground: 0xd4a0a6, intensity: 0.68 },
    sun: {
      color: 0xffc27f, intensity: 2.30,
      azimuthDeg: 126,      // same side as the game's (48,75,-35)
      elevationDeg: 28,     // golden hour (game: 51.6)
      distance: 96,         // from sun.target (keeps the game's shadow camera near/far valid)
      shadow: { bias: -0.0005, normalBias: 0.035 }
    },
    fill: { color: 0xb6b4ff, intensity: 0.36, elevationDeg: 32 },   // opposite azimuth, cool lavender
    exposure: 1.02,
    toneMapping: 'ACESFilmic',
    /* Post parameters (display-space grade). Applied to the active postFX by applyLook(). */
    post: {
      exposure: 1.02,       // = renderer.toneMappingExposure (material-side, tone mapped once)
      bloomStrength: 0.30,
      bloomThreshold: 0.92,
      bloomKnee: 0.35,
      bloomRadius: 0.72,    // 0..1 scatter: larger = wider, softer glow
      bloomTint: 0xffe2c4,
      saturation: 1.14,
      contrast: 1.10,
      gain: 1.0,
      shadowTint: 0xc4baff,     // multiplies the darks (cool lavender)
      highlightTint: 0xfff0d8,  // multiplies the brights (warm)
      shadowSplit: 0.22,        // 0..1 how far the darks are pulled to the shadow tint hue
      highlightSplit: 0.15,
      lift: 0x100c20,           // lifted blacks (lavender, never black)
      vignette: 0.12,
      vignetteTint: 0xc9bcc4,
      grain: 0.012,
      dither: 1.0
    }
  };

  var LUMA = new THREE.Vector3(0.2126, 0.7152, 0.0722);

  function toColor(v, target) {
    var c = target || new THREE.Color();
    if (v && v.isColor) c.copy(v); else c.set(v);
    return c;
  }
  function merge(dst, src) {
    if (!src) return dst;
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      var s = src[k];
      if (s && typeof s === 'object' && !s.isColor && !s.isVector3 && !Array.isArray(s)) {
        if (!dst[k] || typeof dst[k] !== 'object') dst[k] = {};
        merge(dst[k], s);
      } else dst[k] = s;
    }
    return dst;
  }
  function clone(o) { return merge({}, o); }

  /* ------------------------------------------------------------------------
     1. Fog chunk override (reversible)
        r128 facts: every built-in material (Basic/Lambert/Phong/Standard/Physical/Toon/Matcap/Points/Line/Sprite)
        and every custom shader that writes #include <fog_fragment> compiles THREE.ShaderChunk.fog_fragment at
        program-compile time.  The uniforms (fogColor, fogDensity | fogNear/fogFar) and the varying (fogDepth)
        are unchanged, so this works for all of them.  Programs that were compiled earlier keep the old chunk
        (the program cache key does not include chunk text) -> install BEFORE the first render.
     ------------------------------------------------------------------------ */
  var fogOriginal = null;
  var fogInstalled = null;

  function f4(x) { return (Math.round(x * 10000) / 10000).toFixed(4); }

  function installFogGradient(o) {
    o = o || {};
    var near = toColor(o.nearColor !== undefined ? o.nearColor : OVER_THE_HILL_LOOK.fog.nearColor);
    var end = o.gradientEnd !== undefined ? o.gradientEnd : OVER_THE_HILL_LOOK.fog.gradientEnd;
    if (fogOriginal === null) fogOriginal = THREE.ShaderChunk.fog_fragment;
    var chunk = [
      '#ifdef USE_FOG',
      '  #ifdef FOG_EXP2',
      '    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogDepth * fogDepth );',
      '  #else',
      '    float fogFactor = smoothstep( fogNear, fogFar, fogDepth );',
      '  #endif',
      '  // [OTHLook] two-colour depth gradient: warm peach thin haze -> fogColor (= sky horizon) at full fog',
      '  vec3 othFogCol = mix( vec3( ' + f4(near.r) + ', ' + f4(near.g) + ', ' + f4(near.b) + ' ), fogColor, smoothstep( 0.0, ' + f4(Math.max(0.05, end)) + ', fogFactor ) );',
      '  gl_FragColor.rgb = mix( gl_FragColor.rgb, othFogCol, fogFactor );',
      '#endif',
      ''
    ].join('\n');
    THREE.ShaderChunk.fog_fragment = chunk;
    fogInstalled = chunk;
    return chunk;
  }
  function restoreFog() {
    if (fogOriginal !== null) THREE.ShaderChunk.fog_fragment = fogOriginal;
    fogInstalled = null;
  }

  /* ------------------------------------------------------------------------
     2. Sky dome
     ------------------------------------------------------------------------ */
  var SKY_VS = [
    'varying vec3 vDir;',
    'void main() {',
    '  vDir = position;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );',
    '}'
  ].join('\n');

  var SKY_FS = [
    'uniform vec3 uZenith; uniform vec3 uMid; uniform vec3 uHorizon;',
    'uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunIntensity; uniform float uSunSize;',
    'uniform vec3 uHaloColor; uniform float uHaloStrength;',
    'uniform vec3 uGlowColor; uniform float uGlowStrength;',
    'uniform float uMtn; uniform float uMtnHeight; uniform float uMtnHaze;',
    'uniform vec3 uMtnFar; uniform vec3 uMtnMid; uniform vec3 uMtnNear;',
    'uniform float uDither; uniform float uAA;',
    'varying vec3 vDir;',
    '',
    'float hash21( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }',
    'float vnoise( vec2 p ) {',
    '  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );',
    '  return mix( mix( hash21( i ), hash21( i + vec2( 1.0, 0.0 ) ), f.x ), mix( hash21( i + vec2( 0.0, 1.0 ) ), hash21( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );',
    '}',
    'float ridged( vec2 p ) { float n = vnoise( p ); return 1.0 - abs( 2.0 * n - 1.0 ); }',
    '// mountain profile 0..1 around the full circle (noise sampled on a circle -> seamless wrap)',
    'float profile( vec2 c, float freq, float seed ) {',
    '  vec2 p = c * freq + seed;',
    '  float a = ridged( p ) * 0.58 + ridged( p * 2.17 + 7.0 ) * 0.27 + ridged( p * 4.9 + 3.0 ) * 0.15;',
    '  return pow( a, 1.6 ) * 1.55;',
    '}',
    'float ign( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }',
    '',
    '// one mountain layer composited over col',
    'vec3 mtnLayer( vec3 col, vec3 horizon, vec3 mcol, float h, vec2 c, float az, float sunAz, float freq, float seed, float base, float amp, float contrast, float aa ) {',
    '  float s0 = profile( c, freq, seed );',
    '  float top = base + amp * uMtnHeight * s0;',
    '  float mask = 1.0 - smoothstep( top - aa, top + aa, h );',
    '  if ( mask <= 0.0 ) return col;',
    '  // faceted light: slope of the ridge profile relative to the sun azimuth (faces turned to the sun are warm and light)',
    '  float e = 0.11;',
    '  float sp = ( profile( vec2( cos( az + e ), sin( az + e ) ), freq, seed ) - profile( vec2( cos( az - e ), sin( az - e ) ), freq, seed ) ) / ( 2.0 * e );',
    '  float side = sign( sin( sunAz - az ) );',
    '  float up = clamp( ( h - base ) / max( top - base, 0.001 ), 0.0, 1.0 );',
    '  // facet lines run parallel to the local silhouette slope (sheared coordinate), not as vertical curtains',
    '  float ds = amp * uMtnHeight * sp;',
    '  float k = sign( ds ) * 1.5 * smoothstep( 0.02, 0.22, abs( ds ) );',
    '  float u = az - ( h - base ) * k;',
    '  float gul = vnoise( vec2( u * freq * 4.2, seed + 1.7 ) ) - 0.5;',
    '  float lit = smoothstep( -0.10, 0.10, - sp * side * 0.10 + gul * 1.5 + ( up - 0.5 ) * 0.30 );',
    '  vec3 shade = mcol * vec3( 0.82, 0.78, 0.96 );',
    '  vec3 sunny = mix( mcol, uGlowColor, 0.38 ) * 1.06;',
    '  vec3 mc = mix( shade, sunny, lit );',
    '  // snow-ish pale caps on the highest parts',
    '  mc = mix( mc, mix( sunny, vec3( 1.0, 0.93, 0.95 ), 0.55 ), smoothstep( 0.78, 0.98, up ) * 0.55 * contrast );',
    '  // atmospheric perspective: hazier toward the base and for far ranges (colour pulled to the horizon colour == fog)',
    '  float haze = clamp( uMtnHaze * ( 1.15 - contrast * 0.75 ) + ( 1.0 - up ) * 0.38 * ( 1.0 - contrast * 0.4 ), 0.0, 0.94 );',
    '  mc = mix( mc, horizon, haze );',
    '  // the bottom of the range melts into the horizon colour',
    '  mc = mix( horizon, mc, smoothstep( base - 0.080, base + 0.018, h ) );',
    '  return mix( col, mc, mask );',
    '}',
    '',
    'void main() {',
    '  vec3 d = normalize( vDir );',
    '  float h = d.y;',
    '  float aa = uAA;',
    '  float g = clamp( h, 0.0, 1.0 );',
    '  // vertical gradient: horizon band -> pale blue -> zenith',
    '  vec3 sky = mix( uHorizon, uMid, smoothstep( 0.0, 0.20, g ) );',
    '  sky = mix( sky, uZenith, smoothstep( 0.10, 0.90, g ) );',
    '  // sun glow (halo) and low horizon glow on the sun side; both are zero AT the horizon so sky == fog colour there',
    '  float sd = clamp( dot( d, uSunDir ), -1.0, 1.0 );',
    '  float ang = acos( sd );',
    '  float vis = smoothstep( 0.0, 0.07, h );',
    '  float halo = exp( - ang * ang / ( 2.0 * 0.09 * 0.09 ) ) * 0.55 + exp( - ang * ang / ( 2.0 * 0.38 * 0.38 ) ) * 0.45;',
    '  sky = mix( sky, uHaloColor, clamp( halo * uHaloStrength * vis, 0.0, 0.85 ) );',
    '  vec2 hz = d.xz; float hzl = length( hz ); vec2 sz = uSunDir.xz; float szl = length( sz );',
    '  float azAlign = ( hzl > 1e-4 && szl > 1e-4 ) ? max( dot( hz / hzl, sz / szl ), 0.0 ) : 0.0;',
    '  float band = smoothstep( 0.0, 0.05, h ) * exp( - h * 8.0 );',
    '  sky = mix( sky, uGlowColor, clamp( pow( azAlign, 3.0 ) * band * uGlowStrength * 2.2, 0.0, 0.8 ) );',
    '  // sun disc: soft edge, HDR core',
    '  float disc = 1.0 - smoothstep( uSunSize * 0.70, uSunSize * 1.35, ang );',
    '  sky = mix( sky, uSunColor * uSunIntensity, disc * smoothstep( -0.03, 0.0, h ) );',
    '  // below the horizon: exactly the horizon (fog) colour',
    '  if ( h < 0.0 ) sky = uHorizon;',
    '  // distant mountain ranges (far -> near)',
    '  if ( uMtn > 0.5 && h < 0.34 ) {',
    '    float az = atan( d.x, d.z );',
    '    float sunAz = atan( uSunDir.x, uSunDir.z );',
    '    vec2 c = vec2( cos( az ), sin( az ) );',
    '    sky = mtnLayer( sky, uHorizon, uMtnFar,  h, c, az, sunAz, 1.35, 3.1,  0.030, 0.205, 0.30, aa );',
    '    sky = mtnLayer( sky, uHorizon, uMtnMid,  h, c, az, sunAz, 2.10, 7.7,  0.014, 0.135, 0.50, aa );',
    '    sky = mtnLayer( sky, uHorizon, uMtnNear, h, c, az, sunAz, 3.40, 11.3, 0.003, 0.075, 0.70, aa );',
    '  }',
    '  sky += ( ign( gl_FragCoord.xy ) + ign( gl_FragCoord.xy + 5.588238 ) - 1.0 ) * ( uDither / 255.0 );',
    '  gl_FragColor = vec4( sky, 1.0 );',
    '}'
  ].join('\n');

  function createSkyDome(opts) {
    var o = merge(clone(OVER_THE_HILL_LOOK.sky), opts || {});
    var baseRadius = 100;
    var radius = o.radius || 320;
    var U = {
      uZenith: { value: toColor(o.zenith) },
      uMid: { value: toColor(o.mid) },
      uHorizon: { value: toColor(o.horizon) },
      uSunDir: { value: new THREE.Vector3(0.670, 0.469, -0.575).normalize() },
      uSunColor: { value: toColor(o.sunColor) },
      uSunIntensity: { value: o.sunIntensity },
      uSunSize: { value: o.sunSize },
      uHaloColor: { value: toColor(o.haloColor) },
      uHaloStrength: { value: o.haloStrength },
      uGlowColor: { value: toColor(o.glowColor) },
      uGlowStrength: { value: o.glowStrength },
      uMtn: { value: o.mountains && o.mountains.enabled ? 1 : 0 },
      uMtnHeight: { value: o.mountains ? o.mountains.height : 1 },
      uMtnHaze: { value: o.mountains ? o.mountains.haze : 0.5 },
      uMtnFar: { value: toColor(o.mountains.far) },
      uMtnMid: { value: toColor(o.mountains.mid) },
      uMtnNear: { value: toColor(o.mountains.near) },
      uDither: { value: 1.0 },
      uAA: { value: 0.0015 }          // ridge edge softness in sin(elevation) units, ~1.2 px (set per draw in onBeforeRender)
    };
    var mat = new THREE.ShaderMaterial({
      uniforms: U, vertexShader: SKY_VS, fragmentShader: SKY_FS,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false
    });
    var geo = new THREE.SphereGeometry(baseRadius, 48, 24);
    var mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -1000;
    mesh.frustumCulled = false;
    mesh.name = 'OTH_SkyDome';
    // Ridge anti-aliasing width from the real pixel size (fwidth() inside the mountain branch gave garbage on the
    // branch-boundary pixel quads under ANGLE/D3D11 -> thin dashed line; an analytic value is branch-safe).
    var aaSize = new THREE.Vector2();
    mesh.onBeforeRender = function (rend, sc, cam) {
      var rt = rend.getRenderTarget();
      var hpx = rt ? rt.height : rend.getDrawingBufferSize(aaSize).y;
      var tanHalf = cam.isPerspectiveCamera ? Math.tan(cam.fov * Math.PI / 360) / (cam.zoom || 1) : 0.4;
      U.uAA.value = Math.max(0.0004, 2.4 * tanHalf / Math.max(1, hpx));
    };

    var sunDirection = U.uSunDir.value;
    var dome = {
      mesh: mesh, uniforms: U, material: mat,
      radius: radius,
      sunDirection: sunDirection,
      /* Call once per frame, before render. sunDir = direction FROM the scene TO the sun (any length). */
      update: function (camera, sunDir) {
        if (sunDir) {
          if (sunDir !== sunDirection) sunDirection.copy(sunDir);
          sunDirection.normalize();
        }
        mesh.position.copy(camera.position);
        var r = Math.min(dome.radius, camera.far * 0.9);
        mesh.scale.setScalar(r / baseRadius);
      },
      setHorizon: function (c) { toColor(c, U.uHorizon.value); },
      /* push a palette/option object (same keys as OVER_THE_HILL_LOOK.sky) */
      applyPalette: function (p) {
        if (!p) return;
        if (p.zenith !== undefined) toColor(p.zenith, U.uZenith.value);
        if (p.mid !== undefined) toColor(p.mid, U.uMid.value);
        if (p.horizon !== undefined) toColor(p.horizon, U.uHorizon.value);
        if (p.sunColor !== undefined) toColor(p.sunColor, U.uSunColor.value);
        if (p.sunIntensity !== undefined) U.uSunIntensity.value = p.sunIntensity;
        if (p.sunSize !== undefined) U.uSunSize.value = p.sunSize;
        if (p.haloColor !== undefined) toColor(p.haloColor, U.uHaloColor.value);
        if (p.haloStrength !== undefined) U.uHaloStrength.value = p.haloStrength;
        if (p.glowColor !== undefined) toColor(p.glowColor, U.uGlowColor.value);
        if (p.glowStrength !== undefined) U.uGlowStrength.value = p.glowStrength;
        if (p.radius !== undefined) dome.radius = p.radius;
        var m = p.mountains;
        if (m) {
          if (m.enabled !== undefined) U.uMtn.value = m.enabled ? 1 : 0;
          if (m.height !== undefined) U.uMtnHeight.value = m.height;
          if (m.haze !== undefined) U.uMtnHaze.value = m.haze;
          if (m.far !== undefined) toColor(m.far, U.uMtnFar.value);
          if (m.mid !== undefined) toColor(m.mid, U.uMtnMid.value);
          if (m.near !== undefined) toColor(m.near, U.uMtnNear.value);
        }
      },
      dispose: function () { geo.dispose(); mat.dispose(); }
    };
    return dome;
  }

  /* ------------------------------------------------------------------------
     3. Post FX
        Verified r128 facts (src/renderers/webgl/WebGLPrograms.js, WebGLRenderer.js):
         - toneMapping: material.toneMapped ? renderer.toneMapping : NoToneMapping  -> applied by the MATERIALS even
           while rendering into a render target (r128 has no "tone map only on screen" logic);
         - outputEncoding: render target -> getTextureEncodingFromMap(rt.texture) (LinearEncoding by default),
           screen -> renderer.outputEncoding (Linear, kept) => no colour-space conversion anywhere;
         - fog is mixed AFTER tone mapping (chunk order tonemapping_fragment, encodings_fragment, fog_fragment);
         - WebGLMultisampleRenderTarget works only on WebGL2 and is resolved automatically at the end of every
           renderer.render() into an RT (blit incl. depth); RGBA16F needs EXT_color_buffer_float (three enables it);
         - renderer.render() resets renderer.info each call (autoReset) -> we snapshot/restore the scene numbers;
         - every renderer.render() call re-uploads ShaderMaterial uniforms (_currentMaterialId reset).
        Decision: tone map ONCE, in the materials (unchanged).  The scene goes to a half-float RT (so the HDR sun
        core of the sky dome survives for the bloom), the composite does NOT tone-map.
     ------------------------------------------------------------------------ */
  var FS_VS = [
    'varying vec2 vUv;',
    'void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }'
  ].join('\n');

  var DOWN_FS = [
    'uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uPre; uniform float uThreshold; uniform float uKnee;',
    'varying vec2 vUv;',
    'vec3 pre( vec3 c ) {',
    '  if ( uPre < 0.5 ) return c;',
    '  float br = max( c.r, max( c.g, c.b ) );',
    '  float soft = clamp( br - uThreshold + uKnee, 0.0, 2.0 * uKnee );',
    '  soft = soft * soft / ( 4.0 * uKnee + 1e-5 );',
    '  float contrib = max( soft, br - uThreshold ) / max( br, 1e-4 );',
    '  return c * contrib;',
    '}',
    'vec3 s( vec2 o ) { return pre( texture2D( tSrc, vUv + o * uTexel ).rgb ); }',
    'float kw( vec3 c ) { return 1.0 / ( 1.0 + dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) ); }',
    'void main() {',
    '  vec3 a = s( vec2( -2.0,  2.0 ) ), b = s( vec2( 0.0,  2.0 ) ), c = s( vec2( 2.0,  2.0 ) );',
    '  vec3 d = s( vec2( -2.0,  0.0 ) ), e = s( vec2( 0.0,  0.0 ) ), f = s( vec2( 2.0,  0.0 ) );',
    '  vec3 g = s( vec2( -2.0, -2.0 ) ), h = s( vec2( 0.0, -2.0 ) ), i = s( vec2( 2.0, -2.0 ) );',
    '  vec3 j = s( vec2( -1.0,  1.0 ) ), k = s( vec2( 1.0,  1.0 ) ), l = s( vec2( -1.0, -1.0 ) ), m = s( vec2( 1.0, -1.0 ) );',
    '  vec3 g0 = ( a + b + d + e ) * 0.25; vec3 g1 = ( b + c + e + f ) * 0.25; vec3 g2 = ( d + e + g + h ) * 0.25;',
    '  vec3 g3 = ( e + f + h + i ) * 0.25; vec3 g4 = ( j + k + l + m ) * 0.25;',
    '  vec3 res;',
    '  if ( uPre > 0.5 ) {',
    '    // Karis average: tames fireflies from the sub-pixel HDR sun core',
    '    float w0 = kw( g0 ) * 0.125, w1 = kw( g1 ) * 0.125, w2 = kw( g2 ) * 0.125, w3 = kw( g3 ) * 0.125, w4 = kw( g4 ) * 0.5;',
    '    res = ( g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4 ) / ( w0 + w1 + w2 + w3 + w4 );',
    '  } else {',
    '    res = g4 * 0.5 + ( g0 + g1 + g2 + g3 ) * 0.125;',
    '  }',
    '  gl_FragColor = vec4( res, 1.0 );',
    '}'
  ].join('\n');

  var UP_FS = [
    'uniform sampler2D tLow; uniform sampler2D tHigh; uniform vec2 uTexelLow; uniform float uScatter;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec2 t = uTexelLow;',
    '  vec3 low = texture2D( tLow, vUv + vec2( -t.x,  t.y ) ).rgb + texture2D( tLow, vUv + vec2( t.x,  t.y ) ).rgb',
    '           + texture2D( tLow, vUv + vec2( -t.x, -t.y ) ).rgb + texture2D( tLow, vUv + vec2( t.x, -t.y ) ).rgb;',
    '  low += 2.0 * ( texture2D( tLow, vUv + vec2( -t.x, 0.0 ) ).rgb + texture2D( tLow, vUv + vec2( t.x, 0.0 ) ).rgb',
    '               + texture2D( tLow, vUv + vec2( 0.0,  t.y ) ).rgb + texture2D( tLow, vUv + vec2( 0.0, -t.y ) ).rgb );',
    '  low += 4.0 * texture2D( tLow, vUv ).rgb;',
    '  low *= 0.0625;',
    '  vec3 high = texture2D( tHigh, vUv ).rgb;',
    '  gl_FragColor = vec4( mix( high, low, uScatter ), 1.0 );',
    '}'
  ].join('\n');

  var COMP_FS = [
    'uniform sampler2D tScene; uniform sampler2D tBloom;',
    'uniform vec2 uRes;',
    'uniform float uBloomStrength; uniform vec3 uBloomTint;',
    'uniform float uContrast; uniform float uSaturation; uniform float uGain;',
    'uniform vec3 uShadowTint; uniform vec3 uHighlightTint; uniform vec3 uLift; uniform float uShadowSplit; uniform float uHighlightSplit;',
    'uniform float uVignette; uniform vec3 uVignetteTint;',
    'uniform float uGrain; uniform float uDither; uniform float uFrame;',
    'varying vec2 vUv;',
    'float ign( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }',
    'void main() {',
    '  vec3 c = texture2D( tScene, vUv ).rgb;',
    '  if ( uBloomStrength > 0.0 ) c += texture2D( tBloom, vUv ).rgb * ( uBloomStrength * uBloomTint );',
    '  c *= uGain;',
    '  c = max( ( c - 0.5 ) * uContrast + 0.5, 0.0 );',
    '  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );',
    '  c = mix( vec3( l ), c, uSaturation );',
    '  l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );',
    '  float sh = 1.0 - smoothstep( 0.04, 0.78, l );',
    '  float hl = smoothstep( 0.55, 1.05, l );',
    '  c *= mix( vec3( 1.0 ), uShadowTint, sh );',
    '  c *= mix( vec3( 1.0 ), uHighlightTint, hl );',
    '  // split toning: pull the darks toward the (luma-normalised) shadow tint, the brights toward the highlight tint',
    '  c = mix( c, l * uShadowTint / max( dot( uShadowTint, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-3 ), sh * uShadowSplit );',
    '  c = mix( c, l * uHighlightTint / max( dot( uHighlightTint, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-3 ), hl * uHighlightSplit );',
    '  c = c + uLift * ( 1.0 - c );',
    '  if ( uVignette > 0.0 ) {',
    '    vec2 q = ( vUv - 0.5 ) * vec2( uRes.x / uRes.y, 1.0 );',
    '    float v = smoothstep( 0.30, 1.05, length( q ) );',
    '    c = mix( c, c * uVignetteTint, v * uVignette );',
    '  }',
    '  vec2 fc = gl_FragCoord.xy;',
    '  float gr = ign( fc + uFrame * vec2( 17.13, 29.71 ) ) - 0.5;',
    '  float mid = 1.0 - abs( dot( c, vec3( 0.3333 ) ) * 2.0 - 1.0 );',
    '  c += gr * uGrain * ( 0.35 + 0.65 * mid );',
    '  c += ( ign( fc ) + ign( fc + 5.588238 ) - 1.0 ) * ( uDither / 255.0 );',
    '  gl_FragColor = vec4( c, 1.0 );',
    '}'
  ].join('\n');

  var activePostFX = null;

  function defaultPostParams() {
    var p = OVER_THE_HILL_LOOK.post;
    return {
      exposure: null,            // null = leave renderer.toneMappingExposure alone (applyLook() sets a number)
      bloomStrength: p.bloomStrength, bloomThreshold: p.bloomThreshold, bloomKnee: p.bloomKnee, bloomRadius: p.bloomRadius,
      bloomTint: toColor(p.bloomTint),
      saturation: p.saturation, contrast: p.contrast, gain: p.gain,
      shadowTint: toColor(p.shadowTint), highlightTint: toColor(p.highlightTint), lift: toColor(p.lift),
      shadowSplit: p.shadowSplit, highlightSplit: p.highlightSplit,
      vignette: p.vignette, vignetteTint: toColor(p.vignetteTint),
      grain: p.grain, dither: p.dither
    };
  }
  function neutralPost(params) {
    params.bloomStrength = 0; params.saturation = 1; params.contrast = 1; params.gain = 1;
    params.shadowTint.setRGB(1, 1, 1); params.highlightTint.setRGB(1, 1, 1); params.lift.setRGB(0, 0, 0);
    params.shadowSplit = 0; params.highlightSplit = 0;
    params.vignette = 0; params.grain = 0; params.dither = 0;
    return params;
  }
  function setPostParams(params, src) {
    if (!src) return params;
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      var cur = params[k];
      if (cur && cur.isColor) toColor(src[k], cur); else params[k] = src[k];
    }
    return params;
  }

  function createPostFX(renderer, scene, camera, opts) {
    opts = opts || {};
    var gl = renderer.getContext();
    var caps = renderer.capabilities;
    var isGL2 = !!caps.isWebGL2;

    var params = defaultPostParams();
    if (opts.neutral) neutralPost(params);
    setPostParams(params, opts.params);

    var fx = {
      params: params,
      enabled: opts.enabled !== false,
      mode: 'direct',            // 'msaa-half' | 'half' | 'msaa-ldr' | 'ldr' | 'direct'
      samples: 0,
      hdr: false,
      ready: false,
      width: 0, height: 0,
      stats: { passes: 0, bloomLevels: 0 },
      setSize: null, render: null, dispose: null, neutral: null, setParams: null
    };

    var fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    var fsGeo = new THREE.BufferGeometry();
    fsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    fsGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    var fsMesh = new THREE.Mesh(fsGeo, null);
    fsMesh.frustumCulled = false;
    var fsScene = new THREE.Scene();
    fsScene.add(fsMesh);

    function mkMat(fs, uniforms) {
      return new THREE.ShaderMaterial({
        uniforms: uniforms, vertexShader: FS_VS, fragmentShader: fs,
        depthTest: false, depthWrite: false, fog: false, toneMapped: false
      });
    }
    var matDown = [], matUp = [], matComp = null;   // per-level materials (cheap; one shared program each)
    var sceneRT = null, downRT = [], upRT = [], blackTex = null;
    var levels = 0;
    var autoSize = true;
    var pixelRatio = null;
    var frame = 0;
    var tmpV2 = new THREE.Vector2();
    var snap = { calls: 0, triangles: 0, points: 0, lines: 0 };

    /* --- capability probing: first working target type wins ------------------------------------ */
    function probe(type, samples) {
      var rt = null, ok = false;
      var prev = renderer.getRenderTarget();
      try {
        while (gl.getError() !== gl.NO_ERROR) { /* flush */ }
        var Ctor = samples > 0 ? THREE.WebGLMultisampleRenderTarget : THREE.WebGLRenderTarget;
        rt = new Ctor(8, 8, {
          type: type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
          depthBuffer: true, stencilBuffer: false, generateMipmaps: false
        });
        if (samples > 0) rt.samples = samples;
        var origWarn = console.warn, origErr = console.error, noisy = 0;
        console.warn = console.error = function () { noisy++; };
        try {
          renderer.setRenderTarget(rt);
          ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR && noisy === 0;
          // second RT of the same type without depth (bloom chain)
        } finally { console.warn = origWarn; console.error = origErr; }
      } catch (e) { ok = false; }
      try { renderer.setRenderTarget(prev); } catch (e2) { /* ignore */ }
      if (rt) rt.dispose();
      while (gl.getError() !== gl.NO_ERROR) { /* flush */ }
      return ok;
    }
    function chooseMode() {
      var want = opts.samples !== undefined ? opts.samples : 4;
      var list = [];
      if (opts.hdr !== false) {
        if (isGL2 && want > 0) list.push(['msaa-half', THREE.HalfFloatType, want]);
        list.push(['half', THREE.HalfFloatType, 0]);
      }
      if (isGL2 && want > 0) list.push(['msaa-ldr', THREE.UnsignedByteType, want]);
      list.push(['ldr', THREE.UnsignedByteType, 0]);
      for (var i = 0; i < list.length; i++) {
        if (probe(list[i][1], list[i][2])) return list[i];
      }
      return null;
    }
    var chosen = chooseMode();
    if (chosen) {
      fx.mode = chosen[0]; fx.samples = chosen[2]; fx.hdr = chosen[1] === THREE.HalfFloatType;
    } else {
      fx.mode = 'direct'; fx.enabled = false; fx.ready = false;
    }
    var rtType = chosen ? chosen[1] : THREE.UnsignedByteType;
    // the bloom chain never needs depth / MSAA; if half-float chain filtering is unsupported fall back to bytes
    var chainType = rtType;

    function rtOpts(type, depth) {
      return {
        type: type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        depthBuffer: !!depth, stencilBuffer: false, generateMipmaps: false
      };
    }

    function disposeTargets() {
      if (sceneRT) { sceneRT.dispose(); sceneRT = null; }
      var i;
      for (i = 0; i < downRT.length; i++) downRT[i].dispose();
      for (i = 0; i < upRT.length; i++) if (upRT[i]) upRT[i].dispose();
      downRT.length = 0; upRT.length = 0;
      for (i = 0; i < matDown.length; i++) matDown[i].dispose();
      for (i = 0; i < matUp.length; i++) matUp[i].dispose();
      matDown.length = 0; matUp.length = 0;
    }

    function allocate(w, h) {
      w = Math.max(2, w | 0); h = Math.max(2, h | 0);
      disposeTargets();
      fx.width = w; fx.height = h;
      if (!chosen) return;

      if (fx.samples > 0) {
        sceneRT = new THREE.WebGLMultisampleRenderTarget(w, h, rtOpts(rtType, true));
        sceneRT.samples = fx.samples;
      } else {
        sceneRT = new THREE.WebGLRenderTarget(w, h, rtOpts(rtType, true));
      }

      // bloom mip chain: 1/2, 1/4, ... (smallest side >= ~12 px, max 6 levels)
      levels = Math.max(2, Math.min(6, Math.floor(Math.log(Math.min(w, h) / 12) / Math.LN2)));
      var cw = w, ch = h, i;
      for (i = 0; i < levels; i++) {
        cw = Math.max(1, (cw + 1) >> 1); ch = Math.max(1, (ch + 1) >> 1);
        downRT.push(new THREE.WebGLRenderTarget(cw, ch, rtOpts(chainType, false)));
        upRT.push(i < levels - 1 ? new THREE.WebGLRenderTarget(cw, ch, rtOpts(chainType, false)) : null);
      }
      upRT[levels - 1] = downRT[levels - 1];   // the lowest level is both

      // materials: one per pass so the uniforms stay put; identical sources share one compiled program
      for (i = 0; i < levels; i++) {
        var src = i === 0 ? sceneRT.texture : downRT[i - 1].texture;
        var sw = i === 0 ? w : downRT[i - 1].width, sh = i === 0 ? h : downRT[i - 1].height;
        matDown.push(mkMat(DOWN_FS, {
          tSrc: { value: src }, uTexel: { value: new THREE.Vector2(1 / sw, 1 / sh) },
          uPre: { value: i === 0 ? 1 : 0 }, uThreshold: { value: 1 }, uKnee: { value: 0.3 }
        }));
      }
      for (i = 0; i < levels - 1; i++) {
        var low = upRT[i + 1];
        matUp.push(mkMat(UP_FS, {
          tLow: { value: low.texture }, tHigh: { value: downRT[i].texture },
          uTexelLow: { value: new THREE.Vector2(1 / low.width, 1 / low.height) }, uScatter: { value: 0.7 }
        }));
      }
      matComp.uniforms.tScene.value = sceneRT.texture;
      matComp.uniforms.tBloom.value = upRT[0].texture;
      matComp.uniforms.uRes.value.set(w, h);
      fx.ready = true;
      fx.stats.bloomLevels = levels;
    }

    if (chosen) {
      blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
      blackTex.needsUpdate = true;
      matComp = mkMat(COMP_FS, {
        tScene: { value: blackTex }, tBloom: { value: blackTex }, uRes: { value: new THREE.Vector2(1, 1) },
        uBloomStrength: { value: 0 }, uBloomTint: { value: new THREE.Color(1, 1, 1) },
        uContrast: { value: 1 }, uSaturation: { value: 1 }, uGain: { value: 1 },
        uShadowTint: { value: new THREE.Color(1, 1, 1) }, uHighlightTint: { value: new THREE.Color(1, 1, 1) },
        uLift: { value: new THREE.Color(0, 0, 0) }, uShadowSplit: { value: 0 }, uHighlightSplit: { value: 0 },
        uVignette: { value: 0 }, uVignetteTint: { value: new THREE.Color(1, 1, 1) },
        uGrain: { value: 0 }, uDither: { value: 0 }, uFrame: { value: 0 }
      });
      var d = renderer.getDrawingBufferSize(tmpV2);
      allocate(d.x, d.y);
    }

    fx.setSize = function (w, h, pr) {
      autoSize = false;
      if (pr === undefined || pr === null) pr = renderer.getPixelRatio();
      pixelRatio = pr;
      if (!chosen) return;
      var pw = Math.max(2, Math.floor(w * pr)), ph = Math.max(2, Math.floor(h * pr));
      if (pw !== fx.width || ph !== fx.height) allocate(pw, ph);
    };

    fx.neutral = function () { neutralPost(params); return fx; };
    fx.setParams = function (p) { setPostParams(params, p); return fx; };

    function pass(mat, target) {
      fsMesh.material = mat;
      renderer.setRenderTarget(target);
      renderer.render(fsScene, fsCam);
      fx.stats.passes++;
    }

    fx.render = function () {
      if (!fx.enabled || !fx.ready) {
        renderer.render(scene, camera);
        return;
      }
      if (autoSize) {
        var d = renderer.getDrawingBufferSize(tmpV2);
        if (d.x !== fx.width || d.y !== fx.height) allocate(d.x, d.y);
      }
      var P = params;
      var prevRT = renderer.getRenderTarget();
      var prevAuto = renderer.autoClear;
      var info = renderer.info;
      var prevInfoAuto = info.autoReset;   // honoured for the scene render, so renderer.info reads like a direct render
      fx.stats.passes = 0;

      if (P.exposure !== null && P.exposure !== undefined) renderer.toneMappingExposure = P.exposure;

      // 1. scene -> (MSAA) half-float target.  Tone mapping stays in the materials.
      renderer.autoClear = true;
      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);
      var r = info.render;
      snap.calls = r.calls; snap.triangles = r.triangles; snap.points = r.points; snap.lines = r.lines;

      renderer.autoClear = false;
      info.autoReset = false;              // the fullscreen passes must not wipe the scene numbers

      // 2. bloom: prefilter+downsample chain, then progressive upsample
      var bs = P.bloomStrength;
      var i;
      if (bs > 0) {
        var scatter = Math.min(0.98, Math.max(0.05, P.bloomRadius));
        var kn = Math.max(0.01, P.bloomKnee);
        var u0 = matDown[0].uniforms;
        u0.uThreshold.value = P.bloomThreshold; u0.uKnee.value = kn;
        for (i = 0; i < levels; i++) pass(matDown[i], downRT[i]);
        for (i = levels - 2; i >= 0; i--) { matUp[i].uniforms.uScatter.value = scatter; pass(matUp[i], upRT[i]); }
      }

      // 3. composite + grade -> screen
      var U = matComp.uniforms;
      U.uBloomStrength.value = bs;
      U.uBloomTint.value.copy(P.bloomTint);
      U.uContrast.value = P.contrast; U.uSaturation.value = P.saturation; U.uGain.value = P.gain;
      U.uShadowTint.value.copy(P.shadowTint); U.uHighlightTint.value.copy(P.highlightTint); U.uLift.value.copy(P.lift);
      U.uShadowSplit.value = P.shadowSplit; U.uHighlightSplit.value = P.highlightSplit;
      U.uVignette.value = P.vignette; U.uVignetteTint.value.copy(P.vignetteTint);
      U.uGrain.value = P.grain; U.uDither.value = P.dither;
      U.uFrame.value = (frame++) & 63;
      pass(matComp, null);

      // restore the renderer exactly as the caller left it (the viewport is restored by setRenderTarget(null))
      renderer.setRenderTarget(prevRT);
      renderer.autoClear = prevAuto;
      r.calls = snap.calls; r.triangles = snap.triangles; r.points = snap.points; r.lines = snap.lines;
      info.autoReset = prevInfoAuto;
    };

    fx.dispose = function () {
      disposeTargets();
      if (matComp) matComp.dispose();
      if (blackTex) blackTex.dispose();
      fsGeo.dispose();
      if (activePostFX === fx) activePostFX = null;
      fx.ready = false; fx.enabled = false;
    };

    activePostFX = fx;
    renderer.__othPostFX = fx;
    return fx;
  }

  /* ------------------------------------------------------------------------
     4. applyLook
     ------------------------------------------------------------------------ */
  function dirFromAngles(azDeg, elDeg, out) {
    var az = azDeg * Math.PI / 180, el = elDeg * Math.PI / 180;
    return out.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  }

  function applyLook(scene, renderer, lights, look, skyDome) {
    look = look || OVER_THE_HILL_LOOK;
    lights = lights || {};
    var L = merge(clone(OVER_THE_HILL_LOOK), look);   // missing keys fall back to the tuned defaults

    // --- fog: colour == sky horizon colour -------------------------------------------------------
    var horizon = toColor(L.fog.color);
    if (L.fog.gradient) {
      if (renderer && renderer.info && renderer.info.programs && renderer.info.programs.length > 0 && !fogInstalled) {
        console.warn('applyLook: fog chunk installed after materials were compiled; call applyLook before the first render.');
      }
      installFogGradient({ nearColor: L.fog.nearColor, gradientEnd: L.fog.gradientEnd });
    } else {
      restoreFog();
    }
    if (scene.fog && scene.fog.isFogExp2) { scene.fog.color.copy(horizon); scene.fog.density = L.fog.density; }
    else scene.fog = new THREE.FogExp2(horizon.getHex(), L.fog.density);
    if (scene.background && scene.background.isColor) scene.background.set(L.background); else scene.background = new THREE.Color(L.background);

    // --- renderer ----------------------------------------------------------------------------
    if (renderer) {
      renderer.toneMapping = L.toneMapping === 'ACESFilmic' ? THREE.ACESFilmicToneMapping : renderer.toneMapping;
      renderer.toneMappingExposure = L.exposure;
    }

    // --- lights ------------------------------------------------------------------------------
    var sunDir = dirFromAngles(L.sun.azimuthDeg, L.sun.elevationDeg, new THREE.Vector3());
    if (lights.hemi) {
      lights.hemi.color.set(L.hemi.sky); lights.hemi.groundColor.set(L.hemi.ground); lights.hemi.intensity = L.hemi.intensity;
    }
    if (lights.sun) {
      var sun = lights.sun;
      sun.color.set(L.sun.color); sun.intensity = L.sun.intensity;
      if (L.sun.reposition !== false) {
        var tp = sun.target ? sun.target.position : new THREE.Vector3();
        sun.position.copy(sunDir).multiplyScalar(L.sun.distance).add(tp);
      }
      if (sun.shadow) { sun.shadow.bias = L.sun.shadow.bias; sun.shadow.normalBias = L.sun.shadow.normalBias; }
    }
    if (lights.fill) {
      var fd = dirFromAngles(L.sun.azimuthDeg + 180, L.fill.elevationDeg, new THREE.Vector3());
      lights.fill.color.set(L.fill.color); lights.fill.intensity = L.fill.intensity;
      lights.fill.position.copy(fd).multiplyScalar(L.sun.distance);
    }

    // --- sky dome ----------------------------------------------------------------------------
    if (skyDome) {
      var sp = clone(L.sky); sp.horizon = horizon.getHex();
      skyDome.applyPalette(sp);
      skyDome.sunDirection.copy(sunDir);
    }

    // --- post FX params (if a pipeline exists) ------------------------------------------------
    var fx = (renderer && renderer.__othPostFX) || activePostFX;
    if (fx && fx.params && L.post) setPostParams(fx.params, L.post);

    return { sunDirection: sunDir, fogColor: horizon, fogDensity: L.fog.density };
  }

  /* ------------------------------------------------------------------------
     5. exports
     ------------------------------------------------------------------------ */
  global.OVER_THE_HILL_LOOK = OVER_THE_HILL_LOOK;
  global.createSkyDome = createSkyDome;
  global.createPostFX = createPostFX;
  global.applyLook = applyLook;
  global.OTHLook = {
    version: 1,
    installFogGradient: installFogGradient,
    restoreFog: restoreFog,
    neutralPost: neutralPost,
    setPostParams: setPostParams,
    getActivePostFX: function () { return activePostFX; }
  };
})(typeof window !== 'undefined' ? window : this);
