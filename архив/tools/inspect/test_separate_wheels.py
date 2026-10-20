import bpy
from mathutils import Vector

def test_loose(tmp_glb, name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=tmp_glb)
    
    # Select all wheel meshes
    wheel_objs = [o for o in bpy.context.scene.objects if o.type == 'MESH' and any('Wheel' in m.name for m in o.data.materials if m)]
    print(f"=== {name}: found {len(wheel_objs)} wheel objects before loose separation ===")
    
    bpy.ops.object.select_all(action='DESELECT')
    for o in wheel_objs:
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.separate(type='LOOSE')
        bpy.ops.object.mode_set(mode='OBJECT')
        
    new_wheels = [o for o in bpy.context.scene.objects if o.type == 'MESH' and any('Wheel' in m.name for m in o.data.materials if m)]
    print(f"=== {name}: after loose separation: {len(new_wheels)} wheel parts ===")
    for o in new_wheels:
        bbox = [o.matrix_world @ Vector(b) for b in o.bound_box]
        xs = [b.x for b in bbox]; ys = [b.y for b in bbox]; zs = [b.z for b in bbox]
        min_v = Vector((min(xs), min(ys), min(zs)))
        max_v = Vector((max(xs), max(ys), max(zs)))
        center = (min_v + max_v) / 2
        size = max_v - min_v
        print(f"  Part: {o.name:<30} center=({center.x:5.2f}, {center.y:5.2f}, {center.z:5.2f}) size=({size.x:4.2f}, {size.y:4.2f}, {size.z:4.2f}) polys={len(o.data.polygons)}")

test_loose(r"C:\Users\MSI\AppData\Local\Temp\Toyota_Landcruiser_1985_4WD.glb", "Toyota Land Cruiser")
test_loose(r"C:\Users\MSI\AppData\Local\Temp\Subaru_L_Series_4WD_1990_Sports_Wagon.glb", "Subaru L-Series")
