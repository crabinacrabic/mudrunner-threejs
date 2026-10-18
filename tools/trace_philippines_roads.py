"""
Trace the road network of Mactan New Town, Philippines from the scan,
generate 3D spline ribbons over the scan, render an annotated map,
and export the road path coordinates to JSON for Three.js.
"""
import bpy
import os
import math
import json
from mathutils import Vector

BASE_DIR = r"C:\Users\MSI\Desktop\My Projects\AFRICAN_IT_DRIVERS"
ARTIFACT_DIR = r"C:\Users\MSI\.gemini\antigravity\brain\36f37e40-a893-4e45-90a8-72a13c535227"
OUT_IMG = os.path.join(ARTIFACT_DIR, "philippines_roads_annotated.png")
OUT_JSON = os.path.join(BASE_DIR, "models", "philippines_roads.json")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(BASE_DIR, "models", "map_philippines.glb"))

# Helper: convert pixel (x, y) on 1024x1024 ortho-500 map to Blender (x, y)
# In our previous render:
# cam_data.ortho_scale = 500, resolution = 1024
# Center (512, 512) is (0, 0)
def px_to_blender(px, py):
    bx = (px - 512.0) * (500.0 / 1024.0)
    by = (512.0 - py) * (500.0 / 1024.0)
    return bx, by

def blender_to_three(bx, by, bz=0):
    # glTF X = bx, glTF Y = bz (Up), glTF Z = -by
    return bx, bz, -by

# Defined routes based on visual scan analysis:
# Route 1: Central Mactan Boulevard (main highway through business district)
route_boulevard_px = [
    (575, 845), # South Gate
    (575, 805), # South Roundabout
    (580, 730), # South Avenue
    (575, 660), # Mid Avenue South
    (550, 580), # Central Boulevard Curve
    (535, 510), # Center Highrise Plaza
    (550, 440), # North Boulevard
    (600, 340), # North Main Junction
]

# Route 2: Ocean Beach Promenade (towards Shangri-La / Mactan Newtown Beach)
route_beach_px = [
    (600, 340), # From North Junction
    (595, 275), # North Hill Pass
    (605, 215), # Resort Gate
    (645, 175), # Beach Approach
    (730, 155), # Beachfront Overlook
    (810, 175), # Pier Entrance Road
    (860, 150), # Boat Marina / Pier
]

# Route 3: West Mangrove Trail (towards tidal inlet / village)
route_mangrove_px = [
    (550, 580), # Branch from Central Blvd
    (495, 590), # Plaza West Branch
    (445, 600), # West Canal Bridge
    (330, 595), # Mangrove Overlook Road
    (300, 675), # Lagoon Shore Trail
    (270, 720), # Fishing Village Pier
]

# Route 4: Central Plaza Loop
route_plaza_px = [
    (550, 580), # Split from Boulevard
    (465, 555), # Northwest Plaza Corner
    (445, 615), # West Plaza Corner
    (470, 680), # Southwest Plaza Corner
    (540, 670), # Reconnect to Boulevard
]

# Route 5: East Hillside Bypass (residential loop)
route_east_px = [
    (580, 730), # East Split South
    (630, 715), # East Hillside
    (660, 630), # East Residential
    (670, 530), # Hilltop Terrace
    (665, 410), # North-East Road
    (600, 340), # Reconnect to North Junction
]

routes = {
    "mactan_boulevard": {
        "name": "Mactan New Town Boulevard (Главный проспект)",
        "color": (1.0, 0.8, 0.0, 1.0), # Amber Yellow
        "width": 10.0,
        "points_px": route_boulevard_px
    },
    "beach_promenade": {
        "name": "Mactan Beach & Marina Access (Пляжный трек)",
        "color": (0.0, 0.9, 1.0, 1.0), # Cyan
        "width": 8.0,
        "points_px": route_beach_px
    },
    "mangrove_trail": {
        "name": "West Mangrove & Village Trail (Мангровый залив)",
        "color": (0.2, 1.0, 0.3, 1.0), # Mint Green
        "width": 7.0,
        "points_px": route_mangrove_px
    },
    "plaza_loop": {
        "name": "Central Plaza Ring (Кольцо бизнес-центра)",
        "color": (1.0, 0.3, 0.2, 1.0), # Orange Red
        "width": 8.0,
        "points_px": route_plaza_px
    },
    "east_bypass": {
        "name": "East Residential Bypass (Восточный объезд)",
        "color": (0.8, 0.3, 1.0, 1.0), # Purple
        "width": 6.5,
        "points_px": route_east_px
    }
}

