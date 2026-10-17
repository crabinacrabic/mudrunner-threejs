# Stage 0: import the big GLB, weld vertices, label connected islands, cache per-variant npz
import bpy, bmesh, sys, os, time
import numpy as np
SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "source_models", "Toyota Land Cruiser J40 Pickup, Canvas and Hardtop.glb")
OUT = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else r"."
OUT = sys.argv[sys.argv.index('--')+1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
ids = {'Pickup':'j40_pickup','Hard_Top':'j40_hardtop','Canvas_Top':'j40_canvas'}

def find(parent, i):
    while parent[i] != i:
        parent[i] = parent[parent[i]]
        i = parent[i]
    return i

for o in list(bpy.context.scene.objects):
    if o.type != 'MESH': continue
    vid = [v for k, v in ids.items() if k in o.name][0]
    t0 = time.time()
    me = o.data
    mats = []
    for m in me.materials:
        b = m.node_tree.nodes.get('Principled BSDF')
        bc = list(b.inputs['Base Color'].default_value)
        mats.append((m.name, bc, b.inputs['Alpha'].default_value, b.inputs['Roughness'].default_value))
    bm = bmesh.new(); bm.from_mesh(me)
    bm.transform(o.matrix_world)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
    bm.faces.ensure_lookup_table()
    # degenerate faces
    bad = [f for f in bm.faces if len({v.index for v in f.verts}) < 3]
    if bad: bmesh.ops.delete(bm, geom=bad, context='FACES')
    bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
    nv = len(bm.verts); nf = len(bm.faces)
    me2 = bpy.data.meshes.new('tmp'); bm.to_mesh(me2); bm.free()
    co = np.empty(nv*3, np.float32); me2.vertices.foreach_get('co', co); co = co.reshape(-1,3)
    me2.calc_loop_triangles()
    nt = len(me2.loop_triangles)
    tri = np.empty(nt*3, np.int32); me2.loop_triangles.foreach_get('vertices', tri); tri = tri.reshape(-1,3)
    mi = np.empty(nt, np.int32); me2.loop_triangles.foreach_get('material_index', mi)
    print(vid, 'welded verts', nv, 'tris', nt, 'loopTris', len(me2.loop_triangles), 'polys', len(me2.polygons), round(time.time()-t0,1))
    parent = list(range(nv))
    for x, y, z in zip(tri[:,0].tolist(), tri[:,1].tolist(), tri[:,2].tolist()):
        rx = find(parent, x); ry = find(parent, y)
        if rx != ry: parent[ry] = rx
        rz = find(parent, z); rx = find(parent, x)
        if rz != rx: parent[rz] = rx
    roots = np.array([find(parent, i) for i in range(nv)])
    ur, isl = np.unique(roots[tri[:,0]], return_inverse=True)
    print('  islands', len(ur))
    import pickle
    np.savez_compressed(os.path.join(OUT, vid + '.npz'), co=co, tri=tri, mi=mi, isl=isl.astype(np.int32))
    with open(os.path.join(OUT, vid + '_mats.pkl'), 'wb') as f: pickle.dump(mats, f)
