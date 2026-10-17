"""Blender 5.1 headless: Land Cruiser J40 (fused mesh, islands cached) -> 3 lightweight game GLBs with separate wheels.
usage: blender -b -P build_j40.py -- <out_dir> [variant ...]   (variants: pickup hardtop canvas)
Source frame (already the target frame): up = +Z, front = -Y, units cm. Output: metres, ground z=0, origin midway between the axles."""
import bpy, bmesh, sys, os, json, math, time, pickle
import numpy as np
from mathutils import Vector, Matrix

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'j40').replace(chr(92), '/')
sys.path.insert(0, HERE)
from lib import load, island_table, build_obj
from classify import find_wheels, wheel_islands

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
VARS = argv[1:] or ['pickup', 'hardtop', 'canvas']

META = {
    'pickup':  dict(id='j40_pickup',  name='Land Cruiser J40 Пикап',   shortName='J40 Пикап',   typeLabel='FJ45 • 4x4', mass=1750, power=22, paint=0xd9a441),
    'hardtop': dict(id='j40_hardtop', name='Land Cruiser J40 Хардтоп', shortName='J40 Хардтоп', typeLabel='BJ44 • 4x4', mass=1850, power=22, paint=0x3f8f8b),
    'canvas':  dict(id='j40_canvas',  name='Land Cruiser J40 Тент',    shortName='J40 Тент',    typeLabel='BJ40 • 4x4', mass=1600, power=21, paint=0xc2452d),
}
ROLE = {'carpaint': 'paint', 'black': 'trim_black', 'chrome': 'chrome', 'tire': 'rubber', 'rim': 'rim', 'interior': 'interior',
        'orangeglass': 'light_amber', 'redglass': 'light_tail', 'clearglass': 'glass', 'windowglass': 'glass', 'white': 'light_head',
        'yellow': 'light_amber', 'red': 'light_tail', 'mirror': 'chrome', 'grey': 'trim_black', 'Material__1': 'plate', 'Material__2': 'trim_black',
        'Material__3': 'trim_black', 'Material__4': 'light_amber'}
BUDGET = dict(total=54000, paint=0.34, trim_black=0.20, interior=0.06, chrome=0.12, glass=0.09, light_head=0.04, light_tail=0.03, light_amber=0.03, plate=0.01, rubber=0.02, rim=0.02)

def log(*a): print('[J]', time.strftime('%H:%M:%S'), *a, flush=True)

def role_of(name):
    base = name.split('.')[0]
    return ROLE.get(base, 'trim_black')

def apply_mod(o):
    dg = bpy.context.evaluated_depsgraph_get(); eo = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(eo); old = o.data; o.data = me; o.modifiers.clear()
    if old.users == 0: bpy.data.meshes.remove(old)

def tri_count(o):
    o.data.calc_loop_triangles(); return len(o.data.loop_triangles)

def dissolve_tri(o, deg):
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    if deg > 0:
        bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(deg), verts=bm.verts, edges=bm.edges, use_dissolve_boundaries=False)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(o.data); bm.free(); o.data.update()

def collapse(o, target):
    cur = tri_count(o)
    if cur <= target: return cur
    md = o.modifiers.new('d', 'DECIMATE'); md.decimate_type = 'COLLAPSE'; md.ratio = max(0.0008, min(1.0, target / cur)); md.use_collapse_triangulate = True
    apply_mod(o); return tri_count(o)

def smooth(o, deg=38.0):
    bm = bmesh.new(); bm.from_mesh(o.data); lim = math.radians(deg)
    for f in bm.faces: f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2:
            a = e.calc_face_angle(None); e.smooth = not (a is not None and a > lim)
        else: e.smooth = True
    bm.to_mesh(o.data); bm.free(); o.data.update()

def mk_mat(role, rgba, rough, alpha=1.0, metal=0.0):
    m = bpy.data.materials.new(role); m.use_nodes = True
    nt = m.node_tree
    b = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if b is None:
        b = nt.nodes.new('ShaderNodeBsdfPrincipled')
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(b.outputs['BSDF'], out.inputs['Surface'])
    b.inputs['Base Color'].default_value = (rgba[0], rgba[1], rgba[2], 1.0)
    b.inputs['Roughness'].default_value = rough; b.inputs['Alpha'].default_value = alpha; b.inputs['Metallic'].default_value = metal
    return m

def clear_scene():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    for me in list(bpy.data.meshes): bpy.data.meshes.remove(me)
    for m in list(bpy.data.materials): bpy.data.materials.remove(m)

