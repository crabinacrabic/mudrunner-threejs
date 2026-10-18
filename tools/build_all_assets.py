import bpy
import bmesh
import os
import sys
import json
import math
import numpy as np
from mathutils import Vector, Matrix

BASE_DIR = r"C:\Users\MSI\Desktop\My Projects\AFRICAN_IT_DRIVERS"
MODELS_DIR = os.path.join(BASE_DIR, "models")
TEMP_DIR = r"C:\Users\MSI\AppData\Local\Temp"

os.makedirs(MODELS_DIR, exist_ok=True)

def log(*args):
    print("[BUILD]", *args, flush=True)

# ==============================================================================
# SUBARU L-SERIES 4WD 1990
# ==============================================================================
def build_subaru():
    log("Starting Subaru L-Series build...")
    tmp_glb = os.path.join(TEMP_DIR, "Subaru_L_Series_4WD_1990_Sports_Wagon.glb")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=tmp_glb)
    
    # Bake world transforms
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.data.transform(mw)
        o.matrix_world = Matrix.Identity(4)
        
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
            
    # Check orientation:
    # In Sketchfab export:
    # let's find the bounding box of the whole car
    all_verts = []
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            for v in o.data.vertices:
                all_verts.append(v.co)
    all_verts = np.array(all_verts)
    min_co = all_verts.min(axis=0)
    max_co = all_verts.max(axis=0)
    dims = max_co - min_co
    log(f"Subaru raw bounds: min={min_co}, max={max_co}, dims={dims}")
    # In raw: dims ~ (3.06, 3.39, 6.22) or similar
    # Let's inspect axes:
    # Longitudinal axis is the longest dimension (e.g. Z or Y).
    # Width is X (~1.6 - 1.8m), height is Z or Y.
    # In raw: X is width (min_x ~ -1.5, max_x ~ 1.5, or ~1.6m), Z is long (~4.0 - 4.5m), Y is height (~1.4m) or similar.
    
    # Let's inspect the 4 wheel meshes:
    wheel_names = [
        "nut_middle_02_low_Subaru_L_Wheel_0",
        "nut_middle_02_low.004_Subaru_L_Wheel.001_0",
        "nut_middle_02_low.001_Subaru_L_Wheel.001_0",
        "nut_middle_02_low.002_Subaru_L_Wheel.002_0"
    ]
    wheel_objs = [bpy.data.objects.get(n) for n in wheel_names if bpy.data.objects.get(n)]
    log(f"Found {len(wheel_objs)} wheel objects")
    
    wheel_centers = {}
    for o in wheel_objs:
        co = np.array([v.co for v in o.data.vertices])
        c = co.mean(axis=0)
        wheel_centers[o.name] = Vector(c)
        log(f"  {o.name}: center={c}")

    # Let's print out what we found
    print("Wheel centers raw:", {k: (round(v.x, 3), round(v.y, 3), round(v.z, 3)) for k, v in wheel_centers.items()})

build_subaru()
