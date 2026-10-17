"""Blender 5.1 headless: heavy Sketchfab car with SEPARATE wheel objects -> lightweight game GLB + spec.
usage: blender -b -P build_sep.py -- <delica|hiace> <out_dir>
Source axes (both models): up = -Y, forward (front) = -Z, units cm. Target (Blender frame before glTF export):
up = +Z, forward = -Y (glTF +Z), metres, origin on the ground midway between the axles."""
import bpy, bmesh, sys, os, json, math, time
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
NAME, OUT = argv[0], argv[1]
PROJECT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = PROJECT.replace(chr(92), '/') + '/source_models/'

CFG = {
    'delica': dict(
        src=SRC + 'mitsubishi_delica_mk3_star_wagon_4wd.glb',
        tire='tire', rims=['material_15'], drop=['brakedisk'],
        spec=dict(id='delica', name='Mitsubishi Delica Star Wagon 4WD', shortName='Delica 4x4', typeLabel='Минивэн • 4WD',
                  mass=1900, power=21, maxSpeed=40, lowMaxSpeed=16, torqueMult=2.3, clearance=0.21, sinkFactor=1.0, tireBite=0.7,
                  hasAWD=True, hasDiffLock=True, drivenAxles='all', soundType='jeep', badge='4x4 AWD', defaultPaintHex=0x7d9a5c),
    ),
    'hiace': dict(
        src=SRC + 'toyota_hiacemk3h50_passenger_van.glb',
        tire='tire', rims=['material'], drop=['brakedisk'],
        spec=dict(id='hiace', name='Toyota HiAce H50 Фургон', shortName='HiAce H50', typeLabel='Фургон • RWD',
                  mass=1750, power=17, maxSpeed=40, lowMaxSpeed=15, torqueMult=1.9, clearance=0.18, sinkFactor=1.5, tireBite=0.45,
                  hasAWD=False, hasDiffLock=False, drivenAxles='rear', soundType='bus', badge='4x2 RWD', defaultPaintHex=0xe9e1cf),
    ),
}[NAME]

ROLE = {  # source material name -> game role
    'carpaint': 'paint', 'black': 'trim_black', 'chrome': 'chrome', 'windowglass': 'glass', 'clearglass': 'glass',
    'orangeglass': 'light_amber', 'redglass': 'light_tail', 'interior': 'interior', 'mirror': 'chrome', 'white': 'plate',
    'mattemetal': 'trim_black', 'LicPlate_black': 'trim_black', 'Material__1': 'trim_black', 'Material__2': 'trim_black',
    'Material__4': 'trim_black', 'material': 'trim_black', 'tire': 'rubber',
}
BUDGET = dict(total=52000, paint=0.40, trim_black=0.14, interior=0.07, chrome=0.10, glass=0.09, light_head=0.03, light_tail=0.03, light_amber=0.02, plate=0.02)

def log(*a): print('[V]', time.strftime('%H:%M:%S'), *a, flush=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=CFG['src'])
log('imported', len(bpy.context.scene.objects), 'objects')

# ---- bake world transforms (units: cm in source axes)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in meshes:
    mw = o.matrix_world.copy()
    o.parent = None
    o.data.transform(mw)
    o.matrix_world = Matrix.Identity(4)
