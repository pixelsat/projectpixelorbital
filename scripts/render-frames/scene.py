# Renders the satellite story in Blender Cycles. Run through cycles.mjs:
#
#   blender -b --factory-startup -P scene.py -- job.json
#
# A port of scripts/render-frames/renderer.ts (the three.js renderer): the
# same model, poses, studio, lights and solar panel maps, but path traced, so
# shadows, ambient occlusion, reflections and fades come out of the light
# transport instead of the three.js approximations.
#
# The job file gives the model and panel map paths, the poses, the frame size
# and a list of shots, each a segment i, progress t and output path. Each
# shot is written as raw 8-bit RGB, rows top to bottom, and announced on
# stdout as a line "FRAME {json}".
#
# Coordinates: the story and the model are Y-up (three.js); Blender is Z-up.
# A three.js (x, y, z) is Blender (x, -z, y). The glTF importer does this for
# the model; everything else here is written in Blender coordinates.

import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
POSES = job["poses"]
PARTS = job["parts"]
WIDTH, HEIGHT, BASE = job["width"], job["height"], job["base"]

UP = Vector((0, 0, 1))


def lerp(a, b, t):
    return a + (b - a) * t


def clamp01(v):
    return min(1.0, max(0.0, v))


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_color(h):
    return tuple(srgb_to_linear(((h >> s) & 255) / 255) for s in (16, 8, 0))


# --- Scene and Cycles ------------------------------------------------------

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "METAL"
prefs.refresh_devices()
for d in prefs.devices:
    d.use = d.type == "METAL"
# Hardware ray tracing on M3 and later.
prefs.metalrt = "ON"

scene.render.engine = "CYCLES"
cycles = scene.cycles
cycles.device = "GPU"
cycles.samples = job["samples"]
cycles.use_adaptive_sampling = True
cycles.adaptive_threshold = job.get("noise", 0.01)
cycles.use_denoising = job.get("denoise", True)
cycles.denoiser = "OPENIMAGEDENOISE"
cycles.denoising_use_gpu = True
cycles.denoising_prefilter = job.get("prefilter", "FAST")
cycles.caustics_reflective = False
cycles.caustics_refractive = False
cycles.max_bounces = 8
cycles.diffuse_bounces = 4
cycles.glossy_bounces = 4
cycles.transparent_max_bounces = 16

scene.render.resolution_x = WIDTH
scene.render.resolution_y = HEIGHT
scene.render.resolution_percentage = job.get("percent", 100)
# Cycles writes linear EXR, which is tone mapped below with three.js's AgX
# (Blender's AgX is a different, flatter curve), at its exposure of 1.1.
scene.render.image_settings.file_format = "OPEN_EXR"
scene.render.image_settings.color_mode = "RGB"
scene.render.image_settings.color_depth = "16"
scene.render.image_settings.exr_codec = "NONE"
scene.view_settings.view_transform = "Raw"
scene.view_settings.look = "None"
EXPOSURE = 1.1


# --- Model ----------------------------------------------------------------

bpy.ops.import_scene.gltf(filepath=job["model"])
bpy.context.view_layer.update()

sat = bpy.data.objects.new("sat", None)
sat.location = (0, 0, -150)
scene.collection.objects.link(sat)

nodes = {}
rest_boxes = {}
rest_z = {}
frame_objects = []
for obj in [o for o in scene.objects if o.type == "MESH"]:
    if obj.name == "frame":
        frame_objects.append(obj)
    elif obj.name in PARTS:
        nodes[obj.name] = obj
        corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
        rest_boxes[obj.name] = (
            Vector([min(c[k] for c in corners) for k in range(3)]),
            Vector([max(c[k] for c in corners) for k in range(3)]),
        )
        rest_z[obj.name] = obj.location.z
    obj.parent = sat
    obj.matrix_parent_inverse = Matrix.Identity(4)

# The CAD export only distinguishes materials by colour, and gives every
# KiCad part the same matte plastic. Plating is picked out by KiCad's standard
# colours so pins and pads read as metal. (As in renderer.ts.)
GOLD_TIN = {
    "Opaque(212,176,56)",
    "Opaque(212,173,56)",
    "Opaque(219,188,126)",
    "Opaque(165,132,0)",
    "Opaque(188,188,188)",
    "Opaque(210,209,199)",
    "Opaque(165,158,150)",
}


def principled(mat):
    return next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


