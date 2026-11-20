# Blender (5.1) script: converts "Sukhoi Su-35 - Fighter Jet - Free" (Sketchfab GLB) into the
# ship.glb embedded in js/modelsdata.js.
# Usage: blender -b --python tools/convert_ship.py -- <sukhoi_su-35_-_fighter_jet_-_free.glb> <out_dir>
#  - removes the lowered landing gear (keeps the closed gear doors)
#  - adds empties: Nozzle_1 / Nozzle_2 (engine exits; their scale = nozzle radius) and Eye (pilot)
#  - turns the nose toward Blender +Y (= -Z in glTF / three.js); source units are decimeters
#  - re-encodes the textures as 1024 px JPEG
import bpy, sys, os, math, mathutils

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
scene = bpy.context.scene

def part(name):
    return [o for o in bpy.data.objects if o.type == 'MESH' and o.parent and name in o.parent.name]

# gear down + its light: not needed in flight
for o in part('landingOn'):
    bpy.data.objects.remove(o, do_unlink=True)

air = part('airframe')[0]
pts = [air.matrix_world @ v.co for v in air.data.vertices]
nozzles = []
for side in (-1, 1):
    # engine area: beside the central tail stinger, at fuselage height
    sub = [p for p in pts if 8 < p.y * side < 17 and -7 < p.z < 5]
    mnx = min(p.x for p in sub)
    ring = [p for p in sub if p.x < mnx + 2.0]
    c = sum(ring, mathutils.Vector()) / len(ring)
    r = max(math.hypot(p.y - c.y, p.z - c.z) for p in ring)
    nozzles.append((mathutils.Vector((mnx, c.y, c.z)), r))
    print('NOZZLE', side, [round(v, 2) for v in (mnx, c.y, c.z)], 'radius', round(r, 2))

# eye: inside the canopy, a little below its top
can = part('canopy')[0]
cp = [can.matrix_world @ v.co for v in can.data.vertices]
cmin = mathutils.Vector([min(p[i] for p in cp) for i in range(3)])
cmax = mathutils.Vector([max(p[i] for p in cp) for i in range(3)])
eye = mathutils.Vector(((cmin.x + cmax.x) / 2 - 2.0, 0.0, cmax.z - 2.6))
print('EYE', [round(v, 2) for v in eye])

# bake every remaining mesh into world space (no parents), then rotate the nose to +Y
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
rot = mathutils.Matrix.Rotation(math.pi / 2, 4, 'Z')  # +X (nose) -> +Y
keep = []
for o in meshes:
    me = o.data.copy()
    me.transform(o.matrix_world)
    me.transform(rot)
    n = bpy.data.objects.new(o.parent.name.split('_')[0] if o.parent else o.name, me)
    scene.collection.objects.link(n)
    keep.append(n)
for o in list(bpy.data.objects):
    if o not in keep:
        bpy.data.objects.remove(o, do_unlink=True)

def empty(name, p, s=1.0):
    e = bpy.data.objects.new(name, None)
    e.location = rot @ p
    e.scale = (s, s, s)
    scene.collection.objects.link(e)
for i, (p, r) in enumerate(nozzles):
    empty('Nozzle_%d' % (i + 1), p, r)
empty('Eye', eye)

for img in bpy.data.images:
    if img.users == 0:
        continue
    if img.size[0] > 1024:
        img.scale(1024, max(1, int(img.size[1] * 1024 / img.size[0])))
    img.file_format = 'JPEG'

bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'ship.glb'), export_format='GLB', export_image_format='JPEG',
                          export_animations=False, export_skins=False, export_cameras=False, export_lights=False)
print('EXPORTED')
