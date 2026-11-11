"""
Builds 4 ready-made, expressive, textured Ready Player Me 3D Human Hikers
for Da Lat Cloud Hunting ("Chạm Mây Đà Lạt"):
  1. hiker_f_adventurer.glb (wool_trench)    <- Lyra (Belted Wool Trench Coat + Winter Tights + Tall Boots)
  2. hiker_f_casual.glb     (knit_sweater)   <- Celeste (Cozy Winter Drawstring Hoodie + Cargo Pants + Sneakers)
  3. hiker_m_jacket.glb     (puffer_vest)    <- Thanh (Vietnamese Young Man in Collared Jacket/Shirt + Trousers)
  4. hiker_m_sweater.glb    (vintage_poncho) <- Thanh Head/Hair + Vintage Da Lat Tailored Overcoat & Waistcoat
"""
import bpy
import bmesh
import math
import mathutils
import os

CAND_DIR = "/Users/admin/.gemini/antigravity/brain/b225db1c-7975-469e-88d4-556d97d63d29/scratch/human_candidates"
OUT_DIR = "/Users/admin/blender/dalat_cloud_hunting/apps/web/public/assets/models"
SCRATCH_DIR = "/Users/admin/.gemini/antigravity/brain/b225db1c-7975-469e-88d4-556d97d63d29/scratch"

os.makedirs(OUT_DIR, exist_ok=True)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_rgba(h: str):
    h = h.lstrip("#")
    return (
        srgb_to_linear(int(h[0:2], 16) / 255.0),
        srgb_to_linear(int(h[2:4], 16) / 255.0),
        srgb_to_linear(int(h[4:6], 16) / 255.0),
        1.0,
    )


def make_pbr_mat(name: str, hex_col: str, roughness: float = 0.82, metallic: float = 0.02):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = hex_to_rgba(hex_col)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
    return mat


def get_base_color_image(mat):
    if not mat or not mat.use_nodes:
        return None
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if not bsdf:
        return None
    inp = bsdf.inputs.get("Base Color")
    if inp and inp.is_linked:
        node = inp.links[0].from_node
        if node.type == 'TEX_IMAGE' and node.image:
            return node.image
    for n in mat.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image and any(k in n.image.name.lower() for k in ("base", "diffuse", "color")):
            return n.image
    return None


