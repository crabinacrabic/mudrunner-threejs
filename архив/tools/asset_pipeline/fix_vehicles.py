"""
Fix and re-export Subaru and Land Cruiser with:
1. Land Cruiser: exact axle centering so wheels are centered in wheel arches!
2. Subaru: clean stray geometry under ground and set up proper vehicle specs.
"""
import bpy
import bmesh
import os
import math
import numpy as np
from mathutils import Vector, Matrix

BASE_DIR = r"C:\Users\MSI\Desktop\My Projects\AFRICAN_IT_DRIVERS"
MODELS_DIR = os.path.join(BASE_DIR, "models")
TEMP_DIR = os.environ.get("TEMP", r"C:\Users\MSI\AppData\Local\Temp")

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def fix_landcruiser():
    print("=== FIXING LAND CRUISER FJ60 ===")
    reset_scene()
    src = os.path.join(TEMP_DIR, "Toyota_Landcruiser_1985_4WD.glb")
    bpy.ops.import_scene.gltf(filepath=src)
    bpy.context.view_layer.update()

    # Raw Land Cruiser:
    # Front is +X, Rear is -X, Width is Y, Height is Z.
    # Raw rear wheel center X: -1.02955
    # Raw front hub center X: 1.70218
    # Raw axle midpoint X: (+1.70218 + (-1.02955)) / 2 = +0.336317
    # Raw wheelbase = 2.7317m
    raw_axle_midpoint_x = 0.336317
    
    # We want axle midpoint to be at X=0 before rotation:
    T_pre = Matrix.Translation(Vector((-raw_axle_midpoint_x, 0, 0)))
    
    # Then rotate -90° around Z so +X (front) becomes -Y (front in Blender):
    R_z = Matrix.Rotation(-math.pi / 2, 4, 'Z')
    
    # Scale factor (wheelbase 2.73m):
    scale_lc = 4.675 / 4.55
    T_lc = Matrix.Scale(scale_lc, 4) @ R_z @ T_pre

    # Transform all meshes
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            mw = o.matrix_world.copy()
            o.parent = None
            o.data.transform(T_lc @ mw)
            o.matrix_world = Matrix.Identity(4)

    # Remove non-meshes
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o)

    # Wheel master
    wheel_master = bpy.data.objects.get("backNob_low.004_Wheel_0")
    if not wheel_master:
        wheel_master = bpy.data.objects.get("backNob_low.001_Wheel_0")

    for n in ["backNob_low.001_Wheel_0", "backNob_low.004_Wheel_0", "backNob_low.005_Wheel_0"]:
        o = bpy.data.objects.get(n)
        if o and o != wheel_master:
            bpy.data.objects.remove(o)

    # Center wheel master vertices at local (0, 0, 0)
    w_co = np.array([v.co for v in wheel_master.data.vertices])
    w_center = (w_co.min(axis=0) + w_co.max(axis=0)) / 2
    wheel_master.data.transform(Matrix.Translation(-Vector(w_center)))
    wheel_master.matrix_world = Matrix.Identity(4)

    # Center body laterally along X (so car is symmetrical left/right)
    body_objs = [o for o in bpy.context.scene.objects if o != wheel_master and o.type == 'MESH']
    b_verts = np.vstack([np.array([v.co for v in o.data.vertices]) for o in body_objs])
    center_x = (b_verts[:, 0].min() + b_verts[:, 0].max()) / 2
    for o in body_objs:
        o.data.transform(Matrix.Translation(Vector((-center_x, 0, 0))))

    # Downscale large textures if any
    for img in bpy.data.images:
        if img.size[0] > 2048 or img.size[1] > 2048:
            img.scale(2048, 2048)

    # In our transformed coordinates:
    # Front axle is at Y = -(1.70218 - 0.336317) * scale_lc = -1.3658 * 1.0275 = -1.403m!
    # Rear axle is at Y = -(-1.02955 - 0.336317) * scale_lc = +1.3658 * 1.0275 = +1.403m!
    # Let's set wheel locations exactly at ±1.37m, track half width 0.74m, hub height 0.40m:
    front_y = -1.37
    rear_y = 1.37
    wheel_radius = 0.40
    track_x = 0.74

    wheel_master.name = "Wheel_FL"
    wheel_master.location = Vector((-track_x, front_y, wheel_radius))

    def copy_wheel(name, loc, flip_x=False):
        w_new = wheel_master.copy()
        w_new.data = wheel_master.data.copy()
        w_new.name = name
        w_new.location = Vector(loc)
        if flip_x:
            w_new.data.transform(Matrix.Scale(-1, 4, Vector((1, 0, 0))))
            bm = bmesh.new()
            bm.from_mesh(w_new.data)
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
            bm.to_mesh(w_new.data)
            bm.free()
        bpy.context.collection.objects.link(w_new)
        return w_new

    copy_wheel("Wheel_FR", (track_x, front_y, wheel_radius), flip_x=True)
    copy_wheel("Wheel_RL", (-track_x, rear_y, wheel_radius), flip_x=False)
    copy_wheel("Wheel_RR", (track_x, rear_y, wheel_radius), flip_x=True)

    # Recalculate normals
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.to_mesh(o.data)
            bm.free()

    dst = os.path.join(MODELS_DIR, "landcruiser_1985.glb")
    bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB')
    print(f"Exported Land Cruiser: {dst} ({os.path.getsize(dst)/1024:.1f} KB)")