for o in list(bpy.context.scene.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']

# ---- rotate to the target frame and scale to metres: R maps -Z(front)->-Y, -Y(up)->+Z, X->X  (rotation by -90 deg about X), then *0.01
R = Matrix.Rotation(-math.pi / 2, 4, 'X')
T = Matrix.Scale(0.01, 4) @ R
for o in meshes:
    o.data.transform(T)

def tri_count(o):
    o.data.calc_loop_triangles(); return len(o.data.loop_triangles)

def mat_names(o):
    return [m.name if m else '' for m in o.data.materials]

def bbox(o):
    co = np.empty(len(o.data.vertices) * 3, dtype=np.float32); o.data.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    return co.min(0), co.max(0)

drop = set(CFG['drop'])
tire_objs = [o for o in meshes if CFG['tire'] in mat_names(o)]
rim_objs = [o for o in meshes if any(m in CFG['rims'] for m in mat_names(o))]
wheel_parts = tire_objs + rim_objs
for o in meshes:
    if any(m in drop for m in mat_names(o)):
        bpy.data.objects.remove(o)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']

# ---- cluster wheel parts into 4 wheels by (side, axle)
centers = []
for o in wheel_parts:
    lo, hi = bbox(o); centers.append(((lo + hi) / 2, o))
zs = sorted(c[0][1] for c in centers)   # target frame: forward = -Y, so Y is the longitudinal axis
mid = (min(zs) + max(zs)) / 2
wheels = {}
for c, o in centers:
    side = 'L' if c[0] < 0 else 'R'       # game convention: x<0 -> 'L'
    axle = 'F' if c[1] < mid else 'R'     # front = more negative Y (forward = -Y in this frame)
    wheels.setdefault('Wheel_' + axle + side, []).append(o)
assert len(wheels) == 4, {k: len(v) for k, v in wheels.items()}
log('wheel groups', {k: len(v) for k, v in wheels.items()})

hub = {}
rad = {}
wid = {}
for k, objs in wheels.items():
    los = []; his = []
    for o in objs:
        lo, hi = bbox(o); los.append(lo); his.append(hi)
    lo = np.min(los, 0); hi = np.max(his, 0)
    hub[k] = Vector(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2))
    rad[k] = (hi[2] - lo[2]) / 2
    wid[k] = hi[0] - lo[0]
log('hubs', {k: tuple(round(v, 3) for v in hub[k]) for k in hub}, 'radius', {k: round(v, 3) for k, v in rad.items()}, 'width', {k: round(v, 3) for k, v in wid.items()})

# ground at z = 0 (lowest tyre point), centre origin between the axle centres, x centred
zmin = min(hub[k].z - rad[k] for k in hub)
axle_y = (np.mean([hub[k].y for k in hub if k[6] == 'F']) + np.mean([hub[k].y for k in hub if k[6] == 'R'])) / 2
xc = np.mean([hub[k].x for k in hub])
shift = Matrix.Translation((-xc, -axle_y, -zmin))
for o in bpy.context.scene.objects:
    if o.type == 'MESH':
        o.data.transform(shift)
for k in hub:
    hub[k] = shift @ hub[k]

# ---- helpers
def apply_mod(o):
    dg = bpy.context.evaluated_depsgraph_get(); eo = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(eo); old = o.data; o.data = me; o.modifiers.clear()
    if old.users == 0: bpy.data.meshes.remove(old)

def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active; o.name = name; o.data.name = name; return o

def dissolve_tri(o, deg):
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
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

# ---- materials: one per role, copied from the first source material using it
role_mat = {}
def get_role_mat(src_mat, role):
    if role in role_mat: return role_mat[role]
    m = src_mat.copy(); m.name = role
    role_mat[role] = m
    return m

def retarget(o, default_role=None):
    """split o by role: returns {role: object}"""
    me = o.data
    roles = []
    for m in me.materials:
        r = ROLE.get(m.name if m else '', default_role or 'trim_black')
        roles.append(r)
    out = {}
    pidx = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get('material_index', pidx)
    for ri, r in enumerate(roles):
        out.setdefault(r, []).append(ri)
    return roles, pidx

# ---- wheels: join parts, 2 materials, decimate, origin at hub
final_wheels = {}
for k, objs in wheels.items():
    for o in objs:
        dissolve_tri(o, 1.0)
        # rename materials: tyre -> rubber, rim parts -> rim
        for i, m in enumerate(o.data.materials):
            mm = m.copy(); mm.name = 'rubber' if m.name == CFG['tire'] else 'rim'; o.data.materials[i] = mm
    w = join(objs, k)
    collapse(w, 3400)
    smooth(w, 35)
    # merge duplicate material slots by name
    seen = {}
    for i, m in enumerate(w.data.materials): seen.setdefault(m.name, i)
    pidx = np.empty(len(w.data.polygons), dtype=np.int32); w.data.polygons.foreach_get('material_index', pidx)
    remap = np.array([seen[w.data.materials[i].name] for i in range(len(w.data.materials))], dtype=np.int32)
    w.data.polygons.foreach_set('material_index', remap[pidx])
    keep = []
    for name, i in seen.items(): keep.append(w.data.materials[i])
    # rebuild slot list in order of first use
    order = {i: n for n, i in enumerate(seen.values())}
    pidx = np.empty(len(w.data.polygons), dtype=np.int32); w.data.polygons.foreach_get('material_index', pidx)
    w.data.polygons.foreach_set('material_index', np.array([order[i] for i in pidx], dtype=np.int32))
    w.data.materials.clear()
    for m in keep: w.data.materials.append(m)
    # origin at hub
    h = hub[k]
    w.data.transform(Matrix.Translation(-h)); w.location = h
    final_wheels[k] = w
    log(k, 'tris', tri_count(w))

