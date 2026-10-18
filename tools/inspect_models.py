import bpy
import os

def inspect(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if not os.path.exists(path):
        print(f"File not found: {path}")
        return
    bpy.ops.import_scene.gltf(filepath=path)
    print(f"=== {path} ===")
    for obj in bpy.context.scene.objects:
        p = obj.parent.name if obj.parent else "None"
        mats = [m.name for m in obj.data.materials if m] if obj.type == 'MESH' and obj.data else []
        print(f"{obj.name} (type={obj.type}, parent={p}, loc={[round(x, 2) for x in obj.location]}, dim={[round(x, 2) for x in obj.dimensions]}, mats={mats[:2]})")

print("--- RAW SUBARU ---")
raw_subaru = os.path.abspath("Новые модели/Subaru L-Series 1990 4WD Sports Wagon (Leone 3) (2).glb")
inspect(raw_subaru)

print("\n--- EXPORTED SUBARU ---")
inspect(os.path.abspath("models/subaru_l_series.glb"))

print("\n--- RAW LAND CRUISER ---")
raw_lc = os.path.abspath("Новые модели/toyota_land_cruiser_1985.glb")
inspect(raw_lc)

print("\n--- EXPORTED LAND CRUISER ---")
inspect(os.path.abspath("models/landcruiser_1985.glb"))