def fix_subaru():
    print("=== FIXING SUBARU L-SERIES ===")
    reset_scene()
    src = os.path.join(TEMP_DIR, "Subaru_L_Series_4WD_1990_Sports_Wagon.glb")
    bpy.ops.import_scene.gltf(filepath=src)
    bpy.context.view_layer.update()

    wheel_master = bpy.data.objects.get("nut_middle_02_low_Subaru_L_Wheel_0")
    if not wheel_master:
        raise RuntimeError("Subaru wheel master not found!")

    # Remove duplicates
    for n in ["nut_middle_02_low.004_Subaru_L_Wheel.001_0", "nut_middle_02_low.001_Subaru_L_Wheel.001_0", 
             "nut_middle_02_low.002_Subaru_L_Wheel.002_0", "blackout_low.003_Wheel.002_0", "blackout_low.004_Wheel.001_0"]:
        o = bpy.data.objects.get(n)
        if o and o != wheel_master:
            bpy.data.objects.remove(o)

    # Remove floating stray geometry under the ground (min Z < 0 in raw)
    for o in list(bpy.context.scene.objects):
        if o.type == 'MESH' and o != wheel_master:
            co = np.array([o.matrix_world @ v.co for v in o.data.vertices])
            if co[:, 2].max() < 0.1:  # entirely below or at ground level
                print(f"Removing stray sub-ground mesh: {o.name} (maxZ = {co[:, 2].max():.3f})")
                bpy.data.objects.remove(o)

    # Center wheel master vertices at (0, 0, 0)
    w_co = np.array([v.co for v in wheel_master.data.vertices])
    w_center = (w_co.min(axis=0) + w_co.max(axis=0)) / 2
    wheel_master.data.transform(Matrix.Translation(-Vector(w_center)))
    wheel_master.matrix_world = Matrix.Identity(4)

    scale_subaru = 1.66 / 1.579
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.data.transform(Matrix.Scale(scale_subaru, 4))
            o.matrix_world = Matrix.Identity(4)

    wheel_radius = 0.31
    wheel_master.name = "Wheel_FL"
    wheel_master.location = Vector((-0.71, -1.235, wheel_radius))

    def copy_wheel(name, loc, flip_x=False):
        w_new = wheel_master.copy()
        w_new.data = wheel_master.data.copy()
        w_new.name = name
        w_new.location = Vector(loc)
        if flip_x:
            w_new.data.transform(Matrix.Scale(-1, 4, Vector((1, 0, 0))))
            bm = bmesh.new()
            bm.from_mesh(w_new.data)
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
            bm.to_mesh(w_new.data)
            bm.free()
        bpy.context.collection.objects.link(w_new)
        return w_new

    copy_wheel("Wheel_FR", (0.71, -1.235, wheel_radius), flip_x=True)
    copy_wheel("Wheel_RL", (-0.71, 1.235, wheel_radius), flip_x=False)
    copy_wheel("Wheel_RR", (0.71, 1.235, wheel_radius), flip_x=True)

    # Recalculate normals
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.to_mesh(o.data)
            bm.free()

    dst = os.path.join(MODELS_DIR, "subaru_l_series.glb")
    bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB')
    print(f"Exported Subaru: {dst} ({os.path.getsize(dst)/1024:.1f} KB)")

if __name__ == "__main__":
    fix_landcruiser()
    fix_subaru()
    print("ALL VEHICLE FIXES COMPLETED!")