for mat in bpy.data.materials:
    if not mat.node_tree:
        continue
    bsdf = principled(mat)
    if mat.name in GOLD_TIN:
        bsdf.inputs["Metallic"].default_value = 1
        bsdf.inputs["Roughness"].default_value = 0.3
    elif mat.name == "Opaque(80,124,105)":
        bsdf.inputs["Roughness"].default_value = 0.4
    elif mat.name.startswith("Aluminum"):
        bsdf.inputs["Base Color"].default_value = (0.62, 0.63, 0.65, 1)
        bsdf.inputs["Metallic"].default_value = 1
        bsdf.inputs["Roughness"].default_value = 0.45


# --- Solar panels -----------------------------------------------------------

PANEL_W, PANEL_H, PANEL_T = 82, 280, 1.6


def panel_materials():
    maps = job["panelMaps"]

    def image(name, colorspace):
        img = bpy.data.images.load(maps[name])
        img.colorspace_settings.name = colorspace
        return img

    front = bpy.data.materials.new("panel-front")
    nt = front.node_tree
    bsdf = principled(front)
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"

    def texture(img):
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = img
        node.interpolation = "Cubic"
        nt.links.new(uv.outputs["UV"], node.inputs["Vector"])
        return node

    albedo = texture(image("map", "sRGB"))
    surface = texture(image("surface", "Non-Color"))
    normal = texture(image("normalMap", "Non-Color"))
    # Packed surface map: R = coverglass (clearcoat), G = roughness,
    # B = metalness.
    split = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(surface.outputs["Color"], split.inputs["Color"])
    normal_map = nt.nodes.new("ShaderNodeNormalMap")
    normal_map.uv_map = "UVMap"
    nt.links.new(normal.outputs["Color"], normal_map.inputs["Color"])

    nt.links.new(albedo.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(split.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(split.outputs["Blue"], bsdf.inputs["Metallic"])
    nt.links.new(split.outputs["Red"], bsdf.inputs["Coat Weight"])
    nt.links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    # The coverglass is flat: its coat keeps the geometric normal.
    bsdf.inputs["Coat Roughness"].default_value = 0.02
    bsdf.inputs["Coat IOR"].default_value = 1.5
    # Anti-reflective coating: a quarter of the usual base reflectance.
    bsdf.inputs["Specular IOR Level"].default_value = job.get("cellSpecular", 0.125)

    def plain(name, hex_value, roughness):
        m = bpy.data.materials.new(name)
        b = principled(m)
        b.inputs["Base Color"].default_value = (*hex_color(hex_value), 1)
        b.inputs["Roughness"].default_value = roughness
        return m

    return front, plain("panel-back", 0x0F1013, 0.6), plain("panel-edge", 0x6B6245, 0.8)


def panel_mesh(materials):
    # Local frame: +X is out of the panel, width along Y, height along Z.
    # The front's texture runs left to right and bottom to top as seen from
    # outside, like three.js BoxGeometry faces.
    x, y, z = PANEL_T / 2, PANEL_W / 2, PANEL_H / 2
    verts = [(sx * x, sy * y, sz * z) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    at = lambda sx, sy, sz: ((sx > 0) << 2) | ((sy > 0) << 1) | (sz > 0)
    faces = [
        ([at(1, -1, -1), at(1, 1, -1), at(1, 1, 1), at(1, -1, 1)], 0),  # front
        ([at(-1, -1, -1), at(-1, -1, 1), at(-1, 1, 1), at(-1, 1, -1)], 1),  # back
        ([at(-1, -1, -1), at(1, -1, -1), at(1, -1, 1), at(-1, -1, 1)], 2),
        ([at(-1, 1, -1), at(-1, 1, 1), at(1, 1, 1), at(1, 1, -1)], 2),
        ([at(-1, -1, -1), at(-1, 1, -1), at(1, 1, -1), at(1, -1, -1)], 2),
        ([at(-1, -1, 1), at(1, -1, 1), at(1, 1, 1), at(-1, 1, 1)], 2),
    ]
    mesh = bpy.data.meshes.new("panel")
    mesh.from_pydata(verts, [], [f for f, _ in faces])
    for m in materials:
        mesh.materials.append(m)
    uv = mesh.uv_layers.new(name="UVMap")
    for poly, (_, index) in zip(mesh.polygons, faces):
        poly.material_index = index
        for li in poly.loop_indices:
            vx, vy, vz = verts[mesh.loops[li].vertex_index]
            uv.data[li].uv = ((vy + y) / PANEL_W, (vz + z) / PANEL_H)
    return mesh


panel_mesh_data = panel_mesh(panel_materials())
panels = []
for n in [Vector((1, 0, 0)), Vector((-1, 0, 0)), Vector((0, -1, 0)), Vector((0, 1, 0))]:
    obj = bpy.data.objects.new("panel", panel_mesh_data)
    obj.rotation_euler = (0, 0, math.atan2(n.y, n.x))
    obj.parent = sat
    scene.collection.objects.link(obj)
    panels.append((obj, n))


# --- Fading -----------------------------------------------------------------

# Every material blends to transparent by its object's alpha (object colour),
# so the frame and panels fade, shadows and all.
for mat in bpy.data.materials:
    nt = mat.node_tree
    if not nt:
        continue
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    shader = out.inputs["Surface"].links[0].from_socket
    info = nt.nodes.new("ShaderNodeObjectInfo")
    clear = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(info.outputs["Alpha"], mix.inputs["Fac"])
    nt.links.new(clear.outputs["BSDF"], mix.inputs[1])
    nt.links.new(shader, mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])


def set_opacity(objects, opacity):
    for obj in objects:
        obj.color[3] = opacity
        obj.hide_render = opacity <= 0.001


# --- Studio -----------------------------------------------------------------

# The black photo studio of renderer.ts, as an equirectangular environment.
# It's laid out (in three.js coordinates) around a camera on +z looking at the
# origin, and turned with the camera so every shot is lit the same way.
def studio_image(w=4096, h=2048, ss=2):
    # Softboxes: centre, width, height, radiance. Each faces the origin, with
    # its width horizontal (three.js lookAt).
    boxes = [
        ((0, 10, 0), 10, 10, (1.2, 1.2, 1.2)),
        ((-7, 5, 7), 3, 8, (3, 3, 3)),
        ((8, 5, -6), 2, 8, (1.2, 1.4, 1.8)),
        ((0, 5.5, -10), 14, 5, (0.6, 0.6, 0.6)),
    ]
    # Thin bands just below the horizon: open cylinders of radius 10.
    bands = [(-1.8, 0.65), (-3.6, 1.3)]

    out = np.zeros((h, w, 3), np.float32)
    for sy in range(ss):
        for sx in range(ss):
            u = (np.arange(w, dtype=np.float32) + (sx + 0.5) / ss) / w
            v = (np.arange(h, dtype=np.float32) + (sy + 0.5) / ss) / h
            az = (0.5 - u)[None, :] * 2 * np.pi
            el = (v - 0.5)[:, None] * np.pi
            # Blender direction (row 0 is the bottom of the image) ...
            bx = np.cos(el) * np.cos(az)
            by = np.cos(el) * np.sin(az)
            bz = np.sin(el) * np.ones_like(az)
            # ... in three.js coordinates.
            d = np.stack([bx, bz, -by], -1).astype(np.float32)
            up, front = d[..., 1], d[..., 2]

            floor = np.exp(-(((up + 0.3) / 0.3) ** 2))
            shade = (
                0.015
                + 0.08 * np.maximum(0, up) ** 1.2
                + 0.25 * floor * (0.25 + 0.75 * np.maximum(0, front))
            )
            color = np.repeat(shade[..., None], 3, -1)
            nearest = np.full(shade.shape, 20.0, np.float32)

            horizontal = np.hypot(d[..., 0], d[..., 2])
            for y, brightness in bands:
                t = 10 / np.maximum(horizontal, 1e-6)
                hit = (np.abs(d[..., 1] * t - y) <= 0.1) & (t < nearest)
                color[hit] = brightness
                nearest[hit] = t[hit]

            for c, bw, bh, radiance in boxes:
                c = np.array(c, np.float32)
                z = -c / np.linalg.norm(c)
                x = np.cross([0, 1, 0], z)
                if np.linalg.norm(x) < 1e-6:
                    z = z + np.array([0, 0, 1e-4], np.float32)
                    z /= np.linalg.norm(z)
                    x = np.cross([0, 1, 0], z)
                x /= np.linalg.norm(x)
                yv = np.cross(z, x)
                denom = d @ z
                t = (c @ z) / np.where(np.abs(denom) < 1e-6, 1e-6, denom)
                p = d * t[..., None] - c
                hit = (
                    (t > 0)
                    & (t < nearest)
                    & (np.abs(p @ x) <= bw / 2)
                    & (np.abs(p @ yv) <= bh / 2)
                )
                color[hit] = radiance
                nearest[hit] = t[hit]
            out += color
    out /= ss * ss

    # Kept in memory: saving it to EXR and back sRGB-encodes it.
    img = bpy.data.images.new("studio", w, h, float_buffer=True, alpha=True)
    img.colorspace_settings.name = "Linear Rec.709"
    rgba = np.concatenate([out, np.ones((h, w, 1), np.float32)], -1)
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


world = bpy.data.worlds.new("studio")
scene.world = world
nt = world.node_tree
nt.nodes.clear()
coords = nt.nodes.new("ShaderNodeTexCoord")
mapping = nt.nodes.new("ShaderNodeMapping")
mapping.vector_type = "TEXTURE"  # turns the studio by +rotation
env = nt.nodes.new("ShaderNodeTexEnvironment")
env.image = studio_image()
env.interpolation = "Linear"
lit = nt.nodes.new("ShaderNodeBackground")
black = nt.nodes.new("ShaderNodeBackground")
black.inputs["Color"].default_value = (0, 0, 0, 1)
path = nt.nodes.new("ShaderNodeLightPath")
mix = nt.nodes.new("ShaderNodeMixShader")
out = nt.nodes.new("ShaderNodeOutputWorld")
nt.links.new(coords.outputs["Generated"], mapping.inputs["Vector"])
nt.links.new(mapping.outputs["Vector"], env.inputs["Vector"])
nt.links.new(env.outputs["Color"], lit.inputs["Color"])
# The studio only lights the model: the camera sees black behind it.
nt.links.new(path.outputs["Is Camera Ray"], mix.inputs["Fac"])
nt.links.new(lit.outputs["Background"], mix.inputs[1])
nt.links.new(black.outputs["Background"], mix.inputs[2])
nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])


