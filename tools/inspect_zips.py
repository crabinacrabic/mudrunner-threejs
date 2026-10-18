import zipfile
import os
import json

def inspect_zip(path):
    print(f"=== ZIP: {os.path.basename(path)} ===")
    if not os.path.exists(path):
        print("  File not found!")
        return
    with zipfile.ZipFile(path, 'r') as z:
        infos = z.infolist()
        total_size = sum(x.file_size for x in infos)
        print(f"Total files: {len(infos)}, uncompressed size: {total_size / (1024*1024):.2f} MB")
        for x in infos:
            if x.filename.lower().endswith(('.gltf', '.glb', '.obj', '.fbx', '.bin')):
                print(f"  [3D MODEL] {x.filename} ({x.file_size / (1024*1024):.2f} MB)")
            elif any(x.filename.lower().endswith(ext) for ext in ('.jpg', '.png', '.jpeg', '.webp')):
                pass # textures
        # print first few entries
        print("Sample files:")
        for x in infos[:15]:
            print(f"  {x.filename} ({x.file_size / (1024*1024):.2f} MB)")

base = r"C:\Users\MSI\Desktop\My Projects\AFRICAN_IT_DRIVERS"
inspect_zip(os.path.join(base, "Новы окружения", "Philippines_Lapu_Lapu_city_Mactan_New_Town-ea81b6e7-textures.zip"))
inspect_zip(os.path.join(base, "Новые модели", "Subaru_L_Series_4WD_1990_Sports_Wagon-eda7ebfd.zip"))
inspect_zip(os.path.join(base, "Новые модели", "Toyota_Landcruiser_1985_4WD-19d5c2f7-textures.zip"))
