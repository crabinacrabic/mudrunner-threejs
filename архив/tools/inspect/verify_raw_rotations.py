import bpy
import numpy as np
import os
from mathutils import Matrix, Vector

TEMP_DIR = os.environ.get("TEMP", r"C:\Users\MSI\AppData\Local\Temp")

def test_subaru():
    print("\n--- TEST SUBARU ---")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(TEMP_DIR, "Subaru_L_Series_4WD_1990_Sports_Wagon.glb"))
    bpy.context.view_layer.update()
    
    # Body
    body = bpy.data.objects.get("body_low_Subaru_L_Body_0")
    print(f"Body dims: {body.dimensions}")
    # Subaru Leone 1990 real specs:
    # Length: 4.41 m, Width: 1.66 m, Height: 1.45 m
    # Raw body dims: X=1.579, Y=3.875, Z=1.125
    # Scale: 4.41 / (bumper to bumper length)
    # Let's check total scene mesh bounds:
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    all_verts = np.vstack([np.array([o.matrix_world @ v.co for v in o.data.vertices]) for o in meshes])
    b_min, b_max = all_verts.min(axis=0), all_verts.max(axis=0)
    print(f"All meshes raw bounds: min={b_min}, max={b_max}, size={b_max - b_min}")
    
def test_landcruiser():
    print("\n--- TEST LAND CRUISER ---")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(TEMP_DIR, "Toyota_Landcruiser_1985_4WD.glb"))
    bpy.context.view_layer.update()
    
    body = bpy.data.objects.get("backNob_low.003_Main_0")
    print(f"Body dims: {body.dimensions}")
    # If front is +X and rear is -X, rotating 90 deg around Z:
    # (x, y, z) -> (-y, x, z) or (y, -x, z)
    # Let's check front/rear features:
    # Headlights are at front, taillights at rear.
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    all_verts = np.vstack([np.array([o.matrix_world @ v.co for v in o.data.vertices]) for o in meshes])
    b_min, b_max = all_verts.min(axis=0), all_verts.max(axis=0)
    print(f"All meshes raw bounds: min={b_min}, max={b_max}, size={b_max - b_min}")

def test_philippines():
    print("\n--- TEST PHILIPPINES ---")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(TEMP_DIR, "philippines_test.glb"))
    bpy.context.view_layer.update()
    
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    all_verts = np.vstack([np.array([o.matrix_world @ v.co for v in o.data.vertices]) for o in meshes])
    b_min, b_max = all_verts.min(axis=0), all_verts.max(axis=0)
    print(f"Raw bounds: min={b_min}, max={b_max}, size={b_max - b_min}")
    # If we rotate 90 deg around X:
    R = Matrix.Rotation(np.pi / 2, 4, 'X')
    rotated_verts = np.dot(all_verts, np.array(R.to_3x3()).T)
    rb_min, rb_max = rotated_verts.min(axis=0), rotated_verts.max(axis=0)
    print(f"Rotated bounds (X=width, Y=length, Z=elevation): min={rb_min}, max={rb_max}, size={rb_max - rb_min}")

test_subaru()
test_landcruiser()
test_philippines()
