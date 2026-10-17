/* =============================================================================
 * terrain_deform.js  -  module R: deformable terrain rendering (three.js r128)
 *
 * Plain classic script. Defines exactly two globals:
 *     createSoilTexture( renderer, data, NX, NZ [, opts] )  -> soil object
 *     patchTerrainWithSoil( material, opts )                -> uniforms object
 * everything else lives inside the IIFE below.
 *
 * DATA CONTRACT (owned by the CPU, never changed here)
 *   data : Float32Array( NX*NZ*4 ), cell (i,j) -> index (j*NX+i)*4
 *   R dh   (m, <0 rut, >0 berm)   G wet 0..1   B pack 0..1   A churn 0..1
 *   cell centre: x = originX+(i+0.5)*cell, z = originZ+(j+0.5)*cell
 *   texel (i,j) == cell (i,j), no flipY, v = (z-originZ)/sizeZ
 *
 * USAGE
 *   const soil = createSoilTexture(renderer, data, NX, NZ);
 *   const U = patchTerrainWithSoil(terrainMat, { soilTex: soil.texture, NX, NZ,
 *               originX:-40, originZ:-90, sizeX:80, sizeZ:180, linear: soil.linear });
 *   // per frame: after changing cells of 'data'
 *   soil.uploadRect(i0, j0, i1, j1);       // inclusive cell rect, clamped
 *   U.uTime.value = clock.elapsedTime;     // water ripples only
 *
 * The terrain mesh must be a plain (non rotated, Y-up) mesh at any translation:
 * the vertex shader displaces along object-space Y. flatShading must stay off.
 * ========================================================================== */
