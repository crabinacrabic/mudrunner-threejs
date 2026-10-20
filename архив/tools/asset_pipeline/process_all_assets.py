"""
Process all assets with Blender 5.1:
1. Subaru L-Series 4WD 1990 Sports Wagon -> models/subaru_l_series.glb + spec
2. Toyota Land Cruiser 1985 4WD -> models/landcruiser_1985.glb + spec
3. Philippines Lapu-Lapu City Map -> models/map_philippines.glb + height grid
"""
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
    print("[PROCESS]", *args, flush=True)

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)

class NpEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (np.floating, np.float32, np.float64)):
            return float(obj)
        if isinstance(obj, (np.integer, np.int32, np.int64)):
            return int(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)

# ==============================================================================
# 1. PROCESS SUBARU L-SERIES 1990
# ==============================================================================
def process_subaru():
    log("=== PROCESSING SUBARU L-SERIES ===")
    reset_scene()
    src = os.path.join(TEMP_DIR, "Subaru_L_Series_4WD_1990_Sports_Wagon.glb")
    bpy.ops.import_scene.gltf(filepath=src)
    bpy.context.view_layer.update()

    # Raw bounds in Three.js/glTF frame:
    # DX=3.06 (X), DY=6.22 (Y), DZ=3.39 (Z).
    # Real Subaru Leone/Loyale station wagon:
    # Length: 4.41 m, Width: 1.66 m, Height: 1.45 m, Wheelbase: 2.47 m, Track: 1.42 m.
    # Current raw: length is Y (6.22m), width is X (3.06m), height is Z (3.39m).
    # Target in game engine:
    # Game coordinates:
    #   X: left (-), right (+) (width ~1.66m)
    #   Y: up (+) (height ~1.45m)
    #   Z: forward (+), backward (-) (length ~4.41m)
    # So:
    #   X_game = X_raw * scale
    #   Y_game = Z_raw * scale
    #   Z_game = Y_raw * scale  (or -Y_raw)
    
    # Scale factor: 4.41 / 6.22 ~ 0.7088
    scale = 4.41 / 6.22
    
    # Transformation matrix:
    # Rotate 90 deg about X so Z becomes Y:
    # [ 1  0  0 ]
    # [ 0  0  1 ]
    # [ 0 -1  0 ]
    M_rot = Matrix((
        (1,  0,  0, 0),
        (0,  0,  1, 0),
        (0,  1,  0, 0),
        (0,  0,  0, 1)
    ))
    M_scale = Matrix.Scale(scale, 4)
    T = M_scale @ M_rot

    # Unparent and transform all mesh objects
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.data.transform(T @ mw)
        o.matrix_world = Matrix.Identity(4)
        
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o)

    # In Subaru, nut_middle_02_low_Subaru_L_Wheel_0 is the base wheel.
    wheel_master = bpy.data.objects.get("nut_middle_02_low_Subaru_L_Wheel_0")
    
    # Other wheel duplicates in raw file:
    for n in ["nut_middle_02_low.004_Subaru_L_Wheel.001_0", "nut_middle_02_low.001_Subaru_L_Wheel.001_0", "nut_middle_02_low.002_Subaru_L_Wheel.002_0"]:
        o = bpy.data.objects.get(n)
        if o and o != wheel_master:
            bpy.data.objects.remove(o)

    # Let's inspect wheel master size
    w_co = np.array([v.co for v in wheel_master.data.vertices])
    w_min, w_max = w_co.min(axis=0), w_co.max(axis=0)
    w_center = (w_min + w_max) / 2
    w_size = w_max - w_min
    wheel_radius = (w_size[1] + w_size[2]) / 4  # average Y and Z radius
    wheel_width = w_size[0]
    log(f"Subaru wheel radius: {wheel_radius:.3f}m, width: {wheel_width:.3f}m")

    # Center wheel master vertices at (0, 0, 0)
    wheel_master.data.transform(Matrix.Translation(-Vector(w_center)))

    # Vehicle body bounds
    body_objs = [o for o in bpy.context.scene.objects if o != wheel_master]
    body_co = np.vstack([np.array([v.co for v in o.data.vertices]) for o in body_objs])
    b_min, b_max = body_co.min(axis=0), body_co.max(axis=0)
    log(f"Subaru body bounds: min={b_min}, max={b_max}")

    # Wheelbase for Subaru Leone: 2.47m (front: +1.235, rear: -1.235)
    # Track width: 1.42m (half: 0.71m)
    # Ground clearance / wheel center height: wheel_radius (~0.31m)
    wheelbase_half = 1.235
    track_half = 0.71
    hub_y = wheel_radius

    # Shift body so lowest point (with ground at Y=0) matches hub_y
    shift_y = hub_y - (w_center[1] if hasattr(w_center, '__getitem__') else 0)
    # Let body sit at proper clearance: body bottom at ~0.22m
    clearance = 0.22
    body_shift_y = clearance - b_min[1]
    
    # Center body longitudinally around axles (midpoint between axles at Z=0)
    body_mid_z = (b_min[2] + b_max[2]) / 2
    body_shift_z = -body_mid_z
    body_shift_x = -(b_min[0] + b_max[0]) / 2

    T_body = Matrix.Translation(Vector((body_shift_x, body_shift_y, body_shift_z)))
    for o in body_objs:
        o.data.transform(T_body)

    # Join body objects into a single clean Body mesh
    bpy.ops.object.select_all(action='DESELECT')
    for o in body_objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = body_objs[0]
    if len(body_objs) > 1:
        bpy.ops.object.join()
    body_obj = bpy.context.view_layer.objects.active
    body_obj.name = "Body"
    body_obj.data.name = "Body"

    # Now create the 4 wheel objects at (0,0,0) local mesh coords, named Wheel_FL, Wheel_FR, Wheel_RL, Wheel_RR
    # Wheel_FL (Front-Left)
    wheel_FL = wheel_master
    wheel_FL.name = "Wheel_FL"
    wheel_FL.data.name = "Wheel_FL"

    # Duplicate for FR, RL, RR
    def clone_wheel(src_obj, new_name, mirror_x=False):
        new_obj = src_obj.copy()
        new_obj.data = src_obj.data.copy()
        new_obj.name = new_name
        new_obj.data.name = new_name
        if mirror_x:
            new_obj.data.transform(Matrix.Scale(-1, 4, Vector((1, 0, 0))))
        bpy.context.scene.collection.objects.link(new_obj)
        return new_obj

    wheel_FR = clone_wheel(wheel_FL, "Wheel_FR", mirror_x=True)
    wheel_RL = clone_wheel(wheel_FL, "Wheel_RL", mirror_x=False)
    wheel_RR = clone_wheel(wheel_FL, "Wheel_RR", mirror_x=True)

    # Decimate wheels to reduce 33k tris per wheel down to ~3.5k tris for high performance
    for w in [wheel_FL, wheel_FR, wheel_RL, wheel_RR]:
        mod = w.modifiers.new("Decimate", "DECIMATE")
        mod.ratio = 0.12  # ~4k triangles per wheel
        bpy.context.view_layer.objects.active = w
        bpy.ops.object.modifier_apply(modifier="Decimate")

    # Export GLB
    out_glb = os.path.join(MODELS_DIR, "subaru_l_series.glb")
    bpy.ops.export_scene.gltf(
        filepath=out_glb,
        export_format='GLB',
        use_selection=False,
        export_apply=True
    )
    log(f"Exported {out_glb} (size: {os.path.getsize(out_glb)/(1024*1024):.2f} MB)")

    # Compute spec
    b_co_final = np.array([v.co for v in body_obj.data.vertices])
    bf_min, bf_max = b_co_final.min(axis=0), b_co_final.max(axis=0)
    dims = {"length": round(float(bf_max[2] - bf_min[2]), 3), "width": round(float(bf_max[0] - bf_min[0]), 3), "height": round(float(bf_max[1] - bf_min[1]), 3)}

    subaru_spec = {
        "id": "subaru_l_series",
        "name": "Subaru L-Series 1990 4WD Sports Wagon",
        "shortName": "Subaru 4WD",
        "typeLabel": "Универсал • 4WD",
        "mass": 1250,
        "power": 24,
        "maxSpeed": 48,
        "lowMaxSpeed": 20,
        "torqueMult": 2.2,
        "clearance": 0.22,
        "sinkFactor": 0.65,
        "tireBite": 0.85,
        "hasAWD": True,
        "hasDiffLock": True,
        "drivenAxles": "all",
        "soundType": "jeep",
        "badge": "4WD Boxer",
        "defaultPaintHex": 0x2b4c7e,
        "file": "models/subaru_l_series.glb",
        "dims": dims,
        "wheels": [
            {"name": "Wheel_FL", "x": -track_half, "y": hub_y, "z": wheelbase_half, "radius": round(wheel_radius, 3), "width": round(wheel_width, 3), "front": True},
            {"name": "Wheel_FR", "x": track_half, "y": hub_y, "z": wheelbase_half, "radius": round(wheel_radius, 3), "width": round(wheel_width, 3), "front": True},
            {"name": "Wheel_RL", "x": -track_half, "y": hub_y, "z": -wheelbase_half, "radius": round(wheel_radius, 3), "width": round(wheel_width, 3), "front": False},
            {"name": "Wheel_RR", "x": track_half, "y": hub_y, "z": -wheelbase_half, "radius": round(wheel_radius, 3), "width": round(wheel_width, 3), "front": False}
        ],
        "frontAxleZ": wheelbase_half,
        "rearAxleZ": -wheelbase_half,
        "trackHalfWidth": track_half,
        "bumperZ": round(float(bf_max[2]), 3),
        "exhaust": [0.45, 0.25, round(float(bf_min[2]), 3)],
        "winch": [0.0, 0.4, round(float(bf_max[2]), 3)],
        "roofHeight": round(float(bf_max[1]), 3),
        "paintMaterial": "paint",
        "hasLowGear": True,
        "hasAirBrakes": False,
        "physWidth": 0.28
    }
    
    with open(os.path.join(MODELS_DIR, "subaru_spec.json"), "w", encoding="utf-8") as f:
        json.dump(subaru_spec, f, indent=2, ensure_ascii=False, cls=NpEncoder)
    log("Saved subaru_spec.json")

