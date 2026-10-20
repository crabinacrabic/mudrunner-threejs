import zipfile, os, json

base = r"C:\Users\MSI\Desktop\My Projects\AFRICAN_IT_DRIVERS"
zips = [
    r"Новые модели\Subaru_L_Series_4WD_1990_Sports_Wagon-eda7ebfd.zip",
    r"Новые модели\Toyota_Landcruiser_1985_4WD-19d5c2f7-textures.zip"
]

for zp_rel in zips:
    zp = os.path.join(base, zp_rel)
    print("=" * 60)
    print("ZIP:", os.path.basename(zp))
    with zipfile.ZipFile(zp, 'r') as z:
        if 'model.gltf' in z.namelist():
            g = json.loads(z.read('model.gltf'))
            nodes = g.get('nodes', [])
            print("Total nodes in model.gltf:", len(nodes))
            for i, n in enumerate(nodes):
                has_mat = 'matrix' in n
                trans = n.get('translation')
                rot = n.get('rotation')
                scale = n.get('scale')
                print(f"  [{i}] {n.get('name')}: mesh={n.get('mesh')}, matrix={has_mat}, trans={trans}, rot={rot}, scale={scale}")
