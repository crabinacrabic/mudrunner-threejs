import bpy
import numpy as np

tmp_glb = r"C:\Users\MSI\AppData\Local\Temp\philippines_test.glb"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=tmp_glb)

print("=== PHILIPPINES MESHES ANALYSIS ===")
all_verts = []
for o in bpy.context.scene.objects:
    if o.type == 'MESH':
        co = np.array([v.co for v in o.data.vertices])
        all_verts.append(co)
        print(f"Mesh '{o.name}': min={co.min(axis=0)}, max={co.max(axis=0)}, count={len(co)}")

all_co = np.vstack(all_verts)
min_pt = all_co.min(axis=0)
max_pt = all_co.max(axis=0)
print(f"OVERALL BOUNDS: min={min_pt}, max={max_pt}")
print(f"EXTENTS: DX={max_pt[0]-min_pt[0]:.3f}, DY={max_pt[1]-min_pt[1]:.3f}, DZ={max_pt[2]-min_pt[2]:.3f}")

# Look at coordinate system: which axis is vertical?
# DY is usually elevation (or DZ).
# In Blender, Z is up. Here:
# min_z = -0.40, max_z = 0.16 -> span is 0.56!
# X is [-3.74 .. 2.08] -> span 5.82
# Y is [-4.32 .. 2.12] -> span 6.44
# So Z is vertical! (Ground is in XY plane, height is Z).
print(f"Horizontal area: {max_pt[0]-min_pt[0]:.2f} x {max_pt[1]-min_pt[1]:.2f}, vertical span: {max_pt[2]-min_pt[2]:.2f}")
