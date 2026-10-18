import struct
import json
import os
import zipfile

def analyze_glb(data, name="GLB"):
    magic, version, length = struct.unpack('<4sII', data[:12])
    if magic != b'glTF':
        return f"{name}: Not a valid GLB"
    
    # Read chunk 0 (JSON)
    chunk_len, chunk_type = struct.unpack('<II', data[12:20])
    if chunk_type != 0x4E4F534A: # 'JSON'
        return f"{name}: First chunk is not JSON"
    
    json_bytes = data[20:20+chunk_len]
    gltf = json.loads(json_bytes.decode('utf-8'))
    
    accessors = gltf.get('accessors', [])
    meshes = gltf.get('meshes', [])
    materials = gltf.get('materials', [])
    textures = gltf.get('textures', [])
    images = gltf.get('images', [])
    
    total_triangles = 0
    total_vertices = 0
    
    for mesh in meshes:
        for prim in mesh.get('primitives', []):
            mode = prim.get('mode', 4) # 4 is TRIANGLES
            pos_acc_idx = prim.get('attributes', {}).get('POSITION')
            if pos_acc_idx is not None and pos_acc_idx < len(accessors):
                pos_acc = accessors[pos_acc_idx]
                total_vertices += pos_acc.get('count', 0)
            
            indices_idx = prim.get('indices')
            if indices_idx is not None and indices_idx < len(accessors):
                ind_acc = accessors[indices_idx]
                cnt = ind_acc.get('count', 0)
                if mode == 4:
                    total_triangles += cnt // 3
                elif mode == 5: # TRIANGLE_STRIP
                    total_triangles += max(0, cnt - 2)
                elif mode == 6: # TRIANGLE_FAN
                    total_triangles += max(0, cnt - 2)
            else:
                if pos_acc_idx is not None and pos_acc_idx < len(accessors):
                    cnt = accessors[pos_acc_idx].get('count', 0)
                    if mode == 4:
                        total_triangles += cnt // 3
    
    return {
        'name': name,
        'size_mb': len(data) / (1024*1024),
        'meshes': len(meshes),
        'triangles': total_triangles,
        'vertices': total_vertices,
        'materials': len(materials),
        'textures': len(textures),
        'images': len(images)
    }

base = r"C:\Users\MSI\Desktop\My Projects\AFRICAN_IT_DRIVERS"

print("================ CURRENT MODELS (models/) ================")
current_models = [
    'j40_pickup.glb', 'j40_hardtop.glb', 'j40_canvas.glb', 'delica.glb', 'hiace.glb',
    'car.glb', 'suv.glb', 'bus.glb', 'sports-car.glb', 'fire-truck.glb', 'bruno-chassis.glb'
]

for m in current_models:
    p = os.path.join(base, 'models', m)
    if os.path.exists(p):
        with open(p, 'rb') as f:
            res = analyze_glb(f.read(), m)
            print(f"{res['name']:<18} | {res['triangles']:>8} tris | {res['vertices']:>8} verts | {res['size_mb']:>6.2f} MB | Mats: {res['materials']}")

print("\n================ NEW MODELS (ZIPs) ================")
new_zips = [
    (r"Новые модели\Subaru_L_Series_4WD_1990_Sports_Wagon-eda7ebfd.zip", "Subaru_L_Series_4WD_1990_Sports_Wagon.glb"),
    (r"Новые модели\Toyota_Landcruiser_1985_4WD-19d5c2f7-textures.zip", "Toyota_Landcruiser_1985_4WD.glb"),
    (r"Новы окружения\Philippines_Lapu_Lapu_city_Mactan_New_Town-ea81b6e7-textures.zip", "Philippines_Lapu_Lapu_city_Mactan_New_Town.glb")
]

for zip_rel, glb_name in new_zips:
    zp = os.path.join(base, zip_rel)
    if os.path.exists(zp):
        with zipfile.ZipFile(zp, 'r') as z:
            if glb_name in z.namelist():
                data = z.read(glb_name)
                res = analyze_glb(data, glb_name)
                print(f"{res['name']:<42} | {res['triangles']:>9} tris | {res['vertices']:>9} verts | {res['size_mb']:>6.2f} MB | Mats: {res['materials']} | Imgs: {res['images']}")
