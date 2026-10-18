import struct
import json
import os
import zipfile

def inspect_nodes_and_bounds(data, name):
    magic, version, length = struct.unpack('<4sII', data[:12])
    chunk_len, chunk_type = struct.unpack('<II', data[12:20])
    json_bytes = data[20:20+chunk_len]
    gltf = json.loads(json_bytes.decode('utf-8'))
    
    nodes = gltf.get('nodes', [])
    scenes = gltf.get('scenes', [])
    accessors = gltf.get('accessors', [])
    meshes = gltf.get('meshes', [])
    
    print(f"=== {name} ===")
    print(f"Scenes: {len(scenes)}, Nodes: {len(nodes)}, Meshes: {len(meshes)}")
    
    # Calculate bounding box from POSITION accessors
    min_x, min_y, min_z = float('inf'), float('inf'), float('inf')
    max_x, max_y, max_z = float('-inf'), float('-inf'), float('-inf')
    
    for mesh in meshes:
        for prim in mesh.get('primitives', []):
            pos_idx = prim.get('attributes', {}).get('POSITION')
            if pos_idx is not None and pos_idx < len(accessors):
                acc = accessors[pos_idx]
                if 'min' in acc and 'max' in acc:
                    min_x = min(min_x, acc['min'][0])
                    min_y = min(min_y, acc['min'][1])
                    min_z = min(min_z, acc['min'][2])
                    max_x = max(max_x, acc['max'][0])
                    max_y = max(max_y, acc['max'][1])
                    max_z = max(max_z, acc['max'][2])
                    
    print(f"BBOX: min=({min_x:.2f}, {min_y:.2f}, {min_z:.2f}) max=({max_x:.2f}, {max_y:.2f}, {max_z:.2f})")
    print(f"DIMENSIONS: DX={max_x - min_x:.2f}, DY={max_y - min_y:.2f}, DZ={max_z - min_z:.2f}")
    
    print("Nodes list (first 25):")
    for i, n in enumerate(nodes[:25]):
        mesh_info = f"mesh={n.get('mesh')}" if 'mesh' in n else ""
        children = f"children={n.get('children')}" if 'children' in n else ""
        print(f"  [{i}] {n.get('name', 'unnamed')} {mesh_info} {children}")
    if len(nodes) > 25:
        print(f"  ... and {len(nodes) - 25} more nodes")
    print()

base = r"C:\Users\MSI\Desktop\My Projects\AFRICAN_IT_DRIVERS"
zips = [
    (r"Новые модели\Subaru_L_Series_4WD_1990_Sports_Wagon-eda7ebfd.zip", "Subaru_L_Series_4WD_1990_Sports_Wagon.glb"),
    (r"Новые модели\Toyota_Landcruiser_1985_4WD-19d5c2f7-textures.zip", "Toyota_Landcruiser_1985_4WD.glb"),
    (r"Новы окружения\Philippines_Lapu_Lapu_city_Mactan_New_Town-ea81b6e7-textures.zip", "Philippines_Lapu_Lapu_city_Mactan_New_Town.glb")
]

for zip_rel, glb_name in zips:
    zp = os.path.join(base, zip_rel)
    with zipfile.ZipFile(zp, 'r') as z:
        data = z.read(glb_name)
        inspect_nodes_and_bounds(data, glb_name)
