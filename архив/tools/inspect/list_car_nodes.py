import struct, json, os, zipfile

def list_nodes(data, name):
    magic, version, length = struct.unpack('<4sII', data[:12])
    chunk_len, chunk_type = struct.unpack('<II', data[12:20])
    json_bytes = data[20:20+chunk_len]
    gltf = json.loads(json_bytes.decode('utf-8'))
    nodes = gltf.get('nodes', [])
    print(f"=== NODES FOR {name} ===")
    for i, n in enumerate(nodes):
        print(f"  [{i}] name: \"{n.get('name')}\", mesh: {n.get('mesh')}, children: {n.get('children')}, translation: {n.get('translation')}, rotation: {n.get('rotation')}, scale: {n.get('scale')}")

base = r"C:\Users\MSI\Desktop\My Projects\AFRICAN_IT_DRIVERS"
z1 = os.path.join(base, r"Новые модели\Subaru_L_Series_4WD_1990_Sports_Wagon-eda7ebfd.zip")
with zipfile.ZipFile(z1, 'r') as z:
    list_nodes(z.read('Subaru_L_Series_4WD_1990_Sports_Wagon.glb'), 'Subaru')

z2 = os.path.join(base, r"Новые модели\Toyota_Landcruiser_1985_4WD-19d5c2f7-textures.zip")
with zipfile.ZipFile(z2, 'r') as z:
    list_nodes(z.read('Toyota_Landcruiser_1985_4WD.glb'), 'Toyota Landcruiser')
