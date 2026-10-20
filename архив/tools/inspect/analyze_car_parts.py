import bpy
import os
import zipfile
import json
import numpy as np
from mathutils import Vector, Matrix

base = r"C:\Users\MSI\Desktop\My Projects\AFRICAN_IT_DRIVERS"

def analyze_car(zip_rel, glb_name):
    zp = os.path.join(base, zip_rel)
    tmp_glb = os.path.join(r"C:\Users\MSI\AppData\Local\Temp", glb_name)
    if not os.path.exists(tmp_glb):
        with zipfile.ZipFile(zp, 'r') as z:
            with open(tmp_glb, 'wb') as f:
                f.write(z.read(glb_name))
                
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=tmp_glb)
    
    print(f"\n==================== ANALYZE {glb_name} ====================")
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            # world bounding box
            bbox = [o.matrix_world @ Vector(b) for b in o.bound_box]
            xs = [b.x for b in bbox]; ys = [b.y for b in bbox]; zs = [b.z for b in bbox]
            min_v = Vector((min(xs), min(ys), min(zs)))
            max_v = Vector((max(xs), max(ys), max(zs)))
            center = (min_v + max_v) / 2
            size = max_v - min_v
            mats = [m.name for m in o.data.materials if m]
            print(f"Object: {o.name:<40} | center: ({center.x:5.2f}, {center.y:5.2f}, {center.z:5.2f}) | size: ({size.x:5.2f}, {size.y:5.2f}, {size.z:5.2f}) | mats: {mats}")

analyze_car(r"Новые модели\Subaru_L_Series_4WD_1990_Sports_Wagon-eda7ebfd.zip", "Subaru_L_Series_4WD_1990_Sports_Wagon.glb")
analyze_car(r"Новые модели\Toyota_Landcruiser_1985_4WD-19d5c2f7-textures.zip", "Toyota_Landcruiser_1985_4WD.glb")