def neutralize_image_for_tinting(img, name_suffix: str, min_lum: float = 0.44, max_lum: float = 0.98, contrast_gamma: float = 0.82, preserve_white_highlights: bool = False):
    """
    Converts a colored clothing/hair texture into a high-detail neutral white/silver luminance map
    so Three.js material.color can tint it to ANY color while preserving 100% of fabric folds, lapels,
    buttons, seams, pockets, and hair strand detail!
    """
    if not img:
        return None
    new_img = img.copy()
    new_img.name = f"{img.name}_{name_suffix}"
    px = list(new_img.pixels)
    n_pix = len(px) // 4

    sample_lums = []
    step = max(1, n_pix // 4000)
    for idx in range(0, n_pix, step):
        i = idx * 4
        lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
        sample_lums.append(lum)
    sample_lums.sort()
    p92 = sample_lums[int(len(sample_lums) * 0.92)] if sample_lums else 0.8
    p08 = sample_lums[int(len(sample_lums) * 0.08)] if sample_lums else 0.05
    # If original texture is jet-black (p92 < 0.22), avoid stretching 8x8 dark compression blocks;
    # keep clean high luminance so the Normal Map drives crisp lapel/fold shading!
    if p92 < 0.22:
        eff_min = 0.78
        eff_max = 0.96
        span = max(0.28, p92 - p08)
    else:
        eff_min = min_lum
        eff_max = max_lum
        span = max(0.18, p92 - p08)

    for idx in range(n_pix):
        i = idx * 4
        r, g, b = px[i], px[i + 1], px[i + 2]
        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        t = max(0.0, min(1.0, (lum - p08) / span))
        t = t ** contrast_gamma
        val = eff_min + t * (eff_max - eff_min)
        if preserve_white_highlights and lum > 0.82 and abs(r - g) < 0.08 and abs(g - b) < 0.08:
            val = max(val, 0.96)
        px[i] = val
        px[i + 1] = val
        px[i + 2] = val

    new_img.pixels[:] = px
    new_img.pack()
    return new_img


def naturalize_pastel_eyebrows_on_skin(img):
    """Turns neon pink/lavender dyed eyebrows on Lyra/Celeste head textures into natural warm espresso-brown eyebrows!"""
    if not img:
        return
    px = list(img.pixels)
    n_pix = len(px) // 4
    changed = 0
    for idx in range(n_pix):
        i = idx * 4
        r, g, b = px[i], px[i + 1], px[i + 2]
        if (b > g * 1.15 and r > g * 1.15 and b > 0.20 and r < b * 2.1):
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            dark = max(0.06, min(0.28, lum * 0.36))
            px[i] = dark * 1.28
            px[i + 1] = dark * 0.92
            px[i + 2] = dark * 0.74
            changed += 1
    if changed > 0:
        img.pixels[:] = px
        img.pack()


def set_material_for_slot(obj, mat_name: str, mode: str, roughness: float = 0.78):
    """Prepares Wolf3D material for dynamic tinting (Mat_Coat, Mat_Hair) while keeping normal/roughness maps!"""
    if not obj.material_slots or not obj.material_slots[0].material:
        return
    src_mat = obj.material_slots[0].material
    mat = src_mat.copy()
    mat.name = mat_name
    obj.material_slots[0].material = mat

    if not mat.use_nodes:
        return
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        if not bsdf.inputs["Roughness"].is_linked:
            bsdf.inputs["Roughness"].default_value = roughness
        elif mode == "coat_matte":
            for lk in list(bsdf.inputs["Roughness"].links):
                mat.node_tree.links.remove(lk)
            bsdf.inputs["Roughness"].default_value = roughness

        if not bsdf.inputs["Metallic"].is_linked:
            bsdf.inputs["Metallic"].default_value = 0.02
        elif mode == "coat_matte":
            for lk in list(bsdf.inputs["Metallic"].links):
                mat.node_tree.links.remove(lk)
            bsdf.inputs["Metallic"].default_value = 0.02

        inp = bsdf.inputs.get("Base Color")
        if inp and inp.is_linked:
            tex_node = inp.links[0].from_node
            if tex_node.type == 'TEX_IMAGE' and tex_node.image:
                if mode in ("coat", "coat_matte"):
                    tex_node.image = neutralize_image_for_tinting(
                        tex_node.image, mat_name, min_lum=0.46, max_lum=0.98, contrast_gamma=0.80, preserve_white_highlights=True
                    )
                elif mode == "hair":
                    tex_node.image = neutralize_image_for_tinting(
                        tex_node.image, mat_name, min_lum=0.38, max_lum=0.96, contrast_gamma=0.85, preserve_white_highlights=False
                    )


def smooth_subdivide_accessory(obj, levels: int = 1):
    bpy.context.view_layer.objects.active = obj
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0002)
    bm.to_mesh(obj.data)
    bm.free()
    sub = obj.modifiers.new(name="SmoothSubd", type='SUBSURF')
    sub.levels = levels
    sub.render_levels = levels
    bpy.ops.object.modifier_apply(modifier=sub.name)
    for p in obj.data.polygons:
        p.use_smooth = True


def bind_rigid_accessory_to_bone(obj, arm_obj, bone_name: str):
    """Binds an accessory mesh 100% rigidly to a single bone on arm_obj (ZERO multi-bone spike risk!)."""
    bpy.context.view_layer.update()
    inv_arm = arm_obj.matrix_world.inverted()
    m_to_arm = inv_arm @ obj.matrix_world
    me = obj.data
    for v in me.vertices:
        v.co = m_to_arm @ v.co
    me.update()

    obj.vertex_groups.clear()
    obj.modifiers.clear()
    obj.parent = arm_obj
    obj.matrix_parent_inverse.identity()
    obj.location = (0.0, 0.0, 0.0)
    obj.rotation_euler = (0.0, 0.0, 0.0)
    obj.scale = (1.0, 1.0, 0.0 + 1.0)

    vg = obj.vertex_groups.new(name=bone_name)
    vg.add(list(range(len(me.vertices))), 1.0, 'REPLACE')
    amod = obj.modifiers.new(name="Armature", type='ARMATURE')
    amod.object = arm_obj
    for p in me.polygons:
        p.use_smooth = True