# --- Lights -----------------------------------------------------------------


def sun(name, color, strength, angle, direction, shadow=True, glossy=True):
    light = bpy.data.lights.new(name, "SUN")
    light.color = color
    light.energy = strength
    light.angle = angle
    light.use_shadow = shadow
    obj = bpy.data.objects.new(name, light)
    obj.visible_glossy = glossy
    scene.collection.objects.link(obj)
    if direction is not None:
        obj.rotation_euler = Vector(direction).to_track_quat("Z", "Y").to_euler()
    return obj


# The key light follows the camera (see place), lit from the upper left. The
# three.js renderer jittered it across a disc 0.07 rad in radius to soften
# its shadow; here it's a sun that size.
key = sun("key", (1, 1, 1), 3.4, 0.14, None)
# The rim light casts no shadow, as in three.js.
rim = sun("rim", hex_color(0x9FB4FF), 1.2, math.radians(1), (-400, 300, 100), shadow=False)
# three.js's hemisphere light (sky 0xe8eeff, ground 0x1a1a1a, 0.5): diffuse
# only, irradiance mix(ground, sky, n.up / 2 + 1 / 2) * 0.5. Two
# hemisphere-sized suns, from above and below, add up to exactly that.
sun("sky", hex_color(0xE8EEFF), 0.5, math.pi, (0, 0, 1), glossy=False)
sun("ground", hex_color(0x1A1A1A), 0.5, math.pi, (0, 0, -1), glossy=False)


