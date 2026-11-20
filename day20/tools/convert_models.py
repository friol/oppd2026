# Blender (5.1) script: converts the airliner into the a345.glb embedded in js/modelsdata.js.
# Usage: blender -b --python tools/convert_models.py -- <a345_dir> <out_dir>
#   <a345_dir>: airbus_a345.zip extracted (scene.gltf, scene.bin, textures/)
# The player's jet is converted by tools/convert_ship.py.
import bpy, os, sys

args = sys.argv[sys.argv.index('--') + 1:]
AB, OUT = args

# --- Airbus A345: glTF -> GLB, texture 1024 px JPEG
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(AB, 'scene.gltf'))
for img in bpy.data.images:
    if img.size[0] > 1024:
        img.scale(1024, 1024)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'a345.glb'), export_format='GLB', export_image_format='JPEG', export_animations=False)
