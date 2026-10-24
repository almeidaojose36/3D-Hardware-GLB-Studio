// Ford F-150 Platinum SuperCrew, 5.5 ft bed (2024 facelift), Rapid Red metallic, 22" polished wheels.
// Real size about 5885 mm long, 2029 mm wide (without mirrors), 1990 mm tall; wheelbase 3683 mm,
// 275/50R22 tyres (834 mm diameter). Authored in millimetres: +Z front, +X the truck's left (driver) side,
// +Y up, ground at y = 0 (every top-level group is lowered so the model is centred on the origin).
//
// Sub-assemblies (exploded view, in the order a body shop would take it apart):
//   Chassis_Frame   ladder frame, axles, driveshaft, leaf springs, fuel tank, exhaust (stays put)
//   Wheels          four 22" wheels with tyres, rotors and calipers (each slides outward)
//   Front_Clip      hood and front fenders, with Front_Fascia nested (grille, LED headlamps, bumper)
//   Cab_Body        door panels, floor, rear wall, mirrors, handles, steps, with Greenhouse nested
//                   (roof, pillars, windshield and side glass)
//   Interior        two-tone seats, rear bench, console, dash, screen, steering wheel
//   Cargo_Bed       bed sides, floor, front wall, taillamps, with the Platinum Tailgate nested
//   Rear_Bumper     body-colour bumper with step pad, plate recess and hitch receiver
// Badging is kept generic (plain blue oval, PLATINUM trim lettering) rather than copying logo artwork.

const MODEL_INFO = {
  title: 'Ford F-150 Platinum SuperCrew',
  subtitle: 'Full-size pickup: crew cab, 5.5 ft bed, LED lighting, 22" polished wheels & ladder frame',
  summary:
    'The F-150 is a body-on-frame pickup: a steel ladder frame carries the axles and drivetrain, while the cab and the cargo bed are separate bodies bolted on top. The Platinum trim adds chrome and gunmetal detailing, LED lighting and 22-inch wheels.',
  callouts: [
    { pos: [0, (1060 - 995) * 1.6 / 5885, 2975 * 1.6 / 5885], tag: 'Grille & LED Headlamps', desc: 'Gunmetal bar grille feeds cooling air to the radiator; the C-shaped LED signature frames each headlamp.' },
    { pos: [1012 * 1.6 / 5885, (415 - 995) * 1.6 / 5885, 2000 * 1.6 / 5885], tag: '22" Wheel & Disc Brake', desc: 'Polished 22-inch alloy wheel on a 275/50R22 tyre, with a vented brake rotor and caliper behind the spokes.' },
    { pos: [0, (1395 - 995) * 1.6 / 5885, -1900 * 1.6 / 5885], tag: '5.5 ft Cargo Bed', desc: 'A separate steel-and-aluminium box bolted to the frame; it can be lifted off without touching the cab.' },
    { pos: [0, (1100 - 995) * 1.6 / 5885, -2850 * 1.6 / 5885], tag: 'Platinum Tailgate', desc: 'Drops down to load the bed; the dark applique with trim lettering and the C-shaped LED taillamps mark the Platinum trim.' },
    { pos: [1006 * 1.6 / 5885, (520 - 995) * 1.6 / 5885, 400 * 1.6 / 5885], tag: 'Ladder Frame (underneath)', desc: 'Two boxed steel rails joined by crossmembers carry the engine, axles and both bodies: the "body-on-frame" layout of full-size trucks.' }
  ]
};

const S = 1.6 / 5885;
const mm = (v) => v * S;
const GROUND = 995; // half the height: groups are lowered by this so the truck is centred

