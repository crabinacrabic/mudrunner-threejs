"""
Clean reprocessing of:
1. Subaru L-Series 1990 4WD Sports Wagon -> models/subaru_l_series.glb
2. Toyota Land Cruiser FJ60 1985 4WD -> models/landcruiser_1985.glb
3. Philippines Lapu-Lapu Map -> models/map_philippines.glb + models/philippines_meta.json
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
TEMP_DIR = os.environ.get("TEMP", r"C:\Users\MSI\AppData\Local\Temp")

def log(*args):
    print("[CLEAN_PROCESS]", *args, flush=True)

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
# 1. PROCESS SUBARU L-SERIES
# ==============================================================================
def process_subaru():
    log("==========================================")
    log("PROCESSING SUBARU L-SERIES")
    log("==========================================")
    reset_scene()
    src = os.path.join(TEMP_DIR, "Subaru_L_Series_4WD_1990_Sports_Wagon.glb")
    bpy.ops.import_scene.gltf(filepath=src)
    bpy.context.view_layer.update()

    # Raw Subaru in Blender:
    # X = width (1.579m, min=-0.789, max=0.789)
    # Y = length (-Y is front hood, +Y is rear trunk)
    # Z = height (0.265 to 1.389)
    # Wheel master: nut_middle_02_low_Subaru_L_Wheel_0
    
    # Real specs for Subaru Leone / Loyale 1990 Wagon:
    # Length: 4.41 m, Width: 1.66 m, Height: 1.45 m
    # Wheelbase: 2.47 m, Track: 1.42 m (half: 0.71 m)
    # Wheel radius: ~0.30 m
    
    wheel_master = bpy.data.objects.get("nut_middle_02_low_Subaru_L_Wheel_0")
    if not wheel_master:
        raise RuntimeError("Subaru wheel master not found!")
        
    # Remove extra wheel duplicates from raw glb
    for n in ["nut_middle_02_low.004_Subaru_L_Wheel.001_0", "nut_middle_02_low.001_Subaru_L_Wheel.001_0", 
             "nut_middle_02_low.002_Subaru_L_Wheel.002_0", "blackout_low.003_Wheel.002_0", "blackout_low.004_Wheel.001_0"]:
        o = bpy.data.objects.get(n)
        if o and o != wheel_master:
            bpy.data.objects.remove(o)

    # Get wheel geometry and center it
    w_co = np.array([v.co for v in wheel_master.data.vertices])
    w_min, w_max = w_co.min(axis=0), w_co.max(axis=0)
    w_center = (w_min + w_max) / 2
    w_size = w_max - w_min
    log(f"Subaru wheel raw size: X={w_size[0]:.3f}, Y={w_size[1]:.3f}, Z={w_size[2]:.3f}")
    
    # Center wheel master vertices at local (0, 0, 0)
    wheel_master.data.transform(Matrix.Translation(-Vector(w_center)))
    wheel_master.matrix_world = Matrix.Identity(4)
    
    # Scale: target width 1.66m (raw body width 1.579m) -> scale factor 1.66 / 1.579 = 1.051
    scale_subaru = 1.66 / 1.579
    log(f"Subaru scale factor: {scale_subaru:.4f}")

    # Scale all objects
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.data.transform(Matrix.Scale(scale_subaru, 4))
            o.matrix_world = Matrix.Identity(4)

    # Re-measure body bounds (excluding wheel master)
    body_objs = [o for o in bpy.context.scene.objects if o != wheel_master and o.type == 'MESH']
    b_verts = np.vstack([np.array([v.co for v in o.data.vertices]) for o in body_objs])
    b_min, b_max = b_verts.min(axis=0), b_verts.max(axis=0)
    log(f"Subaru body scaled bounds: min={b_min}, max={b_max}, dims={b_max - b_min}")

    # Wheel radius after scaling
    wheel_radius = 0.31  # ~31cm
    wheel_width = 0.20   # ~20cm
    
    # In Blender:
    # Front is -Y! Front axle at Y = -1.235 m.
    # Rear is +Y! Rear axle at Y = +1.235 m.
    # Track half width: X = ±0.71 m.
    # Ground is at Z = 0. Hub height is at Z = wheel_radius = 0.31 m.
    
    # Adjust body Z so that the bottom of the body clears ground appropriately
    # Current body lowest Z is around 0.28m, which gives ~20cm clearance.
    
    # Create the 4 wheels with proper parent and transform
    wheel_master.name = "Wheel_FL"
    wheel_master.location = Vector((-0.71, -1.235, wheel_radius))
    
    def copy_wheel(name, loc, flip_x=False):
        w_new = wheel_master.copy()
        w_new.data = wheel_master.data.copy()
        w_new.name = name
        w_new.location = Vector(loc)
        if flip_x:
            # Mirror across X so outer hub faces outwards on right side
            w_new.data.transform(Matrix.Scale(-1, 4, Vector((1, 0, 0))))
            # Invert normals to fix flipped faces from negative scale
            bm = bmesh.new()
            bm.from_mesh(w_new.data)
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
            bm.to_mesh(w_new.data)
            bm.free()
        bpy.context.collection.objects.link(w_new)
        return w_new

    w_fr = copy_wheel("Wheel_FR", (0.71, -1.235, wheel_radius), flip_x=True)
    w_rl = copy_wheel("Wheel_RL", (-0.71, 1.235, wheel_radius), flip_x=False)
    w_rr = copy_wheel("Wheel_RR", (0.71, 1.235, wheel_radius), flip_x=True)

    # Recalculate normals on all meshes
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.to_mesh(o.data)
            bm.free()

    dst = os.path.join(MODELS_DIR, "subaru_l_series.glb")
    bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB')
    log(f"Exported Subaru to {dst} ({os.path.getsize(dst)/1024:.1f} KB)")


# ==============================================================================
# 2. PROCESS TOYOTA LAND CRUISER FJ60 1985
# ==============================================================================
def process_landcruiser():
    log("==========================================")
    log("PROCESSING TOYOTA LAND CRUISER FJ60 1985")
    log("==========================================")
    reset_scene()
    src = os.path.join(TEMP_DIR, "Toyota_Landcruiser_1985_4WD.glb")
    bpy.ops.import_scene.gltf(filepath=src)
    bpy.context.view_layer.update()

    # Raw Land Cruiser:
    # Front is +X, Rear is -X, Width is Y, Height is Z.
    # To map to Blender standard (Front is -Y, Width is X, Height is Z):
    # Rotate -90° around Z axis: (x, y, z) -> (y, -x, z).
    R_z = Matrix.Rotation(-math.pi / 2, 4, 'Z')
    
    # Real specs for FJ60 Land Cruiser:
    # Length: 4.675 m (raw is 4.55 m, scale ~ 1.027)
    # Width: 1.80 m
    # Height: 1.75 m
    # Wheelbase: 2.73 m (front: 1.365m, rear: -1.365m)
    # Track half width: 0.74 m
    # Wheel radius: ~0.40 m (31" tires)
    scale_lc = 4.675 / 4.55
    T_lc = Matrix.Scale(scale_lc, 4) @ R_z

    # Apply transform to all meshes
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            mw = o.matrix_world.copy()
            o.parent = None
            o.data.transform(T_lc @ mw)
            o.matrix_world = Matrix.Identity(4)

    # Remove non-meshes
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o)

    # In raw LC, backNob_low.004_Wheel_0 is one wheel
    wheel_master = bpy.data.objects.get("backNob_low.004_Wheel_0")
    if not wheel_master:
        wheel_master = bpy.data.objects.get("backNob_low.001_Wheel_0")
        
    for n in ["backNob_low.001_Wheel_0", "backNob_low.004_Wheel_0", "backNob_low.005_Wheel_0"]:
        o = bpy.data.objects.get(n)
        if o and o != wheel_master:
            bpy.data.objects.remove(o)

    # Center wheel master
    w_co = np.array([v.co for v in wheel_master.data.vertices])
    w_min, w_max = w_co.min(axis=0), w_co.max(axis=0)
    w_center = (w_min + w_max) / 2
    wheel_master.data.transform(Matrix.Translation(-Vector(w_center)))
    wheel_master.matrix_world = Matrix.Identity(4)
    
    wheel_radius = 0.40
    wheel_width = 0.30
    
    # Center body horizontally
    body_objs = [o for o in bpy.context.scene.objects if o != wheel_master and o.type == 'MESH']
    b_verts = np.vstack([np.array([v.co for v in o.data.vertices]) for o in body_objs])
    b_min, b_max = b_verts.min(axis=0), b_verts.max(axis=0)
    center_offset = Vector(((b_min[0] + b_max[0])/2, (b_min[1] + b_max[1])/2, 0))
    for o in body_objs:
        o.data.transform(Matrix.Translation(-center_offset))

    # Downscale large textures if any (to optimize loading speed)
    for img in bpy.data.images:
        if img.size[0] > 2048 or img.size[1] > 2048:
            log(f"Downscaling image {img.name} from {img.size[0]}x{img.size[1]} to 2048x2048")
            img.scale(2048, 2048)

    # Create 4 wheels
    wheel_master.name = "Wheel_FL"
    wheel_master.location = Vector((-0.74, -1.365, wheel_radius))
    
    def copy_lc_wheel(name, loc, flip_x=False):
        w_new = wheel_master.copy()
        w_new.data = wheel_master.data.copy()
        w_new.name = name
        w_new.location = Vector(loc)
        if flip_x:
            w_new.data.transform(Matrix.Scale(-1, 4, Vector((1, 0, 0))))
            bm = bmesh.new()
            bm.from_mesh(w_new.data)
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
            bm.to_mesh(w_new.data)
            bm.free()
        bpy.context.collection.objects.link(w_new)
        return w_new

    w_fr = copy_lc_wheel("Wheel_FR", (0.74, -1.365, wheel_radius), flip_x=True)
    w_rl = copy_lc_wheel("Wheel_RL", (-0.74, 1.365, wheel_radius), flip_x=False)
    w_rr = copy_lc_wheel("Wheel_RR", (0.74, 1.365, wheel_radius), flip_x=True)

    # Recalculate normals on all meshes
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.to_mesh(o.data)
            bm.free()

    dst = os.path.join(MODELS_DIR, "landcruiser_1985.glb")
    bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB')
    log(f"Exported Land Cruiser to {dst} ({os.path.getsize(dst)/1024:.1f} KB)")


# ==============================================================================
# 3. PROCESS PHILIPPINES LAPU-LAPU MAP
# ==============================================================================
def process_philippines():
    log("==========================================")
    log("PROCESSING PHILIPPINES LAPU-LAPU MAP")
    log("==========================================")
    reset_scene()
    src = os.path.join(TEMP_DIR, "philippines_test.glb")
    bpy.ops.import_scene.gltf(filepath=src)
    bpy.context.view_layer.update()

    # Raw bounds in Blender:
    # X = width (5.817)
    # Y = elevation (0.458)
    # Z = length (6.436)
    # Rotate +90° around X so Y becomes Z (elevation / UP) and Z becomes -Y (length):
    # R_x: (x, y, z) -> (x, -z, y).
    R_x = Matrix.Rotation(math.pi / 2, 4, 'X')
    
    scale_ph = 75.0
    T_ph = Matrix.Scale(scale_ph, 4) @ R_x

    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.data.transform(T_ph @ mw)
        o.matrix_world = Matrix.Identity(4)

    # Measure bounds in new coordinates
    all_verts = np.vstack([np.array([v.co for v in o.data.vertices]) for o in meshes])
    b_min, b_max = all_verts.min(axis=0), all_verts.max(axis=0)
    log(f"Transformed bounds: min={b_min}, max={b_max}, dims={b_max - b_min}")

    # Center horizontally and align elevation:
    # Ground/sea level at Z = 0
    center_x = (b_min[0] + b_max[0]) / 2
    center_y = (b_min[1] + b_max[1]) / 2
    min_z = b_min[2]
    
    offset = Vector((-center_x, -center_y, -min_z))
    for o in meshes:
        o.data.transform(Matrix.Translation(offset))

    # Re-calculate bounds
    all_verts = np.vstack([np.array([v.co for v in o.data.vertices]) for o in meshes])
    b_min, b_max = all_verts.min(axis=0), all_verts.max(axis=0)
    log(f"Final centered bounds: min={b_min}, max={b_max}")

    # Compute 128x128 height grid
    # In glTF/Three.js:
    # glTF_X = Blender_X
    # glTF_Y = Blender_Z (Elevation!)
    # glTF_Z = -Blender_Y
    # So:
    # Three.js X bounds: [b_min[0], b_max[0]]
    # Three.js Z bounds: [-b_max[1], -b_min[1]]
    grid_res = 128
    x_coords = np.linspace(b_min[0], b_max[0], grid_res)
    # Three.js Z corresponds to -Blender_Y:
    three_z_min, three_z_max = -b_max[1], -b_min[1]
    z_coords = np.linspace(three_z_min, three_z_max, grid_res)
    
    # We will sample the vertex elevations to build the height grid
    # For fast rasterization: bin vertices into grid cells and take lowest/median elevation (ground)
    log("Computing 128x128 ground elevation grid...")
    # Vertices in Three.js coords:
    # v_x = vert[0]
    # v_y = vert[2] (elevation)
    # v_z = -vert[1]
    vx = all_verts[:, 0]
    vy = all_verts[:, 2]
    vz = -all_verts[:, 1]

    grid = np.zeros((grid_res, grid_res), dtype=np.float32)
    counts = np.zeros((grid_res, grid_res), dtype=np.int32)
    
    # Map vertices to cell indices
    ix = np.clip(((vx - b_min[0]) / (b_max[0] - b_min[0]) * (grid_res - 1)).astype(np.int32), 0, grid_res - 1)
    iz = np.clip(((vz - three_z_min) / (three_z_max - three_z_min) * (grid_res - 1)).astype(np.int32), 0, grid_res - 1)

    # For driving roads, we want the ground/street height, not building rooftops.
    # We take the 20th percentile or minimum of heights in each bin.
    # Group by (iz, ix)
    cell_bins = {}
    for i in range(len(vx)):
        k = (iz[i], ix[i])
        if k not in cell_bins:
            cell_bins[k] = []
        # Sample subset for speed
        if len(cell_bins[k]) < 50:
            cell_bins[k].append(vy[i])

    for (r, c), heights in cell_bins.items():
        # Road level is near the bottom of vertices in that horizontal bin
        h_sorted = sorted(heights)
        # Use 15th percentile to avoid sub-ground glitches while rejecting rooftops
        p15_idx = int(len(h_sorted) * 0.15)
        grid[r, c] = h_sorted[p15_idx]
        counts[r, c] = 1

    # Infill empty cells using nearest known neighbor / simple Gaussian-like diffusion
    for r in range(grid_res):
        for c in range(grid_res):
            if counts[r, c] == 0:
                # search local window
                window = []
                for dr in range(-4, 5):
                    for dc in range(-4, 5):
                        nr, nc = r + dr, c + dc
                        if 0 <= nr < grid_res and 0 <= nc < grid_res and counts[nr, nc] > 0:
                            window.append(grid[nr, nc])
                if window:
                    grid[r, c] = float(np.mean(window))
                else:
                    grid[r, c] = 10.0  # default street level

    # Smooth the grid slightly to make driving buttery smooth using pure numpy
    smoothed_grid = grid.copy()
    for _ in range(2):
        padded = np.pad(smoothed_grid, 1, mode='edge')
        smoothed_grid = (
            padded[0:-2, 0:-2] * 1 + padded[0:-2, 1:-1] * 2 + padded[0:-2, 2:] * 1 +
            padded[1:-1, 0:-2] * 2 + padded[1:-1, 1:-1] * 4 + padded[1:-1, 2:] * 2 +
            padded[2:, 0:-2] * 1 + padded[2:, 1:-1] * 2 + padded[2:, 2:] * 1
        ) / 16.0

    meta = {
        "id": "philippines",
        "name": "Филиппины: Лапу-Лапу (Mactan New Town)",
        "bounds": {
            "minX": float(b_min[0]),
            "maxX": float(b_max[0]),
            "minZ": float(three_z_min),
            "maxZ": float(three_z_max)
        },
        "res": grid_res,
        "defaultSpawn": [0.0, float(smoothed_grid[grid_res//2, grid_res//2]), 0.0],
        "grid": smoothed_grid.tolist()
    }
    
    meta_path = os.path.join(MODELS_DIR, "philippines_meta.json")
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, cls=NpEncoder)
    log(f"Saved height grid to {meta_path} (Spawn height: {meta['defaultSpawn'][1]:.2f}m)")

    # Downscale textures if necessary
    for img in bpy.data.images:
        if img.size[0] > 2048 or img.size[1] > 2048:
            log(f"Downscaling image {img.name} from {img.size[0]}x{img.size[1]} to 2048x2048")
            img.scale(2048, 2048)

    dst = os.path.join(MODELS_DIR, "map_philippines.glb")
    bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB')
    log(f"Exported Philippines map to {dst} ({os.path.getsize(dst)/1024:.1f} KB)")


if __name__ == "__main__":
    process_subaru()
    process_landcruiser()
    process_philippines()
    log("ALL 3 ASSETS PROCESSED SUCCESSFULLY!")