# Export data for Three.js
export_data = {
    "routes": {}
}

# Setup lighting & world for render
world = bpy.data.worlds.new("World")
bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
if bg:
    bg.inputs['Color'].default_value = (0.95, 0.95, 0.98, 1.0)
    bg.inputs['Strength'].default_value = 1.0

light_data = bpy.data.lights.new(name="Sun", type='SUN')
light_data.energy = 2.5
light_obj = bpy.data.objects.new(name="Sun", object_data=light_data)
bpy.context.collection.objects.link(light_obj)
light_obj.rotation_euler = (math.radians(20), math.radians(15), math.radians(45))

# Create 3D curve ribbons for each route
for route_id, route in routes.items():
    points_3d_blender = []
    points_three = []
    
    for px, py in route["points_px"]:
        bx, by = px_to_blender(px, py)
        # Sample ground height from scan mesh if possible, or elevated slightly for visual
        # Height on scan is mostly around Z = 15m to 25m
        bz = 28.0 # render high enough to float clearly above buildings/roads
        points_3d_blender.append((bx, by, bz))
        
        tx, ty, tz = blender_to_three(bx, by, bz=10.0)
        points_three.append({
            "x": round(tx, 2),
            "z": round(tz, 2)
        })
    
    export_data["routes"][route_id] = {
        "name": route["name"],
        "width": route["width"],
        "points": points_three
    }
    
    # Create Blender curve
    curve_data = bpy.data.curves.new(name=route_id, type='CURVE')
    curve_data.dimensions = '3D'
    curve_data.bevel_depth = 2.5 # thick visible line
    curve_data.bevel_resolution = 4
    
    spline = curve_data.splines.new('POLY')
    spline.points.add(len(points_3d_blender) - 1)
    for i, pt in enumerate(points_3d_blender):
        spline.points[i].co = (pt[0], pt[1], pt[2], 1.0)
        
    curve_obj = bpy.data.objects.new(name=route_id, object_data=curve_data)
    bpy.context.collection.objects.link(curve_obj)
    
    # Material
    mat = bpy.data.materials.new(name=f"Mat_{route_id}")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs['Base Color'].default_value = route["color"]
        bsdf.inputs['Roughness'].default_value = 0.2
        if 'Emission Color' in bsdf.inputs:
            bsdf.inputs['Emission Color'].default_value = route["color"]
            bsdf.inputs['Emission Strength'].default_value = 0.8
    curve_obj.data.materials.append(mat)

# Save JSON
with open(OUT_JSON, "w", encoding="utf-8") as f:
    json.dump(export_data, f, ensure_ascii=False, indent=2)
print(f"Exported routes to {OUT_JSON}")

# Setup Top Camera
cam_data = bpy.data.cameras.new("TopCam")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 500
cam_obj = bpy.data.objects.new("TopCam", cam_data)
bpy.context.collection.objects.link(cam_obj)
cam_obj.location = (0, 0, 160)
cam_obj.rotation_euler = (0, 0, 0)
bpy.context.scene.camera = cam_obj

# Render settings
bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT' if hasattr(bpy.types, 'RenderEngineEEVEENext') else 'BLENDER_EEVEE'
bpy.context.scene.render.resolution_x = 1024
bpy.context.scene.render.resolution_y = 1024
bpy.context.scene.render.filepath = OUT_IMG
bpy.context.scene.render.image_settings.file_format = 'PNG'

bpy.ops.render.render(write_still=True)
print(f"Annotated render saved to {OUT_IMG}")