function buildModel() {
  const mat = createPBRMaterials();

  // ---------------------------------------------------------------- materials
  const paint = new THREE.MeshPhysicalMaterial({ name: 'Rapid_Red_Metallic_Clearcoat', color: srgb(0x5c0710), metalness: 0.45, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.08 });
  const glossBlack = new THREE.MeshPhysicalMaterial({ name: 'Gloss_Black_Trim', color: srgb(0x0e0f11), metalness: 0, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.1 });
  const trimBlack = mat.matteBlackPlastic.clone();
  trimBlack.name = 'Textured_Black_Trim';
  trimBlack.color = srgb(0x1b1c1f);
  trimBlack.roughness = 0.7;
  const liner = trimBlack.clone();
  liner.name = 'Wheel_Arch_Liner';
  liner.side = THREE.DoubleSide;
  const chrome = mat.chromeMetal;
  const gunmetal = new THREE.MeshStandardMaterial({ name: 'Gunmetal_Grille', color: srgb(0x404348), metalness: 1, roughness: 0.38 });
  const satinBar = new THREE.MeshStandardMaterial({ name: 'Satin_Chrome_Bar', color: srgb(0x8b8f94), metalness: 1, roughness: 0.26 });
  const applique = new THREE.MeshStandardMaterial({ name: 'Tailgate_Applique_Dark_Silver', color: srgb(0x5d6066), metalness: 1, roughness: 0.32 });
  const glass = new THREE.MeshStandardMaterial({ name: 'Tinted_Glass', color: srgb(0x0b0e12), metalness: 0, roughness: 0.04, transparent: true, opacity: 0.58 });
  const privacyGlass = glass.clone();
  privacyGlass.name = 'Privacy_Glass';
  privacyGlass.opacity = 0.82;
  const clearLens = new THREE.MeshStandardMaterial({ name: 'Clear_Lamp_Lens', color: srgb(0xffffff), metalness: 0, roughness: 0.03, transparent: true, opacity: 0.16 });
  const lampHousing = new THREE.MeshStandardMaterial({ name: 'Lamp_Housing_Dark_Chrome', color: srgb(0x50545a), metalness: 1, roughness: 0.2 });
  const ledWhite = new THREE.MeshStandardMaterial({ name: 'LED_Signature_White', color: srgb(0xffffff), emissive: srgb(0xeef4ff), emissiveIntensity: 1.1, roughness: 0.3 });
  const redLens = new THREE.MeshPhysicalMaterial({ name: 'Red_Tail_Lens', color: srgb(0x5c0007), metalness: 0, roughness: 0.12, clearcoat: 1, transparent: true, opacity: 0.92 });
  const ledRed = new THREE.MeshStandardMaterial({ name: 'LED_Tail_Red', color: srgb(0xff2a2a), emissive: srgb(0xff1414), emissiveIntensity: 0.9, roughness: 0.3 });
  const blueEnamel = new THREE.MeshPhysicalMaterial({ name: 'Blue_Oval_Enamel', color: srgb(0x0c2c74), metalness: 0, roughness: 0.2, clearcoat: 1 });
  const frameSteel = mat.chassisBlackSteel;
  const wheelPolish = new THREE.MeshStandardMaterial({ name: 'Polished_Aluminium_Wheel', color: srgb(0xa3a7ac), metalness: 1, roughness: 0.22, roughnessMap: chrome.roughnessMap, metalnessMap: chrome.metalnessMap });
  const wheelPocket = new THREE.MeshStandardMaterial({ name: 'Dark_Grey_Wheel_Pocket', color: srgb(0x3a3d42), metalness: 1, roughness: 0.45 });
  const leatherGrey = mat.matteBlackPlastic.clone();
  leatherGrey.name = 'Leather_Slate_Grey';
  leatherGrey.color = srgb(0x3b3d41);
  leatherGrey.roughness = 0.55;
  const leatherTan = leatherGrey.clone();
  leatherTan.name = 'Leather_Tan_Insert';
  leatherTan.color = srgb(0x8b7e6c);
  const carpet = mat.rubberBlack.clone();
  carpet.name = 'Carpet_Charcoal';
  carpet.color = srgb(0x232427);
  const headliner = leatherTan.clone();
  headliner.name = 'Headliner_Light_Stone';
  headliner.color = srgb(0xb3ab9d);
  headliner.roughness = 0.85;
  const screen = new THREE.MeshStandardMaterial({ name: 'Touchscreen', color: srgb(0x0a0f18), emissive: srgb(0x1c3a66), emissiveIntensity: 0.35, roughness: 0.08 });

  // ---------------------------------------------------------------- helpers (all sizes in mm)
  const root = new THREE.Group();
  root.name = 'Ford_F150_Platinum_SuperCrew';
  const explodes = [];
  const topGroup = (name, offset) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.y = -mm(GROUND);
    root.add(g);
    explodes.push([g, offset]);
    return g;
  };
  const nested = (parent, name, offset) => {
    const g = new THREE.Group();
    g.name = name;
    parent.add(g);
    explodes.push([g, offset]);
    return g;
  };
  // Rounded box spanning [x1,x2] x [y1,y2] x [z1,z2]
  const box = (parent, name, material, [x1, x2], [y1, y2], [z1, z2], r = null) => {
    const w = mm(Math.abs(x2 - x1));
    const h = mm(Math.abs(y2 - y1));
    const d = mm(Math.abs(z2 - z1));
    const geo = r === null ? CAD.softBox(w, h, d) : CAD.roundedBoxGeometry(w, h, d, mm(r), 2);
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    m.position.set(mm((x1 + x2) / 2), mm((y1 + y2) / 2), mm((z1 + z2) / 2));
    parent.add(m);
    return m;
  };
  // Same box on both sides of the truck: x range given for the left (+X) side
  const pair = (parent, name, material, [x1, x2], ys, zs, r = null) => {
    box(parent, `${name}_L`, material, [x1, x2], ys, zs, r);
    box(parent, `${name}_R`, material, [-x2, -x1], ys, zs, r);
  };
  // Side-view profile (z, y) extruded across the truck to a total width, centred on x
  const profile = (parent, name, material, shape, width, bevel, x = 0) => {
    const geo = CAD.extrudeBeveled(shape, mm(width - 2 * bevel), mm(bevel), 4, 48).rotateY(-Math.PI / 2);
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    m.position.x = mm(x);
    parent.add(m);
    return m;
  };
  // Flat panel in a side plane (z, y outline) at a given x, thickness t
  const sidePanel = (parent, name, material, pts, x, t, r = 30) => {
    const shape = CAD.roundedPolygon(pts.map(([z, y]) => [mm(z), mm(y)]), mm(r));
    const geo = CAD.extrudeBeveled(shape, mm(t), mm(1), 1, 12).rotateY(-Math.PI / 2);
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    m.position.x = mm(x);
    parent.add(m);
    return m;
  };
  const cylX = (parent, name, material, r, x1, x2, y, z, seg = 24) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(mm(r), mm(r), mm(x2 - x1), seg).rotateZ(Math.PI / 2), material);
    m.name = name;
    m.position.set(mm((x1 + x2) / 2), mm(y), mm(z));
    parent.add(m);
    return m;
  };
  const ellipseShape = (rx, ry) => {
    const s = new THREE.Shape();
    s.absellipse(0, 0, mm(rx), mm(ry), 0, Math.PI * 2, false, 0);
    return s;
  };
  // Blue oval badge facing +Z (generic: chrome ring and blue enamel, no lettering)
  const oval = (parent, name, rx, ry, x, y, z, faceBack = false) => {
    const g = new THREE.Group();
    g.name = name;
    const ring = new THREE.Mesh(CAD.extrudeBeveled(ellipseShape(rx, ry), mm(6), mm(2), 2, 48), chrome);
    ring.name = `${name}_Chrome_Ring`;
    const enamel = new THREE.Mesh(CAD.extrudeBeveled(ellipseShape(rx - 9, ry - 9), mm(6), mm(1.5), 2, 48), blueEnamel);
    enamel.name = `${name}_Enamel`;
    enamel.position.z = mm(3);
    g.add(ring, enamel);
    g.position.set(mm(x), mm(y), mm(z));
    if (faceBack) g.rotation.y = Math.PI;
    parent.add(g);
    return g;
  };

  // ================================================================ CHASSIS FRAME
  const chassis = topGroup('Chassis_Frame', [0, 0, 0]);
  pair(chassis, 'Frame_Rail', frameSteel, [395, 465], [390, 570], [-2760, 2650], 12);
  [2450, 1200, -350, -1300, -2650].forEach((z, i) => box(chassis, `Crossmember_${i + 1}`, frameSteel, [-395, 395], [420, 540], [z - 45, z + 45], 10));
  cylX(chassis, 'Rear_Axle_Housing', mat.castIron, 52, -790, 790, 415, -1683);
  const diff = new THREE.Mesh(new THREE.SphereGeometry(mm(150), 32, 20), mat.castIron);
  diff.name = 'Rear_Differential';
  diff.scale.set(1, 0.85, 1.05);
  diff.position.set(0, mm(415), mm(-1683));
  chassis.add(diff);
  cylX(chassis, 'Front_Half_Shafts', frameSteel, 32, -780, 780, 415, 2000);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(mm(45), mm(45), mm(3300), 20).rotateX(Math.PI / 2), mat.brushedNickel);
  shaft.name = 'Driveshaft';
  shaft.position.set(0, mm(420), mm(-30));
  chassis.add(shaft);
  pair(chassis, 'Rear_Leaf_Spring', frameSteel, [395, 465], [330, 360], [-2350, -1050], 8);
  box(chassis, 'Fuel_Tank', frameSteel, [-880, -480], [440, 650], [-1150, -480], 40);
  const exhaustPath = new THREE.CatmullRomCurve3([[-560, 380, 1500], [-560, 380, -300], [-560, 380, -1100], [-600, 375, -2150], [-820, 360, -2330]].map(([x, y, z]) => new THREE.Vector3(mm(x), mm(y), mm(z))));
  const exhaust = new THREE.Mesh(new THREE.TubeGeometry(exhaustPath, 80, mm(32), 16, false), mat.brushedNickel);
  exhaust.name = 'Exhaust_Pipe';
  chassis.add(exhaust);
  box(chassis, 'Muffler', frameSteel, [-660, -460], [320, 450], [-1050, -400], 60);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(mm(40), mm(40), mm(160), 32, 1, true).rotateZ(Math.PI / 2).rotateY(0.6), chrome);
  tip.name = 'Exhaust_Tip';
  tip.position.set(mm(-880), mm(358), mm(-2370));
  chassis.add(tip);

  // ================================================================ WHEELS
  const wheels = topGroup('Wheels', [0, 0, 0]);
  const tyreGeo = CAD.shared('f150Tyre', () => {
    const pts = [[285, -112], [300, -122], [340, -128], [380, -128], [400, -120], [409, -100], [410, -60], [410, 60], [409, 100], [400, 120], [380, 128], [340, 128], [300, 122], [285, 112]];
    return new THREE.LatheGeometry(pts.map(([r, a]) => new THREE.Vector2(mm(r), mm(a))), 96).rotateX(Math.PI / 2);
  });
  const treadGeo = CAD.shared('f150Tread', () => {
    const block = CAD.softBox(mm(12), mm(34), mm(58));
    const parts = [];
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      [-78, 0, 78].forEach((zc, row) => {
        const shift = row === 1 ? Math.PI / 60 : 0;
        parts.push(block.clone().translate(mm(414), 0, mm(zc)).rotateZ(a + shift));
      });
    }
    return CAD.merge(parts);
  });
  const spokeGeo = CAD.shared('f150Spoke', () => {
    const s = new THREE.Shape();
    s.moveTo(mm(92), mm(-14));
    s.lineTo(mm(266), mm(-21));
    s.lineTo(mm(266), mm(21));
    s.lineTo(mm(92), mm(14));
    s.closePath();
    return CAD.extrudeBeveled(s, mm(24), mm(5), 2, 8);
  });
  const buildWheel = (name, x, z, left) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(mm(x), mm(415), mm(z));
    g.rotation.y = left ? Math.PI / 2 : -Math.PI / 2;
    const spin = new THREE.Group();
    spin.name = `${name}_Rotating`;
    spin.userData.spinZ = true;
    const tyre = new THREE.Mesh(tyreGeo, mat.rubberBlack);
    tyre.name = `${name}_Tyre_275_50R22`;
    const tread = new THREE.Mesh(treadGeo, mat.rubberBlack);
    tread.name = `${name}_Tread_Blocks`;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(mm(272), mm(272), mm(225), 64, 1, true).rotateX(Math.PI / 2), wheelPocket);
    barrel.material = wheelPocket.clone();
    barrel.material.side = THREE.DoubleSide;
    barrel.name = `${name}_Rim_Barrel`;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(mm(279), mm(9), 12, 96), wheelPolish);
    lip.name = `${name}_Rim_Lip`;
    lip.position.z = mm(104);
    const pocket = new THREE.Mesh(new THREE.CylinderGeometry(mm(268), mm(268), mm(10), 64).rotateX(Math.PI / 2), wheelPocket);
    pocket.name = `${name}_Spoke_Pockets`;
    pocket.position.z = mm(40);
    spin.add(tyre, tread, barrel, lip, pocket);
    for (let p = 0; p < 6; p++) {
      [-0.13, 0.13].forEach((d, k) => {
        const spoke = new THREE.Mesh(spokeGeo, wheelPolish);
        spoke.name = `${name}_Spoke_${p * 2 + k + 1}`;
        spoke.rotation.z = (p / 6) * Math.PI * 2 + d;
        spoke.position.z = mm(52);
        spin.add(spoke);
      });
    }
    const hub = new THREE.Mesh(CAD.roundedCylinderGeometry(mm(108), mm(108), mm(40), mm(8), 48).rotateX(Math.PI / 2), wheelPolish);
    hub.name = `${name}_Hub_Face`;
    hub.position.z = mm(66);
    spin.add(hub);
    const lugGeo = CAD.shared('f150Lug', () => CAD.faceted(new THREE.CylinderGeometry(mm(12), mm(13), mm(24), 6).rotateX(Math.PI / 2), 30));
    for (let i = 0; i < 6; i++) {
      const lug = new THREE.Mesh(lugGeo, chrome);
      lug.name = `${name}_Lug_Nut_${i + 1}`;
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      lug.position.set(Math.cos(a) * mm(76), Math.sin(a) * mm(76), mm(90));
      spin.add(lug);
    }
    const cap = new THREE.Mesh(CAD.roundedCylinderGeometry(mm(42), mm(42), mm(14), mm(4), 40).rotateX(Math.PI / 2), mat.anodizedBlack);
    cap.name = `${name}_Centre_Cap`;
    cap.position.z = mm(92);
    spin.add(cap);
    oval(spin, `${name}_Cap_Badge`, 30, 13, 0, 0, 98);
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(mm(190), mm(190), mm(30), 64).rotateX(Math.PI / 2), mat.castIron);
    rotor.name = `${name}_Brake_Rotor`;
    rotor.position.z = mm(-55);
    spin.add(rotor);
    g.add(spin);
    const caliper = box(g, `${name}_Brake_Caliper`, mat.anodizedBlack, [-45, 45], [-80, 80], [-100, -15], 18);
    const ca = left ? (3 * Math.PI) / 4 : Math.PI / 4;
    caliper.position.set(Math.cos(ca) * mm(165), Math.sin(ca) * mm(165), mm(-58));
    caliper.rotation.z = ca;
    wheels.add(g);
    explodes.push([g, [left ? 0.26 : -0.26, 0, 0]]);
  };
  buildWheel('Wheel_Front_Left', 865, 2000, true);
  buildWheel('Wheel_Front_Right', -865, 2000, false);
  buildWheel('Wheel_Rear_Left', 865, -1683, true);
  buildWheel('Wheel_Rear_Right', -865, -1683, false);

  // ================================================================ FRONT CLIP (hood + fenders)
  const front = topGroup('Front_Clip', [0, 0.3, 0.16]);
  {
    const B = 45;
    const R = 540 + B;
    const a = Math.asin((463 + B - 415) / R);
    const s = new THREE.Shape();
    s.moveTo(mm(1400 + B), mm(463 + B));
    s.lineTo(mm(2000 - R * Math.cos(a)), mm(463 + B));
    s.absarc(mm(2000), mm(415), mm(R), Math.PI - a, a, true);
    s.lineTo(mm(2840), mm(463 + B));
    s.quadraticCurveTo(mm(2940 - B), mm(463 + B), mm(2940 - B), mm(620));
    s.lineTo(mm(2940 - B), mm(1330));
    s.quadraticCurveTo(mm(2935 - B), mm(1395 - B), mm(2850), mm(1395 - B));
    s.lineTo(mm(1620), mm(1438 - B));
    s.lineTo(mm(1400 + B), mm(1432 - B));
    s.closePath();
    profile(front, 'Hood_And_Front_Fenders', paint, s, 2010, B);
  }
  [1, -1].forEach((side) => {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(mm(538), mm(538), mm(280), 48, 1, true, -0.25, Math.PI + 0.5).rotateZ(Math.PI / 2), liner);
    l.name = `Front_Wheel_Arch_Liner_${side > 0 ? 'L' : 'R'}`;
    l.position.set(mm(side * 872), mm(415), mm(2000));
    front.add(l);
  });
  // Sculpted wheel-arch flares
  // Inner wheelhouse wall: closes the arch so you cannot see through the truck from the side
  const wheelhouse = (parent, name, x, z) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(mm(540), 48, 0, Math.PI).rotateY(Math.PI / 2), liner);
    m.name = name;
    m.position.set(mm(x), mm(415), mm(z));
    parent.add(m);
  };
  [1, -1].forEach((sd) => wheelhouse(front, `Front_Wheelhouse_Wall_${sd > 0 ? 'L' : 'R'}`, sd * 735, 2000));
  const flare = (parent, name, x, z, r) => {
    const geo = new THREE.TorusGeometry(mm(r), mm(30), 14, 72, Math.PI + 0.36).rotateZ(-0.18).rotateY(Math.PI / 2);
    geo.scale(0.55, 1, 1);
    const m = new THREE.Mesh(geo, paint);
    m.name = name;
    m.position.set(mm(x), mm(415), mm(z));
    parent.add(m);
  };
  flare(front, 'Front_Arch_Flare_L', 1000, 2000, 568);
  flare(front, 'Front_Arch_Flare_R', -1000, 2000, 568);
  pair(front, 'Fender_Character_Line', paint, [1004, 1014], [1120, 1145], [1470, 2860], 8);
  // Hood shut lines and the fender air vent behind each front wheel
  pair(front, 'Hood_Shut_Line', glossBlack, [818, 826], [1392, 1440], [1640, 2780]);
  pair(front, 'Fender_Vent_Surround', chrome, [1004, 1012], [990, 1240], [1468, 1556], 10);
  pair(front, 'Fender_Vent_Slats', gunmetal, [1008, 1016], [1005, 1225], [1480, 1544], 6);
  const antennaRod = new THREE.Mesh(new THREE.CylinderGeometry(mm(3), mm(4), mm(1150), 8), mat.anodizedBlack);
  antennaRod.name = 'Antenna_Mast';
  antennaRod.position.set(mm(-905), mm(1438 + 575), mm(1700));
  antennaRod.rotation.x = -0.06;
  front.add(antennaRod);
  box(front, 'Antenna_Base', trimBlack, [-930, -880], [1425, 1455], [1680, 1720], 8);

  // ---------------------------------------------------------------- FRONT FASCIA (nested)
  const fascia = nested(front, 'Front_Fascia', [0, 0, 0.18]);
  box(fascia, 'Grille_Frame', gunmetal, [-640, 640], [800, 1345], [2930, 2968], 40);
  box(fascia, 'Grille_Backing_Mesh', glossBlack, [-600, 600], [825, 1320], [2940, 2970], 20);
  for (let i = 0; i < 6; i++) {
    const y = 855 + i * 80;
    box(fascia, `Grille_Bar_${i + 1}`, satinBar, [-600, 600], [y, y + 34], [2960, 2990], 12);
  }
  box(fascia, 'Grille_Centre_Bar', gunmetal, [-30, 30], [825, 1320], [2962, 2992], 10);
  oval(fascia, 'Grille_Blue_Oval', 140, 58, 0, 1060, 2992);
  [1, -1].forEach((side) => {
    const L = side > 0 ? 'L' : 'R';
    const x0 = side * 645;
    const x1 = side * 955;
    const xs = [Math.min(x0, x1), Math.max(x0, x1)];
    box(fascia, `Headlamp_Housing_${L}`, lampHousing, xs, [1010, 1345], [2925, 2958], 25);
    [700, 820].forEach((ax, i) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(mm(42), mm(42), mm(20), 32).rotateX(Math.PI / 2), mat.chromeMetal);
      p.name = `Headlamp_Projector_${L}_${i + 1}`;
      p.position.set(mm(side * ax), mm(1185), mm(2962));
      fascia.add(p);
      const lens = new THREE.Mesh(new THREE.SphereGeometry(mm(30), 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), clearLens);
      lens.name = `Headlamp_Projector_Lens_${L}_${i + 1}`;
      lens.position.set(mm(side * ax), mm(1185), mm(2972));
      fascia.add(lens);
    });
    // C-clamp LED signature: outer vertical bar plus top and bottom returns
    box(fascia, `LED_Signature_Vertical_${L}`, ledWhite, side > 0 ? [915, 940] : [-940, -915], [1025, 1330], [2958, 2972], 6);
    box(fascia, `LED_Signature_Top_${L}`, ledWhite, side > 0 ? [670, 940] : [-940, -670], [1312, 1330], [2958, 2972], 6);
    box(fascia, `LED_Signature_Bottom_${L}`, ledWhite, side > 0 ? [760, 940] : [-940, -760], [1025, 1042], [2958, 2972], 6);
    box(fascia, `Headlamp_Outer_Lens_${L}`, clearLens, xs, [1010, 1345], [2972, 2980], 20);
    // Fog lamps in the lower bumper
    box(fascia, `Fog_Lamp_Housing_${L}`, glossBlack, side > 0 ? [690, 860] : [-860, -690], [600, 720], [2945, 2970], 20);
    box(fascia, `Fog_Lamp_LED_${L}`, ledWhite, side > 0 ? [710, 840] : [-840, -710], [640, 660], [2968, 2976], 5);
  });
  box(fascia, 'Lower_Air_Intake', trimBlack, [-640, 640], [580, 770], [2938, 2965], 30);
  box(fascia, 'Lower_Chrome_Skid_Bar', chrome, [-520, 520], [520, 556], [2942, 2978], 14);
  box(fascia, 'Front_Valance', trimBlack, [-950, 950], [430, 520], [2880, 2950], 30);

  // ================================================================ CAB BODY
  const cab = topGroup('Cab_Body', [0, 0.3, 0]);
  {
    const side = CAD.roundedRectShape(mm(2320 - 30), mm(922 - 30), mm(70), mm(240), mm(924));
    profile(cab, 'Door_Panels_L', paint, side, 60, 15, 975);
    profile(cab, 'Door_Panels_R', paint, side, 60, 15, -975);
  }
  box(cab, 'Cab_Floor_Pan', frameSteel, [-945, 945], [560, 600], [-905, 1400], 10);
  box(cab, 'Cab_Rear_Wall_Lower', paint, [-945, 945], [600, 1385], [-925, -902], 8);
  // Door shut lines, handles, steps, mirrors
  [[1440, 520], [230, 480], [-892, 480]].forEach(([z, y0], i) => pair(cab, `Door_Shut_Line_${i + 1}`, glossBlack, [1004, 1009], [y0, 1380], [z - 3, z + 3]));
  pair(cab, 'Door_Bottom_Shut_Line', glossBlack, [1004, 1009], [478, 484], [-892, 1440]);
  [720, -350].forEach((z, i) => pair(cab, `Door_Handle_${i ? 'Rear' : 'Front'}`, chrome, [1005, 1035], [1172, 1218], [z - 125, z + 125], 18));
  pair(cab, 'Door_Character_Line', paint, [1004, 1014], [1120, 1145], [-900, 1435], 8);
  pair(cab, 'Beltline_Chrome_Trim', chrome, [1003, 1013], [1376, 1392], [-880, 1500], 5);
  pair(cab, 'Power_Running_Board', mat.anodizedBlack, [880, 1075], [368, 410], [-870, 1420], 18);
  pair(cab, 'Running_Board_Chrome_Edge', chrome, [1068, 1082], [384, 400], [-860, 1410], 6);
  [1, -1].forEach((s) => {
    const L = s > 0 ? 'L' : 'R';
    box(cab, `Mirror_Arm_${L}`, trimBlack, s > 0 ? [905, 1045] : [-1045, -905], [1430, 1480], [1495, 1560], 15);
    box(cab, `Mirror_Head_Cap_${L}`, paint, s > 0 ? [1020, 1270] : [-1270, -1020], [1470, 1720], [1430, 1570], 45);
    box(cab, `Mirror_Head_Base_${L}`, trimBlack, s > 0 ? [1020, 1270] : [-1270, -1020], [1405, 1475], [1440, 1570], 30);
    box(cab, `Mirror_Glass_${L}`, mat.chromeMetal, s > 0 ? [1030, 1260] : [-1260, -1030], [1415, 1710], [1424, 1432], 25);
    box(cab, `Mirror_Turn_Signal_${L}`, ledWhite, s > 0 ? [1150, 1245] : [-1245, -1150], [1468, 1478], [1500, 1556], 4);
  });

  // ---------------------------------------------------------------- GREENHOUSE (nested)
  const gh = nested(cab, 'Greenhouse', [0, 0.18, 0]);
  box(gh, 'Roof_Panel', paint, [-910, 910], [1880, 1965], [-882, 930], 35);
  [-420, 0, 420].forEach((x, i) => box(gh, `Roof_Rib_${i + 1}`, paint, [x - 30, x + 30], [1962, 1972], [-820, 860], 5));
  box(gh, 'Headliner', headliner, [-880, 880], [1860, 1882], [-860, 900], 10);
  const wsBase = [1620, 1425];
  const wsTop = [930, 1932];
  const wsLen = Math.hypot(wsTop[0] - wsBase[0], wsTop[1] - wsBase[1]);
  const wsAngle = Math.atan2(wsTop[0] - wsBase[0], wsTop[1] - wsBase[1]);
  const onSlope = (name, material, width, x, thick, lift) => {
    const m = new THREE.Mesh(CAD.roundedBoxGeometry(mm(width), mm(wsLen), mm(thick), mm(Math.min(25, thick / 2)), 2), material);
    m.name = name;
    m.rotation.x = wsAngle;
    m.position.set(mm(x), mm((wsBase[1] + wsTop[1]) / 2 - Math.sin(wsAngle) * lift), mm((wsBase[0] + wsTop[0]) / 2 + Math.cos(wsAngle) * lift));
    gh.add(m);
    return m;
  };
  onSlope('Windshield', glass, 1720, 0, 8, 4);
  onSlope('A_Pillar_L', paint, 70, 880, 60, 20);
  onSlope('A_Pillar_R', paint, 70, -880, 60, 20);
  pair(gh, 'B_Pillar_Gloss_Black', glossBlack, [880, 914], [1385, 1885], [160, 262], 8);
  pair(gh, 'Rear_Pillar', paint, [860, 912], [1385, 1900], [-925, -858], 15);
  box(gh, 'Cab_Rear_Wall_Upper', paint, [-912, 912], [1385, 1898], [-925, -902], 12);
  box(gh, 'Rear_Window_Surround', glossBlack, [-735, 735], [1430, 1862], [-929, -924], 30);
  box(gh, 'Rear_Window_Glass', privacyGlass, [-705, 705], [1452, 1842], [-933, -928], 25);
  box(gh, 'Rear_Window_Slider_Divider', glossBlack, [-260, -245], [1452, 1842], [-935, -931]);
  box(gh, 'Rear_Window_Slider_Divider_2', glossBlack, [245, 260], [1452, 1842], [-935, -931]);
  box(gh, 'Third_Brake_Light_Housing', chrome, [-165, 165], [1918, 1956], [-905, -880], 10);
  box(gh, 'Third_Brake_Light_Lens', redLens, [-150, 150], [1924, 1950], [-910, -903], 6);
  [1, -1].forEach((s) => {
    const L = s > 0 ? 'L' : 'R';
    sidePanel(gh, `Front_Door_Glass_${L}`, glass, [[262, 1390], [1555, 1390], [885, 1880], [262, 1880]], s * 912, 5, 35);
    sidePanel(gh, `Rear_Door_Glass_${L}`, privacyGlass, [[-858, 1390], [160, 1390], [160, 1880], [-858, 1880]], s * 912, 5, 45);
    sidePanel(gh, `Window_Frame_Top_${L}`, glossBlack, [[-858, 1878], [885, 1878], [870, 1892], [-858, 1892]], s * 908, 8, 4);
  });

  // ================================================================ INTERIOR
  const interior = topGroup('Interior', [0, 0.12, 0]);
  box(interior, 'Floor_Carpet', carpet, [-940, 940], [600, 625], [-890, 1380], 10);
  pair(interior, 'Door_Trim_Panel', leatherGrey, [905, 945], [650, 1385], [-880, 1390], 20);
  pair(interior, 'Door_Trim_Tan_Insert', leatherTan, [900, 908], [1050, 1250], [-800, 1300], 15);
  const seat = (name, x, z, width) => {
    const g = new THREE.Group();
    g.name = name;
    box(g, `${name}_Cushion`, leatherGrey, [-width / 2, width / 2], [880, 1010], [0, 520], 45);
    box(g, `${name}_Cushion_Insert`, leatherTan, [-width / 2 + 70, width / 2 - 70], [1008, 1020], [40, 470], 20);
    const back = new THREE.Group();
    back.name = `${name}_Backrest`;
    box(back, `${name}_Backrest_Shell`, leatherGrey, [-width / 2, width / 2], [0, 680], [-70, 70], 50);
    box(back, `${name}_Backrest_Insert`, leatherTan, [-width / 2 + 70, width / 2 - 70], [80, 600], [65, 78], 20);
    box(back, `${name}_Headrest`, leatherGrey, [-130, 130], [720, 900], [-55, 55], 40);
    box(back, `${name}_Headrest_Post`, chrome, [-80, 80], [670, 730], [-8, 8], 4);
    back.position.set(0, mm(980), mm(-30));
    back.rotation.x = -0.2;
    g.add(back);
    g.position.set(mm(x), 0, mm(z));
    interior.add(g);
    return g;
  };
  seat('Driver_Seat', 430, 280, 560);
  seat('Passenger_Seat', -430, 280, 560);
  const bench = seat('Rear_Bench', 0, -760, 1520);
  box(bench, 'Rear_Bench_Centre_Armrest', leatherGrey, [-150, 150], [1020, 1080], [-60, 400], 30);
  box(interior, 'Centre_Console', leatherGrey, [-135, 135], [620, 1100], [250, 1180], 40);
  box(interior, 'Console_Gloss_Top', glossBlack, [-125, 125], [1098, 1110], [700, 1170], 15);
  box(interior, 'Dashboard', leatherGrey, [-890, 890], [1100, 1400], [1250, 1640], 60);
  box(interior, 'Dash_Tan_Lower', leatherTan, [-880, 880], [1000, 1120], [1260, 1600], 40);
  box(interior, 'Instrument_Hood', leatherGrey, [190, 650], [1380, 1445], [1250, 1380], 30);
  box(interior, 'Digital_Cluster', screen, [220, 620], [1300, 1390], [1238, 1248], 10);
  box(interior, 'Centre_Touchscreen', screen, [-175, 175], [1205, 1455], [1228, 1240], 12);
  box(interior, 'Touchscreen_Bezel', glossBlack, [-190, 190], [1190, 1470], [1236, 1250], 15);
  [-560, -330, 330, 560].forEach((x, i) => box(interior, `Air_Vent_${i + 1}`, glossBlack, [x - 80, x + 80], [1300, 1360], [1240, 1252], 10));
  const wheel = new THREE.Group();
  wheel.name = 'Steering_Wheel';
  const rim = new THREE.Mesh(new THREE.TorusGeometry(mm(190), mm(20), 16, 64), leatherGrey);
  rim.name = 'Steering_Wheel_Rim';
  const hubSW = new THREE.Mesh(CAD.roundedCylinderGeometry(mm(75), mm(75), mm(50), mm(10), 32).rotateX(Math.PI / 2), leatherGrey);
  hubSW.name = 'Steering_Wheel_Hub';
  wheel.add(rim, hubSW);
  [0, Math.PI / 2 + 0.2, Math.PI / 2 - 0.2 + Math.PI].forEach((a, i) => {
    const sp = box(wheel, `Steering_Wheel_Spoke_${i + 1}`, satinBar, [-14, 14], [0, 170], [-10, 10], 8);
    sp.position.set(0, 0, 0);
    sp.geometry = sp.geometry.clone().translate(0, mm(95), 0);
    sp.rotation.z = a + Math.PI;
  });
  wheel.position.set(mm(420), mm(1270), mm(1140));
  wheel.rotation.x = -0.45;
  interior.add(wheel);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(mm(40), mm(50), mm(300), 20).rotateX(Math.PI / 2 - 0.45), leatherGrey);
  column.name = 'Steering_Column';
  column.position.set(mm(420), mm(1225), mm(1260));
  interior.add(column);

  // ================================================================ CARGO BED
  const bed = topGroup('Cargo_Bed', [0, 0.28, -0.28]);
  {
    const B = 15;
    const R = 540 + B;
    const a = Math.asin((560 + B - 415) / R);
    const s = new THREE.Shape();
    s.moveTo(mm(-2846 + B), mm(560 + B));
    s.lineTo(mm(-1683 - R * Math.cos(a)), mm(560 + B));
    s.absarc(mm(-1683), mm(415), mm(R), Math.PI - a, a, true);
    s.lineTo(mm(-935 - B), mm(560 + B));
    s.lineTo(mm(-935 - B), mm(1395 - B));
    s.lineTo(mm(-2846 + B), mm(1395 - B));
    s.closePath();
    profile(bed, 'Bed_Side_L', paint, s, 70, B, 970);
    profile(bed, 'Bed_Side_R', paint, s, 70, B, -970);
  }
  [1, -1].forEach((sd) => wheelhouse(bed, `Rear_Wheelhouse_Wall_${sd > 0 ? 'L' : 'R'}`, sd * 735, -1683));
  flare(bed, 'Rear_Arch_Flare_L', 1000, -1683, 568);
  flare(bed, 'Rear_Arch_Flare_R', -1000, -1683, 568);
  pair(bed, 'Bed_Character_Line', paint, [1004, 1014], [1120, 1145], [-2800, -945], 8);
  [1, -1].forEach((side) => {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(mm(538), mm(538), mm(280), 48, 1, true, -0.25, Math.PI + 0.5).rotateZ(Math.PI / 2), liner);
    l.name = `Rear_Wheel_Arch_Liner_${side > 0 ? 'L' : 'R'}`;
    l.position.set(mm(side * 872), mm(415), mm(-1683));
    bed.add(l);
    const well = new THREE.Mesh(new THREE.CylinderGeometry(mm(560), mm(560), mm(260), 48, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), paint);
    well.name = `Bed_Wheel_Well_${side > 0 ? 'L' : 'R'}`;
    well.position.set(mm(side * 805), mm(415), mm(-1683));
    well.rotation.y = 0;
    bed.add(well);
  });
  box(bed, 'Bed_Floor', paint, [-935, 935], [828, 851], [-2790, -955], 6);
  for (let i = 0; i < 9; i++) {
    const x = -800 + i * 200;
    box(bed, `Bed_Floor_Rib_${i + 1}`, paint, [x - 22, x + 22], [851, 866], [-2780, -965], 6);
  }
  box(bed, 'Bed_Front_Wall', paint, [-935, 935], [851, 1395], [-965, -935], 8);
  pair(bed, 'Bed_Rail_Cap', trimBlack, [930, 1010], [1395, 1418], [-2830, -945], 8);
  box(bed, 'Bed_Front_Rail_Cap', trimBlack, [-930, 930], [1395, 1418], [-970, -930], 8);
  [-1300, -2400].forEach((z, i) => pair(bed, `Cargo_Tie_Down_${i + 1}`, mat.brushedNickel, [920, 936], [1120, 1170], [z - 30, z + 30], 6));
  [1, -1].forEach((s) => {
    const L = s > 0 ? 'L' : 'R';
    box(bed, `Tail_Lamp_Housing_${L}`, glossBlack, s > 0 ? [880, 1010] : [-1010, -880], [880, 1355], [-2860, -2790], 25);
    box(bed, `Tail_Lamp_Lens_${L}`, redLens, s > 0 ? [888, 1012] : [-1012, -888], [890, 1345], [-2866, -2800], 22);
    // C-shaped LED: top return, outer vertical, inner hook
    box(bed, `Tail_LED_Top_${L}`, ledRed, s > 0 ? [905, 990] : [-990, -905], [1255, 1275], [-2870, -2860], 6);
    box(bed, `Tail_LED_Vertical_${L}`, ledRed, s > 0 ? [905, 925] : [-925, -905], [1060, 1275], [-2870, -2860], 6);
    box(bed, `Tail_LED_Lower_${L}`, ledRed, s > 0 ? [905, 990] : [-990, -905], [1060, 1080], [-2870, -2860], 6);
  });

  // ---------------------------------------------------------------- TAILGATE (nested)
  const gate = nested(bed, 'Tailgate', [0, 0, -0.15]);
  box(gate, 'Tailgate_Panel', paint, [-866, 866], [600, 1390], [-2846, -2790], 25);
  box(gate, 'Tailgate_Top_Cap', trimBlack, [-866, 866], [1386, 1404], [-2846, -2790], 8);
  box(gate, 'Tailgate_Applique', applique, [-830, 830], [950, 1250], [-2851, -2843], 30);
  const letters = ProceduralTextures.artwork('platinumTailgate', 2048, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#c9ccd0';
    ctx.font = '600 120px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const word = 'PLATINUM';
    const step = 210;
    [...word].forEach((ch, i) => ctx.fillText(ch, w / 2 + (i - (word.length - 1) / 2) * step, h / 2));
  });
  const word = CAD.decal(mm(1500), mm(1500 / 8), letters, { name: 'Tailgate_Trim_Lettering', roughness: 0.3, metalness: 1 });
  word.rotation.y = Math.PI;
  word.position.set(0, mm(1110), mm(-2853));
  gate.add(word);
  box(gate, 'Tailgate_Handle_Bezel', trimBlack, [-130, 130], [1320, 1365], [-2850, -2842], 15);
  oval(gate, 'Tailgate_Blue_Oval', 70, 30, -690, 990, -2856, true);

  // ================================================================ REAR BUMPER
  const rear = topGroup('Rear_Bumper', [0, 0, -0.35]);
  box(rear, 'Rear_Bumper_Shell', paint, [-1000, 1000], [330, 600], [-2995, -2846], 45);
  box(rear, 'Rear_Step_Pad', trimBlack, [-460, 460], [596, 606], [-2985, -2860], 10);
  box(rear, 'Licence_Plate_Recess', glossBlack, [-235, 235], [380, 560], [-3000, -2990], 15);
  box(rear, 'Lower_Valance', trimBlack, [-900, 900], [300, 345], [-2980, -2860], 15);
  box(rear, 'Hitch_Receiver', frameSteel, [-38, 38], [290, 366], [-3060, -2900], 6);
  [-780, -500, 500, 780].forEach((x, i) => {
    const sensor = new THREE.Mesh(new THREE.CylinderGeometry(mm(12), mm(12), mm(6), 20).rotateX(Math.PI / 2), paint);
    sensor.name = `Parking_Sensor_${i + 1}`;
    sensor.position.set(mm(x), mm(470), mm(-2997));
    rear.add(sensor);
  });

  explodes.forEach(([g, [x, y, z]]) => setExplodeOffset(g, x, y, z));
  return root;
}