# ---- body: group the rest by role, decimate per role
body_objs = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o not in final_wheels.values()]
by_role = {}
for o in body_objs:
    mats = [m for m in o.data.materials]
    roles = [ROLE.get(m.name, 'trim_black') for m in mats]
    if len(set(roles)) == 1:
        by_role.setdefault(roles[0], []).append((o, mats[0]))
    else:
        by_role.setdefault(roles[0], []).append((o, mats[0]))
body = []
for r, items in by_role.items():
    objs = []
    for o, m in items:
        o.data.materials.clear(); o.data.materials.append(get_role_mat(m, r)); objs.append(o)
        dissolve_tri(o, 2.5)
    j = join(objs, 'Body_' + r)
    body.append(j)
total_now = sum(tri_count(b) for b in body)
log('body before collapse', total_now, {b.name: tri_count(b) for b in body})
rest = BUDGET['total']
for b in body:
    role = b.name[5:]
    share = BUDGET.get(role, 0.02)
    tgt = int(BUDGET['total'] * share)
    n = collapse(b, max(300, tgt))
    smooth(b, 36)
    log(b.name, '->', n)

# glass look: alpha in material
for m in role_mat.values():
    if m.node_tree:
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        if bsdf and m.name == 'glass':
            bsdf.inputs['Alpha'].default_value = 0.62

# ---- export
os.makedirs(OUT, exist_ok=True)
path = os.path.join(OUT, CFG['spec']['id'] + '.glb')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=False, export_materials='EXPORT',
                          export_image_format='AUTO', export_cameras=False, export_lights=False, use_selection=False)
log('exported', path, round(os.path.getsize(path) / 1048576, 2), 'MB')

# ---- spec
allb = [bbox(b) for b in body]
lo = np.min([a[0] for a in allb], 0); hi = np.max([a[1] for a in allb], 0)
fy = {k: hub[k].y for k in hub}
frontY = np.mean([fy[k] for k in fy if k[6] == 'F']); rearY = np.mean([fy[k] for k in fy if k[6] == 'R'])
# in this frame forward = -Y; glTF z = -blender y
wl = []
for k in ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR']:
    h = hub[k]
    wl.append(dict(name=k, x=round(float(h.x), 4), y=round(float(h.z), 4), z=round(float(-h.y), 4), radius=round(float(rad[k]), 4), width=round(float(wid[k]), 4), front=(k[6] == 'F')))
spec = dict(CFG['spec'])
spec.update(file='models/' + spec['id'] + '.glb', dims=dict(length=round(float(hi[1] - lo[1]), 3), width=round(float(hi[0] - lo[0]), 3), height=round(float(hi[2] - lo[2]), 3)),
            wheels=wl, frontAxleZ=round(float(-frontY), 4), rearAxleZ=round(float(-rearY), 4),
            trackHalfWidth=round(float(np.mean([abs(hub[k].x) for k in hub])), 4), bumperZ=round(float(-lo[1]), 4),
            exhaust=[round(float(hi[0] * 0.55), 3), 0.3, round(float(-hi[1]) + 0.05, 3)], winch=[0.0, 0.45, round(float(-lo[1]) , 3)],
            roofHeight=round(float(hi[2]), 3), paintMaterial='paint', hasLowGear=True, hasAirBrakes=False)
json.dump(spec, open(os.path.join(OUT, spec['id'] + '.spec.json'), 'w'), indent=1, ensure_ascii=False)
log('spec written')