(function ( root ) {

'use strict';

/* ---------------------------------------------------------------------------
 *  1. SOIL TEXTURE + PARTIAL UPLOAD
 * ------------------------------------------------------------------------ */

function createSoilTexture( renderer, data, NX, NZ, opts ) {

	opts = opts || {};

	const gl = renderer.getContext();
	const caps = renderer.capabilities;
	const isGL2 = !! caps.isWebGL2;
	const ext = renderer.extensions;

	// --- capability checks ------------------------------------------------
	// RGBA32F texture: always in WebGL2, OES_texture_float in WebGL1.
	const floatOK = isGL2 || ext.has( 'OES_texture_float' );
	// hardware bilinear on 32F: OES_texture_float_linear (r128 requests it at init).
	// Sampling a 32F texture with LINEAR filter WITHOUT this extension gives an
	// "incomplete texture" = black, so we must fall back to NEAREST + shader bilinear.
	const linear = floatOK && ext.has( 'OES_texture_float_linear' ) && opts.linear !== false;
	// vertex texture fetch (always true on WebGL2 / every desktop GPU)
	const vertexFetch = ( caps.maxVertexTextures || 0 ) > 0;

	const THREE_ = root.THREE;
	const texture = new THREE_.DataTexture( data, NX, NZ, THREE_.RGBAFormat, THREE_.FloatType );
	texture.minFilter = texture.magFilter = linear ? THREE_.LinearFilter : THREE_.NearestFilter;
	texture.wrapS = texture.wrapT = THREE_.ClampToEdgeWrapping;
	texture.generateMipmaps = false;
	texture.flipY = false;
	texture.premultiplyAlpha = false;
	texture.unpackAlignment = 4;
	texture.needsUpdate = true;                 // first use uploads everything
	// r128 Texture has no userData: attach our own record
	texture.userData = texture.userData || {};
	texture.userData.soilSupported = floatOK;
	texture.userData.soilLinear = linear;
	texture.userData.soilVertexFetch = vertexFetch;

	// fast path = raw gl.texSubImage2D with UNPACK_ROW_LENGTH/SKIP_* (WebGL2 only)
	let raw = isGL2 && opts.forceCopyPath !== true;
	const state = renderer.state;
	const props = renderer.properties;

	// slow path = renderer.copyTextureToTexture() with a small DataTexture patch
	let patch = null, patchBuf = null;
	const patchPos = new THREE_.Vector2();

	function gpuTexture() {

		// only a texture that is already uploaded and not marked dirty can be patched
		const p = props.get( texture );
		return ( p && p.__webglTexture && p.__version === texture.version ) ? p.__webglTexture : null;

	}

	function uploadAll() {

		texture.needsUpdate = true;
		renderer.initTexture( texture );          // uploads now (23 MB) and unbinds

	}

	function uploadRect( i0, j0, i1, j1 ) {

		i0 = i0 < 0 ? 0 : ( i0 | 0 ); j0 = j0 < 0 ? 0 : ( j0 | 0 );
		i1 = i1 >= NX ? NX - 1 : ( i1 | 0 ); j1 = j1 >= NZ ? NZ - 1 : ( j1 | 0 );
		if ( i1 < i0 || j1 < j0 ) return;

		const tex = gpuTexture();
		if ( tex === null ) { uploadAll(); return; }   // nothing on the GPU yet: full upload covers the rect

		const w = i1 - i0 + 1, h = j1 - j0 + 1;

		if ( raw ) {

			// bind through three's state cache so that its bookkeeping stays valid
			state.bindTexture( gl.TEXTURE_2D, tex );
			gl.pixelStorei( gl.UNPACK_FLIP_Y_WEBGL, false );
			gl.pixelStorei( gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false );
			gl.pixelStorei( gl.UNPACK_ALIGNMENT, 4 );
			gl.pixelStorei( gl.UNPACK_ROW_LENGTH, NX );
			gl.pixelStorei( gl.UNPACK_SKIP_PIXELS, i0 );
			gl.pixelStorei( gl.UNPACK_SKIP_ROWS, j0 );
			gl.texSubImage2D( gl.TEXTURE_2D, 0, i0, j0, w, h, gl.RGBA, gl.FLOAT, data );
			// three never touches these three, so they MUST be reset or every later
			// three.js texture upload would be corrupted
			gl.pixelStorei( gl.UNPACK_ROW_LENGTH, 0 );
			gl.pixelStorei( gl.UNPACK_SKIP_PIXELS, 0 );
			gl.pixelStorei( gl.UNPACK_SKIP_ROWS, 0 );
			state.unbindTexture();

		} else {

			const n = w * h * 4;
			if ( patchBuf === null || patchBuf.length < n ) {

				patchBuf = new Float32Array( Math.max( n, 4096 ) );
				if ( patch === null ) {

					patch = new THREE_.DataTexture( patchBuf, 1, 1, THREE_.RGBAFormat, THREE_.FloatType );
					patch.flipY = false; patch.generateMipmaps = false;

				}

			}

			const view = patchBuf.subarray( 0, n );
			const rowLen = w * 4;
			for ( let j = 0; j < h; j ++ ) {

				const s = ( ( j0 + j ) * NX + i0 ) * 4;
				view.set( data.subarray( s, s + rowLen ), j * rowLen );

			}

			patch.image = { data: view, width: w, height: h };
			patchPos.set( i0, j0 );
			renderer.copyTextureToTexture( patchPos, patch, texture );

		}

	}

	// --- optional: batch several dirty rects into few uploads --------------
	const dirty = [];

	function markDirty( i0, j0, i1, j1 ) {

		i0 = Math.max( 0, i0 | 0 ); j0 = Math.max( 0, j0 | 0 );
		i1 = Math.min( NX - 1, i1 | 0 ); j1 = Math.min( NZ - 1, j1 | 0 );
		if ( i1 < i0 || j1 < j0 ) return;

		let merged = true;
		while ( merged ) {

			merged = false;
			for ( let k = 0; k < dirty.length; k ++ ) {

				const r = dirty[ k ];
				const u0 = Math.min( r[ 0 ], i0 ), v0 = Math.min( r[ 1 ], j0 );
				const u1 = Math.max( r[ 2 ], i1 ), v1 = Math.max( r[ 3 ], j1 );
				const areaU = ( u1 - u0 + 1 ) * ( v1 - v0 + 1 );
				const areaS = ( r[ 2 ] - r[ 0 ] + 1 ) * ( r[ 3 ] - r[ 1 ] + 1 ) + ( i1 - i0 + 1 ) * ( j1 - j0 + 1 );
				if ( areaU <= areaS * 1.35 + 256 ) {          // overlapping / adjacent / cheap to join

					i0 = u0; j0 = v0; i1 = u1; j1 = v1;
					dirty.splice( k, 1 );
					merged = true;
					break;

				}

			}

		}

		dirty.push( [ i0, j0, i1, j1 ] );

	}

	function flush() {

		for ( let k = 0; k < dirty.length; k ++ ) {

			const r = dirty[ k ];
			uploadRect( r[ 0 ], r[ 1 ], r[ 2 ], r[ 3 ] );

		}
		dirty.length = 0;

	}

	function dispose() { texture.dispose(); if ( patch ) patch.dispose(); }

	return {
		texture: texture,
		linear: linear,
		supported: floatOK,
		vertexFetch: vertexFetch,
		method: raw ? 'texSubImage2D+UNPACK_ROW_LENGTH' : 'copyTextureToTexture',
		uploadRect: uploadRect,
		uploadAll: uploadAll,
		markDirty: markDirty,       // optional helpers: markDirty(...) any number of times,
		flush: flush,               // then flush() once per frame
		dispose: dispose,
		NX: NX, NZ: NZ
	};

}

/* ---------------------------------------------------------------------------
 *  2. GLSL
 * ------------------------------------------------------------------------ */

// shared by vertex and fragment stage: field sampling
const GLSL_COMMON = /* glsl */`
uniform highp sampler2D uSoilTex;
uniform vec4 uSoilRect;   // xy = origin (world x,z), zw = 1 / size
uniform vec2 uSoilRes;    // NX, NZ
uniform vec2 uSoilTexel;  // 1/NX, 1/NZ
uniform float uCell;      // metres per cell

// field sample at texture coordinate (0 outside the rect). dh,wet,pack,churn
vec4 soilFetch( vec2 uv ) {
	vec2 inside = step( vec2( 0.0 ), uv ) * step( uv, vec2( 1.0 ) );
	#ifdef SOIL_LINEAR
		vec4 t = texture2D( uSoilTex, uv );
	#else
		// manual bilinear on a NEAREST float texture (clamp to edge)
		vec2 p = uv * uSoilRes - 0.5;
		vec2 fl = floor( p );
		vec2 f = p - fl;
		vec2 c = ( fl + 0.5 ) * uSoilTexel;
		vec4 a = texture2D( uSoilTex, c );
		vec4 b = texture2D( uSoilTex, c + vec2( uSoilTexel.x, 0.0 ) );
		vec4 d = texture2D( uSoilTex, c + vec2( 0.0, uSoilTexel.y ) );
		vec4 e = texture2D( uSoilTex, c + uSoilTexel );
		vec4 t = mix( mix( a, b, f.x ), mix( d, e, f.x ), f.y );
	#endif
	return t * ( inside.x * inside.y );
}

vec4 soilAt( vec2 xz ) { return soilFetch( ( xz - uSoilRect.xy ) * uSoilRect.zw ); }
`;

const GLSL_VERT_PARS = /* glsl */`
uniform float uDisplace;
uniform float uVertexFilter;
uniform vec2 uMeshCell;
varying vec2 vSoilXZ;

// dh prefiltered over the footprint of the mesh cells (5x5 taps, bell shaped): the mesh is
// coarser than the field, point sampling would alias thin ruts into a saw tooth along the
// triangle edges. The per pixel normals (fragment stage) carry the sharp detail.
float soilVertexHeight( vec2 xz ) {
	vec2 o = uMeshCell * ( 0.5 * uVertexFilter );
	float h = 0.0;
	float wsum = 0.0;
	for ( int a = -2; a <= 2; a ++ ) {
		float wa = a == 0 ? 1.0 : ( a == 1 || a == -1 ? 0.75 : 0.25 );
		for ( int b = -2; b <= 2; b ++ ) {
			float wb = b == 0 ? 1.0 : ( b == 1 || b == -1 ? 0.75 : 0.25 );
			float w = wa * wb;
			h += w * soilAt( xz + vec2( float( a ) * o.x, float( b ) * o.y ) ).x;
			wsum += w;
		}
	}
	return h / wsum;
}
`;

const GLSL_VERT_MAIN = /* glsl */`
	{
		vec4 soilW = modelMatrix * vec4( transformed, 1.0 );   // undisplaced world position
		vSoilXZ = soilW.xz;
		#ifndef SOIL_NO_VTF
			transformed.y += soilVertexHeight( soilW.xz ) * uDisplace;
		#endif
	}
`;

const GLSL_FRAG_PARS = /* glsl */`
uniform float uNormalStrength;
uniform float uSlopeTexels;
uniform float uDetailNormal;
uniform float uDetailScale;
uniform float uWetDarken;
uniform vec3 uMudColor;
uniform vec3 uWetMudColor;
uniform float uMudMix;
uniform vec3 uWaterColor;
uniform float uPoolWater;
uniform vec2 uPoolRange;
uniform vec3 uSkyColor;
uniform float uWaterReflect;
uniform float uCavityAO;
uniform float uSelfShadow;
uniform float uShadowReach;
uniform float uBermLight;
uniform float uTime;
uniform float uSoilDebug;
varying vec2 vSoilXZ;

float soilHash( vec2 p ) {
	p = fract( p * vec2( 0.1031, 0.1030 ) );
	p += dot( p, p.yx + 33.33 );
	return fract( ( p.x + p.y ) * p.x );
}

float soilNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( soilHash( i ), soilHash( i + vec2( 1.0, 0.0 ) ), u.x ),
	            mix( soilHash( i + vec2( 0.0, 1.0 ) ), soilHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}

// Soft height-field shadow of the soil layer: march towards the light across the
// field and test whether the surface there rises above the ray.
// Lw = world space unit vector pointing TO the light. Returns visibility 0..1.
#if SOIL_SHADOW_STEPS > 0
float soilSelfShadow( vec2 xz, float h0, vec3 Lw ) {
	float lh = length( Lw.xz );
	if ( lh < 1e-3 || Lw.y <= 0.0 ) return 1.0;
	vec2 dir = Lw.xz / lh;
	float rise = Lw.y / lh;                       // metres of ray height per horizontal metre
	float jitter = soilHash( xz * 41.0 );         // hides the stepping
	float blocked = 0.0;
	for ( int k = 1; k <= SOIL_SHADOW_STEPS; k ++ ) {
		float t = ( float( k ) - 0.5 + ( jitter - 0.5 ) * 0.15 ) / float( SOIL_SHADOW_STEPS ) * uShadowReach;
		float hh = soilAt( xz + dir * t ).x;
		float over = hh - ( h0 + t * rise );                        // >0: the ray is below the surface
		blocked = max( blocked, smoothstep( -0.015, 0.05 + 0.10 * t, over ) );   // penumbra grows with distance
	}
	return 1.0 - blocked * uSelfShadow;
}
#endif
`;

const GLSL_FRAG_MAIN = /* glsl */`
	// ======================= SOIL FIELD SHADING =============================
	float soilSunShadow = 1.0;
	float soilAO = 1.0;
	{
		vec2 sUV = ( vSoilXZ - uSoilRect.xy ) * uSoilRect.zw;
		vec4 s0 = soilFetch( sUV );
		vec2 sd = uSoilTexel * uSlopeTexels;                                // stencil half width (1 texel = plain central difference)
		float hL = soilFetch( sUV - vec2( sd.x, 0.0 ) ).x;
		float hR = soilFetch( sUV + vec2( sd.x, 0.0 ) ).x;
		float hD = soilFetch( sUV - vec2( 0.0, sd.y ) ).x;
		float hU = soilFetch( sUV + vec2( 0.0, sd.y ) ).x;
		vec2 slope = vec2( hR - hL, hU - hD ) / ( 2.0 * uCell * uSlopeTexels );          // d(dh)/dx, d(dh)/dz
		float lap = ( hL + hR + hD + hU - 4.0 * s0.x ) / ( uCell * uCell * uSlopeTexels * uSlopeTexels ); // >0 concave (cavity)

		float dh = s0.x, wet = s0.y, pack = s0.z, churn = s0.w;
		float depth = max( -dh, 0.0 );
		float berm = max( dh, 0.0 );

		float n1 = soilNoise( vSoilXZ * 1.3 );
		float n2 = soilNoise( vSoilXZ * 4.7 + 17.0 );
		float moist = saturate( wet + 0.55 * smoothstep( 0.03, 0.30, depth ) );

		// ---- water pool: deep + wet, soft edge ----
		float pool = smoothstep( uPoolRange.x, uPoolRange.y, depth ) * smoothstep( 0.45, 0.80, wet ) * uPoolWater;

		// ---- albedo ----
		vec3 c = diffuseColor.rgb;
		float lumB = dot( c, vec3( 0.299, 0.587, 0.114 ) );
		c = mix( vec3( lumB ), c, 1.0 + 0.35 * moist );                   // wet = more saturated
		c *= 1.0 - uWetDarken * moist;                                    // ... and darker
		vec3 mudCol = mix( uMudColor, uWetMudColor, moist ) * ( 0.88 + 0.24 * n2 ) * ( 0.70 + 0.60 * lumB );
		float mudK = saturate( 0.9 * smoothstep( 0.012, 0.10, depth ) + 0.40 * pack + 0.85 * churn );
		c = mix( c, mudCol, mudK * uMudMix );                             // subsoil / churned mud shows
		c *= 1.0 - 0.12 * pack;                                           // pressed soil: darker
		float crest = smoothstep( 0.02, 0.14, berm ) * ( 1.0 - moist );
		c = mix( c, c * 1.16 + vec3( 0.030, 0.022, 0.012 ), crest * uBermLight ); // dry lighter crest
		c *= 0.94 + 0.12 * n1 * ( 0.4 + moist );                         // very soft patchiness
		c = max( c, uWetMudColor * 0.62 );                                // wet mud is warm brown, never black

		vec3 wcol = uWaterColor * ( 1.0 - 0.35 * smoothstep( uPoolRange.y, uPoolRange.y + 0.30, depth ) );
		c = mix( c, wcol, pool * 0.90 );

		// ---- cavity ambient occlusion ----
		float cav = 0.60 * smoothstep( 0.0, 0.45, depth ) + 0.40 * saturate( lap * 0.022 );
		cav *= 1.0 - 0.75 * pool;
		soilAO = 1.0 - uCavityAO * cav;
		c *= mix( 1.0, soilAO, 0.30 );

		diffuseColor.rgb = c;

		// ---- roughness / metalness ----
		float r = roughnessFactor;
		r = mix( r, 0.52, pack * 0.55 );
		r = mix( r, 0.36, moist * 0.50 );
		r = mix( r, 0.24, churn * ( 0.45 + 0.55 * moist ) * 0.80 );
		r = mix( r, 0.08, pool );
		roughnessFactor = r;
		metalnessFactor = mix( metalnessFactor, 0.10, pool );

		// ---- per pixel normal: geometric normal + soil field slope (view space <-> world) ----
		vec3 nW = inverseTransformDirection( normal, viewMatrix );
		vec2 dnp = vSoilXZ * uDetailScale;
		float dnx = soilNoise( dnp + vec2( 0.35, 0.0 ) ) - soilNoise( dnp - vec2( 0.35, 0.0 ) );
		float dnz = soilNoise( dnp + vec2( 0.0, 0.35 ) ) - soilNoise( dnp - vec2( 0.0, 0.35 ) );
		float detailAmt = uDetailNormal * ( 0.25 + 0.75 * churn + 0.5 * smoothstep( 0.02, 0.12, berm ) ) * ( 1.0 - pool );
		vec3 gs = vec3( -slope.x * uNormalStrength - dnx * detailAmt, 0.0, -slope.y * uNormalStrength - dnz * detailAmt );
		vec3 nP = normalize( nW + gs * nW.y );
		// water is flat (the pool follows the geometric normal) with tiny ripples
		vec2 rip = vec2( sin( vSoilXZ.x * 9.0 + uTime * 1.7 ) + sin( vSoilXZ.y * 7.3 - uTime * 1.3 ),
		                 cos( vSoilXZ.x * 6.1 - uTime * 1.1 ) + cos( vSoilXZ.y * 8.7 + uTime * 1.9 ) ) * 0.007;
		nP = normalize( mix( nP, normalize( nW + vec3( rip.x, 0.0, rip.y ) ), pool ) );
		normal = transformDirection( nP, viewMatrix );
		geometryNormal = normal;       // specular anti-aliasing (geometryRoughness) now sees the soil normals

		// ---- fake sky reflection on glossy wet surfaces / water (there is no envMap) ----
		float gloss = 1.0 - roughnessFactor;
		float fres = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 3.0 );
		float reflAmt = pool + 0.10 * churn * moist + 0.05 * pack * moist;
		totalEmissiveRadiance += uSkyColor * ( 0.14 + 0.86 * fres ) * gloss * gloss * reflAmt * uWaterReflect;

		// ---- soil self shadow of the sun (first directional light) ----
		#if NUM_DIR_LIGHTS > 0 && SOIL_SHADOW_STEPS > 0
			soilSunShadow = soilSelfShadow( vSoilXZ, dh, inverseTransformDirection( directionalLights[ 0 ].direction, viewMatrix ) );
		#endif

		// ---- debug views: uSoilDebug 1 dh, 2 wet, 3 pack, 4 churn, 5 normal, 6 pool, 7 sun shadow ----
		if ( uSoilDebug > 0.5 ) {
			vec3 dbg = vec3( 0.0 );
			if ( uSoilDebug < 1.5 ) dbg = vec3( depth * 2.5, berm * 5.0, 0.0 );
			else if ( uSoilDebug < 2.5 ) dbg = vec3( 0.0, 0.2, wet );
			else if ( uSoilDebug < 3.5 ) dbg = vec3( pack );
			else if ( uSoilDebug < 4.5 ) dbg = vec3( churn, churn * 0.5, 0.0 );
			else if ( uSoilDebug < 5.5 ) dbg = nP * 0.5 + 0.5;
			else if ( uSoilDebug < 6.5 ) dbg = vec3( pool );
			else dbg = vec3( soilSunShadow );
			diffuseColor.rgb = vec3( 0.0 );
			totalEmissiveRadiance = dbg;
		}
	}
`;

// after the lighting accumulation
const GLSL_FRAG_AFTER_LIGHTS = /* glsl */`
	reflectedLight.indirectDiffuse *= soilAO;
	reflectedLight.directDiffuse *= mix( 1.0, soilAO, 0.35 );
	#ifdef SOIL_POSTHOC_SHADOW
		reflectedLight.directDiffuse *= soilSunShadow;
		reflectedLight.directSpecular *= soilSunShadow;
	#endif
`;

/* ---------------------------------------------------------------------------
 *  3. MATERIAL PATCH
 * ------------------------------------------------------------------------ */

let patchCounter = 0;

function patchTerrainWithSoil( material, opts ) {

	opts = opts || {};
	const THREE_ = root.THREE;
	const tex = opts.soilTex;
	const NX = opts.NX, NZ = opts.NZ;
	const originX = opts.originX, originZ = opts.originZ;
	const sizeX = opts.sizeX, sizeZ = opts.sizeZ;
	const linear = !! opts.linear;
	const meshSegX = opts.meshSegX || 256;           // only used for the vertex prefilter footprint
	const meshSegZ = opts.meshSegZ || 512;
	const shadowSteps = opts.shadowSteps === undefined ? 8 : ( opts.shadowSteps | 0 );
	const ud = ( tex && tex.userData ) || {};
	const supported = !! tex && ud.soilSupported !== false;
	const vtf = ud.soilVertexFetch !== false;

	const U = {
		uSoilTex: { value: tex },
		uSoilRect: { value: new THREE_.Vector4( originX, originZ, 1 / sizeX, 1 / sizeZ ) },
		uSoilRes: { value: new THREE_.Vector2( NX, NZ ) },
		uSoilTexel: { value: new THREE_.Vector2( 1 / NX, 1 / NZ ) },
		uCell: { value: sizeX / NX },

		// geometry
		uDisplace: { value: 1.0 },                                   // 0 = no vertex displacement
		uVertexFilter: { value: 1.5 },                               // footprint scale of the vertex prefilter (0 = point sample, aliases)
		uMeshCell: { value: new THREE_.Vector2( sizeX / meshSegX, sizeZ / meshSegZ ) },

		// look
		uNormalStrength: { value: 1.0 },                             // scales the dh slope normal
		uSlopeTexels: { value: 1.5 },                                // central difference half width in texels (1 = plain +-1 texel)
		uDetailNormal: { value: 0.28 },                              // procedural micro bumps on churn / berms
		uDetailScale: { value: 2.6 },                                // noise cycles per metre
		uWetDarken: { value: 0.55 },                                 // 0..1 darkening of wet soil
		uMudColor: { value: new THREE_.Color( 0x6e4829 ) },          // subsoil / dry mud
		uWetMudColor: { value: new THREE_.Color( 0x432a17 ) },       // wet mud (warm brown)
		uMudMix: { value: 0.80 },                                    // how strongly mud colour replaces albedo in ruts
		uWaterColor: { value: new THREE_.Color( 0x4f3d28 ) },        // puddle body colour (muddy)
		uPoolWater: { value: 1.0 },                                  // 0 disables water pools
		uPoolRange: { value: new THREE_.Vector2( 0.085, 0.17 ) },    // rut depth (m) where water starts / is full
		uSkyColor: { value: new THREE_.Color( 0xf1dcc2 ) },          // colour reflected by water / glossy mud
		uWaterReflect: { value: 0.65 },
		uCavityAO: { value: 0.70 },                                  // rut ambient occlusion strength
		uSelfShadow: { value: 0.85 },                                // 0 = off, sun shadow of berms inside ruts
		uShadowReach: { value: 1.3 },                                // metres marched towards the sun
		uBermLight: { value: 0.55 },                                 // lighter dry crest of berms
		uTime: { value: 0 },                                         // seconds, water ripples
		uSoilDebug: { value: 0 }                                     // 1 dh 2 wet 3 pack 4 churn 5 normal 6 pool 7 sun shadow
	};

	if ( ! supported ) {

		U.enabled = false;                                           // float textures missing: material untouched
		return U;

	}
	U.enabled = true;

	const prev = material.onBeforeCompile;

	material.onBeforeCompile = function ( shader, renderer ) {

		if ( typeof prev === 'function' ) prev.call( material, shader, renderer );

		for ( const k in U ) if ( U[ k ] && U[ k ].value !== undefined ) shader.uniforms[ k ] = U[ k ];

		let defs = '#define SOIL_SHADOW_STEPS ' + shadowSteps + '\n';
		if ( linear ) defs += '#define SOIL_LINEAR\n';
		if ( ! vtf ) defs += '#define SOIL_NO_VTF\n';

		// ---- vertex ----
		let vs = shader.vertexShader;
		vs = defs + vs.replace( '#include <clipping_planes_pars_vertex>',
			'#include <clipping_planes_pars_vertex>\n' + GLSL_COMMON + GLSL_VERT_PARS );
		vs = vs.replace( '#include <displacementmap_vertex>', '#include <displacementmap_vertex>\n' + GLSL_VERT_MAIN );
		shader.vertexShader = vs;

		// ---- fragment ----
		let fs = shader.fragmentShader;
		fs = fs.replace( '#include <clipping_planes_pars_fragment>',
			'#include <clipping_planes_pars_fragment>\n' + GLSL_COMMON + GLSL_FRAG_PARS );
		fs = fs.replace( '#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + GLSL_FRAG_MAIN );

		// let the self shadow multiply the sun BEFORE the BRDF (so the fill light is left alone):
		// patch the directional loop of the lights chunk, fall back to a post-hoc multiply
		const lfb = THREE_.ShaderChunk.lights_fragment_begin;
		const marker = 'getDirectionalDirectLightIrradiance( directionalLight, geometry, directLight );';
		if ( lfb && lfb.indexOf( marker ) >= 0 ) {

			fs = fs.replace( '#include <lights_fragment_begin>', lfb.replace( marker,
				marker + '\n\t\t#if UNROLLED_LOOP_INDEX == 0\n\t\tdirectLight.color *= soilSunShadow;\n\t\t#endif' ) );

		} else {

			defs += '#define SOIL_POSTHOC_SHADOW\n';

		}
		fs = fs.replace( '#include <aomap_fragment>', '#include <aomap_fragment>\n' + GLSL_FRAG_AFTER_LIGHTS );
		shader.fragmentShader = defs + fs;

		material.userData.soilShader = shader;

	};

	// distinct program per option set (the onBeforeCompile source text is identical for all patched materials)
	const key = 'soilterrain_r1_' + ( linear ? 'L' : 'N' ) + ( vtf ? 'V' : 'f' ) + shadowSteps;
	const prevKey = material.customProgramCacheKey;
	material.customProgramCacheKey = function () {

		return key + '|' + ( typeof prevKey === 'function' ? prevKey.call( material ) : '' );

	};
	material.needsUpdate = true;
	patchCounter ++;

	return U;

}

root.createSoilTexture = createSoilTexture;
root.patchTerrainWithSoil = patchTerrainWithSoil;

} )( typeof window !== 'undefined' ? window : this );