# --- Camera -----------------------------------------------------------------

cam_data = bpy.data.cameras.new("camera")
cam_data.sensor_fit = "VERTICAL"
# The page's camera has a 28° vertical field of view across one viewport
# height; the frame spans HEIGHT / BASE of those.
cam_data.angle_y = 2 * math.atan((HEIGHT / BASE) * math.tan(math.radians(14)))
cam_data.clip_start = 5
cam_data.clip_end = 5000
camera = bpy.data.objects.new("camera", cam_data)
scene.collection.objects.link(camera)
scene.camera = camera


def center_of(focus, lift):
    if focus == "all" or focus[0] not in rest_boxes:
        return Vector((0, 0, 150))
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for part in focus:
        a, b = rest_boxes[part]
        dz = Vector((0, 0, lift.get(part, 0)))
        lo = Vector(map(min, lo, a + dz))
        hi = Vector(map(max, hi, b + dz))
    return (lo + hi) / 2


def place(i, t):
    a, b = POSES[i], POSES[i + 1]

    for part in PARTS:
        if part in nodes:
            nodes[part].location.z = rest_z[part] + lerp(
                a["lift"].get(part, 0), b["lift"].get(part, 0), t
            )

    off = lerp(a["panels"], b["panels"], t)
    for obj, n in panels:
        obj.location = n * (50.4 + off * 160) + Vector((0, 0, 150))
    set_opacity([p for p, _ in panels], 1 - clamp01((off - 0.35) / 0.65))
    set_opacity(frame_objects, lerp(a["frame"], b["frame"], t))

    focus = center_of(a["focus"], a["lift"]).lerp(
        center_of(b["focus"], b["lift"]), t
    ) + sat.location

    az = math.radians(lerp(a["az"], b["az"], t))
    el = math.radians(lerp(a["el"], b["el"], t))
    dist = lerp(a["dist"], b["dist"], t)
    mapping.inputs["Rotation"].default_value = (0, 0, az)
    # three.js (cos el sin az, sin el, cos el cos az).
    offset = Vector((math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), math.sin(el)))
    position = focus + offset * dist
    z = offset.normalized()
    x = UP.cross(z).normalized()
    y = z.cross(x)
    look = Matrix((x, y, z)).transposed()

    light = (look @ Vector((-0.6, 1, 0.7)).normalized()).normalized()
    key.rotation_euler = light.to_track_quat("Z", "Y").to_euler()

    roll = Matrix.Rotation(math.radians(lerp(a["roll"], b["roll"], t)), 3, "Z")
    camera.matrix_world = Matrix.Translation(position) @ (look @ roll).to_4x4()


