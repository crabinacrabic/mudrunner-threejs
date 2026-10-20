import bpy
import os
import zipfile
from mathutils import Vector

base = r"C:\Users\MSI\Desktop\My Projects\AFRICAN_IT_DRIVERS"

def inspect_car_blender(zip_rel, glb_name):
    zp = os.path.join(base, zip_rel)
    tmp_glb = os.path.join(r"C:\Users\MSI\AppData\Local\Temp", glb_name)
    if not os.path.exists(tmp_glb):
        with zipfile.ZipFile(zp, 'r') as z:
            with open(tmp_glb, 'wb') as f:
                f.write(z.read(glb_name))
                
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=tmp_glb)
    
    print(f"\n=== BLENDER REPORT: {glb_name} ===")
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            dim = o.dimensions
            print(f"  Mesh: {o.name:<35} | dim: ({dim.x:5.2f}, {dim.y:5.2f}, {dim.z:5.2f}) | polys: {len(o.data.polygons):>6} | verts: {len(o.data.vertices):>6}")

inspect_car_blender(r"Новые модели\Subaru_L_Series_4WD_1990_Sports_Wagon-eda7ebfd.zip", "Subaru_L_Series_4WD_1990_Sports_Wagon.glb")
inspect_car_blender(r"Новые модели\Toyota_Landcruiser_1985_4WD-19d5c2f7-textures.zip", "Toyota_Landcruiser_1985_4WD.glb")