def run(var):
    meta = META[var]
    vid = 'j40_' + var
    clear_scene()
    co, tri, mi, isl, mats = load(vid)
    co = co.copy()
    wheels, (cnt, mn, mx) = find_wheels(co, tri, mi, isl, mats, verbose=False)
    owner = wheel_islands(wheels, cnt, mn, mx)
    # target-frame transform (cm -> m, centre x, mid-axle y, ground z)
    cx = np.mean([w['centre'][0] for w in wheels.values()])
    ys = [w['centre'][1] for w in wheels.values()]
    cy = (min(ys) + max(ys)) / 2
    zg = np.mean([w['centre'][2] - w['R'] for w in wheels.values()])
    co[:, 0] = (co[:, 0] - cx) * 0.01; co[:, 1] = (co[:, 1] - cy) * 0.01; co[:, 2] = (co[:, 2] - zg) * 0.01
    hub = {}
    for k, w in wheels.items():
        c = w['centre']
        hub[k] = Vector(((c[0] - cx) * 0.01, (c[1] - cy) * 0.01, (c[2] - zg) * 0.01))
    R = float(np.mean([w['R'] for w in wheels.values()])) * 0.01
    W = float(np.mean([w['width'] for w in wheels.values()])) * 0.01
    log(var, 'hubs', {k: tuple(round(v, 3) for v in hub[k]) for k in hub}, 'R', round(R, 3), 'W', round(W, 3))

    # materials by role
    src_role = [role_of(m[0]) for m in mats]
    role_mat = {}
    for i, m in enumerate(mats):
        r = src_role[i]
        if r not in role_mat:
            role_mat[r] = mk_mat(r, m[1], float(m[3]), alpha=(0.62 if r == 'glass' else 1.0))
    # wheels
    wheel_roles = ['rubber', 'rim', 'chrome', 'trim_black']
    wheel_objs = {}
    island_owner = np.array([owner[i] for i in range(len(cnt))], dtype=object)
    tri_owner = island_owner[isl]
    for name, h in hub.items():
        sel = tri_owner == name
        t = tri[sel]; m_ = mi[sel]
        slot = np.array([wheel_roles.index(src_role[i]) if src_role[i] in wheel_roles else 3 for i in range(len(mats))])
        o = build_obj(name, co, t, slot[m_], [role_mat[r] if r in role_mat else mk_mat(r, (0.1, 0.1, 0.1), 0.9) for r in wheel_roles])
        dissolve_tri(o, 1.0)
        collapse(o, 3400)
        smooth(o, 35)
        o.data.transform(Matrix.Translation(-h)); o.location = h
        wheel_objs[name] = o
        log('  ', name, tri_count(o))
    # body
    sel = tri_owner == ''
    t = tri[sel]; m_ = mi[sel]
    body = []
    roles = sorted(set(src_role[i] for i in np.unique(m_)))
    for r in roles:
        idx = [i for i in range(len(mats)) if src_role[i] == r]
        mask = np.isin(m_, idx)
        if not mask.any(): continue
        o = build_obj('Body_' + r, co, t[mask], np.zeros(mask.sum(), dtype=np.int32), [role_mat[r]])
        dissolve_tri(o, 2.5)
        body.append(o)
    log(var, 'body before', {b.name: tri_count(b) for b in body})
    for b in body:
        r = b.name[5:]
        tgt = int(BUDGET['total'] * BUDGET.get(r, 0.02))
        n = collapse(b, max(250, tgt))
        smooth(b, 36)
    log(var, 'body after', {b.name: tri_count(b) for b in body})

    path = os.path.join(OUT, meta['id'] + '.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=False, export_materials='EXPORT',
                              export_image_format='AUTO', export_cameras=False, export_lights=False, use_selection=False)
    log('exported', path, round(os.path.getsize(path) / 1048576, 2), 'MB')

    # spec (glTF z = -blender y; y = blender z)
    allv = np.vstack([np.array([v.co[:] for v in b.data.vertices]) for b in body])
    lo = allv.min(0); hi = allv.max(0)
    fy = np.mean([hub[k].y for k in hub if k[6] == 'F']); ry = np.mean([hub[k].y for k in hub if k[6] == 'R'])
    wl = [dict(name=k, x=round(float(hub[k].x), 4), y=round(float(hub[k].z), 4), z=round(float(-hub[k].y), 4), radius=round(R, 4), width=round(W, 4), front=(k[6] == 'F'))
          for k in ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR']]
    spec = dict(id=meta['id'], name=meta['name'], shortName=meta['shortName'], typeLabel=meta['typeLabel'], mass=meta['mass'], power=meta['power'],
                maxSpeed=40, lowMaxSpeed=17, torqueMult=2.6, clearance=0.22, sinkFactor=0.9, tireBite=0.88, hasAWD=True, hasDiffLock=True,
                drivenAxles='all', soundType='jeep', badge='4x4 AWD', defaultPaintHex=meta['paint'], file='models/' + meta['id'] + '.glb',
                dims=dict(length=round(float(hi[1] - lo[1]), 3), width=round(float(hi[0] - lo[0]), 3), height=round(float(hi[2] - lo[2]), 3)),
                wheels=wl, frontAxleZ=round(float(-fy), 4), rearAxleZ=round(float(-ry), 4),
                trackHalfWidth=round(float(np.mean([abs(hub[k].x) for k in hub])), 4), bumperZ=round(float(-lo[1]), 4),
                exhaust=[round(float(hi[0] * 0.5), 3), 0.3, round(float(-hi[1]) + 0.05, 3)], winch=[0.0, 0.5, round(float(-lo[1]), 3)],
                roofHeight=round(float(hi[2]), 3), paintMaterial='paint', hasLowGear=True, hasAirBrakes=False)
    json.dump(spec, open(os.path.join(OUT, meta['id'] + '.spec.json'), 'w'), indent=1, ensure_ascii=False)

os.makedirs(OUT, exist_ok=True)
for v in VARS:
    run(v)
