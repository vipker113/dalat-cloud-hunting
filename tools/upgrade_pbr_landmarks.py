import os
import math
import bpy
import bmesh
from mathutils import Vector, Matrix

PBR_DIR = "/Users/admin/.gemini/antigravity/brain/b225db1c-7975-469e-88d4-556d97d63d29/scratch/raw_assets/polyhaven_pbr"
LANTERN_GLTF = "/Users/admin/.gemini/antigravity/brain/b225db1c-7975-469e-88d4-556d97d63d29/scratch/raw_assets/polyhaven/wooden_lantern_01/wooden_lantern_01.gltf"
RAW_GLB_DIR = "/Users/admin/blender/dalat_cloud_hunting/assets_src/raw_glb"
OUT_GLB_DIR = "/Users/admin/blender/dalat_cloud_hunting/apps/web/public/assets/models"
TMP_DIR = "/Users/admin/.gemini/antigravity/brain/b225db1c-7975-469e-88d4-556d97d63d29/scratch/pbr_baked"

os.makedirs(TMP_DIR, exist_ok=True)
os.makedirs(OUT_GLB_DIR, exist_ok=True)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load_scaled_image(filepath: str, size: int = 512, non_color: bool = False, tint_rgb=None, cache_tag: str = ""):
    name_key = f"IMG_{os.path.basename(filepath)}_{size}_{cache_tag}"
    existing = bpy.data.images.get(name_key)
    if existing:
        return existing

    img = bpy.data.images.load(filepath)
    img.name = name_key
    if img.size[0] != size or img.size[1] != size:
        img.scale(size, size)

    if tint_rgb is not None:
        # Gently grade linear/sRGB pixels in-place so Principled BSDF connects Image Texture directly (100% glTF native!)
        px = list(img.pixels)
        tr, tg, tb, gain = tint_rgb
        for i in range(0, len(px), 4):
            px[i] = min(1.0, max(0.0, px[i] * tr * gain))
            px[i + 1] = min(1.0, max(0.0, px[i + 1] * tg * gain))
            px[i + 2] = min(1.0, max(0.0, px[i + 2] * tb * gain))
        img.pixels[:] = px
        img.update()

    img.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
    img.pack()
    return img


def build_gltf_pbr_material(
    name: str,
    diff_path: str,
    nor_path: str,
    arm_path: str,
    tint_rgb=(1.0, 1.0, 1.0, 1.0),
    normal_strength: float = 0.85,
    roughness_factor: float = 1.0,
    metallic_factor: float = 0.0,
):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out_node = nt.nodes.new("ShaderNodeOutputMaterial")
    out_node.location = (500, 0)

    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (180, 0)
    bsdf.inputs["Roughness"].default_value = roughness_factor
    bsdf.inputs["Metallic"].default_value = metallic_factor
    nt.links.new(bsdf.outputs["BSDF"], out_node.inputs["Surface"])

    # 1. Base Color Texture
    diff_img = load_scaled_image(diff_path, 512, non_color=False, tint_rgb=tint_rgb, cache_tag=name)
    tex_diff = nt.nodes.new("ShaderNodeTexImage")
    tex_diff.image = diff_img
    tex_diff.location = (-360, 240)
    nt.links.new(tex_diff.outputs["Color"], bsdf.inputs["Base Color"])

    # 2. ARM Texture (R=AO, G=Roughness, B=Metallic)
    arm_img = load_scaled_image(arm_path, 512, non_color=True, tint_rgb=None, cache_tag="arm")
    tex_arm = nt.nodes.new("ShaderNodeTexImage")
    tex_arm.image = arm_img
    tex_arm.location = (-560, -40)

    sep = nt.nodes.new("ShaderNodeSeparateColor")
    sep.location = (-220, -40)
    nt.links.new(tex_arm.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    if metallic_factor > 0.05:
        nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])

    # Hook glTF Material Output Occlusion socket so Three.js MeshStandardMaterial.aoMap activates!
    gltf_group = bpy.data.node_groups.get("glTF Material Output")
    if not gltf_group:
        gltf_group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        gltf_group.interface.new_socket(name="Occlusion", in_out='INPUT', socket_type='NodeSocketFloat')
    gltf_node = nt.nodes.new("ShaderNodeGroup")
    gltf_node.node_tree = gltf_group
    gltf_node.location = (500, -220)
    nt.links.new(sep.outputs["Red"], gltf_node.inputs["Occlusion"])

    # 3. Normal Map
    nor_img = load_scaled_image(nor_path, 512, non_color=True, tint_rgb=None, cache_tag="nor")
    tex_nor = nt.nodes.new("ShaderNodeTexImage")
    tex_nor.image = nor_img
    tex_nor.location = (-560, -340)

    nor_map = nt.nodes.new("ShaderNodeNormalMap")
    nor_map.location = (-180, -340)
    nor_map.inputs["Strength"].default_value = normal_strength
    nt.links.new(tex_nor.outputs["Color"], nor_map.inputs["Color"])
    nt.links.new(nor_map.outputs["Normal"], bsdf.inputs["Normal"])

    return mat


