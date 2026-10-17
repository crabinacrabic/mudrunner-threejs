import sys; import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *

def find_wheels(co, tri, mi, isl, mats, verbose=True):
    """returns dict name -> {'centre':(x,y,z), 'R':radius, 'width', 'islands': [ids]} in model cm (Blender axes, front = -Y)"""
    cnt, mn, mx = island_table(co, tri, isl)
    tire_idx = [k for k, m in enumerate(mats) if m[0].startswith('tire')][0]
    # majority material per island
    ext = mx - mn
    # tyre carcass candidates: large islands with axis along x: dx small, dy,dz ~ 71
    cands = [i for i in range(len(cnt)) if cnt[i] > 3000 and ext[i,0] < 30 and 60 < ext[i,1] < 90 and 60 < ext[i,2] < 90]
    # keep those that are mostly tire material
    good = []
    for i in cands:
        sel = isl == i
        frac = (mi[sel] == tire_idx).mean()
        if frac > 0.9: good.append(i)
    if verbose: print('tyre carcass islands', good, [(cnt[i], ext[i].round(1)) for i in good])
    assert len(good) == 4, good
    wheels = {}
    info = []
    for i in good:
        c = (mn[i] + mx[i]) / 2
        info.append((i, c))
    # front = smaller y (model front is -Y)
    ys = sorted(set(round(c[1], 0) for _, c in info))
    for i, c in info:
        front = c[1] < 0 - 0  # centre of car about y=0 roughly -> sign test with midpoint
    ymid = np.mean([c[1] for _, c in info])
    for i, c in info:
        fb = 'F' if c[1] < ymid else 'R'
        lr = 'L' if c[0] < np.mean([cc[0] for _, cc in info]) else 'R'
        R = max(ext[i,1], ext[i,2]) / 2
        wheels['Wheel_' + fb + lr] = dict(centre=tuple(c), R=R, width=ext[i,0], carcass=i, xr=(mn[i,0], mx[i,0]))
    return wheels, (cnt, mn, mx)

def wheel_islands(wheels, cnt, mn, mx, out_ext=7.0, in_ext=16.0, tol=0.8):
    xc_all = np.mean([w['centre'][0] for w in wheels.values()])
    owner = np.full(len(cnt), '', dtype=object)
    for name, w in wheels.items():
        cx, cy, cz = w['centre']; R = w['R']
        s = 1.0 if cx > xc_all else -1.0
        u0 = s * cx
        # tyre x-range in outward coordinate
        xr = w['xr']; ur = sorted([s*xr[0], s*xr[1]])
        lo = ur[0] - in_ext; hi = ur[1] + out_ext
        for i in range(len(cnt)):
            if owner[i]: continue
            # island bbox in outward coordinate
            ui = sorted([s*mn[i,0], s*mx[i,0]])
            if ui[0] < lo or ui[1] > hi: continue
            if mx[i,1] > cy + R + tol or mn[i,1] < cy - R - tol: continue
            if mx[i,2] > cz + R + tol or mn[i,2] < cz - R - tol: continue
            owner[i] = name
    return owner

if __name__ == '__main__':
    for vid in ['j40_hardtop', 'j40_pickup', 'j40_canvas']:
        co, tri, mi, isl, mats = load(vid)
        wheels, (cnt, mn, mx) = find_wheels(co, tri, mi, isl, mats)
        for k, w in sorted(wheels.items()):
            print(vid, k, 'centre', np.round(w['centre'], 2), 'R', round(w['R'], 2), 'width', round(w['width'], 2))
        owner = wheel_islands(wheels, cnt, mn, mx)
        for name in sorted(wheels):
            ids = [i for i in range(len(cnt)) if owner[i] == name]
            print(' ', name, 'islands', len(ids), 'tris', int(cnt[ids].sum()))
            big = sorted(ids, key=lambda i: -cnt[i])[:8]
            for i in big:
                sel = isl == i
                mh = np.bincount(mi[sel], minlength=len(mats))
                top = [(mats[k][0], int(mh[k])) for k in np.argsort(-mh)[:2] if mh[k]]
                print('     isl', i, 'tris', cnt[i], 'ext', (mx[i]-mn[i]).round(1), 'x', mn[i,0].round(1), mx[i,0].round(1), top)
        # who else is a tire-material island ouside the wheels
        tire_idx = [k for k, m in enumerate(mats) if m[0].startswith('tire')][0]
        rest = [i for i in range(len(cnt)) if not owner[i] and (mi[isl==i]==tire_idx).mean() > 0.5]
        print(' tire-material islands not in wheels', len(rest), 'tris', int(cnt[rest].sum()))
        big = sorted(rest, key=lambda i: -cnt[i])[:12]
        for i in big: print('     isl', i, 'tris', cnt[i], 'min', mn[i].round(1), 'max', mx[i].round(1))