def create_dalat_daypack(back_surface_y: float, spine2_z: float):
    """Creates a clean, rounded vintage canvas & leather Da Lat hiking daypack + rolled blanket."""
    mat_pack = make_pbr_mat("Mat_Backpack", "#786D59", 0.85)
    mat_strap = make_pbr_mat("Mat_Boots", "#543624", 0.78)
    mat_gold = make_pbr_mat("Mat_Accent", "#D8A24A", 0.40, 0.35)
    mat_bedroll = make_pbr_mat("Mat_Bedroll", "#325173", 0.84)

    parts = []
    cy = back_surface_y + 0.068
    cz = spine2_z + 0.025

    # Main rounded canvas pack body
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, cy, cz))
    body = bpy.context.active_object
    body.scale = (0.24, 0.13, 0.31)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bev = body.modifiers.new("Bevel", 'BEVEL')
    bev.width = 0.036
    bev.segments = 3
    bpy.ops.object.modifier_apply(modifier=bev.name)
    body.data.materials.append(mat_pack)
    parts.append(body)

    # Front lower zip pouch
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, cy + 0.065, cz - 0.055))
    pouch = bpy.context.active_object
    pouch.scale = (0.19, 0.048, 0.135)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bev2 = pouch.modifiers.new("Bevel", 'BEVEL')
    bev2.width = 0.018
    bev2.segments = 2
    bpy.ops.object.modifier_apply(modifier=bev2.name)
    pouch.data.materials.append(mat_pack)
    parts.append(pouch)

    # Rolled pine-blue camping blanket on top
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=18,
        radius=0.046,
        depth=0.27,
        location=(0.0, cy - 0.005, cz + 0.175),
        rotation=(0.0, math.pi * 0.5, 0.0),
    )
    roll = bpy.context.active_object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    roll.data.materials.append(mat_bedroll)
    parts.append(roll)

    # Twin leather vertical straps + brass buckles
    for sx in (-0.062, 0.062):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(sx, cy + 0.066, cz + 0.045))
        strap = bpy.context.active_object
        strap.scale = (0.022, 0.014, 0.22)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        strap.data.materials.append(mat_strap)
        parts.append(strap)

        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(sx, cy + 0.075, cz + 0.015))
        buckle = bpy.context.active_object
        buckle.scale = (0.028, 0.016, 0.022)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        buckle.data.materials.append(mat_gold)
        parts.append(buckle)

    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    bp_obj = bpy.context.active_object
    bp_obj.name = "Hiker_Backpack"
    bp_obj.data.name = "Hiker_Backpack"
    for poly in bp_obj.data.polygons:
        poly.use_smooth = True
    return bp_obj


