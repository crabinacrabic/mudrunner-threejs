import io, json, shutil, sys, os
GAME = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCR = os.path.join(GAME, 'tools', 'blender')
ids = sys.argv[1:] or ['delica', 'hiace']
specs = []
for i in ids:
    shutil.copy(os.path.join(SCR, 'out', i + '.glb'), os.path.join(GAME, 'models', i + '.glb'))
    specs.append(json.load(io.open(os.path.join(SCR, 'out', i + '.spec.json'), encoding='utf-8')))
OVR = {
    'j40_pickup': dict(physWidth=0.30, sinkFactor=0.55, tireBite=0.95, clearance=0.28),
    'j40_hardtop': dict(physWidth=0.30, sinkFactor=0.55, tireBite=0.95, clearance=0.28),
    'j40_canvas': dict(physWidth=0.30, sinkFactor=0.52, tireBite=0.95, clearance=0.28),
    'delica': dict(physWidth=0.30, sinkFactor=0.60, tireBite=0.90, clearance=0.30),
    'hiace': dict(physWidth=0.25, sinkFactor=1.10, tireBite=0.45),
}
for sp in specs:
    sp.update(OVR.get(sp['id'], {}))
p = os.path.join(GAME, 'index.html')
s = io.open(p, encoding='utf-8').read()
BEGIN = '/*SPECS_BEGIN*/'
END = '/*SPECS_END*/'
a = s.index(BEGIN) + len(BEGIN)
b = s.index(END)
NL = chr(10)
body = (',' + NL).join('      ' + json.dumps(sp, ensure_ascii=False) for sp in specs)
s = s[:a] + '[' + NL + body + NL + '    ]' + s[b:]
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('specs', [sp['id'] for sp in specs])
