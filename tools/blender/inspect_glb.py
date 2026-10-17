import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv
path = argv[argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)

print('=== FILE', os.path.basename(path), round(os.path.getsize(path) / 1048576, 1), 'MB')
tot_tris = 0
rows = []
for o in bpy.context.scene.objects:
    if o.type == 'MESH':
        me = o.data
        me.calc_loop_triangles()
        t = len(me.loop_triangles)
        tot_tris += t
        # world-space bbox
        pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
        mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        rows.append((o.name, t, o.parent.name if o.parent else '-', mn, mx, [m.name for m in me.materials][:3]))
    else:
        rows.append((o.name, 0, o.parent.name if o.parent else '-', None, None, [o.type]))
print('TOTAL TRIS', tot_tris, 'objects', len(rows))
rows.sort(key=lambda r: -r[1])
for r in rows[:70]:
    n, t, par, mn, mx, mats = r
    if mn is None:
        print(f'  {n[:44]:44s} {r[5]} parent={par}')
    else:
        print(f'  {n[:44]:44s} tris={t:8d} parent={par[:20]:20s} min=({mn.x:.2f},{mn.y:.2f},{mn.z:.2f}) max=({mx.x:.2f},{mx.y:.2f},{mx.z:.2f}) mats={mats}')
# overall bbox
allp = []
for o in bpy.context.scene.objects:
    if o.type == 'MESH':
        allp += [o.matrix_world @ Vector(c) for c in o.bound_box]
mn = Vector((min(p.x for p in allp), min(p.y for p in allp), min(p.z for p in allp)))
mx = Vector((max(p.x for p in allp), max(p.y for p in allp), max(p.z for p in allp)))
print('OVERALL BBOX min', tuple(round(v, 2) for v in mn), 'max', tuple(round(v, 2) for v in mx), 'size', tuple(round(v, 2) for v in (mx - mn)))
print('IMAGES', [(i.name, i.size[0], i.size[1]) for i in bpy.data.images][:20])