def attach_dalat_accessories(arm_obj):
    """Attaches snug Da Lat Scarf, Beanie, Beret, and clean Spine2-bound Backpack onto Ready Player Me rig."""
    bpy.context.view_layer.update()
    mat_scarf = make_pbr_mat("Mat_Scarf", "#E8D5B7", 0.86)
    mat_cream = make_pbr_mat("Mat_Cream", "#FAF2E6", 0.88)
    mat_beret = make_pbr_mat("Mat_Coat_Beret", "#C87D55", 0.80)

    head_bone = arm_obj.data.bones["Head"]
    neck_bone = arm_obj.data.bones["Neck"]
    spine2_bone = arm_obj.data.bones["Spine2"]

    head_w = arm_obj.matrix_world @ head_bone.head_local
    neck_w = arm_obj.matrix_world @ neck_bone.head_local
    spine2_w = arm_obj.matrix_world @ spine2_bone.head_local

    crown_verts = []
    back_verts = []
    collar_front_ys = []
    for o in bpy.data.objects:
        if o.type == 'MESH' and any(k in o.name for k in ("Wolf3D_Head", "Wolf3D_Hair")):
            for v in o.data.vertices:
                wv = o.matrix_world @ v.co
                if wv.z > head_w.z + 0.04:
                    crown_verts.append(wv)
        if o.type == 'MESH' and "Wolf3D_Outfit_Top" in o.name:
            for v in o.data.vertices:
                wv = o.matrix_world @ v.co
                if abs(wv.x) < 0.12 and spine2_w.z - 0.05 < wv.z < spine2_w.z + 0.18:
                    back_verts.append(wv)
                if abs(wv.x) < 0.09 and neck_w.z - 0.04 < wv.z < neck_w.z + 0.04 and wv.y < neck_w.y:
                    collar_front_ys.append(wv.y)

    if crown_verts:
        rx = max(0.102, (max(v.x for v in crown_verts) - min(v.x for v in crown_verts)) * 0.50)
        ry = max(0.110, (max(v.y for v in crown_verts) - min(v.y for v in crown_verts)) * 0.50)
        top_z = max(v.z for v in crown_verts)
        cy = (min(v.y for v in crown_verts) + max(v.y for v in crown_verts)) * 0.5
    else:
        rx, ry, top_z, cy = 0.112, 0.120, head_w.z + 0.21, head_w.y

    back_surface_y = max((v.y for v in back_verts), default=0.11)
    front_collar_y = min(collar_front_ys) if collar_front_ys else (neck_w.y - 0.075)

    # 1. Cozy Knitted Wool Scarf around Neck ABOVE Collar + Hanging Tail in Front
    scarf_z = neck_w.z + 0.018
    scarf_y = neck_w.y - 0.010
    front_clear_radius = min(0.110, max(0.094, abs(front_collar_y - scarf_y) + 0.006))
    bpy.ops.mesh.primitive_torus_add(
        major_radius=front_clear_radius,
        minor_radius=0.026,
        major_segments=24,
        minor_segments=12,
        location=(0.0, scarf_y, scarf_z),
        rotation=(-0.22, 0.0, 0.0),
    )
    s_loop = bpy.context.active_object
    s_loop.scale = (0.94, 1.06, 0.92)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=14,
        ring_count=10,
        radius=0.025,
        location=(0.028, scarf_y - front_clear_radius * 1.06 - 0.008, scarf_z - 0.056),
    )
    s_tail = bpy.context.active_object
    s_tail.scale = (0.88, 0.44, 1.90)
    s_tail.rotation_euler = (-0.20, 0.08, -0.06)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    bpy.ops.object.select_all(action='DESELECT')
    s_loop.select_set(True)
    s_tail.select_set(True)
    bpy.context.view_layer.objects.active = s_loop
    bpy.ops.object.join()
    scarf_obj = bpy.context.active_object
    scarf_obj.name = "Hiker_Scarf"
    scarf_obj.data.name = "Hiker_Scarf"
    scarf_obj.data.materials.append(mat_scarf)
    smooth_subdivide_accessory(scarf_obj, levels=1)
    bind_rigid_accessory_to_bone(scarf_obj, arm_obj, "Neck")

    # 2. Snug Winter Wool Beanie + Pom-Pom
    beanie_z = top_z - 0.076
    beanie_y = cy + 0.006
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=20,
        ring_count=12,
        radius=1.0,
        location=(0.0, beanie_y, beanie_z),
    )
    dome = bpy.context.active_object
    bm = bmesh.new()
    bm.from_mesh(dome.data)
    for v in bm.verts:
        if v.co.z < -0.06:
            v.co.z = -0.06
            v.co.x *= 0.95
            v.co.y *= 0.95
    bm.to_mesh(dome.data)
    bm.free()
    dome.scale = (rx * 1.09, ry * 1.07, 0.096)
    dome.rotation_euler = (-0.16, 0.0, 0.0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    dome.data.materials.append(mat_scarf)

    bpy.ops.mesh.primitive_torus_add(
        major_radius=1.0,
        minor_radius=0.14,
        major_segments=20,
        minor_segments=10,
        location=(0.0, beanie_y, beanie_z - 0.006),
    )
    cuff = bpy.context.active_object
    cuff.scale = (rx * 1.06, ry * 1.05, 0.108)
    cuff.rotation_euler = (-0.16, 0.0, 0.0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    cuff.data.materials.append(mat_scarf)

    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=12,
        ring_count=8,
        radius=0.024,
        location=(0.0, beanie_y + 0.016, beanie_z + 0.096),
    )
    pom = bpy.context.active_object
    pom.data.materials.append(mat_cream)

    bpy.ops.object.select_all(action='DESELECT')
    dome.select_set(True)
    cuff.select_set(True)
    pom.select_set(True)
    bpy.context.view_layer.objects.active = dome
    bpy.ops.object.join()
    beanie_obj = bpy.context.active_object
    beanie_obj.name = "Hiker_Beanie"
    beanie_obj.data.name = "Hiker_Beanie"
    smooth_subdivide_accessory(beanie_obj, levels=1)
    bind_rigid_accessory_to_bone(beanie_obj, arm_obj, "Head")

    # 3. Stylish Da Lat French Wool Beret
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=20,
        ring_count=12,
        radius=1.0,
        location=(0.016, cy + 0.004, top_z - 0.044),
    )
    beret = bpy.context.active_object
    beret.scale = (rx * 1.14, ry * 1.10, 0.045)
    beret.rotation_euler = (-0.12, 0.20, 0.05)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    beret.name = "Hiker_Beret"
    beret.data.name = "Hiker_Beret"
    beret.data.materials.append(mat_beret)
    smooth_subdivide_accessory(beret, levels=1)
    bind_rigid_accessory_to_bone(beret, arm_obj, "Head")

    # 4. Clean Rigid Spine2-Bound Hiking Backpack (ZERO deformation spikes!)
    bp_obj = create_dalat_daypack(back_surface_y, spine2_w.z)
    bind_rigid_accessory_to_bone(bp_obj, arm_obj, "Spine2")


