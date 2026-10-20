import bpy
from mathutils import Vector

tmp_glb = r"C:\Users\MSI\AppData\Local\Temp\Subaru_L_Series_4WD_1990_Sports_Wagon.glb"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=tmp_glb)
bpy.context.view_layer.update()

wheel_names = [
    "nut_middle_02_low_Subaru_L_Wheel_0",
    "nut_middle_02_low.004_Subaru_L_Wheel.001_0",
    "nut_middle_02_low.001_Subaru_L_Wheel.001_0",
    "nut_middle_02_low.002_Subaru_L_Wheel.002_0"
]

for name in wheel_names:
    o = bpy.data.objects.get(name)
    if o:
        mw = o.matrix_world
        print(f"Subaru '{name}': world translation = ({mw.translation.x:.3f}, {mw.translation.y:.3f}, {mw.translation.z:.3f})")

print("Checking parent hierarchy:")
for name in wheel_names:
    o = bpy.data.objects.get(name)
    if o:
        p = o.parent
        p_name = p.name if p else "None"
        print(f"  {name} parent: {p_name}, loc={o.location}")
