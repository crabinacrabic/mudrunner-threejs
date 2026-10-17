import bpy, bmesh, os, sys, pickle, math
import numpy as np
from mathutils import Vector, Matrix
HERE = os.path.dirname(os.path.abspath(__file__)).replace(chr(92), "/")
CACHE = HERE + "/cache"

def load(vid):
    d = np.load(f"{CACHE}/{vid}.npz")
    mats = pickle.load(open(f"{CACHE}/{vid}_mats.pkl", 'rb'))
    return d['co'].astype(np.float64), d['tri'], d['mi'], d['isl'], mats

def island_table(co, tri, isl):
    n = isl.max() + 1
    cnt = np.bincount(isl, minlength=n)
    p = co[tri.reshape(-1)].reshape(-1, 3)
    ip = np.repeat(isl, 3)
    mn = np.full((n, 3), 1e9); mx = np.full((n, 3), -1e9)
    for a in range(3):
        np.minimum.at(mn[:, a], ip, p[:, a]); np.maximum.at(mx[:, a], ip, p[:, a])
    return cnt, mn, mx

def make_mat(name, rgba, rough=0.8, metal=0.0, alpha=1.0, blend=False):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (rgba[0], rgba[1], rgba[2], 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['Alpha'].default_value = alpha
    m.diffuse_color = (rgba[0], rgba[1], rgba[2], alpha)
    if blend:
        try: m.surface_render_method = 'BLENDED'
        except Exception: pass
    return m

def build_obj(name, co, tri, mi, mat_list, smooth=True, link=True):
    """co: (N,3) float, tri: (M,3) indices into co (will be compacted), mi: (M,) material slot index into mat_list"""
    used = np.unique(tri.reshape(-1))
    remap = np.full(len(co), -1, np.int64); remap[used] = np.arange(len(used))
    c2 = co[used]; t2 = remap[tri]
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(c2)); me.vertices.foreach_set('co', c2.astype(np.float32).reshape(-1))
    nt = len(t2)
    me.loops.add(nt*3); me.polygons.add(nt)
    me.loops.foreach_set('vertex_index', t2.astype(np.int32).reshape(-1))
    me.polygons.foreach_set('loop_start', np.arange(nt, dtype=np.int32)*3)
    me.polygons.foreach_set('material_index', mi.astype(np.int32))
    me.update(calc_edges=True)
    for m in mat_list: me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    if link: bpy.context.scene.collection.objects.link(ob)
    if smooth:
        me.shade_smooth()
    return ob

def tri_count(ob):
    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)

def setup_render(w=1400, h=800):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x = w; sc.render.resolution_y = h
    sc.render.film_transparent = False
    sh = sc.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_cavity = False; sh.show_shadows = False
    sc.display.render_aa = '8'
    sc.view_settings.view_transform = 'Standard'
    w_ = bpy.data.worlds.new('w') ; w_.color = (0.55, 0.62, 0.7); sc.world = w_
    return sc

def render_view(path, center, direction, dist=900.0, ortho=None, w=1400, h=800, lens=50):
    sc = bpy.context.scene
    cam = bpy.data.objects.get('cam__')
    if cam is None:
        cd = bpy.data.cameras.new('cam__'); cam = bpy.data.objects.new('cam__', cd); sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.lens = lens
    if ortho:
        cam.data.type = 'ORTHO'; cam.data.ortho_scale = ortho
    else:
        cam.data.type = 'PERSP'
    cam.data.clip_end = 100000
    d = Vector(direction).normalized()
    cam.location = Vector(center) + d * dist
    look = (Vector(center) - cam.location).normalized()
    up = Vector((0, 0, 1))
    if abs(look.dot(up)) > 0.99: up = Vector((0, 1, 0))
    q = look.to_track_quat('-Z', 'Y')
    # use track with proper up
    rot = look.to_track_quat('-Z', 'Y')
    cam.rotation_euler = rot.to_euler()
    sc.render.resolution_x = w; sc.render.resolution_y = h
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