def build_rpm_hiker(base_glb: str, out_name: str, head_donor_glb: str = None, matte_coat: bool = False):
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=base_glb)

    # Remove stray helper/mask/glasses/beard/fedora-hat meshes
    for o in list(bpy.data.objects):
        if o.name == "Mesh" or any(k in o.name for k in ("Icosphere", "Facewear", "Glasses", "Beard", "Headwear")):
            bpy.data.objects.remove(o, do_unlink=True)

    arm_obj = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    arm_obj.name = "Armature"

    # Optional head/hair swap from donor RPM avatar (e.g., Thanh's Vietnamese face + hair onto vintage overcoat!)
    if head_donor_glb:
        for o in list(bpy.data.objects):
            if o.type == 'MESH' and any(k in o.name for k in ("Wolf3D_Head", "Wolf3D_Hair", "Wolf3D_Teeth", "EyeLeft", "EyeRight")):
                bpy.data.objects.remove(o, do_unlink=True)

        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=head_donor_glb)
        added = [o for o in bpy.data.objects if o not in before]
        keep_donor = []
        for o in added:
            if o.type == 'MESH' and any(k in o.name for k in ("Wolf3D_Head", "Wolf3D_Hair", "Wolf3D_Teeth", "EyeLeft", "EyeRight")):
                o.parent = arm_obj
                o.matrix_parent_inverse.identity()
                for mod in o.modifiers:
                    if mod.type == 'ARMATURE':
                        mod.object = arm_obj
                keep_donor.append(o)
        for o in list(added):
            if o not in keep_donor:
                bpy.data.objects.remove(o, do_unlink=True)
        for o in keep_donor:
            clean_n = o.name.split(".")[0]
            o.name = clean_n
            o.data.name = clean_n

    # Ensure footwear sole sits flush at Z = 0.000m in rest pose
    bpy.context.view_layer.update()
    foot_zs = []
    for o in bpy.data.objects:
        if o.type == 'MESH' and "Footwear" in o.name:
            for v in o.data.vertices:
                foot_zs.append((o.matrix_world @ v.co).z)
    if foot_zs:
        min_fz = min(foot_zs)
        if abs(min_fz) > 0.001:
            arm_obj.location.z -= min_fz
            bpy.context.view_layer.update()

    # Prepare tintable Coat & Hair materials while preserving full Ready Player Me facial/eye/skin/cloth textures!
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        if "Wolf3D_Head" in o.name and o.material_slots and o.material_slots[0].material:
            head_img = get_base_color_image(o.material_slots[0].material)
            naturalize_pastel_eyebrows_on_skin(head_img)
        elif "Wolf3D_Outfit_Top" in o.name:
            set_material_for_slot(o, "Mat_Coat", "coat_matte" if matte_coat else "coat", roughness=0.78)
        elif "Wolf3D_Hair" in o.name:
            set_material_for_slot(o, "Mat_Hair", "hair", roughness=0.72)

    attach_dalat_accessories(arm_obj)

    # Clear embedded actions on individual character GLBs (all animations live in shared hiker_animations.glb!)
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)

    out_path = os.path.join(OUT_DIR, out_name)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        export_yup=True,
        export_skins=True,
        export_animations=False,
        export_morph=False,
    )
    meshes_exported = sorted(o.name for o in bpy.data.objects if o.type == 'MESH')
    print(f"Exported {out_name} ({os.path.getsize(out_path)/1024:.1f} KB) -> Meshes: {meshes_exported}")


