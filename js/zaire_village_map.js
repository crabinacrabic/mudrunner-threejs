/**
 * Zaire 1988: Mutshatsha Village & RN39 Laterite Corridor
 * High-authenticity 1980s East Africa off-road level.
 * Features:
 *  - 500x500m authentic terrain with high-res satellite ortho-photo
 *  - 3D spline roads with realistic PBR laterite clay, dirt, gravel, and sand
 *  - African village props: round thatched huts, clay houses, umbrella acacias, mango trees, termite mounds, Total barrels
 *  - Real soil physics & tyre mud ruts on red laterite
 */

window.ZaireVillageMap = (function() {
  let zaireGroup = null;
  let terrainMesh = null;
  let roadsGroup = null;
  let propsGroup = null;
  let zaireRoadsData = null;
  let zaireLoaded = false;
  let zaireLoading = false;
  let activeRoadSplines = [];

  // Контрольные ворота (Checkpoints) экспедиции в Мутшатше
  const checkpoints = [
    { title: "КП 1: Северный въезд (Дорога RN39)", x: 81.2, z: -105.75, radius: 9, isFinish: false, rot: 0.05 },
    { title: "КП 2: Развилка у хижин Луо", x: 35.1, z: -35.5, radius: 9, isFinish: false, rot: -0.65 },
    { title: "КП 3: Центр деревни Мутшатша", x: 35.8, z: -3.8, radius: 9, isFinish: false, rot: 0.05 },
    { title: "КП 4: Подъезд к станции Бенгела", x: 118.1, z: 82.2, radius: 9, isFinish: false, rot: 0.65 },
    { title: "КП 5: Брод через ручей (Песчаная отмель)", x: -19.9, z: 55.4, radius: 8, isFinish: false, rot: -0.70 },
    { title: "КП 6: Южный выезд на Колвези (Финиш)", x: 150.0, z: 150.0, radius: 10, isFinish: true, rot: 0.78 }
  ];

  // Высота рельефа саванны в точке (x, z)
  function getGroundHeight(x, z) {
    // Естественный пологий рельеф саванны Катанги (плато Шаба) с ложбиной ручья
    let h = Math.sin(x * 0.012) * Math.cos(z * 0.010) * 1.8;
    h += Math.sin(x * 0.035 + 1.2) * 0.45;

    // Ложбина ручья в районе брода (z от 10 до 120, x от -60 до 35)
    const fordDist = Math.hypot(x - (-10), z - 65);
    if (fordDist < 75) {
      const dip = Math.cos((fordDist / 75) * Math.PI * 0.5) * 1.6;
      h -= dip;
    }
    return h;
  }

  // Определение типа грунта под колесом
  function getSoilZoneAt(x, z) {
    if (!activeRoadSplines || !activeRoadSplines.length) return null;

    let closestRoad = null;
    let minD = Infinity;

    for (let r of activeRoadSplines) {
      const d = r.getDistTo(x, z);
      if (d < r.halfWidth + 2.5 && d < minD) {
        minD = d;
        closestRoad = r;
      }
    }

    if (closestRoad) {
      return {
        x: x,
        z: z,
        type: closestRoad.surfaceType,
        radius: closestRoad.halfWidth + 2.0,
        strength: 0.95,
        roadName: closestRoad.name
      };
    }

    // Вне дорог — плотная сухая саванна
    return {
      x: x,
      z: z,
      type: 'dirt',
      radius: 10.0,
      strength: 0.60,
      roadName: 'Саванна'
    };
  }

  // Генерация бесшовной процедурной текстуры покрытия дороги
  function createRoadTexture(surfaceType) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    if (surfaceType === 'clay') {
      // 1. Красный латерит Заира (RN39)
      ctx.fillStyle = '#8f3b1e';
      ctx.fillRect(0, 0, 512, 512);

      // Шум латеритной глины и мелкого щебня
      const imgData = ctx.getImageData(0, 0, 512, 512);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 45;
        data[i] = Math.min(255, Math.max(0, data[i] + noise + 15));
        data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise * 0.6));
        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise * 0.4));
      }
      ctx.putImageData(imgData, 0, 0);

      // Глубокие влажные выдавленные колеи колёс (левая и правая)
      ctx.fillStyle = 'rgba(65, 22, 10, 0.65)';
      ctx.fillRect(95, 0, 75, 512);
      ctx.fillRect(340, 0, 75, 512);

      // Влажный блеск и стоячая жижа на дне колеи
      ctx.fillStyle = 'rgba(45, 14, 6, 0.55)';
      ctx.fillRect(115, 0, 40, 512);
      ctx.fillRect(360, 0, 40, 512);

      // Неровная глинисто-травяная обочина
      ctx.fillStyle = 'rgba(110, 75, 30, 0.45)';
      ctx.fillRect(0, 0, 30, 512);
      ctx.fillRect(482, 0, 30, 512);

    } else if (surfaceType === 'gravel') {
      // 2. Станционный гравий и щебень
      ctx.fillStyle = '#78716c';
      ctx.fillRect(0, 0, 512, 512);

      const imgData = ctx.getImageData(0, 0, 512, 512);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 60;
        data[i] = Math.min(255, Math.max(0, data[i] + noise));
        data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
      }
      ctx.putImageData(imgData, 0, 0);

      // Следы грузовиков на гравии
      ctx.fillStyle = 'rgba(60, 55, 50, 0.35)';
      ctx.fillRect(100, 0, 70, 512);
      ctx.fillRect(340, 0, 70, 512);

    } else if (surfaceType === 'sand') {
      // 3. Песчаный брод через ручей
      ctx.fillStyle = '#cba16a';
      ctx.fillRect(0, 0, 512, 512);

      const imgData = ctx.getImageData(0, 0, 512, 512);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 30;
        data[i] = Math.min(255, Math.max(0, data[i] + noise));
        data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise * 0.8));
        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise * 0.6));
      }
      ctx.putImageData(imgData, 0, 0);

      // Песчаные волны / наносные рифли
      ctx.fillStyle = 'rgba(140, 105, 55, 0.35)';
      for (let y = 0; y < 512; y += 32) {
        ctx.fillRect(0, y, 512, 8);
      }

    } else {
      // 4. Деревенская тропа / сухая грунтовка (dirt)
      ctx.fillStyle = '#9a7b56';
      ctx.fillRect(0, 0, 512, 512);

      const imgData = ctx.getImageData(0, 0, 512, 512);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 35;
        data[i] = Math.min(255, Math.max(0, data[i] + noise));
        data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise * 0.8));
        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise * 0.6));
      }
      ctx.putImageData(imgData, 0, 0);

      // Узкая протоптанная дорожка велосипедов и пешеходов в центре
      ctx.fillStyle = 'rgba(80, 55, 30, 0.40)';
      ctx.fillRect(190, 0, 130, 512);
      ctx.fillStyle = 'rgba(60, 40, 20, 0.35)';
      ctx.fillRect(235, 0, 40, 512);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 1);
    tex.anisotropy = 4;
    return tex;
  }

  // Построение 3D-полосы дороги по сплайну CatmullRom
  function buildRoadSplineMesh(points, width, surfaceType) {
    if (!points || points.length < 2) return null;

    const curvePoints = points.map(p => new THREE.Vector3(p.x, getGroundHeight(p.x, p.z) + 0.12, p.z));
    const curve = new THREE.CatmullRomCurve3(curvePoints, false, 'centripetal', 0.5);

    const length = curve.getLength();
    const numSteps = Math.max(20, Math.floor(length / 2.5));
    const halfW = width * 0.5;

    const positions = [];
    const uvs = [];
    const normals = [];
    const indices = [];

    // Поперечный профиль с плавными сходами в грунт
    const profile = [
      { offset: -halfW - 0.75, h: -0.15, u: 0.0 },
      { offset: -halfW,        h: 0.02,  u: 0.08 },
      { offset: -halfW * 0.45, h: 0.08,  u: 0.30 },
      { offset: 0.0,           h: 0.10,  u: 0.50 },
      { offset: halfW * 0.45,  h: 0.08,  u: 0.70 },
      { offset: halfW,         h: 0.02,  u: 0.92 },
      { offset: halfW + 0.75,  h: -0.15, u: 1.0 }
    ];

    for (let i = 0; i <= numSteps; i++) {
      const t = i / numSteps;
      const pt = curve.getPoint(t);
      const tangent = curve.getTangent(t).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const binormal = new THREE.Vector3().crossVectors(tangent, up).normalize();
      const realNormal = new THREE.Vector3().crossVectors(binormal, tangent).normalize();

      const v = (t * length) / 6.0;

      for (let j = 0; j < profile.length; j++) {
        const pr = profile[j];
        const vert = pt.clone()
          .addScaledVector(binormal, pr.offset)
          .addScaledVector(realNormal, pr.h);

        positions.push(vert.x, vert.y, vert.z);
        normals.push(realNormal.x, realNormal.y, realNormal.z);
        uvs.push(pr.u, v);
      }

      if (i < numSteps) {
        const row1 = i * profile.length;
        const row2 = (i + 1) * profile.length;
        for (let j = 0; j < profile.length - 1; j++) {
          indices.push(row1 + j, row1 + j + 1, row2 + j);
          indices.push(row1 + j + 1, row2 + j + 1, row2 + j);
        }
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    const tex = createRoadTexture(surfaceType);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: surfaceType === 'clay' ? 0.75 : 0.90,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -1.0,
      polygonOffsetUnits: -1.0
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;

    // Вспомогательная функция расчёта расстояния до сплайна
    const samplePts = [];
    for (let s = 0; s <= 40; s++) samplePts.push(curve.getPoint(s / 40));

    mesh.getDistTo = function(x, z) {
      let minD = Infinity;
      for (let p of samplePts) {
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < minD) minD = d;
      }
      return minD;
    };
    mesh.halfWidth = halfW;
    mesh.surfaceType = surfaceType;

    return mesh;
  }

  // --- 3D ПРОПСЫ АФРИКАНСКОЙ ДЕРЕВНИ ---

  // 1. Круглая хижина банту (саманная глина + соломенная коническая крыша)
  function createRoundHutMesh() {
    const group = new THREE.Group();

    // Саманное глиняное основание
    const wallGeom = new THREE.CylinderGeometry(2.4, 2.6, 2.2, 16);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x9a4a2b, // красно-коричневая глина
      roughness: 0.95,
      metalness: 0.02
    });
    const walls = new THREE.Mesh(wallGeom, wallMat);
    walls.position.y = 1.1;
    walls.castShadow = true;
    walls.receiveShadow = true;
    group.add(walls);

    // Коническая соломенная крыша (thatch roof)
    const roofGeom = new THREE.ConeGeometry(3.4, 2.4, 16);
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0xb58038, // золотисто-сухая солома
      roughness: 0.98,
      metalness: 0.0
    });
    const roof = new THREE.Mesh(roofGeom, roofMat);
    roof.position.y = 3.2;
    roof.castShadow = true;
    roof.receiveShadow = true;
    group.add(roof);

    // Дверной проём из темного дерева
    const doorGeom = new THREE.BoxGeometry(0.75, 1.4, 0.2);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x2e180d, roughness: 0.9 });
    const door = new THREE.Mesh(doorGeom, doorMat);
    door.position.set(0, 0.7, 2.45);
    group.add(door);

    return group;
  }

  // 2. Прямоугольный глинобитный дом с двухскатной крышей
  function createClayHouseMesh() {
    const group = new THREE.Group();

    // Глинобитные стены
    const bodyGeom = new THREE.BoxGeometry(4.2, 2.3, 3.4);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8b4526, roughness: 0.95 });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 1.15;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Крыша из профнастила / сухих пальмовых веток
    const roofGeom = new THREE.ConeGeometry(3.6, 1.5, 4);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x5a524c, roughness: 0.85 });
    const roof = new THREE.Mesh(roofGeom, roofMat);
    roof.position.y = 2.85;
    roof.rotation.y = Math.PI * 0.25;
    roof.scale.set(1.1, 1.0, 0.9);
    roof.castShadow = true;
    group.add(roof);

    return group;
  }

  // 3. Зонтичная африканская акация (Acacia tortilis)
  function createAcaciaTreeMesh() {
    const group = new THREE.Group();

    // Изогнутый шершавый ствол акации
    const trunkGeom = new THREE.CylinderGeometry(0.25, 0.45, 4.2, 7);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3d2716, roughness: 0.95 });
    const trunk = new THREE.Mesh(trunkGeom, trunkMat);
    trunk.position.y = 2.1;
    trunk.rotation.z = (Math.random() - 0.5) * 0.15;
    trunk.castShadow = true;
    group.add(trunk);

    // Плоская ярусная зонтичная крона
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0x4a6326, // приглушённо-оливковая зелень саванны
      roughness: 0.9,
      metalness: 0.0
    });

    const layers = [
      { y: 4.1, r: 3.5, h: 0.55 },
      { y: 4.7, r: 2.8, h: 0.45 },
      { y: 5.2, r: 1.7, h: 0.35 }
    ];

    layers.forEach(l => {
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(l.r, l.r * 1.15, l.h, 9), leafMat);
      crown.position.y = l.y;
      crown.castShadow = true;
      group.add(crown);
    });

    return group;
  }

  // 4. Манговое дерево с густой тёмно-зелёной кроной
  function createMangoTreeMesh() {
    const group = new THREE.Group();

    const trunkGeom = new THREE.CylinderGeometry(0.35, 0.55, 3.2, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x332014, roughness: 0.95 });
    const trunk = new THREE.Mesh(trunkGeom, trunkMat);
    trunk.position.y = 1.6;
    trunk.castShadow = true;
    group.add(trunk);

    const foliageGeom = new THREE.DodecahedronGeometry(2.8, 1);
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x1f4720, roughness: 0.9 });
    const foliage = new THREE.Mesh(foliageGeom, foliageMat);
    foliage.position.y = 4.2;
    foliage.scale.set(1.2, 0.95, 1.2);
    foliage.castShadow = true;
    group.add(foliage);

    return group;
  }

  // 5. Красный термитник саванны
  function createTermiteMoundMesh() {
    const group = new THREE.Group();
    const moundMat = new THREE.MeshStandardMaterial({ color: 0x8a3c1b, roughness: 0.98 });

    const spire1 = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.6, 6), moundMat);
    spire1.position.y = 1.3;
    spire1.castShadow = true;
    group.add(spire1);

    const spire2 = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.8, 6), moundMat);
    spire2.position.set(0.4, 0.9, 0.2);
    spire2.castShadow = true;
    group.add(spire2);

    return group;
  }

  // 6. Топливные бочки Total (дизель для экспедиции)
  function createFuelDrumsMesh() {
    const group = new THREE.Group();
    const drumGeom = new THREE.CylinderGeometry(0.32, 0.32, 0.95, 12);
    const drumMat = new THREE.MeshStandardMaterial({ color: 0xcc292b, roughness: 0.6, metalness: 0.3 }); // красный Total

    const drum1 = new THREE.Mesh(drumGeom, drumMat);
    drum1.position.set(-0.25, 0.48, 0);
    drum1.castShadow = true;
    group.add(drum1);

    const drum2 = new THREE.Mesh(drumGeom, drumMat);
    drum2.position.set(0.35, 0.48, 0.1);
    drum2.castShadow = true;
    group.add(drum2);

    return group;
  }

  // 7. Станционный навес Бенгела
  function createStationShedMesh() {
    const group = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a3319, roughness: 0.9 });
    const tinMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.5, metalness: 0.6 });

    // 4 столба
    const postGeom = new THREE.CylinderGeometry(0.08, 0.08, 2.6, 6);
    const coords = [[-2, -1.2], [2, -1.2], [-2, 1.2], [2, 1.2]];
    coords.forEach(([px, pz]) => {
      const post = new THREE.Mesh(postGeom, woodMat);
      post.position.set(px, 1.3, pz);
      post.castShadow = true;
      group.add(post);
    });

    // Навес из жести
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.1, 3.0), tinMat);
    roof.position.y = 2.65;
    roof.rotation.x = 0.08;
    roof.castShadow = true;
    group.add(roof);

    return group;
  }

  // 8. Тяжёлый дорожный велосипед (Roadster)
  function createBicycleMesh() {
    const group = new THREE.Group();
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.8 });

    // Рама и колеса
    const wheelGeom = new THREE.TorusGeometry(0.35, 0.03, 6, 16);
    const w1 = new THREE.Mesh(wheelGeom, frameMat);
    w1.position.set(-0.5, 0.35, 0);
    group.add(w1);

    const w2 = new THREE.Mesh(wheelGeom, frameMat);
    w2.position.set(0.5, 0.35, 0);
    group.add(w2);

    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 5), frameMat);
    bar.rotation.z = Math.PI * 0.5;
    bar.position.set(0, 0.5, 0);
    group.add(bar);

    group.scale.set(1.2, 1.2, 1.2);
    return group;
  }

  // Создание ворот чекпоинта экспедиции (африканские деревянные столбы с баннером и сигнальным фонарем)
  function createCheckpointGate(cp, idx, isFinish) {
    const group = new THREE.Group();
    group.name = `CheckpointGate_${idx}`;

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x3d2716, roughness: 0.9 });
    const postGeom = new THREE.CylinderGeometry(0.14, 0.18, 5.0, 7);

    const postL = new THREE.Mesh(postGeom, woodMat);
    postL.position.set(-4.5, 2.5, 0);
    postL.castShadow = true;
    group.add(postL);

    const postR = new THREE.Mesh(postGeom, woodMat);
    postR.position.set(4.5, 2.5, 0);
    postR.castShadow = true;
    group.add(postR);

    // Поперечная деревянная перекладина
    const crossBar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 9.4, 7), woodMat);
    crossBar.rotation.z = Math.PI * 0.5;
    crossBar.position.set(0, 4.4, 0);
    group.add(crossBar);

    // Баннер с контрастной надписью
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = isFinish ? '#991b1b' : '#c2410c';
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, 500, 116);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isFinish ? '🏁 ФИНИШ • НА КОЛВЕЗИ' : `📍 КП ${idx + 1} • MUTSHATSHA`, 256, 64);

    const bannerTex = new THREE.CanvasTexture(canvas);
    const bannerMat = new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.6 });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 1.4), bannerMat);
    banner.position.set(0, 3.6, 0);
    group.add(banner);

    const bannerBack = banner.clone();
    bannerBack.rotation.y = Math.PI;
    group.add(bannerBack);

    // Светящиеся сигнальные маяки
    const beaconMat = new THREE.MeshStandardMaterial({
      color: isFinish ? 0xe71d36 : 0xff9f1c,
      emissive: isFinish ? 0xe71d36 : 0xff9f1c,
      emissiveIntensity: 0.95,
      roughness: 0.2
    });
    const bGeo = new THREE.SphereGeometry(0.35, 12, 12);
    const bL = new THREE.Mesh(bGeo, beaconMat);
    bL.position.set(-4.5, 4.8, 0);
    group.add(bL);
    const bR = new THREE.Mesh(bGeo, beaconMat);
    bR.position.set(4.5, 4.8, 0);
    group.add(bR);

    const gh = getGroundHeight(cp.x, cp.z);
    group.position.set(cp.x, gh, cp.z);
    if (typeof cp.rot === 'number') {
      group.rotation.y = cp.rot;
    }

    return { group, beaconMat };
  }

  // Создание экземпляра 3D-пропса по его типу
  function instantiateProp(prop) {
    let mesh = null;
    switch (prop.type) {
      case 'hut_round':
        mesh = createRoundHutMesh();
        break;
      case 'hut_clay':
        mesh = createClayHouseMesh();
        break;
      case 'acacia_tree':
        mesh = createAcaciaTreeMesh();
        break;
      case 'mango_tree':
        mesh = createMangoTreeMesh();
        break;
      case 'termite_mound':
        mesh = createTermiteMoundMesh();
        break;
      case 'fuel_drums':
      case 'barrel_fuel':
        mesh = createFuelDrumsMesh();
        break;
      case 'station_shed':
        mesh = createStationShedMesh();
        break;
      case 'roadster_bicycle':
      case 'bicycle_roadster':
        mesh = createBicycleMesh();
        break;
      default:
        mesh = createTermiteMoundMesh();
    }

    if (mesh) {
      const gh = getGroundHeight(prop.x, prop.z);
      mesh.position.set(prop.x, gh, prop.z);
      mesh.rotation.y = prop.rot || 0;
      const s = prop.scale || 1.0;
      mesh.scale.set(s, s, s);
    }
    return mesh;
  }

  // --- ИНИЦИАЛИЗАЦИЯ И ЗАГРУЗКА КАРТЫ ЗАИРА ---
  function init(scene, onReady) {
    if (zaireLoaded) {
      if (onReady) onReady();
      return;
    }
    if (zaireLoading) return;
    zaireLoading = true;

    zaireGroup = new THREE.Group();
    zaireGroup.name = 'ZaireVillageMapGroup';
    roadsGroup = new THREE.Group();
    propsGroup = new THREE.Group();
    zaireGroup.add(roadsGroup);
    zaireGroup.add(propsGroup);

    // 1. Построение ландшафта (Terrain 500x500м) со спутниковым ортофото
    const terrainSize = 500;
    const terrainSegs = 120;
    const terrainGeom = new THREE.PlaneGeometry(terrainSize, terrainSize, terrainSegs, terrainSegs);
    terrainGeom.rotateX(-Math.PI * 0.5);

    const posAttr = terrainGeom.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getZ(i);
      posAttr.setY(i, getGroundHeight(vx, vz));
    }
    terrainGeom.computeVertexNormals();

    const texLoader = new THREE.TextureLoader();
    texLoader.load('assets/zaire_village_map.jpg', (satTexture) => {
      satTexture.anisotropy = 8;
      satTexture.wrapS = THREE.ClampToEdgeWrapping;
      satTexture.wrapT = THREE.ClampToEdgeWrapping;

      const terrainMat = new THREE.MeshStandardMaterial({
        map: satTexture,
        roughness: 0.92,
        metalness: 0.03
      });

      terrainMesh = new THREE.Mesh(terrainGeom, terrainMat);
      terrainMesh.receiveShadow = true;
      zaireGroup.add(terrainMesh);

      // 2. Установка контрольных ворот (чекпоинтов) экспедиции
      checkpoints.forEach((cp, idx) => {
        cp.passed = false;
        const isFinish = idx === checkpoints.length - 1;
        cp.isFinish = isFinish;
        const gate = createCheckpointGate(cp, idx, isFinish);
        propsGroup.add(gate.group);
        cp.beaconMat = gate.beaconMat;
      });

      // 3. Загрузка дорог и пропсов из файла models/zaire_village_roads.json
      fetch('models/zaire_village_roads.json')
        .then(res => res.json())
        .then(data => {
          zaireRoadsData = data;
          activeRoadSplines = [];

          // Построение 3D-полотен дорог
          if (data.routes) {
            Object.keys(data.routes).forEach(routeId => {
              const r = data.routes[routeId];
              const roadMesh = buildRoadSplineMesh(r.points, r.width || 4, r.surfaceType || 'clay');
              if (roadMesh) {
                roadMesh.name = r.name || routeId;
                roadsGroup.add(roadMesh);
                activeRoadSplines.push(roadMesh);
              }
            });
          }

          // Расстановка 3D-пропсов (хижины, акации, термитники, бочки)
          if (data.props && Array.isArray(data.props)) {
            data.props.forEach(p => {
              const propObj = instantiateProp(p);
              if (propObj) propsGroup.add(propObj);
            });
          }

          scene.add(zaireGroup);
          zaireLoaded = true;
          zaireLoading = false;
          console.log(`[ZaireMap] Успешно загружено дорог: ${activeRoadSplines.length}, пропсов: ${data.props?.length || 0}`);
          if (onReady) onReady();
        })
        .catch(err => {
          console.error('[ZaireMap] Ошибка чтения zaire_village_roads.json:', err);
          zaireLoading = false;
          scene.add(zaireGroup);
          zaireLoaded = true;
          if (onReady) onReady();
        });
    }, undefined, (err) => {
      console.error('[ZaireMap] Ошибка загрузки текстуры sat map:', err);
      zaireLoading = false;
    });
  }

  function show() {
    if (zaireGroup) zaireGroup.visible = true;
  }

  function hide() {
    if (zaireGroup) zaireGroup.visible = false;
  }

  return {
    init: init,
    show: show,
    hide: hide,
    getGroundHeight: getGroundHeight,
    getSoilZoneAt: getSoilZoneAt,
    getCheckpoints: () => checkpoints,
    isLoaded: () => zaireLoaded
  };
})();