def make_emissive_mat(name: str, base_hex: str, em_hex: str, em_strength: float, roughness: float = 0.2):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")

    def hex_lin(h):
        r = int(h[1:3], 16) / 255.0
        g = int(h[3:5], 16) / 255.0
        b = int(h[5:7], 16) / 255.0
        return (pow(r, 2.2), pow(g, 2.2), pow(b, 2.2), 1.0)

    if bsdf:
        bsdf.inputs["Base Color"].default_value = hex_lin(base_hex)
        bsdf.inputs["Roughness"].default_value = roughness
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = hex_lin(em_hex)
        elif "Emission" in bsdf.inputs:
            bsdf.inputs["Emission"].default_value = hex_lin(em_hex)
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = em_strength
    return mat


def make_solid_mat(name: str, base_hex: str, roughness: float = 0.45, metallic: float = 0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    r = pow(int(base_hex[1:3], 16) / 255.0, 2.2)
    g = pow(int(base_hex[3:5], 16) / 255.0, 2.2)
    b = pow(int(base_hex[5:7], 16) / 255.0, 2.2)
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
    return mat


def assign_world_box_uvs(mesh, mat_uv_scales: dict, default_scale: float = 0.42):
    """Generates clean world-scale planar/box UVs + uv2 (for glTF occlusionMap!) on every polygon."""
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    uv_layer = mesh.uv_layers[0]

    mats = [m.name if m else "" for m in mesh.materials]
    verts = mesh.vertices

    for poly in mesh.polygons:
        mname = mats[poly.material_index] if poly.material_index < len(mats) else ""
        sc = mat_uv_scales.get(mname, default_scale)
        n = poly.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)

        for loop_idx in poly.loop_indices:
            v = verts[mesh.loops[loop_idx].vertex_index].co
            if "Roof" in mname and az > 0.35:
                # Corrugated iron ribs run along X down the roof pitch, repeating across Y!
                u = v.y * sc
                w = v.x * sc
            elif az >= ax and az >= ay:
                # Horizontal deck/tabletops: planks run cleanly along Y (north-south veranda axis)
                u = v.x * sc
                w = v.y * sc
            elif ax >= ay:
                u = v.y * sc
                w = v.z * sc
            else:
                u = v.x * sc
                w = v.z * sc
            uv_layer.data[loop_idx].uv = (u, w)


def add_box_part(bm, center, size, mat_index: int):
    sx, sy, sz = size
    m = Matrix.Translation(center) @ Matrix.Diagonal((sx, sy, sz, 1.0))
    ret = bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    for v in ret["verts"]:
        for f in v.link_faces:
            f.material_index = mat_index


def add_cyl_part(bm, p0: Vector, p1: Vector, rad0: float, rad1: float, segs: int, mat_index: int):
    delta = p1 - p0
    length = delta.length
    if length < 1e-4:
        return
    mid = (p0 + p1) * 0.5
    rot = delta.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
    m = Matrix.Translation(mid) @ rot
    ret = bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=segs,
        radius1=rad0,
        radius2=rad1,
        depth=length,
        matrix=m,
    )
    for v in ret["verts"]:
        for f in v.link_faces:
            f.material_index = mat_index
            f.smooth = True


