import bpy
import bmesh
import math
import os

BASE_DIR = r"C:\Users\MSI\Desktop\My Projects\AFRICAN_IT_DRIVERS"
SRC_GLB = os.path.join(BASE_DIR, "models", "map_philippines.glb")
OUT_GLB = os.path.join(BASE_DIR, "models", "philippines_skyscrapers.glb")
PREV_IMG = r"C:\tools\preview_clean_towers_only.png"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC_GLB)

# Join into single object
mesh_objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.context.view_layer.objects.active = mesh_objs[0]
for o in mesh_objs:
    o.select_set(True)
bpy.ops.object.join()
joined = bpy.context.active_object

# Delete ground faces below 11.2m
bpy.ops.object.mode_set(mode='EDIT')
bm = bmesh.from_edit_mesh(joined.data)
del_faces = [f for f in bm.faces if max(v.co.z for v in f.verts) < 11.2]
bmesh.ops.delete(bm, geom=del_faces, context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if len(v.link_faces) == 0], context='VERTS')
bmesh.update_edit_mesh(joined.data)
bpy.ops.object.mode_set(mode='OBJECT')

# Separate by loose parts
bpy.ops.mesh.separate(type='LOOSE')

parts = [o for o in bpy.context.scene.objects if o.type == 'MESH']
print(f"Total loose parts separated: {len(parts)}")

kept_parts = []
removed_count = 0
for p in parts:
    xs = [v.co.x for v in p.data.vertices]
    ys = [v.co.y for v in p.data.vertices]
    zs = [v.co.z for v in p.data.vertices]
    z_max = max(zs)
    z_min = min(zs)
    span = z_max - z_min
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)

    # Core Downtown Mactan New Town Business District:
    # Towers are clustered in X: [-25..70], Y: [-105..55] with height reaching > 22m and vertical span > 8m
    in_downtown = (-25 <= x_min and x_max <= 75 and -105 <= y_min and y_max <= 60)
    is_tower = (z_max >= 22.0 and span >= 8.0 and len(p.data.vertices) >= 50)

    if in_downtown and is_tower:
        kept_parts.append(p)
    else:
        bpy.data.objects.remove(p, do_unlink=True)
        removed_count += 1

print(f"Kept {len(kept_parts)} authentic downtown skyscrapers (removed {removed_count} peripheral fragments/rubble)")

# Join kept towers back together
bpy.context.view_layer.objects.active = kept_parts[0]
for o in kept_parts:
    o.select_set(True)
bpy.ops.object.join()
towers_obj = bpy.context.active_object
towers_obj.name = "Philippines_Skyscrapers"

# Downscale textures if larger than 2048
for img in bpy.data.images:
    if img.size[0] > 2048 or img.size[1] > 2048:
        img.scale(2048, 2048)

# Export clean GLB
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB')
print(f"Exported {OUT_GLB} ({os.path.getsize(OUT_GLB) / 1024:.1f} KB)")

# Render preview
cam_data = bpy.data.cameras.new('Cam')
cam_obj = bpy.data.objects.new('Cam', cam_data)
bpy.context.collection.objects.link(cam_obj)
cam_obj.location = (80, -150, 90)
cam_obj.rotation_euler = (math.radians(60), 0, math.radians(25))
bpy.context.scene.camera = cam_obj
light = bpy.data.lights.new('Sun', 'SUN')
light_obj = bpy.data.objects.new('Sun', light)
bpy.context.collection.objects.link(light_obj)
light_obj.rotation_euler = (math.radians(45), math.radians(20), 0)
bpy.context.scene.render.resolution_x = 800
bpy.context.scene.render.resolution_y = 600
bpy.context.scene.render.filepath = PREV_IMG
bpy.ops.render.render(write_still=True)
print(f"Saved preview to {PREV_IMG}")