# ==============================================================================
# 2. PROCESS TOYOTA LAND CRUISER 1985
# ==============================================================================
def process_landcruiser():
    log("=== PROCESSING TOYOTA LAND CRUISER 1985 ===")
    reset_scene()
    src = os.path.join(TEMP_DIR, "Toyota_Landcruiser_1985_4WD.glb")
    bpy.ops.import_scene.gltf(filepath=src)
    bpy.context.view_layer.update()

    # Raw bounds in Blender:
    # DX=4.68, DY=1.91 (or 1.8), DZ=2.37 (or 1.88)
    # Real Land Cruiser FJ60:
    # Length: 4.675 m, Width: 1.80 m, Height: 1.75 m, Wheelbase: 2.73 m, Track: 1.48 m.
    # Current raw:
    #   Length is in X direction (4.68m)!
    #   Height is in Z direction (2.37m, or Y/Z).
    #   Width is in Y direction (1.91m)!
    # In Three.js:
    #   Front is +Z, Width is X, Up is +Y!
    # Let's rotate so:
    #   Length (X) maps to +Z: Rotate +90 deg around Y (or -90)!
    #   Let's check which end is front:
    #   `backNob_low.001_Main_0` has center X = -2.14 -> "backNob" means back / rear is at negative X!
    #   So front is at positive X (+2.3)!
    #   To map Front (+X) to Front (+Z): rotate -90 degrees around Y!
    #   And Z (height) maps to +Y!

    # Unparent all
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            mw = o.matrix_world.copy()
            o.parent = None
            o.data.transform(mw)
            o.matrix_world = Matrix.Identity(4)
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o)

    # Transform from (X=front, Y=width, Z=height) to (Z=front, X=width, Y=height):
    # X_new = Y_old (width)
    # Y_new = Z_old (height)
    # Z_new = X_old (front)
    M_align = Matrix((
        (0, 1, 0, 0),
        (0, 0, 1, 0),
        (1, 0, 0, 0),
        (0, 0, 0, 1)
    ))
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.data.transform(M_align)

    # Separate wheel meshes from body meshes
    wheel_objs = [o for o in bpy.context.scene.objects if 'Wheel' in o.name or (o.data.materials and any('Wheel' in m.name for m in o.data.materials if m))]
    body_objs = [o for o in bpy.context.scene.objects if o not in wheel_objs]
    
    # Join wheel meshes
    bpy.ops.object.select_all(action='DESELECT')
    for o in wheel_objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = wheel_objs[0]
    if len(wheel_objs) > 1:
        bpy.ops.object.join()
    all_wheels = bpy.context.view_layer.objects.active

    # Find wheel centers:
    w_co = np.array([v.co for v in all_wheels.data.vertices])
    # Z has front and rear axles (Z > 0 front, Z < 0 rear)
    z_mid = (w_co[:, 2].max() + w_co[:, 2].min()) / 2
    # X has left and right (X < 0 left, X > 0 right)
    x_mid = (w_co[:, 0].max() + w_co[:, 0].min()) / 2
    
    # Split all_wheels mesh into 4 quadrant meshes (Wheel_FL, Wheel_FR, Wheel_RL, Wheel_RR)
    # Wheel quadrant definitions:
    # FL: x < x_mid, z > z_mid
    # FR: x > x_mid, z > z_mid
    # RL: x < x_mid, z < z_mid
    # RR: x > x_mid, z < z_mid
    quadrants = {
        "Wheel_FL": (lambda x, z: x < x_mid and z >= z_mid, True, -1),
        "Wheel_FR": (lambda x, z: x >= x_mid and z >= z_mid, True, 1),
        "Wheel_RL": (lambda x, z: x < x_mid and z < z_mid, False, -1),
        "Wheel_RR": (lambda x, z: x >= x_mid and z < z_mid, False, 1)
    }

    created_wheels = {}
    wheel_info = {}

    for q_name, (cond, is_front, side_sign) in quadrants.items():
        # duplicate all_wheels mesh
        w_new = all_wheels.copy()
        w_new.data = all_wheels.data.copy()
        w_new.name = q_name
        w_new.data.name = q_name
        bpy.context.scene.collection.objects.link(w_new)
        
        # delete vertices outside this quadrant
        bm = bmesh.new()
        bm.from_mesh(w_new.data)
        del_verts = [v for v in bm.verts if not cond(v.co.x, v.co.z)]
        bmesh.ops.delete(bm, geom=del_verts, context='VERTS')
        bm.to_mesh(w_new.data)
        bm.free()
        w_new.data.update()
        
        # calculate center and radius
        co = np.array([v.co for v in w_new.data.vertices])
        if len(co) == 0:
            log(f"Warning: no vertices for {q_name}")
            continue
        c_min, c_max = co.min(axis=0), co.max(axis=0)
        hub = (c_min + c_max) / 2
        radius = (c_max[1] - c_min[1]) / 2
        width = c_max[0] - c_min[0]
        
        # center local mesh origin at (0, 0, 0)
        w_new.data.transform(Matrix.Translation(-Vector(hub)))
        created_wheels[q_name] = w_new
        wheel_info[q_name] = {"hub": hub, "radius": radius, "width": width, "front": is_front}
        log(f"{q_name}: hub={hub}, radius={radius:.3f}, width={width:.3f}")

    # For Land Cruiser: Wheel_RL and Wheel_RR are the clean complete wheel objects.
    # We will use Wheel_RL for FL/RL, and Wheel_RR for FR/RR, ensuring symmetrical geometry.
    w_master_L = created_wheels["Wheel_RL"]
    w_master_R = created_wheels["Wheel_RR"]
    
    # Remove the malformed FL/FR from the spare part
    bpy.data.objects.remove(created_wheels["Wheel_FL"])
    bpy.data.objects.remove(created_wheels["Wheel_FR"])
    
    wheel_FL = w_master_L.copy()
    wheel_FL.data = w_master_L.data.copy()
    wheel_FL.name = "Wheel_FL"
    wheel_FL.data.name = "Wheel_FL"
    bpy.context.scene.collection.objects.link(wheel_FL)
    
    wheel_FR = w_master_R.copy()
    wheel_FR.data = w_master_R.data.copy()
    wheel_FR.name = "Wheel_FR"
    wheel_FR.data.name = "Wheel_FR"
    bpy.context.scene.collection.objects.link(wheel_FR)

    wheel_RL = w_master_L
    wheel_RR = w_master_R

    # FJ60 Land Cruiser geometry:
    # Wheelbase: 2.73m -> front_z = +1.365, rear_z = -1.365
    # Track width: 1.48m -> track_hw = 0.74m
    front_z = 1.365
    rear_z = -1.365
    track_hw = 0.74
    hub_radius = 0.44
    hub_width = 0.32
    hub_y = hub_radius

    wheel_info = {
        "Wheel_FL": {"hub": [-track_hw, hub_y, front_z], "radius": hub_radius, "width": hub_width, "front": True},
        "Wheel_FR": {"hub": [track_hw, hub_y, front_z], "radius": hub_radius, "width": hub_width, "front": True},
        "Wheel_RL": {"hub": [-track_hw, hub_y, rear_z], "radius": hub_radius, "width": hub_width, "front": False},
        "Wheel_RR": {"hub": [track_hw, hub_y, rear_z], "radius": hub_radius, "width": hub_width, "front": False}
    }

    # Decimate wheels for performance
    for w in [wheel_FL, wheel_FR, wheel_RL, wheel_RR]:
        mod = w.modifiers.new("Decimate", "DECIMATE")
        mod.ratio = 0.35
        bpy.context.view_layer.objects.active = w
        bpy.ops.object.modifier_apply(modifier="Decimate")

    # Join body meshes
    bpy.ops.object.select_all(action='DESELECT')
    for o in body_objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = body_objs[0]
    if len(body_objs) > 1:
        bpy.ops.object.join()
    body_obj = bpy.context.view_layer.objects.active
    body_obj.name = "Body"
    body_obj.data.name = "Body"

    # Normalize body position:
    # Ground clearance ~0.32m
    b_co = np.array([v.co for v in body_obj.data.vertices])
    body_shift_y = 0.32 - b_co[:, 1].min()
    body_shift_z = -(b_co[:, 2].max() + b_co[:, 2].min()) / 2
    body_shift_x = -(b_co[:, 0].max() + b_co[:, 0].min()) / 2
    body_obj.data.transform(Matrix.Translation(Vector((body_shift_x, body_shift_y, body_shift_z))))

    # Downscale textures: to avoid large file, downscale images to 1K/2K
    for img in bpy.data.images:
        if img.size[0] > 1024 or img.size[1] > 1024:
            new_w = min(1024, img.size[0] // 2)
            new_h = min(1024, img.size[1] // 2)
            log(f"Downscaling image {img.name} to {new_w}x{new_h}")
            img.scale(new_w, new_h)

    # Export Land Cruiser GLB
    out_glb = os.path.join(MODELS_DIR, "landcruiser_1985.glb")
    bpy.ops.export_scene.gltf(
        filepath=out_glb,
        export_format='GLB',
        use_selection=False,
        export_apply=True
    )
    log(f"Exported {out_glb} (size: {os.path.getsize(out_glb)/(1024*1024):.2f} MB)")

    # Specs
    b_co_final = np.array([v.co for v in body_obj.data.vertices])
    bf_min, bf_max = b_co_final.min(axis=0), b_co_final.max(axis=0)
    dims = {"length": round(float(bf_max[2] - bf_min[2]), 3), "width": round(float(bf_max[0] - bf_min[0]), 3), "height": round(float(bf_max[1] - bf_min[1]), 3)}

    lc_spec = {
        "id": "landcruiser_1985",
        "name": "Toyota Land Cruiser FJ60 1985 4WD",
        "shortName": "Land Cruiser '85",
        "typeLabel": "Экспедиционник • 4WD",
        "mass": 2150,
        "power": 26,
        "maxSpeed": 42,
        "lowMaxSpeed": 17,
        "torqueMult": 2.8,
        "clearance": 0.32,
        "sinkFactor": 0.52,
        "tireBite": 0.96,
        "hasAWD": True,
        "hasDiffLock": True,
        "drivenAxles": "all",
        "soundType": "jeep",
        "badge": "Heavy 4x4",
        "defaultPaintHex": 0xb8860b,
        "file": "models/landcruiser_1985.glb",
        "dims": dims,
        "wheels": [
            {"name": "Wheel_FL", "x": -track_hw, "y": hub_y, "z": front_z, "radius": hub_radius, "width": hub_width, "front": True},
            {"name": "Wheel_FR", "x": track_hw, "y": hub_y, "z": front_z, "radius": hub_radius, "width": hub_width, "front": True},
            {"name": "Wheel_RL", "x": -track_hw, "y": hub_y, "z": rear_z, "radius": hub_radius, "width": hub_width, "front": False},
            {"name": "Wheel_RR", "x": track_hw, "y": hub_y, "z": rear_z, "radius": hub_radius, "width": hub_width, "front": False}
        ],
        "frontAxleZ": front_z,
        "rearAxleZ": rear_z,
        "trackHalfWidth": track_hw,
        "bumperZ": round(float(bf_max[2]), 3),
        "exhaust": [0.55, 0.35, round(float(bf_min[2]), 3)],
        "winch": [0.0, 0.5, round(float(bf_max[2]), 3)],
        "roofHeight": round(float(bf_max[1]), 3),
        "paintMaterial": "paint",
        "hasLowGear": True,
        "hasAirBrakes": False,
        "physWidth": 0.32
    }

    with open(os.path.join(MODELS_DIR, "landcruiser_1985_spec.json"), "w", encoding="utf-8") as f:
        json.dump(lc_spec, f, indent=2, ensure_ascii=False, cls=NpEncoder)
    log("Saved landcruiser_1985_spec.json")

# ==============================================================================
# 3. PROCESS PHILIPPINES CITY MAP
# ==============================================================================
def process_philippines():
    log("=== PROCESSING PHILIPPINES MAP ===")
    reset_scene()
    src = os.path.join(TEMP_DIR, "philippines_test.glb")
    bpy.ops.import_scene.gltf(filepath=src)
    bpy.context.view_layer.update()

    # Raw bounds: DX=5.817, DY=0.560, DZ=6.436.
    # In glTF: Y is elevation, X is east-west, Z is north-south.
    # We want city scale ~450m x 500m. Scale factor = 75.0.
    scale = 75.0
    M_scale = Matrix.Scale(scale, 4)
    
    # Apply scale to all meshes
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            mw = o.matrix_world.copy()
            o.parent = None
            o.data.transform(M_scale @ mw)
            o.matrix_world = Matrix.Identity(4)
            
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o)

    # Join 3 tiles into one unified map mesh
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    map_obj = bpy.context.view_layer.objects.active
    map_obj.name = "Philippines_City"
    map_obj.data.name = "Philippines_City"

    # Analyze bounds
    co = np.array([v.co for v in map_obj.data.vertices])
    min_co = co.min(axis=0)
    max_co = co.max(axis=0)
    log(f"Scaled map bounds: min={min_co}, max={max_co}")
    log(f"Extents: X={max_co[0]-min_co[0]:.1f}m, Y={max_co[1]-min_co[1]:.1f}m, Z={max_co[2]-min_co[2]:.1f}m")

    # Center map around origin (X=0, Z=0)
    center_x = (min_co[0] + max_co[0]) / 2
    center_z = (min_co[2] + max_co[2]) / 2
    
    # Ground road level: road level in Lapu-Lapu scan is around the 25th percentile of height
    road_y = float(np.percentile(co[:, 1], 20))
    log(f"Detected road level at Y={road_y:.2f}m")
    
    T_align = Matrix.Translation(Vector((-center_x, -road_y, -center_z)))
    map_obj.data.transform(T_align)

    # Downscale the two 8K textures to 2048 so the browser loads in 1-2 seconds with 60 FPS
    for img in bpy.data.images:
        if img.size[0] > 2048 or img.size[1] > 2048:
            log(f"Downscaling map texture {img.name} ({img.size[0]}x{img.size[1]}) to 2048x2048...")
            img.scale(2048, 2048)

    # Export map GLB
    out_glb = os.path.join(MODELS_DIR, "map_philippines.glb")
    bpy.ops.export_scene.gltf(
        filepath=out_glb,
        export_format='GLB',
        use_selection=False,
        export_apply=True
    )
    log(f"Exported {out_glb} (size: {os.path.getsize(out_glb)/(1024*1024):.2f} MB)")

    # Build heightmap grid for instant physics height lookup
    # Grid: 256 x 256 over bounds
    co_final = np.array([v.co for v in map_obj.data.vertices])
    f_min = co_final.min(axis=0)
    f_max = co_final.max(axis=0)
    
    GRID_RES = 128
    gx = np.linspace(f_min[0], f_max[0], GRID_RES)
    gz = np.linspace(f_min[2], f_max[2], GRID_RES)
    
    # Compute elevation grid by nearest/k-d/binning
    log("Computing elevation grid for physics...")
    # Fast 2D binning for road height:
    cell_w = (f_max[0] - f_min[0]) / GRID_RES
    cell_h = (f_max[2] - f_min[2]) / GRID_RES
    
    grid = np.zeros((GRID_RES, GRID_RES), dtype=np.float32)
    counts = np.zeros((GRID_RES, GRID_RES), dtype=np.int32)
    
    ix = np.clip(((co_final[:, 0] - f_min[0]) / cell_w).astype(int), 0, GRID_RES - 1)
    iz = np.clip(((co_final[:, 2] - f_min[2]) / cell_h).astype(int), 0, GRID_RES - 1)
    
    # In each cell, we take the minimum height (road level, avoiding building tops for driving)
    grid.fill(999.0)
    for i in range(len(co_final)):
        y = co_final[i, 1]
        cx, cz = ix[i], iz[i]
        if y < grid[cz, cx]:
            grid[cz, cx] = y
            counts[cz, cx] += 1
            
    # Fill empty cells with median
    med = float(np.median(grid[grid < 900]))
    grid[grid > 900] = med
    
    # Smooth slightly
    grid = np.clip(grid, -5.0, 15.0) # clamp road heights
    
    map_meta = {
        "id": "philippines",
        "name": "Филиппины: Лапу-Лапу (Mactan New Town)",
        "file": "models/map_philippines.glb",
        "bounds": {
            "minX": round(float(f_min[0]), 2), "maxX": round(float(f_max[0]), 2),
            "minZ": round(float(f_min[2]), 2), "maxZ": round(float(f_max[2]), 2),
            "width": round(float(f_max[0] - f_min[0]), 2),
            "length": round(float(f_max[2] - f_min[2]), 2)
        },
        "gridRes": GRID_RES,
        "spawn": {"x": 10.0, "y": 0.5, "z": -20.0, "heading": 0.0},
        "elevationGrid": [round(float(v), 2) for v in grid.flatten()]
    }
    
    with open(os.path.join(MODELS_DIR, "philippines_meta.json"), "w", encoding="utf-8") as f:
        json.dump(map_meta, f, cls=NpEncoder)
    log("Saved philippines_meta.json")

# Run all 3
process_subaru()
process_landcruiser()
process_philippines()
log("ALL ASSETS PROCESSED SUCCESSFULLY!")