# Debugging: {"disable": ["world", "key", "rim", "sky", "ground", "coat"]}.
for name in job.get("disable", []):
    if name == "world":
        lit.inputs["Strength"].default_value = 0
    elif name == "coat":
        principled(bpy.data.materials["panel-front"]).inputs["Coat Weight"].default_value = 0
        m = bpy.data.materials["panel-front"].node_tree
        for l in list(m.links):
            if l.to_socket.name == "Coat Weight":
                m.links.remove(l)
    elif name == "indirect":
        cycles.max_bounces = 1
    else:
        bpy.data.objects[name].hide_render = True


# --- Tone mapping -------------------------------------------------------------

# three.js's AgXToneMapping (tonemapping_pars_fragment.glsl.js) and sRGB
# encoding. Matrices are GLSL columns, so they apply to row vectors as is.
REC709_TO_REC2020 = np.array(
    [[0.6274, 0.0691, 0.0164], [0.3293, 0.9195, 0.0880], [0.0433, 0.0113, 0.8956]]
)
REC2020_TO_REC709 = np.array(
    [[1.6605, -0.1246, -0.0182], [-0.5876, 1.1329, -0.1006], [-0.0728, -0.0083, 1.1187]]
)
AGX_INSET = np.array(
    [
        [0.856627153315983, 0.137318972929847, 0.11189821299995],
        [0.0951212405381588, 0.761241990602591, 0.0767994186031903],
        [0.0482516061458583, 0.101439036467562, 0.811302368396859],
    ]
)
AGX_OUTSET = np.array(
    [
        [1.1271005818144368, -0.1413297634984383, -0.14132976349843826],
        [-0.11060664309660323, 1.157823702216272, -0.11060664309660294],
        [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405],
    ]
)
AGX_MIN_EV, AGX_MAX_EV = -12.47393, 4.026069


def agx(c):
    c = (c * EXPOSURE) @ REC709_TO_REC2020 @ AGX_INSET
    c = np.log2(np.maximum(c, 1e-10))
    x = np.clip((c - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV), 0, 1)
    x2 = x * x
    x4 = x2 * x2
    c = (
        15.5 * x4 * x2
        - 40.14 * x4 * x
        + 31.96 * x4
        - 6.868 * x2 * x
        + 0.4298 * x2
        + 0.1191 * x
        - 0.00232
    )
    c = np.maximum(c @ AGX_OUTSET, 0) ** 2.2
    c = np.clip(c @ REC2020_TO_REC709, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def tone_map(exr_path, out_path):
    src = bpy.data.images.load(exr_path)
    w, h = src.size
    rgba = np.empty(w * h * 4, np.float32)
    src.pixels.foreach_get(rgba)
    bpy.data.images.remove(src)
    rgb = agx(rgba.reshape(h, w, 4)[::-1, :, :3].astype(np.float64))
    np.round(rgb * 255).astype(np.uint8).tofile(out_path)


# --- Render -----------------------------------------------------------------

for shot in job["shots"]:
    started = time.time()
    place(shot["i"], shot["t"])
    exr = os.path.splitext(shot["out"])[0] + ".exr"
    scene.render.filepath = exr
    bpy.ops.render.render(write_still=True)
    tone_map(exr, shot["out"])
    os.remove(exr)
    width = WIDTH * scene.render.resolution_percentage // 100
    height = HEIGHT * scene.render.resolution_percentage // 100
    report = {"out": shot["out"], "width": width, "height": height, "seconds": time.time() - started}
    print("FRAME " + json.dumps(report), flush=True)
