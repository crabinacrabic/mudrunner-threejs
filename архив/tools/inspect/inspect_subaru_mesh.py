import bpy
import numpy as np

tmp_glb = r"C:\Users\MSI\AppData\Local\Temp\Subaru_L_Series_4WD_1990_Sports_Wagon.glb"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=tmp_glb)

o = bpy.data.objects.get("blackout_low.003_Wheel.002_0")
if o:
    verts = np.array([v.co for v in o.data.vertices])
    print("blackout_low.003_Wheel.002_0 vertices min:", verts.min(axis=0), "max:", verts.max(axis=0))
    print("Vertex count:", len(verts), "Faces:", len(o.data.polygons))
