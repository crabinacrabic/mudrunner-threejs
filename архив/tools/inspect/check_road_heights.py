import json
import numpy as np

with open("models/philippines_meta.json", "r", encoding="utf-8") as f:
    meta = json.load(f)

with open("models/philippines_roads.json", "r", encoding="utf-8") as f:
    roads = json.load(f)

b = meta["bounds"]
width = b["maxX"] - b["minX"]
length = b["maxZ"] - b["minZ"]
res = meta["res"]
grid = np.array(meta["grid"])

def get_h(x, z):
    u = np.clip((x - b["minX"]) / width, 0, 0.9999)
    v = np.clip((z - b["minZ"]) / length, 0, 0.9999)
    gx = u * (res - 1)
    gz = v * (res - 1)
    ix = int(gx)
    iz = int(gz)
    tx = gx - ix
    tz = gz - iz
    h00 = grid[iz, ix]
    h10 = grid[iz, min(ix + 1, res - 1)]
    h01 = grid[min(iz + 1, res - 1), ix]
    h11 = grid[min(iz + 1, res - 1), min(ix + 1, res - 1)]
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz

print("=== MACTAN BOULEVARD HEIGHTS ===")
for p in roads["routes"]["mactan_boulevard"]["points"]:
    print(f"X: {p['x']:6.2f}, Z: {p['z']:6.2f} -> Height: {get_h(p['x'], p['z']):.2f}m")

print("\n=== COASTAL LOOP HEIGHTS ===")
for p in roads["routes"]["coastal_loop"]["points"]:
    print(f"X: {p['x']:6.2f}, Z: {p['z']:6.2f} -> Height: {get_h(p['x'], p['z']):.2f}m")
