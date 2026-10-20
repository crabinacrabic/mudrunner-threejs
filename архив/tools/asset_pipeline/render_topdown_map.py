"""
Render a high resolution top-down orthographic map of Philippines (Mactan New Town)
to inspect all roads, coastline, and landmarks.
"""
import bpy
import os
import math
from mathutils import Vector

BASE_DIR = r"C:\Users\MSI\Desktop\My Projects\AFRICAN_IT_DRIVERS"
ARTIFACT_DIR = r"C:\Users\MSI\.gemini\antigravity\brain\36f37e40-a893-4e45-90a8-72a13c535227"
OUT_IMG = os.path.join(ARTIFACT_DIR, "philippines_topdown_map.png")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(BASE_DIR, "models", "map_philippines.glb"))

# Set background / world
world = bpy.data.worlds.new("World")
bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
if bg:
    bg.inputs['Color'].default_value = (0.9, 0.9, 0.95, 1.0)
    bg.inputs['Strength'].default_value = 1.2

# Setup sun
light_data = bpy.data.lights.new(name="Sun", type='SUN')
light_data.energy = 2.0
light_obj = bpy.data.objects.new(name="Sun", object_data=light_data)
bpy.context.collection.objects.link(light_obj)
light_obj.rotation_euler = (math.radians(20), math.radians(15), math.radians(45))

# Setup orthographic camera directly above the map
cam_data = bpy.data.cameras.new("TopCam")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 500  # Map is ~440x485m
cam_obj = bpy.data.objects.new("TopCam", cam_data)
bpy.context.collection.objects.link(cam_obj)
cam_obj.location = (0, 0, 150)
cam_obj.rotation_euler = (0, 0, 0)
bpy.context.scene.camera = cam_obj

# Render settings
bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT' if hasattr(bpy.types, 'RenderEngineEEVEENext') else 'BLENDER_EEVEE'
bpy.context.scene.render.resolution_x = 1024
bpy.context.scene.render.resolution_y = 1024
bpy.context.scene.render.filepath = OUT_IMG
bpy.context.scene.render.image_settings.file_format = 'PNG'

bpy.ops.render.render(write_still=True)
print(f"Topdown render saved to {OUT_IMG}")
