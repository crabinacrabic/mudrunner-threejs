import bpy
import os
import zipfile

zp = r"C:\Users\MSI\Desktop\My Projects\AFRICAN_IT_DRIVERS\Новы окружения\Philippines_Lapu_Lapu_city_Mactan_New_Town-ea81b6e7-textures.zip"
tmp_glb = r"C:\Users\MSI\AppData\Local\Temp\philippines_test.glb"

if not os.path.exists(tmp_glb):
    print("Extracting GLB from zip...")
    with zipfile.ZipFile(zp, 'r') as z:
        data = z.read("Philippines_Lapu_Lapu_city_Mactan_New_Town.glb")
        with open(tmp_glb, 'wb') as f:
            f.write(data)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=tmp_glb)

print("=== BLENDER SCENE REPORT FOR PHILIPPINES ===")
objs = bpy.context.scene.objects
print(f"Total objects: {len(objs)}")
for o in objs:
    if o.type == 'MESH':
        dim = o.dimensions
        bbox = [o.matrix_world @ Vector(b) for b in o.bound_box] if 'Vector' in dir() else []
        print(f"Mesh: {o.name}, dimensions: ({dim.x:.2f}, {dim.y:.2f}, {dim.z:.2f}), verts: {len(o.data.vertices)}, polys: {len(o.data.polygons)}")