def add_catenary_string_lights(bm, p_start: Vector, p_end: Vector, sag: float, bulb_count: int, wire_mat_idx: int, bulb_mat_idx: int):
    steps = max(8, bulb_count * 2)
    pts = []
    for i in range(steps + 1):
        t = i / steps
        p = p_start.lerp(p_end, t)
        p.z -= sag * 4.0 * t * (1.0 - t)
        pts.append(p)
    for i in range(steps):
        add_cyl_part(bm, pts[i], pts[i + 1], 0.012, 0.012, 5, wire_mat_idx)

    for b in range(1, bulb_count + 1):
        t = b / (bulb_count + 1)
        anchor = p_start.lerp(p_end, t)
        anchor.z -= sag * 4.0 * t * (1.0 - t)
        socket_bot = anchor - Vector((0.0, 0.0, 0.055))
        add_cyl_part(bm, anchor, socket_bot, 0.016, 0.020, 6, wire_mat_idx)
        bulb_center = socket_bot - Vector((0.0, 0.0, 0.042))
        ret = bmesh.ops.create_icosphere(
            bm,
            subdivisions=1,
            radius=0.046,
            matrix=Matrix.Translation(bulb_center) @ Matrix.Diagonal((0.88, 0.88, 1.18, 1.0)),
        )
        for v in ret["verts"]:
            for f in v.link_faces:
                f.material_index = bulb_mat_idx
                f.smooth = True


def add_bistro_table_set(bm, cx: float, cy: float, deck_z: float, warm_wood_idx: int, dark_wood_idx: int, ceramic_idx: int, coffee_idx: int, metal_idx: int, bulb_idx: int):
    # 1. Turned wooden pedestal + 4 splayed feet + round plank tabletop
    ped_bot = Vector((cx, cy, deck_z))
    ped_top = Vector((cx, cy, deck_z + 0.50))
    add_cyl_part(bm, ped_bot, ped_top, 0.062, 0.048, 10, dark_wood_idx)
    for ang in (0.0, math.pi * 0.5, math.pi, math.pi * 1.5):
        foot_end = Vector((cx + math.cos(ang) * 0.34, cy + math.sin(ang) * 0.34, deck_z + 0.028))
        foot_hub = Vector((cx + math.cos(ang) * 0.04, cy + math.sin(ang) * 0.04, deck_z + 0.075))
        add_cyl_part(bm, foot_hub, foot_end, 0.032, 0.024, 6, dark_wood_idx)

    # Round warm pine tabletop (diameter 1.06m, top at deck_z + 0.535)
    top_z = deck_z + 0.535
    add_cyl_part(bm, Vector((cx, cy, deck_z + 0.495)), Vector((cx, cy, top_z)), 0.52, 0.535, 18, warm_wood_idx)
    # Dark rim band
    add_cyl_part(bm, Vector((cx, cy, deck_z + 0.482)), Vector((cx, cy, deck_z + 0.496)), 0.49, 0.52, 18, dark_wood_idx)

    # 2. Two cozy wooden low stools tucked slightly around the bistro table
    for stool_ang in (-0.85, 2.15):
        sx = cx + math.cos(stool_ang) * 0.72
        sy = cy + math.sin(stool_ang) * 0.72
        seat_bot = deck_z + 0.31
        seat_top = deck_z + 0.345
        add_cyl_part(bm, Vector((sx, sy, seat_bot)), Vector((sx, sy, seat_top)), 0.19, 0.195, 12, warm_wood_idx)
        for l_ang in (0.3, 1.87, 3.44, 5.01):
            l_top = Vector((sx + math.cos(l_ang) * 0.12, sy + math.sin(l_ang) * 0.12, seat_bot))
            l_bot = Vector((sx + math.cos(l_ang) * 0.16, sy + math.sin(l_ang) * 0.16, deck_z))
            add_cyl_part(bm, l_top, l_bot, 0.020, 0.015, 6, dark_wood_idx)

    # 3. Ceramic Da Lat Phin Coffee Cup + Warm Soy Mug + Tiny Glass Table Candle on tabletop!
    cup1 = Vector((cx - 0.16, cy - 0.09, top_z))
    add_cyl_part(bm, cup1, cup1 + Vector((0, 0, 0.085)), 0.036, 0.042, 10, ceramic_idx)
    add_cyl_part(bm, cup1 + Vector((0, 0, 0.072)), cup1 + Vector((0, 0, 0.082)), 0.035, 0.036, 10, coffee_idx)
    # Aluminum Phin filter perched on cup1
    add_cyl_part(bm, cup1 + Vector((0, 0, 0.085)), cup1 + Vector((0, 0, 0.091)), 0.052, 0.052, 10, metal_idx)
    add_cyl_part(bm, cup1 + Vector((0, 0, 0.091)), cup1 + Vector((0, 0, 0.142)), 0.038, 0.039, 10, metal_idx)

    cup2 = Vector((cx + 0.17, cy + 0.11, top_z))
    add_cyl_part(bm, cup2, cup2 + Vector((0, 0, 0.088)), 0.035, 0.040, 10, ceramic_idx)

    # Cozy glowing amber table votive lantern in center
    candle = Vector((cx + 0.02, cy - 0.14, top_z))
    add_cyl_part(bm, candle, candle + Vector((0, 0, 0.022)), 0.044, 0.040, 10, dark_wood_idx)
    add_cyl_part(bm, candle + Vector((0, 0, 0.022)), candle + Vector((0, 0, 0.095)), 0.034, 0.038, 10, bulb_idx)


