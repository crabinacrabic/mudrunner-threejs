import bpy
import os
import math

BASE_DIR = r"C:\Users\MSI\Desktop\My Projects\AFRICAN_IT_DRIVERS"
MODELS_DIR = os.path.join(BASE_DIR, "models")
TOOLS_DIR = os.path.join(BASE_DIR, "tools")
ARTIFACT_DIR = r"C:\Users\MSI\.gemini\antigravity\brain\36f37e40-a893-4e45-90a8-72a13c535227"
OUT_IMG_ROOT = os.path.join(BASE_DIR, "philippines_topdown_map.png")
OUT_IMG_TOOLS = os.path.join(TOOLS_DIR, "philippines_topdown_map.png")
OUT_IMG_ARTIFACT = os.path.join(ARTIFACT_DIR, "philippines_topdown_map.png")

bpy.ops.wm.read_factory_settings(use_empty=True)

# 1. Import Philippines 3D model
glb_path = os.path.join(MODELS_DIR, "map_philippines.glb")
print(f"Importing {glb_path}...")
bpy.ops.import_scene.gltf(filepath=glb_path)

# 2. Load original 8192x8192 texture
tex_path = os.path.join(TOOLS_DIR, "textures", "gltf_embedded_0.jpeg")
if os.path.exists(tex_path):
    print(f"Loading 8K texture from {tex_path}...")
    hires_img = bpy.data.images.load(tex_path)
    hires_img.colorspace_settings.name = 'sRGB'
    for mat in bpy.data.materials:
        if mat.use_nodes:
            for node in mat.node_tree.nodes:
                if node.type == 'TEX_IMAGE':
                    node.image = hires_img
                    print(f"Updated material {mat.name} image to 8K texture ({hires_img.size[0]}x{hires_img.size[1]})")
else:
    print(f"Warning: {tex_path} not found, using embedded texture")

# 3. Setup World Lighting (bright, even, high clarity)
world = bpy.data.worlds.new("World")
bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
if bg:
    bg.inputs['Color'].default_value = (0.95, 0.95, 0.98, 1.0)
    bg.inputs['Strength'].default_value = 1.35

# 4. Sun Light with soft shadow for crisp road readability
light_data = bpy.data.lights.new(name="Sun", type='SUN')
light_data.energy = 2.2
light_data.color = (1.0, 0.98, 0.95)
light_obj = bpy.data.objects.new(name="Sun", object_data=light_data)
bpy.context.collection.objects.link(light_obj)
light_obj.rotation_euler = (math.radians(25), math.radians(10), math.radians(35))

# 5. Orthographic Camera
cam_data = bpy.data.cameras.new("TopCam")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 500.0  # Exactly 500 meters span
cam_obj = bpy.data.objects.new("TopCam", cam_data)
bpy.context.collection.objects.link(cam_obj)
cam_obj.location = (0, 0, 180)
cam_obj.rotation_euler = (0, 0, 0)
bpy.context.scene.camera = cam_obj

# 6. Render Settings: 4096 x 4096 (Ultra-HD for high zoom in editor)
res = 4096
bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT' if hasattr(bpy.types, 'RenderEngineEEVEENext') else 'BLENDER_EEVEE'
bpy.context.scene.render.resolution_x = res
bpy.context.scene.render.resolution_y = res
bpy.context.scene.render.resolution_percentage = 100
bpy.context.scene.render.image_settings.file_format = 'PNG'
bpy.context.scene.render.image_settings.color_mode = 'RGB'
bpy.context.scene.render.image_settings.compression = 15  # Fast save, high quality

bpy.context.scene.render.filepath = OUT_IMG_ROOT
print(f"Rendering {res}x{res} map to {OUT_IMG_ROOT}...")
bpy.ops.render.render(write_still=True)

# Copy to tools and artifact directories
import shutil
shutil.copyfile(OUT_IMG_ROOT, OUT_IMG_TOOLS)
shutil.copyfile(OUT_IMG_ROOT, OUT_IMG_ARTIFACT)

print(f"Hires map successfully rendered and saved to all targets!")
