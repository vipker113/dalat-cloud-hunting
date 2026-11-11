import os
import math
import bpy
import bmesh
from mathutils import Vector, Matrix, Quaternion, Euler

RAW_DIR = "/Users/admin/.gemini/antigravity/brain/b225db1c-7975-469e-88d4-556d97d63d29/scratch/raw_assets"
OUT_DIR = "/Users/admin/blender/dalat_cloud_hunting/apps/web/public/assets/models"
SCRATCH_DIR = "/Users/admin/.gemini/antigravity/brain/b225db1c-7975-469e-88d4-556d97d63d29/scratch"

os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(SCRATCH_DIR, exist_ok=True)

# Exact topological parent-to-child bone mapping from UAL1/UAL2 -> Quaternius CharacterArmature
BONE_MAP = [
    ("pelvis", "Hips"),
    ("spine_01", "Abdomen"),
    ("spine_02", "Torso"),
    ("spine_03", "Chest"),
    ("neck_01", "Neck"),
    ("Head", "Head"),
    ("clavicle_l", "Shoulder.L"),
    ("upperarm_l", "UpperArm.L"),
    ("lowerarm_l", "LowerArm.L"),
    ("hand_l", "Hand.L"),
    ("clavicle_r", "Shoulder.R"),
    ("upperarm_r", "UpperArm.R"),
    ("lowerarm_r", "LowerArm.R"),
    ("hand_r", "Hand.R"),
    ("thigh_l", "UpperLeg.L"),
    ("calf_l", "LowerLeg.L"),
    ("foot_l", "Foot.L"),
    ("thigh_r", "UpperLeg.R"),
    ("calf_r", "LowerLeg.L" if False else "LowerLeg.R"),
    ("foot_r", "Foot.R"),
]