def load_prepared_polyhaven_lantern():
    """Imports Poly Haven wooden_lantern_01, scales to 0.44m tall, decimates gently, and rescales textures to 256x256."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=LANTERN_GLTF)
    added_meshes = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    added_other = [o for o in bpy.data.objects if o not in before and o.type != 'MESH']

    if not added_meshes:
        return None

    bpy.ops.object.select_all(action='DESELECT')
    for m in added_meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = added_meshes[0]
    if len(added_meshes) > 1:
        bpy.ops.object.join()
    lantern = bpy.context.active_object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    for o in added_other:
        if o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)

    if len(lantern.data.polygons) > 650:
        dec = lantern.modifiers.new("DecLantern", 'DECIMATE')
        dec.ratio = min(1.0, 520.0 / len(lantern.data.polygons))
        bpy.ops.object.modifier_apply(modifier=dec.name)

    xs = [v.co.x for v in lantern.data.vertices]
    ys = [v.co.y for v in lantern.data.vertices]
    zs = [v.co.z for v in lantern.data.vertices]
    height = max(0.05, max(zs) - min(zs))
    scale_f = 0.44 / height
    cx = (min(xs) + max(xs)) * 0.5
    cy = (min(ys) + max(ys)) * 0.5
    max_z = max(zs)
    # Anchor at top hook (0, 0, 0) hanging downward to z = -0.44m!
    for v in lantern.data.vertices:
        v.co = Vector(((v.co.x - cx) * scale_f, (v.co.y - cy) * scale_f, (v.co.z - max_z) * scale_f))
    lantern.data.update()

    for slot in lantern.material_slots:
        if slot.material and slot.material.use_nodes:
            for node in slot.material.node_tree.nodes:
                if node.type == 'TEX_IMAGE' and node.image:
                    if node.image.size[0] > 256:
                        node.image.scale(256, 256)
                        node.image.pack()

    return lantern


def stamp_lantern_instance(template_obj, location: tuple):
    inst = template_obj.copy()
    inst.data = template_obj.data.copy()
    inst.location = location
    bpy.context.scene.collection.objects.link(inst)

    # Add warm glowing filament core inside the lantern glass cage!
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=1,
        radius=0.068,
        location=(location[0], location[1], location[2] - 0.24),
    )
    core = bpy.context.active_object
    core.data.materials.append(bpy.data.materials["HL_WarmBulb"])
    return [inst, core]


def upgrade_cafe_mo_suong():
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=os.path.join(RAW_GLB_DIR, "cafe_mo_suong.glb"))
    cafe = [o for o in bpy.data.objects if o.type == 'MESH'][0]
    bpy.ops.object.select_all(action='DESELECT')
    cafe.select_set(True)
    bpy.context.view_layer.objects.active = cafe
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Build real Poly Haven PBR materials
    mat_deck = build_gltf_pbr_material(
        "HL_PineDeck",
        f"{PBR_DIR}/wood_planks_dirt_Diffuse.jpg",
        f"{PBR_DIR}/wood_planks_dirt_nor_gl.jpg",
        f"{PBR_DIR}/wood_planks_dirt_arm.jpg",
        tint_rgb=(1.06, 0.92, 0.78, 1.05),
        normal_strength=0.90,
    )
    mat_warm = build_gltf_pbr_material(
        "HL_PineWarm",
        f"{PBR_DIR}/weathered_brown_planks_Diffuse.jpg",
        f"{PBR_DIR}/weathered_brown_planks_nor_gl.jpg",
        f"{PBR_DIR}/weathered_brown_planks_arm.jpg",
        tint_rgb=(1.12, 0.88, 0.68, 1.12),
        normal_strength=0.80,
    )
    mat_dark = build_gltf_pbr_material(
        "HL_PineDark",
        f"{PBR_DIR}/weathered_brown_planks_Diffuse.jpg",
        f"{PBR_DIR}/weathered_brown_planks_nor_gl.jpg",
        f"{PBR_DIR}/weathered_brown_planks_arm.jpg",
        tint_rgb=(0.74, 0.56, 0.44, 0.86),
        normal_strength=0.92,
    )
    mat_zinc = build_gltf_pbr_material(
        "HL_ZincRoof",
        f"{PBR_DIR}/corrugated_iron_Diffuse.jpg",
        f"{PBR_DIR}/corrugated_iron_nor_gl.jpg",
        f"{PBR_DIR}/corrugated_iron_arm.jpg",
        tint_rgb=(0.86, 0.92, 0.98, 0.92),
        normal_strength=0.95,
        metallic_factor=0.55,
    )
    mat_rust = build_gltf_pbr_material(
        "HL_RustRoof",
        f"{PBR_DIR}/corrugated_iron_Diffuse.jpg",
        f"{PBR_DIR}/corrugated_iron_nor_gl.jpg",
        f"{PBR_DIR}/corrugated_iron_arm.jpg",
        tint_rgb=(0.98, 0.66, 0.52, 0.88),
        normal_strength=0.95,
        metallic_factor=0.35,
    )
    mat_win = make_emissive_mat("HL_WarmWin", "#FFE6BA", "#FF9E40", 2.15, roughness=0.16)
    mat_bulb = make_emissive_mat("HL_WarmBulb", "#FFF2CF", "#FFB254", 3.4, roughness=0.14)
    mat_iron = make_solid_mat("HL_IronDark", "#252326", roughness=0.52, metallic=0.68)
    mat_ceramic = make_solid_mat("HL_CeramicCream", "#F4ECE0", roughness=0.26, metallic=0.02)
    mat_coffee = make_solid_mat("HL_Espresso", "#26140D", roughness=0.14, metallic=0.02)

    me = cafe.data
    def ensure_slot(mat):
        for i, m in enumerate(me.materials):
            if m and m.name == mat.name:
                me.materials[i] = mat
                return i
        me.materials.append(mat)
        return len(me.materials) - 1

    idx_deck = ensure_slot(mat_deck)
    idx_warm = ensure_slot(mat_warm)
    idx_dark = ensure_slot(mat_dark)
    ensure_slot(mat_zinc)
    ensure_slot(mat_rust)
    ensure_slot(mat_win)
    idx_bulb = ensure_slot(mat_bulb)
    idx_iron = ensure_slot(mat_iron)
    idx_ceramic = ensure_slot(mat_ceramic)
    idx_coffee = ensure_slot(mat_coffee)
    idx_metal = next((i for i, m in enumerate(me.materials) if m and m.name == "HL_Aluminum"), idx_iron)

    bm = bmesh.new()
    bm.from_mesh(me)
    mats = [m.name if m else "" for m in me.materials]

    # 1. Inspect connected islands to clean flat decal strips & plain cube tables, and level deck top to exact Z=0.157!
    visited = set()
    verts_to_delete = set()
    for v in bm.verts:
        if v in visited:
            continue
        comp = []
        stack = [v]
        visited.add(v)
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for e in cur.link_edges:
                nb = e.other_vert(cur)
                if nb not in visited:
                    visited.add(nb)
                    stack.append(nb)
        faces = {f for cv in comp for f in cv.link_faces}
        mnames = {mats[f.material_index] for f in faces}
        xs = [cv.co.x for cv in comp]
        ys = [cv.co.y for cv in comp]
        zs = [cv.co.z for cv in comp]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        min_z, max_z = min(zs), max(zs)

        # Remove the 6 flat floating decal planes at Z=0.157 that caused wide tan stripes
        if mnames == {"HL_PineWarm"} and abs(min_z - 0.157) < 0.003 and abs(max_z - 0.157) < 0.003:
            verts_to_delete.update(comp)
            continue

        # Remove the 3 plain solid brown cube boxes on the veranda (at (5.5,-5.0), (5.5,4.5), (9.5,0.0))
        if (
            mnames == {"HL_PineWarm"}
            and min_x > 4.8
            and abs(min_z - 0.150) < 0.01
            and abs(max_z - 0.610) < 0.015
            and (max_x - min_x) < 1.1
        ):
            verts_to_delete.update(comp)
            continue

        # Level main veranda deck top face from 0.150 -> exact 0.157m (worldY = 135.307m, 100% flush with collider!)
        if "HL_PineDeck" in mnames and min_x < -13.0 and max_x > 13.0:
            for cv in comp:
                if abs(cv.co.z - 0.150) < 0.005:
                    cv.co.z = 0.157

    if verts_to_delete:
        bmesh.ops.delete(bm, geom=list(verts_to_delete), context='VERTS')

    # 2. Add 3 sculpted Da Lat round wooden bistro coffee tables + low stools + steaming phin cups!
    for tx, ty in [(5.5, -5.0), (5.5, 4.5), (9.5, 0.0)]:
        add_bistro_table_set(bm, tx, ty, 0.157, idx_warm, idx_dark, idx_ceramic, idx_coffee, idx_metal, idx_bulb)

    # 3. Add architectural timber frames & 3x2 cross-mullions over all 4 glowing cafe windows!
    # Front windows at X = -3.21, Y in [-4.70, -2.50] & [2.50, 4.70], Z in [1.525, 2.975]
    for wy0, wy1 in [(-4.70, -2.50), (2.50, 4.70)]:
        wy_mid = (wy0 + wy1) * 0.5
        wy_span = wy1 - wy0
        wz0, wz1 = 1.525, 2.975
        wz_mid = (wz0 + wz1) * 0.5
        wz_span = wz1 - wz0
        wx = -3.20
        # Top header, bottom sill, left/right jambs
        add_box_part(bm, (wx + 0.03, wy_mid, wz1 + 0.045), (0.12, wy_span + 0.20, 0.09), idx_dark)
        add_box_part(bm, (wx + 0.05, wy_mid, wz0 - 0.045), (0.16, wy_span + 0.24, 0.09), idx_dark)
        add_box_part(bm, (wx + 0.03, wy0 - 0.04, wz_mid), (0.11, 0.08, wz_span), idx_dark)
        add_box_part(bm, (wx + 0.03, wy1 + 0.04, wz_mid), (0.11, 0.08, wz_span), idx_dark)
        # Cross mullions (2 vertical, 1 horizontal)
        for frac in (0.333, 0.667):
            add_box_part(bm, (wx + 0.015, wy0 + wy_span * frac, wz_mid), (0.06, 0.045, wz_span), idx_dark)
        add_box_part(bm, (wx + 0.015, wy_mid, wz0 + wz_span * 0.52), (0.06, wy_span, 0.045), idx_dark)

    # Side windows at Y = -6.19, X in [-10.60, -8.60] & [-6.60, -4.60], Z in [1.550, 2.950]
    for wx0, wx1 in [(-10.60, -8.60), (-6.60, -4.60)]:
        wx_mid = (wx0 + wx1) * 0.5
        wx_span = wx1 - wx0
        wz0, wz1 = 1.550, 2.950
        wz_mid = (wz0 + wz1) * 0.5
        wz_span = wz1 - wz0
        wy = -6.19
        add_box_part(bm, (wx_mid, wy - 0.03, wz1 + 0.045), (wx_span + 0.18, 0.11, 0.08), idx_dark)
        add_box_part(bm, (wx_mid, wy - 0.05, wz0 - 0.045), (wx_span + 0.22, 0.15, 0.08), idx_dark)
        add_box_part(bm, (wx0 - 0.04, wy - 0.03, wz_mid), (0.08, 0.10, wz_span), idx_dark)
        add_box_part(bm, (wx1 + 0.04, wy - 0.03, wz_mid), (0.08, 0.10, wz_span), idx_dark)
        add_box_part(bm, (wx_mid, wy - 0.015, wz_mid), (0.045, 0.06, wz_span), idx_dark)
        add_box_part(bm, (wx_mid, wy - 0.015, wz0 + wz_span * 0.52), (wx_span, 0.06, 0.045), idx_dark)

    # 4. Add cozy Roastery Stovepipe Chimney on roof at (-6.8, +0.5, 4.35..5.45) matching steam particle emitter!
    add_cyl_part(bm, Vector((-6.8, 0.5, 4.25)), Vector((-6.8, 0.5, 5.25)), 0.17, 0.15, 10, idx_iron)
    add_cyl_part(bm, Vector((-6.8, 0.5, 5.32)), Vector((-6.8, 0.5, 5.46)), 0.28, 0.04, 10, idx_iron)

    # 5. Add draped catenary Edison fairy string lights across the veranda!
    add_catenary_string_lights(bm, Vector((-0.30, -5.50, 3.22)), Vector((11.50, -5.50, 3.55)), 0.32, 6, idx_iron, idx_bulb)
    add_catenary_string_lights(bm, Vector((-0.30,  5.50, 3.22)), Vector((11.50,  5.50, 3.55)), 0.32, 6, idx_iron, idx_bulb)
    add_catenary_string_lights(bm, Vector((11.50, -5.50, 3.55)), Vector((11.50,  5.50, 3.55)), 0.42, 7, idx_iron, idx_bulb)
    add_catenary_string_lights(bm, Vector((-0.30, -2.00, 3.22)), Vector((11.50,  5.50, 3.55)), 0.46, 6, idx_iron, idx_bulb)
    add_catenary_string_lights(bm, Vector((-0.30,  2.00, 3.22)), Vector((11.50, -5.50, 3.55)), 0.46, 6, idx_iron, idx_bulb)

    bm.to_mesh(me)
    bm.free()
    me.update()

    assign_world_box_uvs(
        me,
        {
            "HL_PineDeck": 0.42,
            "HL_PineWarm": 0.48,
            "HL_PineDark": 0.52,
            "HL_ZincRoof": 0.38,
            "HL_RustRoof": 0.38,
        },
    )

    # 6. Hang 3 real Poly Haven wooden_lantern_01 lanterns under the front veranda eaves!
    lantern_tpl = load_prepared_polyhaven_lantern()
    extra_objs = []
    if lantern_tpl:
        for ly in (-4.1, 0.0, 4.1):
            extra_objs.extend(stamp_lantern_instance(lantern_tpl, (-0.30, ly, 3.12)))
        bpy.data.objects.remove(lantern_tpl, do_unlink=True)

    # Join everything cleanly into CafeMoSuong single mesh so HeroLandmarks draw calls stay minimal!
    if extra_objs:
        bpy.ops.object.select_all(action='DESELECT')
        cafe.select_set(True)
        for eo in extra_objs:
            eo.select_set(True)
        bpy.context.view_layer.objects.active = cafe
        bpy.ops.object.join()

    out_path = os.path.join(OUT_GLB_DIR, "cafe_mo_suong.glb")
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        export_yup=True,
        export_image_format='WEBP',
        export_image_quality=84,
        export_normals=True,
        export_texcoords=True,
    )
    print(f"[PBR Upgrade] Exported {out_path} ({os.path.getsize(out_path)/1024:.1f} KB)")


def upgrade_cau_go_bridge():
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=os.path.join(RAW_GLB_DIR, "cau_go_bridge.glb"))
    bridge = [o for o in bpy.data.objects if o.type == 'MESH'][0]
    bpy.ops.object.select_all(action='DESELECT')
    bridge.select_set(True)
    bpy.context.view_layer.objects.active = bridge
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    mat_deck = build_gltf_pbr_material(
        "HL_PineDeck",
        f"{PBR_DIR}/wood_planks_dirt_Diffuse.jpg",
        f"{PBR_DIR}/wood_planks_dirt_nor_gl.jpg",
        f"{PBR_DIR}/wood_planks_dirt_arm.jpg",
        tint_rgb=(1.08, 0.92, 0.76, 1.08),
        normal_strength=0.92,
    )
    mat_warm = build_gltf_pbr_material(
        "HL_PineWarm",
        f"{PBR_DIR}/weathered_brown_planks_Diffuse.jpg",
        f"{PBR_DIR}/weathered_brown_planks_nor_gl.jpg",
        f"{PBR_DIR}/weathered_brown_planks_arm.jpg",
        tint_rgb=(1.14, 0.90, 0.70, 1.10),
        normal_strength=0.85,
    )
    mat_dark = build_gltf_pbr_material(
        "HL_PineDark",
        f"{PBR_DIR}/weathered_brown_planks_Diffuse.jpg",
        f"{PBR_DIR}/weathered_brown_planks_nor_gl.jpg",
        f"{PBR_DIR}/weathered_brown_planks_arm.jpg",
        tint_rgb=(0.74, 0.56, 0.44, 0.88),
        normal_strength=0.92,
    )
    mat_rope = build_gltf_pbr_material(
        "HL_RopeHemp",
        f"{PBR_DIR}/weathered_brown_planks_Diffuse.jpg",
        f"{PBR_DIR}/weathered_brown_planks_nor_gl.jpg",
        f"{PBR_DIR}/weathered_brown_planks_arm.jpg",
        tint_rgb=(1.22, 1.08, 0.84, 1.18),
        normal_strength=1.10,
    )
    mat_bulb = make_emissive_mat("HL_WarmBulb", "#FFF2CF", "#FFB254", 3.2, roughness=0.14)
    mat_iron = make_solid_mat("HL_IronDark", "#252326", roughness=0.52, metallic=0.68)

    me = bridge.data
    def ensure_slot(mat):
        for i, m in enumerate(me.materials):
            if m and m.name == mat.name:
                me.materials[i] = mat
                return i
        me.materials.append(mat)
        return len(me.materials) - 1

    ensure_slot(mat_deck)
    ensure_slot(mat_warm)
    ensure_slot(mat_dark)
    ensure_slot(mat_rope)
    idx_bulb = ensure_slot(mat_bulb)
    idx_iron = ensure_slot(mat_iron)

    # Add warm catenary festoon lights overhead at the sunrise arch (X=44.2, Y=-3.95..+3.95, Z=4.22)
    bm = bmesh.new()
    bm.from_mesh(me)
    add_catenary_string_lights(bm, Vector((44.20, 2.65, 4.22)), Vector((44.20, 3.95, 4.22)), 0.12, 3, idx_iron, idx_bulb)
    bm.to_mesh(me)
    bm.free()
    me.update()

    assign_world_box_uvs(
        me,
        {
            "HL_PineDeck": 0.46,
            "HL_PineWarm": 0.48,
            "HL_PineDark": 0.52,
            "HL_RopeHemp": 1.35,
        },
    )

    # Hang real Poly Haven wooden_lantern_01 from the sunrise timber frame!
    lantern_tpl = load_prepared_polyhaven_lantern()
    extra_objs = []
    if lantern_tpl:
        extra_objs.extend(stamp_lantern_instance(lantern_tpl, (44.20, 3.30, 4.18)))
        bpy.data.objects.remove(lantern_tpl, do_unlink=True)

    if extra_objs:
        bpy.ops.object.select_all(action='DESELECT')
        bridge.select_set(True)
        for eo in extra_objs:
            eo.select_set(True)
        bpy.context.view_layer.objects.active = bridge
        bpy.ops.object.join()

    out_path = os.path.join(OUT_GLB_DIR, "cau_go_bridge.glb")
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        export_yup=True,
        export_image_format='WEBP',
        export_image_quality=84,
        export_normals=True,
        export_texcoords=True,
    )
    print(f"[PBR Upgrade] Exported {out_path} ({os.path.getsize(out_path)/1024:.1f} KB)")


if __name__ == "__main__":
    upgrade_cafe_mo_suong()
    upgrade_cau_go_bridge()