def render_verification_sheet():
    """Renders an up-close portrait & outfit inspection sheet of all 4 exported Ready Player Me hikers!"""
    reset_scene()
    scn = bpy.context.scene
    scn.render.engine = 'BLENDER_EEVEE'
    scn.render.resolution_x = 1920
    scn.render.resolution_y = 820
    scn.render.film_transparent = False

    world = bpy.data.worlds.new("WarmStudio")
    scn.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.34, 0.25, 0.22, 1.0)
        bg.inputs[1].default_value = 1.15

    configs = [
        ("hiker_f_adventurer.glb", -1.20, "#C87D55", "#2B1E1A", "#E8D5B7", "none"),
        ("hiker_f_casual.glb", -0.40, "#D98A6C", "#3D261E", "#F4EFE6", "beanie"),
        ("hiker_m_jacket.glb", 0.40, "#4F6D5A", "#1C1817", "#D9A441", "none"),
        ("hiker_m_sweater.glb", 1.20, "#6E5242", "#261C18", "#C87D55", "beret"),
    ]

    for fname, x_pos, coat_hex, hair_hex, scarf_hex, headwear in configs:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(OUT_DIR, fname))
        added = [o for o in bpy.data.objects if o not in before]
        roots = [o for o in added if o.parent is None]
        for r in roots:
            r.location.x += x_pos
            r.rotation_euler = (0.0, 0.0, -0.18 if x_pos < 0 else 0.18)

        for o in added:
            if o.type != 'MESH':
                continue
            if "Hiker_Beanie" in o.name:
                o.hide_render = headwear != "beanie"
            if "Hiker_Beret" in o.name:
                o.hide_render = headwear != "beret"
            for ms in o.material_slots:
                m = ms.material
                if not m or not m.use_nodes:
                    continue
                bsdf = m.node_tree.nodes.get("Principled BSDF")
                if not bsdf:
                    continue
                # Multiply tint via MixRGB if textured, or Base Color directly
                target_hex = None
                if m.name.startswith("Mat_Coat_Beret") or m.name.startswith("Mat_Coat"):
                    target_hex = coat_hex
                elif m.name.startswith("Mat_Hair"):
                    target_hex = hair_hex
                elif m.name.startswith("Mat_Scarf"):
                    target_hex = scarf_hex
                if target_hex:
                    inp = bsdf.inputs["Base Color"]
                    if inp.is_linked:
                        src_sock = inp.links[0].from_socket
                        mix = m.node_tree.nodes.new("ShaderNodeMix")
                        mix.data_type = 'RGBA'
                        mix.blend_type = 'MULTIPLY'
                        mix.inputs[0].default_value = 1.0
                        m.node_tree.links.new(src_sock, mix.inputs[6])
                        mix.inputs[7].default_value = hex_to_rgba(target_hex)
                        m.node_tree.links.new(mix.outputs[2], inp)
                    else:
                        inp.default_value = hex_to_rgba(target_hex)

    # Key + Rim lights
    key_data = bpy.data.lights.new("Key", type='SUN')
    key_data.energy = 3.2
    key_data.color = (1.0, 0.94, 0.86)
    key_obj = bpy.data.objects.new("Key", key_data)
    scn.collection.objects.link(key_obj)
    key_obj.rotation_euler = (math.radians(58), math.radians(-18), math.radians(22))

    fill_data = bpy.data.lights.new("Fill", type='SUN')
    fill_data.energy = 1.3
    fill_data.color = (0.85, 0.90, 1.0)
    fill_obj = bpy.data.objects.new("Fill", fill_data)
    scn.collection.objects.link(fill_obj)
    fill_obj.rotation_euler = (math.radians(72), math.radians(24), math.radians(-28))

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = 48
    cam_obj = bpy.data.objects.new("Cam", cam_data)
    scn.collection.objects.link(cam_obj)
    cam_obj.location = (0.0, -4.35, 1.44)
    cam_obj.rotation_euler = (math.radians(89.0), 0.0, 0.0)
    scn.camera = cam_obj

    preview_path = os.path.join(SCRATCH_DIR, "verify_4_rpm_humans.png")
    scn.render.filepath = preview_path
    bpy.ops.render.render(write_still=True)
    print(f"Rendered close-up verification sheet: {preview_path}")


if __name__ == "__main__":
    build_rpm_hiker(f"{CAND_DIR}/Lyra.glb", "hiker_f_adventurer.glb", matte_coat=True)
    build_rpm_hiker(f"{CAND_DIR}/Celeste.glb", "hiker_f_casual.glb", matte_coat=False)
    build_rpm_hiker(f"{CAND_DIR}/Thanh.glb", "hiker_m_jacket.glb", matte_coat=False)
    build_rpm_hiker(f"{CAND_DIR}/rpm_threejs.glb", "hiker_m_sweater.glb", head_donor_glb=f"{CAND_DIR}/Thanh.glb", matte_coat=False)
    render_verification_sheet()
    print("=== ALL 4 READY PLAYER ME HUMAN HIKERS BUILT & VERIFIED ===")