# Also map fingers so hands curl naturally instead of stiff flat palms!
for finger_ual, finger_adv in [
    ("thumb", "Thumb"),
    ("index", "Index"),
    ("middle", "Middle"),
    ("ring", "Ring"),
    ("pinky", "Pinky"),
]:
    for idx in (1, 2, 3):
        BONE_MAP.append((f"{finger_ual}_0{idx}_l", f"{finger_adv}{idx}.L"))
        BONE_MAP.append((f"{finger_ual}_0{idx}_r", f"{finger_adv}{idx}.R"))


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_pbr_mat(name: str, hex_col: str, roughness: float = 0.80, metalness: float = 0.02):
    mat = bpy.data.materials.get(name)
    if not mat:
        mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    r = int(hex_col[1:3], 16) / 255.0
    g = int(hex_col[3:5], 16) / 255.0
    b = int(hex_col[5:7], 16) / 255.0
    rl, gl, bl = pow(r, 2.2), pow(g, 2.2), pow(b, 2.2)
    mat.diffuse_color = (rl, gl, bl, 1.0)
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (rl, gl, bl, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metalness
    return mat


def smooth_weld_and_subdivide(obj, levels: int = 1):
    """Clears flat glTF split normals, welds seams watertight, creases material boundaries, and applies Catmull-Clark Subsurf."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    while len(obj.data.color_attributes) > 0:
        obj.data.color_attributes.remove(obj.data.color_attributes[0])

    if obj.data.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.00018)

    crease_layer = bm.edges.layers.float.get("crease_edge") or bm.edges.layers.float.new("crease_edge")
    for e in bm.edges:
        if len(e.link_faces) == 2:
            if e.link_faces[0].material_index != e.link_faces[1].material_index:
                e[crease_layer] = 0.90
        elif len(e.link_faces) == 1:
            e[crease_layer] = 1.0

    for f in bm.faces:
        f.smooth = True

    bm.to_mesh(obj.data)
    bm.free()

    if levels > 0:
        sub = obj.modifiers.new("SmoothSub", 'SUBSURF')
        sub.levels = levels
        sub.render_levels = levels
        if hasattr(sub, "boundary_smooth"):
            sub.boundary_smooth = 'PRESERVE_CORNERS'
        bpy.ops.object.modifier_move_to_index(modifier=sub.name, index=0)
        bpy.ops.object.modifier_apply(modifier=sub.name)

    for poly in obj.data.polygons:
        poly.use_smooth = True
    obj.data.update()


def clear_pose(arm_obj):
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.location = (0.0, 0.0, 0.0)
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pb.scale = (1.0, 1.0, 1.0)


def extract_clean_backpack_mesh():
    """Extracts the sculpted Quaternius Backpack from modular_men/Adventurer.glb transformed cleanly into (0,0,0) -Y space."""
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=f"{RAW_DIR}/quaternius/modular_men/Adventurer.glb")
    bp = bpy.data.objects.get("Backpack")
    arm = bpy.data.objects.get("CharacterArmature")
    if not bp or not arm:
        return None

    deps = bpy.context.evaluated_depsgraph_get()
    eval_bp = bp.evaluated_get(deps)
    mesh_copy = bpy.data.meshes.new_from_object(eval_bp)

    # In modular_men/Adventurer.glb, character stands at (0, 0.712, -5.265) facing +Y instead of (0,0,0) facing -Y!
    # Let's map world coordinates: shift by (0, -0.712, +5.265), rotate 180 deg around Z, and fit snugly onto Torso/Chest back (+Y in Blender = -Z back in glTF)
    rot_z180 = Matrix.Rotation(math.pi, 4, 'Z')
    shift = Matrix.Translation((0.0, -0.712, 5.265))
    world_mat = bp.matrix_world.copy()

    bm = bmesh.new()
    bm.from_mesh(mesh_copy)
    for v in bm.verts:
        co_w = world_mat @ v.co
        co_n = rot_z180 @ (shift @ co_w)
        # Scale slightly (0.88) and snug against upper back (y ~ +0.08, z ~ 1.28)
        v.co = Vector((co_n.x * 0.88, co_n.y * 0.88 + 0.02, (co_n.z - 1.28) * 0.88 + 1.26))
    bm.to_mesh(mesh_copy)
    bm.free()

    # Standardize backpack materials
    old_names = [m.name if m else "" for m in mesh_copy.materials]
    mesh_copy.materials.clear()
    mat_pack = make_pbr_mat("Mat_Backpack", "#6E6552", 0.86)
    mat_strap = make_pbr_mat("Mat_Boots", "#5C3C28", 0.82)
    mat_gold = make_pbr_mat("Mat_Accent", "#D8A24A", 0.42, 0.35)
    slot_map = []
    mesh_copy.materials.append(mat_pack)
    mesh_copy.materials.append(mat_strap)
    mesh_copy.materials.append(mat_gold)
    for poly in mesh_copy.polygons:
        oname = old_names[poly.material_index] if poly.material_index < len(old_names) else ""
        if "Brown" in oname:
            poly.material_index = 1
        elif "Gold" in oname:
            poly.material_index = 2
        else:
            poly.material_index = 0

    tmp_obj = bpy.data.objects.new("Hiker_Backpack_Template", mesh_copy)
    bpy.context.scene.collection.objects.link(tmp_obj)
    smooth_weld_and_subdivide(tmp_obj, levels=1)

    bp_path = f"{SCRATCH_DIR}/temp_backpack.glb"
    bpy.ops.object.select_all(action='DESELECT')
    tmp_obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=bp_path,
        use_selection=True,
        export_format='GLB',
        export_yup=True,
    )
    return bp_path


def create_cozy_headwear_and_scarf(arm_obj, body_obj):
    """Creates snug, cranium-fitted, smooth Catmull-Clark Da Lat Scarf, Beanie, and Beret."""
    mat_scarf = make_pbr_mat("Mat_Scarf", "#E8D5B7", 0.88)
    mat_coat = bpy.data.materials.get("Mat_Coat") or make_pbr_mat("Mat_Coat", "#C87D55", 0.80)
    mat_cream = make_pbr_mat("Mat_Cream", "#F5ECE0", 0.88)

    head_bone = arm_obj.data.bones["Head"]
    neck_bone = arm_obj.data.bones["Neck"]
    head_w = arm_obj.matrix_world @ head_bone.head_local
    neck_w = arm_obj.matrix_world @ neck_bone.head_local

    # Measure exact cranium center & radii from the character's actual head geometry!
    head_verts = [
        body_obj.matrix_world @ v.co
        for v in body_obj.data.vertices
        if (body_obj.matrix_world @ v.co).z > head_w.z + 0.03
    ]
    if head_verts:
        min_hx, max_hx = min(v.x for v in head_verts), max(v.x for v in head_verts)
        min_hy, max_hy = min(v.y for v in head_verts), max(v.y for v in head_verts)
        top_hz = max(v.z for v in head_verts)
        head_cy = (min_hy + max_hy) * 0.5
        rx = max(0.095, (max_hx - min_hx) * 0.5)
        ry = max(0.100, (max_hy - min_hy) * 0.5)
    else:
        head_cy = head_w.y - 0.015
        top_hz = head_w.z + 0.23
        rx, ry = 0.108, 0.114

    inv_arm = arm_obj.matrix_world.inverted()

    def bind_to_bone(obj, bone_name):
        smooth_weld_and_subdivide(obj, levels=1)
        me = obj.data
        m_to_arm = inv_arm @ obj.matrix_world
        for v in me.vertices:
            v.co = m_to_arm @ v.co
        obj.parent = arm_obj
        obj.matrix_parent_inverse.identity()
        obj.location = (0.0, 0.0, 0.0)
        obj.rotation_euler = (0.0, 0.0, 0.0)
        obj.scale = (1.0, 1.0, 1.0)
        vg = obj.vertex_groups.new(name=bone_name)
        vg.add(list(range(len(me.vertices))), 1.0, 'REPLACE')
        amod = obj.modifiers.new(name="Armature", type='ARMATURE')
        amod.object = arm_obj
        for poly in me.polygons:
            poly.use_smooth = True

    # 1. Snug Collar Scarf wrapping cleanly around base of neck on top of coat collar
    scarf_z = neck_w.z + 0.008
    scarf_y = neck_w.y - 0.024
    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.098,
        minor_radius=0.028,
        major_segments=20,
        minor_segments=12,
        location=(0.0, scarf_y, scarf_z),
        rotation=(-0.18, 0.0, 0.0),
    )
    scarf_loop = bpy.context.active_object
    scarf_loop.scale = (1.06, 1.08, 0.92)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=14,
        ring_count=10,
        radius=0.028,
        location=(0.036, scarf_y - 0.102, scarf_z - 0.048),
    )
    scarf_tail = bpy.context.active_object
    scarf_tail.scale = (0.88, 0.48, 1.85)
    scarf_tail.rotation_euler = (-0.28, 0.08, -0.10)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    bpy.ops.object.select_all(action='DESELECT')
    scarf_loop.select_set(True)
    scarf_tail.select_set(True)
    bpy.context.view_layer.objects.active = scarf_loop
    bpy.ops.object.join()
    scarf_obj = bpy.context.active_object
    scarf_obj.name = "Hiker_Scarf"
    scarf_obj.data.materials.append(mat_scarf)
    bind_to_bone(scarf_obj, "Neck")

    # 2. Snug Cranium-Fitted Wool Beanie + Soft Pom-Pom
    beanie_z = top_hz - 0.062
    beanie_y = head_cy + 0.012
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=18,
        ring_count=10,
        radius=1.0,
        location=(0.0, beanie_y, beanie_z),
    )
    dome = bpy.context.active_object
    bm = bmesh.new()
    bm.from_mesh(dome.data)
    for v in bm.verts:
        if v.co.z < -0.08:
            v.co.z = -0.08
            v.co.x *= 0.94
            v.co.y *= 0.94
    bm.to_mesh(dome.data)
    bm.free()
    dome.scale = (rx * 1.02, ry * 1.01, 0.096)
    dome.rotation_euler = (-0.22, 0.0, 0.0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    dome.data.materials.append(mat_scarf)

    bpy.ops.mesh.primitive_torus_add(
        major_radius=1.0,
        minor_radius=0.16,
        major_segments=18,
        minor_segments=8,
        location=(0.0, beanie_y, beanie_z - 0.008),
    )
    cuff = bpy.context.active_object
    cuff.scale = (rx * 0.99, ry * 0.99, 0.11)
    cuff.rotation_euler = (-0.22, 0.0, 0.0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    cuff.data.materials.append(mat_scarf)

    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=12,
        ring_count=8,
        radius=0.026,
        location=(0.0, beanie_y + 0.022, beanie_z + 0.095),
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
    bind_to_bone(beanie_obj, "Head")

    # 3. Stylish Soft French Wool Beret
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=18,
        ring_count=10,
        radius=1.0,
        location=(0.018, head_cy + 0.008, top_hz - 0.018),
    )
    beret = bpy.context.active_object
    beret.scale = (rx * 1.12, ry * 1.08, 0.042)
    beret.rotation_euler = (-0.14, 0.22, 0.06)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    beret.name = "Hiker_Beret"
    beret.data.materials.append(mat_coat)
    bind_to_bone(beret, "Head")


def standardize_and_smooth_hiker_body(arm_obj, variant_id: str):
    """Unifies Head+Body+Legs+Feet into 1 seamless Catmull-Clark subdivided SkinnedMesh with warm Da Lat materials."""
    mat_coat = make_pbr_mat("Mat_Coat", "#C87D55", 0.78)
    mat_shirt = make_pbr_mat("Mat_Shirt", "#F4ECE0", 0.85)
    mat_pants = make_pbr_mat("Mat_Pants", "#2D3648", 0.84)
    mat_shorts = make_pbr_mat("Mat_Shorts", "#4B3429", 0.84)
    mat_boots = make_pbr_mat("Mat_Boots", "#5C3A27", 0.76)
    mat_skin = make_pbr_mat("Mat_Skin", "#F8CFB6", 0.66)
    mat_hair = make_pbr_mat("Mat_Hair", "#2B1E18", 0.78)
    mat_eye = make_pbr_mat("Mat_Eye", "#181416", 0.25)
    mat_accent = make_pbr_mat("Mat_Accent", "#D8A24A", 0.42, 0.25)

    body_parts = []
    for obj in list(bpy.data.objects):
        if obj.type != 'MESH':
            continue
        if obj.name == "Icosphere":
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        if "backpack" in obj.name.lower():
            continue

        mname = obj.name.lower()
        for slot in obj.material_slots:
            raw = (slot.material.name if slot.material else "").lower()
            if "head" in mname:
                if "skin" in raw:
                    slot.material = mat_skin
                elif "eye" in raw and "eyebrow" not in raw:
                    slot.material = mat_eye
                elif "hair" in raw or "eyebrow" in raw or "moustache" in raw:
                    slot.material = mat_hair
                elif "brown" in raw:
                    slot.material = mat_eye if variant_id.startswith("f_") else mat_hair
                else:
                    slot.material = mat_skin
            elif "feet" in mname:
                if "white" in raw:
                    slot.material = mat_shirt
                else:
                    slot.material = mat_boots
            elif "legs" in mname:
                if "gold" in raw:
                    slot.material = mat_accent
                elif "skin" in raw:
                    # Warm winter wool tights/leggings in 10°C Da Lat morning mist!
                    slot.material = mat_pants
                elif "brown" in raw:
                    slot.material = mat_shorts
                else:
                    slot.material = mat_pants
            elif "body" in mname:
                if "skin" in raw:
                    slot.material = mat_skin
                elif "gold" in raw:
                    slot.material = mat_accent
                elif "white" in raw:
                    slot.material = mat_coat if variant_id == "f_casual" else mat_shirt
                else:
                    # Full jacket / sweater (including Adventurer's LightGreen jacket!) tinted by coatColor!
                    slot.material = mat_coat

        body_parts.append(obj)

    bpy.ops.object.select_all(action='DESELECT')
    for bp in body_parts:
        bp.select_set(True)
    bpy.context.view_layer.objects.active = body_parts[0]
    if len(body_parts) > 1:
        bpy.ops.object.join()

    unified = bpy.context.active_object
    unified.name = "Hiker_Body"
    smooth_weld_and_subdivide(unified, levels=1)
    return unified


def build_hiker_glb(src_glb: str, out_name: str, variant_id: str, bp_path: str):
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=src_glb)
    arm_obj = bpy.data.objects["CharacterArmature"]
    clear_pose(arm_obj)
    unified_body = standardize_and_smooth_hiker_body(arm_obj, variant_id)

    # Check if character already includes a native rigged Backpack mesh
    existing_bp = None
    for o in bpy.data.objects:
        if o.type == 'MESH' and "backpack" in o.name.lower():
            existing_bp = o
            break

    if existing_bp:
        existing_bp.name = "Hiker_Backpack"
        mat_pack = make_pbr_mat("Mat_Backpack", "#6E6552", 0.86)
        mat_strap = bpy.data.materials.get("Mat_Boots") or make_pbr_mat("Mat_Boots", "#5C3C28", 0.82)
        mat_gold = bpy.data.materials.get("Mat_Accent") or make_pbr_mat("Mat_Accent", "#D8A24A", 0.42, 0.35)
        mat_bedroll = make_pbr_mat("Mat_Bedroll", "#2E4C6E", 0.84)
        for slot in existing_bp.material_slots:
            raw = (slot.material.name if slot.material else "").lower()
            if "brown" in raw:
                slot.material = mat_strap
            elif "gold" in raw:
                slot.material = mat_gold
            elif "blue" in raw:
                slot.material = mat_bedroll
            else:
                slot.material = mat_pack
        smooth_weld_and_subdivide(existing_bp, levels=1)
    elif bp_path and os.path.exists(bp_path):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=bp_path)
        added = [o for o in bpy.data.objects if o not in before]
        bp_obj = next((o for o in added if o.type == 'MESH'), None)
        for o in added:
            if o != bp_obj:
                bpy.data.objects.remove(o, do_unlink=True)
        if bp_obj:
            bp_obj.name = "Hiker_Backpack"
            inv_arm = arm_obj.matrix_world.inverted()
            m_to_arm = inv_arm @ bp_obj.matrix_world
            for v in bp_obj.data.vertices:
                v.co = m_to_arm @ v.co
            bp_obj.parent = arm_obj
            bp_obj.matrix_parent_inverse.identity()
            bp_obj.location = (0.0, 0.0, 0.0)
            bp_obj.rotation_euler = (0.0, 0.0, 0.0)
            bp_obj.scale = (1.0, 1.0, 1.0)
            vg = bp_obj.vertex_groups.new(name="Chest")
            vg.add(list(range(len(bp_obj.data.vertices))), 1.0, 'REPLACE')
            amod = bp_obj.modifiers.new(name="Armature", type='ARMATURE')
            amod.object = arm_obj
            for poly in bp_obj.data.polygons:
                poly.use_smooth = True

    # Add cranium-fitted cozy winter scarf, beanie & beret rigged to Neck / Head
    create_cozy_headwear_and_scarf(arm_obj, unified_body)

    out_path = os.path.join(OUT_DIR, out_name)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        export_yup=True,
        export_skins=True,
        export_animations=False,
        export_texcoords=False,
        export_normals=True,
    )
    print(f"Exported Hiker Character: {out_path} ({os.path.getsize(out_path)/1024:.1f} KB)")


def retarget_clip_into_action(src_arm, dst_arm, src_action, out_name: str, in_place_xy: bool = True):
    """Exact world-space T-pose rotation delta + proportional hip height retargeter."""
    src_arm.animation_data_create()
    src_arm.animation_data.action = src_action
    if hasattr(src_action, "slots") and len(src_action.slots) > 0:
        try:
            src_arm.animation_data.action_slot = src_action.slots[0]
        except Exception:
            pass

    f_start = int(round(src_action.frame_range[0]))
    f_end = int(round(src_action.frame_range[1]))

    # Precompute world rest 3x3 orientations & armature-local relative rest 3x3 for mapped bones
    src_rest_w = {}
    dst_rest_w = {}
    dst_rest_rel = {}

    for s_name, d_name in BONE_MAP:
        if s_name not in src_arm.data.bones or d_name not in dst_arm.data.bones:
            continue
        sb = src_arm.data.bones[s_name]
        db = dst_arm.data.bones[d_name]
        src_rest_w[s_name] = (src_arm.matrix_world @ sb.matrix_local).to_3x3().normalized()
        dst_rest_w[d_name] = (dst_arm.matrix_world @ db.matrix_local).to_3x3().normalized()
        if db.parent:
            dst_rest_rel[d_name] = (db.parent.matrix_local.inverted() @ db.matrix_local).to_3x3().normalized()
        else:
            dst_rest_rel[d_name] = db.matrix_local.to_3x3().normalized()

    src_pelvis_rest_w = src_arm.matrix_world @ src_arm.data.bones["pelvis"].head_local
    dst_hips_bone = dst_arm.data.bones["Hips"]
    dst_hips_rest_w = dst_arm.matrix_world @ dst_hips_bone.head_local
    height_ratio = max(0.7, dst_hips_rest_w.z / max(0.2, src_pelvis_rest_w.z))

    dst_arm_inv3 = dst_arm.matrix_world.to_3x3().inverted()
    dst_hips_rest_arm_inv = (dst_arm.matrix_world @ dst_hips_bone.matrix_local).to_3x3().inverted()
    arm_scale = dst_arm.scale.x  # 100.0 on Quaternius CharacterArmature

    new_act = bpy.data.actions.new(name=out_name)
    dst_arm.animation_data_create()
    dst_arm.animation_data.action = new_act
    clear_pose(dst_arm)

    # Sample every frame cleanly
    for f in range(f_start, f_end + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()

        # 1. Hips root bounce / sitting vertical offset
        src_pelvis_pb = src_arm.pose.bones["pelvis"]
        src_pelvis_w = src_arm.matrix_world @ src_pelvis_pb.head
        delta_w = (src_pelvis_w - src_pelvis_rest_w) * height_ratio
        if in_place_xy:
            delta_w.x *= 0.15
            delta_w.y *= 0.15

        # Convert world translation delta into Hips pose_bone.location (which is in Hips bone rest local space divided by arm_scale!)
        hips_pb = dst_arm.pose.bones["Hips"]
        local_disp = (dst_hips_rest_arm_inv @ delta_w) / arm_scale
        hips_pb.location = local_disp
        hips_pb.keyframe_insert(data_path="location", frame=f - f_start)

        # 2. Topological parent-to-child rotation retargeting
        # Track computed armature-space pose 3x3 for EVERY bone in dst_arm so we don't need 20 view_layer.update() calls per frame!
        pose_arm_3x3 = {}
        for b in dst_arm.data.bones:
            pose_arm_3x3[b.name] = b.matrix_local.to_3x3().normalized()

        mapped_dict = {d: s for s, d in BONE_MAP if s in src_rest_w and d in dst_rest_w}

        for db in dst_arm.data.bones:
            d_name = db.name
            parent_3x3 = pose_arm_3x3[db.parent.name] if db.parent else Matrix.Identity(3)
            rel_rest = (db.parent.matrix_local.inverted() @ db.matrix_local).to_3x3().normalized() if db.parent else db.matrix_local.to_3x3().normalized()

            if d_name in mapped_dict:
                s_name = mapped_dict[d_name]
                spb = src_arm.pose.bones[s_name]
                r_src_pose_w = (src_arm.matrix_world @ spb.matrix).to_3x3().normalized()
                delta_rot_w = r_src_pose_w @ src_rest_w[s_name].inverted()
                r_dst_target_w = delta_rot_w @ dst_rest_w[d_name]
                r_dst_arm = (dst_arm_inv3 @ r_dst_target_w).normalized()

                q_local = (rel_rest.inverted() @ parent_3x3.inverted() @ r_dst_arm).to_quaternion().normalized()
                pb = dst_arm.pose.bones[d_name]
                pb.rotation_quaternion = q_local
                pb.keyframe_insert(data_path="rotation_quaternion", frame=f - f_start)
                pose_arm_3x3[d_name] = (parent_3x3 @ rel_rest @ q_local.to_matrix()).normalized()
            else:
                pose_arm_3x3[d_name] = (parent_3x3 @ rel_rest).normalized()

    new_act.use_fake_user = True
    print(f"  Retargeted clip '{out_name}' ({f_end - f_start + 1} frames)")
    return new_act


def build_shared_animations_and_preview():
    reset_scene()
    # Import reference target CharacterArmature (Adventurer Female)
    bpy.ops.import_scene.gltf(filepath=f"{RAW_DIR}/quaternius/modular_women/Adventurer.glb")
    dst_arm = bpy.data.objects["CharacterArmature"]
    for o in list(bpy.data.objects):
        if o.name == "Icosphere":
            bpy.data.objects.remove(o, do_unlink=True)
    standardize_hiker_materials(dst_arm, "f_adventurer")

    # Import UAL1
    before_objs = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f"{RAW_DIR}/quaternius/UAL1_Standard.glb")
    ual1_objs = [o for o in bpy.data.objects if o not in before_objs]
    ual1_arm = [o for o in ual1_objs if o.type == 'ARMATURE'][0]

    # Import UAL2
    before_objs2 = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f"{RAW_DIR}/quaternius/UAL2_Standard.glb")
    ual2_objs = [o for o in bpy.data.objects if o not in before_objs2]
    ual2_arm = [o for o in ual2_objs if o.type == 'ARMATURE'][0]

    def find_action(substr: str):
        for act in bpy.data.actions:
            if act.name == substr or act.name.endswith("|" + substr):
                return act
        for act in bpy.data.actions:
            if substr.lower() in act.name.lower():
                return act
        return None

    clip_specs = [
        (ual1_arm, "Idle_Loop", "Idle"),
        (ual1_arm, "Walk_Loop", "Walk"),
        (ual1_arm, "Jog_Fwd_Loop", "Run"),
        (ual1_arm, "Sprint_Loop", "Sprint"),
        (ual1_arm, "Jump_Loop", "Jump"),
        (ual1_arm, "Sitting_Idle_Loop", "Sit"),
        (ual2_arm, "Idle_Rail_Call", "Wave"),
        (ual2_arm, "Idle_Lantern_Loop", "HoldProp"),
        (ual2_arm, "Idle_FoldArms_Loop", "WarmHands"),
        (ual2_arm, "Consume", "SipDrink"),
        (ual1_arm, "Dance_Loop", "Cheer"),
    ]

    baked_actions = []
    for src_arm, raw_clip_name, out_clip_name in clip_specs:
        act = find_action(raw_clip_name)
        if not act:
            print(f"WARNING: missing source clip {raw_clip_name}")
            continue
        baked = retarget_clip_into_action(src_arm, dst_arm, act, out_clip_name)
        baked_actions.append(baked)

    # Remove UAL1 & UAL2 temporary objects and source actions so ONLY our clean baked clips export!
    for o in ual1_objs + ual2_objs:
        if o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)

    baked_set = set(baked_actions)
    for act in list(bpy.data.actions):
        if act not in baked_set:
            bpy.data.actions.remove(act)

    # Render a quick visual pose-verification sheet of Walk, Run, Sit, Wave BEFORE removing meshes!
    render_character_verification(dst_arm, baked_actions)

    # Push all baked actions onto NLA tracks of dst_arm so glTF exporter writes every single clip cleanly
    dst_arm.animation_data_create()
    dst_arm.animation_data.action = None
    for act in baked_actions:
        track = dst_arm.animation_data.nla_tracks.new()
        track.name = act.name
        strip = track.strips.new(act.name, 0, act)
        strip.name = act.name

    # Delete character meshes from hiker_animations.glb so it is a tiny pure-skeleton animation pack (~65 KB!)
    for o in list(bpy.data.objects):
        if o.type == 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)

    anim_out = os.path.join(OUT_DIR, "hiker_animations.glb")
    bpy.ops.export_scene.gltf(
        filepath=anim_out,
        export_format='GLB',
        export_yup=True,
        export_animations=True,
        export_animation_mode='NLA_TRACKS',
        export_nla_strips_merged_animation_name='Animation',
        export_optimize_animation_size=True,
        export_skins=False,
    )
    print(f"Exported Shared Animations: {anim_out} ({os.path.getsize(anim_out)/1024:.1f} KB)")


def render_character_verification(dst_arm, baked_actions):
    """Renders Adventurer_F in Walk pose to verify limb directions, knees, elbows & materials."""
    walk_act = next((a for a in baked_actions if a.name == "Walk"), baked_actions[0])
    dst_arm.animation_data.action = walk_act
    bpy.context.scene.frame_set(6)
    bpy.context.view_layer.update()

    cam_data = bpy.data.cameras.new("VerifyCam")
    cam_data.lens = 45
    cam_obj = bpy.data.objects.new("VerifyCam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    cam_obj.location = (1.6, -2.6, 1.25)
    direction = Vector((0.0, 0.0, 0.95)) - cam_obj.location
    cam_obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam_obj

    sun_data = bpy.data.lights.new("VerifySun", type='SUN')
    sun_data.energy = 3.5
    sun_obj = bpy.data.objects.new("VerifySun", sun_data)
    bpy.context.scene.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (0.8, 0.2, -0.5)

    bpy.context.scene.render.engine = 'BLENDER_WORKBENCH'
    bpy.context.scene.display.shading.light = 'STUDIO'
    bpy.context.scene.display.shading.color_type = 'MATERIAL'
    bpy.context.scene.render.resolution_x = 640
    bpy.context.scene.render.resolution_y = 640
    bpy.context.scene.render.filepath = f"{SCRATCH_DIR}/verify_hiker_walk.png"
    bpy.ops.render.render(write_still=True)
    print(f"Rendered pose verification: {SCRATCH_DIR}/verify_hiker_walk.png")


def build_polyhaven_bench_only():
    """Exports Poly Haven painted_wooden_bench at true ergonomic park-bench height (seat=0.45m, backrest=0.84m, width=1.70m)."""
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=f"{RAW_DIR}/polyhaven/painted_wooden_bench/painted_wooden_bench.gltf")
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if meshes:
        bpy.ops.object.select_all(action='DESELECT')
        for m in meshes:
            m.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        if len(meshes) > 1:
            bpy.ops.object.join()
        bench = bpy.context.active_object
        bench.name = "PH_WoodenBench"
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        xs = [v.co.x for v in bench.data.vertices]
        ys = [v.co.y for v in bench.data.vertices]
        zs = [v.co.z for v in bench.data.vertices]
        span_x = max(xs) - min(xs)
        span_y = max(ys) - min(ys)
        scale_x = 1.70 / max(0.1, span_x)
        scale_y = 0.54 / max(0.1, span_y)
        cx = (min(xs) + max(xs)) * 0.5
        cy = (min(ys) + max(ys)) * 0.5
        min_z = min(zs)
        for v in bench.data.vertices:
            rz = v.co.z - min_z
            # Raw seat top is at rz = 0.650m; map seat top to ergonomic 0.450m while keeping upper backrest comfortable at 0.84m!
            if rz <= 0.652:
                nz = rz * (0.450 / 0.650)
            else:
                nz = 0.450 + (rz - 0.652) * 1.62
            v.co.x = (v.co.x - cx) * scale_x
            v.co.y = (v.co.y - cy) * scale_y
            v.co.z = nz
        for poly in bench.data.polygons:
            poly.use_smooth = True
        bench.data.update()
        for img in bpy.data.images:
            if img.size[0] > 512:
                img.scale(512, 512)
        out_bench = os.path.join(OUT_DIR, "ph_wooden_bench.glb")
        bpy.ops.export_scene.gltf(filepath=out_bench, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=84)
        print(f"Exported Ergonomic Poly Haven Bench: {out_bench} ({os.path.getsize(out_bench)/1024:.1f} KB)")


def build_polyhaven_and_nature_assets():
    """Packs & optimizes real Poly Haven CC0 + Quaternius CC0 nature models for WebGL instancing."""
    build_polyhaven_bench_only()

    # 2. Poly Haven: stone_fire_pit -> campfire_stage.glb (replaces primitive torus campfire!)
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=f"{RAW_DIR}/polyhaven/stone_fire_pit/stone_fire_pit.gltf")
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if meshes:
        bpy.ops.object.select_all(action='DESELECT')
        for m in meshes:
            m.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        if len(meshes) > 1:
            bpy.ops.object.join()
        pit = bpy.context.active_object
        pit.name = "PH_StoneFirePit"
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        dec = pit.modifiers.new("Dec", 'DECIMATE')
        dec.ratio = 0.36
        bpy.ops.object.modifier_apply(modifier=dec.name)
        xs = [v.co.x for v in pit.data.vertices]
        ys = [v.co.y for v in pit.data.vertices]
        zs = [v.co.z for v in pit.data.vertices]
        span_x = max(xs) - min(xs)
        scale_f = 2.25 / max(0.1, span_x)
        cx, cy, min_z = (min(xs)+max(xs))*0.5, (min(ys)+max(ys))*0.5, min(zs)
        for v in pit.data.vertices:
            v.co = Vector(((v.co.x - cx)*scale_f, (v.co.y - cy)*scale_f, (v.co.z - min_z)*scale_f))
        for img in bpy.data.images:
            if img.size[0] > 512:
                img.scale(512, 512)
        out_pit = os.path.join(OUT_DIR, "campfire_stage.glb")
        bpy.ops.export_scene.gltf(filepath=out_pit, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=82)
        print(f"Exported Poly Haven Stone Fire Pit: {out_pit} ({os.path.getsize(out_pit)/1024:.1f} KB)")

    # 3. Poly Haven Botanical Undergrowth: fern_02 + shrub_sorrel_01 -> ph_botanicals.glb
    reset_scene()
    for ph_id, target_name, target_h, dec_ratio in [
        ("fern_02", "PH_Fern", 0.95, 0.14),
        ("shrub_sorrel_01", "PH_Shrub", 0.85, 0.22),
    ]:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=f"{RAW_DIR}/polyhaven/{ph_id}/{ph_id}.gltf")
        added = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
        if added:
            bpy.ops.object.select_all(action='DESELECT')
            for a in added:
                a.select_set(True)
            bpy.context.view_layer.objects.active = added[0]
            if len(added) > 1:
                bpy.ops.object.join()
            bot = bpy.context.active_object
            bot.name = target_name
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            dec = bot.modifiers.new("Dec", 'DECIMATE')
            dec.ratio = dec_ratio
            bpy.ops.object.modifier_apply(modifier=dec.name)
            zs = [v.co.z for v in bot.data.vertices]
            sc = target_h / max(0.05, max(zs) - min(zs))
            min_z = min(zs)
            for v in bot.data.vertices:
                v.co = Vector((v.co.x * sc, v.co.y * sc, (v.co.z - min_z) * sc))
    for img in bpy.data.images:
        if img.size[0] > 512:
            img.scale(512, 512)
    out_bot = os.path.join(OUT_DIR, "ph_botanicals.glb")
    bpy.ops.export_scene.gltf(filepath=out_bot, export_format='GLB')
    print(f"Exported Poly Haven Botanicals: {out_bot} ({os.path.getsize(out_bot)/1024:.1f} KB)")

    # 4. Quaternius Highland Pine Trees (PineTree_1 & PineTree_3) -> highland_pines.glb + lonely_pine_hero.glb
    reset_scene()
    for idx, (pfile, prefix, target_h, dec_canopy) in enumerate([
        ("PineTree_1.glb", "PineA", 11.2, 0.36),
        ("PineTree_3.glb", "PineB", 12.6, 0.32),
    ]):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=f"{RAW_DIR}/quaternius/nature_pack/{pfile}")
        added = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
        if added:
            src_obj = added[0]
            bpy.context.view_layer.objects.active = src_obj
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            zs = [v.co.z for v in src_obj.data.vertices]
            sc = target_h / max(0.2, max(zs) - min(zs))
            min_z = min(zs)
            for v in src_obj.data.vertices:
                v.co = Vector((v.co.x * sc, v.co.y * sc, (v.co.z - min_z) * sc))

            # Separate by material into Trunk vs Canopy so wind shader bends canopy strongly while trunk stays grounded!
            bpy.ops.object.select_all(action='DESELECT')
            src_obj.select_set(True)
            bpy.context.view_layer.objects.active = src_obj
            bpy.ops.mesh.separate(type='MATERIAL')
            parts = [o for o in bpy.context.selected_objects if o.type == 'MESH']
            for pt in parts:
                mname = (pt.data.materials[0].name if pt.data.materials else "").lower()
                if "wood" in mname or "brown" in mname:
                    pt.name = f"{prefix}_Trunk"
                else:
                    pt.name = f"{prefix}_Canopy"
                    dec = pt.modifiers.new("Dec", 'DECIMATE')
                    dec.ratio = dec_canopy
                    bpy.context.view_layer.objects.active = pt
                    bpy.ops.object.modifier_apply(modifier=dec.name)

    out_pines = os.path.join(OUT_DIR, "highland_pines.glb")
    bpy.ops.export_scene.gltf(filepath=out_pines, export_format='GLB')
    print(f"Exported Highland Pines: {out_pines} ({os.path.getsize(out_pines)/1024:.1f} KB)")

    # Hero Lonely Pine (Cây Thông Cô Đơn Thiên Phúc Đức) from full-resolution PineTree_3 with wind-swept lean!
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=f"{RAW_DIR}/quaternius/nature_pack/PineTree_3.glb")
    l_meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if l_meshes:
        lp = l_meshes[0]
        bpy.context.view_layer.objects.active = lp
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        zs = [v.co.z for v in lp.data.vertices]
        max_z, min_z = max(zs), min(zs)
        sc = 15.2 / max(0.2, max_z - min_z)
        for v in lp.data.vertices:
            nz = (v.co.z - min_z) / max(0.2, max_z - min_z)
            # Graceful wind-swept Da Lat solitary pine lean!
            lean_x = (nz * nz) * 1.45
            v.co = Vector((v.co.x * sc * 1.24 + lean_x, v.co.y * sc * 1.24, (v.co.z - min_z) * sc))
        for m in lp.data.materials:
            if m and ("green" in m.name.lower()):
                bsdf = m.node_tree.nodes.get("Principled BSDF")
                if bsdf:
                    bsdf.inputs["Base Color"].default_value = (0.065, 0.185, 0.088, 1.0)
                    bsdf.inputs["Roughness"].default_value = 0.82
        out_lp = os.path.join(OUT_DIR, "lonely_pine_hero.glb")
        bpy.ops.export_scene.gltf(filepath=out_lp, export_format='GLB')
        print(f"Exported Lonely Pine Hero: {out_lp} ({os.path.getsize(out_lp)/1024:.1f} KB)")

    # 5. Quaternius Mossy Rocks, Fallen Mushroom Logs & Cumulus 3D Cloud Meshes -> highland_rocks_and_clouds.glb
    reset_scene()
    for rel_path, obj_name in [
        ("nature_pack/Rock_Moss_1.glb", "MossRockA"),
        ("nature_pack/WoodLog_Moss.glb", "MossLog"),
        ("platformer_pack/Cloud1.glb", "CumulusClusterA"),
        ("platformer_pack/Cloud2.glb", "CumulusClusterB"),
        ("platformer_game_pack/Cloud_1.glb", "CumulusClusterC"),
    ]:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=f"{RAW_DIR}/quaternius/{rel_path}")
        added = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
        if added:
            bpy.ops.object.select_all(action='DESELECT')
            for a in added:
                a.select_set(True)
            bpy.context.view_layer.objects.active = added[0]
            if len(added) > 1:
                bpy.ops.object.join()
            obj = bpy.context.active_object
            obj.name = obj_name
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            for poly in obj.data.polygons:
                poly.use_smooth = True

    out_rc = os.path.join(OUT_DIR, "highland_rocks_and_clouds.glb")
    bpy.ops.export_scene.gltf(filepath=out_rc, export_format='GLB')
    print(f"Exported Rocks & 3D Cumulus Clouds: {out_rc} ({os.path.getsize(out_rc)/1024:.1f} KB)")


if __name__ == "__main__":
    import sys
    only_hikers = "--only-hikers" in sys.argv
    only_hikers_and_bench = "--only-hikers-and-bench" in sys.argv
    print("=== BUILDING REAL CC0 DA LAT CHARACTERS, ANIMATIONS & POLY HAVEN ASSETS ===")
    bp_template = extract_clean_backpack_mesh()
    build_hiker_glb(f"{RAW_DIR}/quaternius/modular_women/Adventurer.glb", "hiker_f_adventurer.glb", "f_adventurer", bp_template)
    build_hiker_glb(f"{RAW_DIR}/quaternius/modular_women/Casual.glb", "hiker_f_casual.glb", "f_casual", bp_template)
    build_hiker_glb(f"{RAW_DIR}/quaternius/modular_men/Casual2.glb", "hiker_m_jacket.glb", "m_jacket", bp_template)
    build_hiker_glb(f"{RAW_DIR}/quaternius/modular_men/Casual.glb", "hiker_m_sweater.glb", "m_sweater", bp_template)
    if only_hikers_and_bench:
        build_polyhaven_bench_only()
    elif not only_hikers:
        build_shared_animations_and_preview()
        build_polyhaven_and_nature_assets()
    print("=== ALL BLENDER ASSETS EXPORTED SUCCESSFULLY ===")
