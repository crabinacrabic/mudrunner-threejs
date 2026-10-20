import bpy
import os

TEMP_DIR = os.environ.get("TEMP", r"C:\Users\MSI\AppData\Local\Temp")

def inspect_raw(filename):
    path = os.path.join(TEMP_DIR, filename)
    print(f"\n==========================================")
    print(f"INSPECTING RAW: {filename}")
    print(f"==========================================")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    bpy.context.view_layer.update()
    
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    print(f"Total mesh objects: {len(meshes)}")
    for o in meshes[:15]:
        mw = o.matrix_world
        b_min = [round(x, 3) for x in o.bound_box[0]]
        b_max = [round(x, 3) for x in o.bound_box[6]]
        dims = [round(x, 3) for x in o.dimensions]
        print(f"  {o.name}: dims(X,Y,Z)={dims}, min={b_min}, max={b_max}, mats={[m.name for m in o.data.materials if m]}")

inspect_raw("Subaru_L_Series_4WD_1990_Sports_Wagon.glb")
inspect_raw("Toyota_Landcruiser_1985_4WD.glb")
inspect_raw("philippines_test.glb")
