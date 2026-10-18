/**
 * Philippines Mactan New Town: Clean Spline Roads, Turquoise Ocean, and Tropical Resort Props
 * Over the Hill & art of rally aesthetic.
 */

window.PhilippinesTracks = (function() {
  let roadsGroup = null;
  let waterMesh = null;
  let activeRoads = [];
  let waterInitialVertices = null;
  let bancaBoat = null;
  let bancaBaseY = 2.5;
  let buoys = [];
  let philippinesCheckpoints = [];

  // Процедурная текстура асфальта с разметкой
  function createRoadTexture(isBoulevard = true) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Тёмный зернистый асфальт (полотно)
    ctx.fillStyle = '#22262e';
    ctx.fillRect(0, 0, 512, 512);

    // Бетонные боковые бордюры (0..36px и 476..512px)
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(0, 0, 36, 512);
    ctx.fillRect(476, 0, 36, 512);

    // Шум гравия и фактура покрытия
    const imgData = ctx.getImageData(0, 0, 512, 512);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 20;
      data[i] = Math.min(255, Math.max(0, data[i] + noise));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
    }
    ctx.putImageData(imgData, 0, 0);

    // Краевые сплошные белые линии (вдоль бордюра на асфальте)
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(36, 0, 8, 512);
    ctx.fillRect(468, 0, 8, 512);

    if (isBoulevard) {
      // Центральная двойная сплошная полоса (бульвар, ярко-янтарная)
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(256 - 9, 0, 6, 512);
      ctx.fillRect(256 + 3, 0, 6, 512);

      // Прерывистые белые разделители полос движения (4м штрих, 4м интервал)
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(146, 0, 6, 260);
      ctx.fillRect(360, 0, 6, 260);
    } else {
      // Набережная / курорт: одинарная прерывистая жёлтая линия
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(256 - 4, 0, 8, 260);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 1);
    tex.anisotropy = 8;
    return tex;
  }

  // Создание меша дороги по CatmullRomCurve3
  function buildSplineRoadMesh(curve, width, isBoulevard = true) {
    const numSteps = Math.max(60, Math.floor(curve.getLength() * 1.5));
    const halfW = width / 2;
    const curbW = 0.45;
    const curbH = 0.12;

    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const uvs = [];
    const normals = [];
    const indices = [];

    // Поперечное сечение из 7 точек:
    // 0: левый скос бордюра
    // 1: верхний левый бордюр
    // 2: левый край асфальта
    // 3: центр дороги
    // 4: правый край асфальта
    // 5: верхний правый бордюр
    // 6: правый скос бордюра
    // Поперечное сечение с боковыми откосами (исключает клиппинг со сканом):
    const profileOffsets = [
      { offset: -halfW - curbW - 0.40, h: -0.45, u: 0.0 },
      { offset: -halfW - curbW,        h: -0.08, u: 0.04 },
      { offset: -halfW,                h: curbH,  u: 0.07 },
      { offset: -halfW + 0.15,         h: 0.06,   u: 0.09 },
      { offset: 0.0,                   h: 0.08,   u: 0.50 },
      { offset: halfW - 0.15,          h: 0.06,   u: 0.91 },
      { offset: halfW,                 h: curbH,  u: 0.93 },
      { offset: halfW + curbW,         h: -0.08,  u: 0.96 },
      { offset: halfW + curbW + 0.40,  h: -0.45,  u: 1.0 }
    ];

    for (let i = 0; i <= numSteps; i++) {
      const t = i / numSteps;
      const point = curve.getPoint(t);
      const tangent = curve.getTangent(t).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const binormal = new THREE.Vector3().crossVectors(tangent, up).normalize();
      const realNormal = new THREE.Vector3().crossVectors(binormal, tangent).normalize();

      const v = (t * curve.getLength()) / 8.0;

      for (let j = 0; j < profileOffsets.length; j++) {
        const p = profileOffsets[j];
        const vert = point.clone()
          .addScaledVector(binormal, p.offset)
          .addScaledVector(realNormal, p.h);

        positions.push(vert.x, vert.y, vert.z);
        normals.push(realNormal.x, realNormal.y, realNormal.z);
        uvs.push(p.u, v);
      }

      if (i < numSteps) {
        const row1 = i * profileOffsets.length;
        const row2 = (i + 1) * profileOffsets.length;
        for (let j = 0; j < profileOffsets.length - 1; j++) {
          indices.push(row1 + j, row1 + j + 1, row2 + j);
          indices.push(row1 + j + 1, row2 + j + 1, row2 + j);
        }
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const roadTex = createRoadTexture(isBoulevard);
    const material = new THREE.MeshStandardMaterial({
      map: roadTex,
      roughness: 0.85,
      metalness: 0.10,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    return mesh;
  }

  // Чистый стилизованный террейн (пляж, зелень, холмы в стиле Over the Hill)
  function buildStylizedTerrain(targetGroup, getGroundH) {
    const size = 500;
    const segments = 96;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = [];
    const colorSand = new THREE.Color('#dfb17b'); // золотистый песок
    const colorGrass = new THREE.Color('#386641'); // тропическая трава
    const colorRock = new THREE.Color('#6c757d'); // холмы

    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);
      let vy = getGroundH(vx, vz);

      // В северной лагуне рельеф плавно уходит под воду
      if (vz < -160 && vx > 50) {
        vy = Math.min(vy, 12.0);
      }
      pos.setY(i, vy - 0.05);

      if (vz < -125 && vx > 65) {
        colors.push(colorSand.r, colorSand.g, colorSand.b);
      } else if (vy > 14.0) {
        colors.push(colorRock.r, colorRock.g, colorRock.b);
      } else {
        colors.push(colorGrass.r, colorGrass.g, colorGrass.b);
      }
    }

    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.05,
      flatShading: true
    });

    const terrainMesh = new THREE.Mesh(geo, mat);
    terrainMesh.receiveShadow = true;
    targetGroup.add(terrainMesh);
    return terrainMesh;
  }

  // Создание океана
  function buildOcean() {
    // Плоскость океана покрывает северную бухту и пляж курорта
    const oceanGeo = new THREE.PlaneGeometry(500, 320, 64, 48);
    oceanGeo.rotateX(-Math.PI / 2);

    waterInitialVertices = new Float32Array(oceanGeo.attributes.position.array);

    const oceanMat = new THREE.MeshPhysicalMaterial({
      color: 0x00b4d8,
      emissive: 0x004e64,
      emissiveIntensity: 0.22,
      roughness: 0.08,
      metalness: 0.05,
      transmission: 0.65,
      transparent: true,
      opacity: 0.82,
      ior: 1.333,
      reflectivity: 0.9,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1
    });

    waterMesh = new THREE.Mesh(oceanGeo, oceanMat);
    waterMesh.position.set(80, 12.80, -185);
    waterMesh.receiveShadow = true;
    return waterMesh;
  }

  // Процедурная кокосовая пальма
  function createPalmTree(x, y, z, scale = 1.0) {
    const palm = new THREE.Group();
    palm.position.set(x, y, z);
    palm.scale.set(scale, scale, scale);

    // Ствол пальмы с лёгким изгибом
    const trunkCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.3, 2.5, 0.1),
      new THREE.Vector3(0.7, 5.0, 0.4),
      new THREE.Vector3(0.5, 7.5, 0.8)
    ]);
    const trunkGeo = new THREE.TubeGeometry(trunkCurve, 10, 0.26, 8, false);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    palm.add(trunk);

    // Крона пальмы из перистых листьев
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0x2d6a4f,
      roughness: 0.65,
      side: THREE.DoubleSide
    });
    const numFronds = 7;
    for (let i = 0; i < numFronds; i++) {
      const angle = (i / numFronds) * Math.PI * 2;
      const frondCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.5, 7.5, 0.8),
        new THREE.Vector3(0.5 + Math.cos(angle) * 1.8, 8.2, 0.8 + Math.sin(angle) * 1.8),
        new THREE.Vector3(0.5 + Math.cos(angle) * 3.4, 7.1, 0.8 + Math.sin(angle) * 3.4)
      ]);
      const frondGeo = new THREE.TubeGeometry(frondCurve, 6, 0.22, 4, false);
      const frond = new THREE.Mesh(frondGeo, leafMat);
      frond.castShadow = true;
      palm.add(frond);
    }
    return palm;
  }

  // Деревянный пирс курорта в море
  function createResortPier(startX, startY, startZ) {
    const pier = new THREE.Group();
    pier.position.set(startX, startY, startZ);

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.85 });
    const plankMat = new THREE.MeshStandardMaterial({ color: 0xa07855, roughness: 0.80 });

    // Настил пирса длиной 35 метров в сторону открытого океана
    const deckGeo = new THREE.BoxGeometry(4.0, 0.25, 35.0);
    deckGeo.translate(0, 0.12, -17.5);
    const deck = new THREE.Mesh(deckGeo, plankMat);
    deck.castShadow = true;
    deck.receiveShadow = true;
    pier.add(deck);

    // Сваи пирса в воду
    const pileGeo = new THREE.CylinderGeometry(0.18, 0.18, 6.0, 8);
    for (let z = -4; z >= -34; z -= 5) {
      const pileL = new THREE.Mesh(pileGeo, woodMat);
      pileL.position.set(-1.8, -1.8, z);
      pier.add(pileL);

      const pileR = new THREE.Mesh(pileGeo, woodMat);
      pileR.position.set(1.8, -1.8, z);
      pier.add(pileR);
    }

    // Т-образная посадочная площадка в конце пирса
    const endDeckGeo = new THREE.BoxGeometry(12.0, 0.25, 6.0);
    endDeckGeo.translate(0, 0.12, -35.0);
    const endDeck = new THREE.Mesh(endDeckGeo, plankMat);
    endDeck.castShadow = true;
    pier.add(endDeck);

    return pier;
  }

  // Традиционная филиппинская лодка Banca (с бамбуковыми аутригерами)
  function createBancaBoat(x, y, z) {
    const banca = new THREE.Group();
    banca.position.set(x, y, z);

    // Узкий деревянный корпус
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xebf8ff, roughness: 0.5 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4 });
    const bambooMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.7 });

    const hullGeo = new THREE.BoxGeometry(1.2, 0.9, 7.5);
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.castShadow = true;
    banca.add(hull);

    // Носовой и кормовой скосы
    const noseGeo = new THREE.ConeGeometry(0.6, 1.8, 6);
    noseGeo.rotateX(-Math.PI / 2);
    const nose = new THREE.Mesh(noseGeo, trimMat);
    nose.position.set(0, 0.1, -4.2);
    banca.add(nose);

    // Поперечные бамбуковые балки (outrigger arms / katig)
    const armGeo = new THREE.CylinderGeometry(0.08, 0.08, 5.5, 8);
    armGeo.rotateZ(Math.PI / 2);

    const armFront = new THREE.Mesh(armGeo, bambooMat);
    armFront.position.set(0, 0.35, -1.5);
    banca.add(armFront);

    const armRear = new THREE.Mesh(armGeo, bambooMat);
    armRear.position.set(0, 0.35, 1.5);
    banca.add(armRear);

    // Продольные бамбуковые поплавки (floats)
    const floatGeo = new THREE.CylinderGeometry(0.12, 0.12, 8.2, 8);
    floatGeo.rotateX(Math.PI / 2);

    const floatL = new THREE.Mesh(floatGeo, bambooMat);
    floatL.position.set(-2.6, 0.05, 0);
    banca.add(floatL);

    const floatR = new THREE.Mesh(floatGeo, bambooMat);
    floatR.position.set(2.6, 0.05, 0);
    banca.add(floatR);

    // Солнцезащитный тент
    const canopyGeo = new THREE.BoxGeometry(1.4, 0.05, 3.2);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.8 });
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.set(0, 1.4, 0);
    banca.add(canopy);

    return banca;
  }

  // Курортное бунгало на песчаном берегу
  function createResortBungalow(x, y, z, rotY = 0) {
    const hut = new THREE.Group();
    hut.position.set(x, y, z);
    hut.rotation.y = rotY;

    // Сваи
    const stiltMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
    const stiltGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.4, 6);
    const coords = [[-2, -2], [2, -2], [-2, 2], [2, 2]];
    coords.forEach(([sx, sz]) => {
      const s = new THREE.Mesh(stiltGeo, stiltMat);
      s.position.set(sx, 0.7, sz);
      hut.add(s);
    });

    // Пол террасы
    const floorGeo = new THREE.BoxGeometry(5.2, 0.2, 5.2);
    const woodMat = new THREE.MeshStandardMaterial({ color: 0xa87d51, roughness: 0.8 });
    const floor = new THREE.Mesh(floorGeo, woodMat);
    floor.position.set(0, 1.4, 0);
    floor.castShadow = true;
    hut.add(floor);

    // Стены бунгало
    const wallGeo = new THREE.BoxGeometry(4.0, 2.2, 3.6);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xfdfbf7, roughness: 0.9 });
    const walls = new THREE.Mesh(wallGeo, wallMat);
    walls.position.set(0, 2.5, -0.4);
    walls.castShadow = true;
    hut.add(walls);

    // Соломенная четырёхскатная крыша (Nipa hut style)
    const roofGeo = new THREE.ConeGeometry(3.8, 1.8, 4);
    roofGeo.rotateY(Math.PI / 4);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xb5925a, roughness: 0.95 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(0, 4.4, -0.4);
    roof.castShadow = true;
    hut.add(roof);

    return hut;
  }

  // Уличный фонарь бульвара
  function createBoulevardLamp(x, y, z) {
    const lamp = new THREE.Group();
    lamp.position.set(x, y, z);

    const metalMat = new THREE.MeshStandardMaterial({ color: 0x2d3748, roughness: 0.4, metalness: 0.8 });
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.14, 6.5, 8);
    const pole = new THREE.Mesh(poleGeo, metalMat);
    pole.position.y = 3.25;
    pole.castShadow = true;
    lamp.add(pole);

    // Двухрожковый светильник
    const armGeo = new THREE.BoxGeometry(2.4, 0.08, 0.12);
    const arm = new THREE.Mesh(armGeo, metalMat);
    arm.position.y = 6.4;
    lamp.add(arm);

    // Светящиеся плафоны
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xffedd5,
      emissive: 0xfbbf24,
      emissiveIntensity: 0.9
    });
    const headGeo = new THREE.BoxGeometry(0.35, 0.12, 0.25);
    const headL = new THREE.Mesh(headGeo, headMat);
    headL.position.set(-1.1, 6.32, 0);
    lamp.add(headL);

    const headR = new THREE.Mesh(headGeo, headMat);
    headR.position.set(1.1, 6.32, 0);
    lamp.add(headR);

    return lamp;
  }

  // Пляжный зонт от солнца
  function createBeachUmbrella(x, y, z, color = 0xf97316) {
    const umb = new THREE.Group();
    umb.position.set(x, y, z);

    // Бамбуковая стойка
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.8 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 1.2;
    pole.rotation.z = 0.08;
    pole.castShadow = true;
    umb.add(pole);

    // Тканевый купол
    const canopyGeo = new THREE.ConeGeometry(1.65, 0.65, 8, 1, true);
    const canopyMat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.7,
      side: THREE.DoubleSide
    });
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.set(0.1, 2.3, 0);
    canopy.rotation.z = 0.08;
    canopy.castShadow = true;
    umb.add(canopy);

    return umb;
  }

  // Деревянный пляжный шезлонг
  function createSunLounger(x, y, z, rotY = 0) {
    const lounger = new THREE.Group();
    lounger.position.set(x, y, z);
    lounger.rotation.y = rotY;

    // Каркас
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x9a3412, roughness: 0.8 });
    const baseGeo = new THREE.BoxGeometry(0.75, 0.18, 1.8);
    const base = new THREE.Mesh(baseGeo, woodMat);
    base.position.y = 0.12;
    base.castShadow = true;
    lounger.add(base);

    // Наклонная спинка с ярким полотенцем
    const towelMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.9 });
    const towelGeo = new THREE.BoxGeometry(0.68, 0.06, 0.65);
    const towel = new THREE.Mesh(towelGeo, towelMat);
    towel.position.set(0, 0.32, -0.55);
    towel.rotation.x = -0.35;
    towel.castShadow = true;
    lounger.add(towel);

    return lounger;
  }

  // Якорный сигнальный буй
  function createMooringBuoy(x, y, z) {
    const buoy = new THREE.Group();
    buoy.position.set(x, y, z);

    // Плавающий буй
    const buoyMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.3 });
    const buoyGeo = new THREE.SphereGeometry(0.38, 10, 10);
    const mesh = new THREE.Mesh(buoyGeo, buoyMat);
    mesh.castShadow = true;
    buoy.add(mesh);

    // Белая полоса
    const bandMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const bandGeo = new THREE.CylinderGeometry(0.39, 0.39, 0.12, 10);
    const band = new THREE.Mesh(bandGeo, bandMat);
    buoy.add(band);

    return buoy;
  }

  // Тропическая арка контрольных ворот (чекпоинт ралли)
  function createTropicalCheckpointArch(def, getGroundH) {
    const arch = new THREE.Group();
    const groundY = getGroundH(def.x, def.z);
    arch.position.set(def.x, groundY, def.z);

    const span = def.span || 11.0;
    const halfSpan = span / 2;

    const yaw = def.yaw || 0;
    const normX = -Math.cos(yaw);
    const normZ = Math.sin(yaw);

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.85 });
    const postGeo = new THREE.CylinderGeometry(0.25, 0.28, 5.6, 8);

    const postL = new THREE.Mesh(postGeo, woodMat);
    postL.position.set(-normX * halfSpan, 2.8, -normZ * halfSpan);
    postL.castShadow = true;
    arch.add(postL);

    const postR = new THREE.Mesh(postGeo, woodMat);
    postR.position.set(normX * halfSpan, 2.8, normZ * halfSpan);
    postR.castShadow = true;
    arch.add(postR);

    // Перекладина
    const beamGeo = new THREE.BoxGeometry(span + 1.2, 0.55, 0.4);
    const beam = new THREE.Mesh(beamGeo, woodMat);
    beam.position.set(0, 5.1, 0);
    beam.rotation.y = yaw + Math.PI / 2;
    beam.castShadow = true;
    arch.add(beam);

    // Баннер с названием КП
    const bCanv = document.createElement('canvas');
    bCanv.width = 512;
    bCanv.height = 64;
    const bCtx = bCanv.getContext('2d');
    const grad = bCtx.createLinearGradient(0, 0, 512, 0);
    if (def.isFinish) {
      grad.addColorStop(0, '#dc2626');
      grad.addColorStop(1, '#b91c1c');
    } else {
      grad.addColorStop(0, '#f59e0b');
      grad.addColorStop(1, '#d97706');
    }
    bCtx.fillStyle = grad;
    bCtx.fillRect(0, 0, 512, 64);

    bCtx.strokeStyle = '#ffffff';
    bCtx.lineWidth = 3;
    bCtx.strokeRect(6, 6, 500, 52);

    bCtx.fillStyle = '#ffffff';
    bCtx.font = 'bold 24px "Segoe UI", sans-serif';
    bCtx.textAlign = 'center';
    bCtx.textBaseline = 'middle';
    bCtx.fillText(def.title, 256, 33);

    const bannerTex = new THREE.CanvasTexture(bCanv);
    const bannerMat = new THREE.MeshStandardMaterial({
      map: bannerTex,
      roughness: 0.5,
      side: THREE.FrontSide
    });
    const bannerGeo = new THREE.PlaneGeometry(span * 0.72, 1.15);

    // Передняя сторона баннера
    const bannerFront = new THREE.Mesh(bannerGeo, bannerMat);
    bannerFront.position.set(0, 4.3, 0.02);
    bannerFront.rotation.y = yaw + Math.PI / 2;
    arch.add(bannerFront);

    // Задняя сторона баннера (не отзеркалена, текст читается с обеих сторон)
    const bannerBack = new THREE.Mesh(bannerGeo, bannerMat);
    bannerBack.position.set(0, 4.3, -0.02);
    bannerBack.rotation.y = yaw - Math.PI / 2;
    arch.add(bannerBack);

    // Светящиеся сигнальные фонари
    const beaconMat = new THREE.MeshStandardMaterial({
      color: def.isFinish ? 0xe71d36 : 0xff9f1c,
      emissive: def.isFinish ? 0xe71d36 : 0xff9f1c,
      emissiveIntensity: 0.95,
      roughness: 0.2
    });
    const bGeo = new THREE.SphereGeometry(0.35, 12, 12);
    const beaconL = new THREE.Mesh(bGeo, beaconMat);
    beaconL.position.set(-normX * halfSpan, 5.7, -normZ * halfSpan);
    arch.add(beaconL);

    const beaconR = new THREE.Mesh(bGeo, beaconMat);
    beaconR.position.set(normX * halfSpan, 5.7, normZ * halfSpan);
    arch.add(beaconR);

    return { arch, beaconMat };
  }

  // Главная функция построения
  function buildTracks(targetGroup, getGroundH, onComplete) {
    roadsGroup = new THREE.Group();
    roadsGroup.name = "Philippines_Active_Roads";
    targetGroup.add(roadsGroup);

    fetch('models/philippines_roads.json')
      .then(res => res.json())
      .then(data => {
        const routes = data.routes || {};
        activeRoads = [];

        // 0. Построение чистого стилизованного рельефа острова
        buildStylizedTerrain(roadsGroup, getGroundH);

        // 1. Построение Mactan Boulevard
        if (routes.mactan_boulevard && routes.mactan_boulevard.points.length >= 2) {
          const pts = routes.mactan_boulevard.points.map(p => {
            const h = getGroundH(p.x, p.z);
            return new THREE.Vector3(p.x, h + 0.40, p.z);
          });
          const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.15);
          const roadMesh = buildSplineRoadMesh(curve, routes.mactan_boulevard.width || 10.0, true);
          roadsGroup.add(roadMesh);

          activeRoads.push({
            id: 'mactan_boulevard',
            curve: curve,
            width: routes.mactan_boulevard.width || 10.0,
            samples: curve.getPoints(200)
          });

          // Расстановка уличных фонарей вдоль бульвара
          const lampSamples = curve.getPoints(12);
          lampSamples.forEach((lp, idx) => {
            if (idx === 0 || idx === lampSamples.length - 1) return;
            const t = idx / lampSamples.length;
            const tang = curve.getTangent(t).normalize();
            const norm = new THREE.Vector3(-tang.z, 0, tang.x).normalize();
            const leftLamp = createBoulevardLamp(lp.x + norm.x * 5.8, lp.y, lp.z + norm.z * 5.8);
            roadsGroup.add(leftLamp);
          });
        }

        // 2. Построение Coastal Loop (Набережная и спуск к пляжу)
        if (routes.coastal_loop && routes.coastal_loop.points.length >= 2) {
          const pts = routes.coastal_loop.points.map(p => {
            const h = getGroundH(p.x, p.z);
            return new THREE.Vector3(p.x, h + 0.40, p.z);
          });
          const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.20);
          const roadMesh = buildSplineRoadMesh(curve, routes.coastal_loop.width || 8.0, false);
          roadsGroup.add(roadMesh);

          activeRoads.push({
            id: 'coastal_loop',
            curve: curve,
            width: routes.coastal_loop.width || 8.0,
            samples: curve.getPoints(160)
          });

          // Пальмы вдоль курортной набережной
          const palmSamples = curve.getPoints(14);
          palmSamples.forEach((pp, idx) => {
            const t = idx / palmSamples.length;
            const tang = curve.getTangent(t).normalize();
            const norm = new THREE.Vector3(-tang.z, 0, tang.x).normalize();
            const side = (idx % 2 === 0) ? 5.2 : -5.2;
            const palm = createPalmTree(
              pp.x + norm.x * side,
              getGroundH(pp.x + norm.x * side, pp.z + norm.z * side),
              pp.z + norm.z * side,
              0.85 + Math.random() * 0.35
            );
            roadsGroup.add(palm);
          });
        }

        // 3. Бирюзовый океан на севере
        const ocean = buildOcean();
        roadsGroup.add(ocean);

        // 4. Деревянный пирс курорта в конце Coastal Loop
        const pier = createResortPier(137.14, getGroundH(137.14, -166.33), -166.33);
        roadsGroup.add(pier);

        // 5. Лодка Banca у пирса
        bancaBoat = createBancaBoat(143.5, 12.80, -182.0);
        bancaBaseY = 12.80;
        roadsGroup.add(bancaBoat);

        // Вторая лодка на якорной стоянке в лагуне
        const banca2 = createBancaBoat(95.0, 12.80, -195.0);
        banca2.rotation.y = 0.45;
        roadsGroup.add(banca2);

        // 6. Курортные бунгало вдоль песчаного берега
        const bungalowCoords = [
          { x: 110.0, z: -148.0, rot: -0.2 },
          { x: 124.0, z: -142.0, rot: 0.15 },
          { x: 152.0, z: -152.0, rot: -0.4 }
        ];
        bungalowCoords.forEach(b => {
          const bg = createResortBungalow(b.x, getGroundH(b.x, b.z), b.z, b.rot);
          roadsGroup.add(bg);
        });

        // 7. Контрольные ворота ралли (чекпоинты экспедиции Лапу-Лапу)
        philippinesCheckpoints = [];
        const checkpointDefs = [
          { index: 0, x: 38.04,  z: 143.82,  yaw: -2.99, span: 13.0, title: 'СТАРТ: MACTAN BOULEVARD', isFinish: false },
          { index: 1, x: 33.74,  z: 106.56,  yaw: -2.67, span: 13.0, title: 'КП-1: ПАЛЬМОВЫЙ ПРОСПЕКТ', isFinish: false },
          { index: 2, x: 18.65,  z: 4.66,    yaw: 2.69,  span: 13.0, title: 'КП-2: ДЕЛОВОЙ ЦЕНТР NEW TOWN', isFinish: false },
          { index: 3, x: 76.45,  z: -78.89,  yaw: 2.45,  span: 11.0, title: 'КП-3: РАЗВЯЗКА НАБЕРЕЖНОЙ', isFinish: false },
          { index: 4, x: 96.97,  z: -138.91, yaw: 0.63,  span: 10.5, title: 'КП-4: ПЛЯЖ И БУНГАЛО', isFinish: false },
          { index: 5, x: 137.14, z: -166.33, yaw: Math.PI, span: 10.5, title: '🏁 ФИНИШ: МОРСКОЙ ПИРС', isFinish: true }
        ];

        checkpointDefs.forEach(def => {
          const res = createTropicalCheckpointArch(def, getGroundH);
          roadsGroup.add(res.arch);
          philippinesCheckpoints.push({
            index: def.index,
            x: def.x,
            z: def.z,
            title: def.title,
            isFinish: def.isFinish,
            passed: false,
            beaconMat: res.beaconMat,
            group: res.arch
          });
        });

        // 8. Пляжная зона отдыха: шезлонги и солнцезащитные зонты
        const beachSpots = [
          { x: 112.0, z: -144.0, uColor: 0x06b6d4, rot: 0.2 },
          { x: 116.0, z: -145.5, uColor: 0xf97316, rot: 0.1 },
          { x: 126.0, z: -138.0, uColor: 0xeab308, rot: -0.15 },
          { x: 130.0, z: -140.0, uColor: 0xec4899, rot: -0.3 },
          { x: 145.0, z: -147.0, uColor: 0x10b981, rot: 0.35 }
        ];
        beachSpots.forEach(s => {
          const gy = getGroundH(s.x, s.z);
          const umb = createBeachUmbrella(s.x, gy, s.z, s.uColor);
          const lounger = createSunLounger(s.x + 1.2, gy, s.z + 0.4, s.rot);
          roadsGroup.add(umb);
          roadsGroup.add(lounger);
        });

        // 9. Якорные сигнальные буи в лагуне
        buoys = [];
        const buoyCoords = [
          { x: 125.0, z: -180.0 },
          { x: 135.0, z: -198.0 },
          { x: 155.0, z: -175.0 },
          { x: 80.0,  z: -188.0 }
        ];
        buoyCoords.forEach(bc => {
          const b = createMooringBuoy(bc.x, 12.80, bc.z);
          roadsGroup.add(b);
          buoys.push(b);
        });

        // 10. Дополнительные рощи кокосовых пальм вокруг пляжа курорта
        const groveCoords = [
          { x: 105.0, z: -155.0 },
          { x: 108.0, z: -160.0 },
          { x: 120.0, z: -158.0 },
          { x: 140.0, z: -156.0 },
          { x: 148.0, z: -162.0 },
          { x: 160.0, z: -154.0 },
          { x: 165.0, z: -165.0 },
          { x: 35.0,  z: 130.0 },
          { x: 22.0,  z: 55.0 }
        ];
        groveCoords.forEach(g => {
          const palm = createPalmTree(g.x, getGroundH(g.x, g.z), g.z, 0.9 + Math.random() * 0.4);
          roadsGroup.add(palm);
        });

        console.log('[PhilippinesTracks] Чистые сплайн-дороги, океан, пирс, курорт и чекпоинты успешно построены!');
        if (onComplete) onComplete();
      })
      .catch(err => {
        console.error('[PhilippinesTracks] Ошибка загрузки дорог:', err);
        if (onComplete) onComplete();
      });
  }

  // Аналитическая проверка нахождения автомобиля на дороге для идеального хода
  function getRoadElevation(x, z) {
    if (!activeRoads.length) return null;

    for (let r = 0; r < activeRoads.length; r++) {
      const road = activeRoads[r];
      const halfW = road.width / 2;
      const samples = road.samples;

      // Быстрый поиск ближайшего сегмента
      let minDistSq = Infinity;
      let bestIdx = 0;

      for (let i = 0; i < samples.length; i++) {
        const dx = x - samples[i].x;
        const dz = z - samples[i].z;
        const dSq = dx * dx + dz * dz;
        if (dSq < minDistSq) {
          minDistSq = dSq;
          bestIdx = i;
        }
      }

      const dist = Math.sqrt(minDistSq);

      // В пределах полотна дороги
      if (dist <= halfW) {
        const roadPt = samples[bestIdx];
        return {
          onRoad: true,
          height: roadPt.y + 0.08,
          drag: 0.82,
          slipMult: 0.18,
          label: road.id === 'mactan_boulevard' ? 'ПРОСПЕКТ MACTAN BOULEVARD (АСФАЛЬТ)' : 'ПРИБРЕЖНАЯ НАБЕРЕЖНАЯ (КУРОРТ)',
          color: '#00f0ff'
        };
      } else if (dist <= halfW + 1.2) {
        // Плавный сход с бордюра на обочину
        const tEdge = (dist - halfW) / 1.2;
        const roadPt = samples[bestIdx];
        return {
          onRoad: true,
          height: roadPt.y + 0.08 * (1.0 - tEdge),
          edgeFactor: tEdge,
          drag: 0.90,
          slipMult: 0.28,
          label: 'ОБОЧИНА ПРОСПЕКТА',
          color: '#f59e0b'
        };
      }
    }

    return null;
  }

  // Анимация волн воды, покачивания лодок и буев
  function updateWater(time) {
    if (waterMesh && waterInitialVertices) {
      const pos = waterMesh.geometry.attributes.position;
      const arr = pos.array;
      const count = pos.count;

      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        const origX = waterInitialVertices[i3];
        const origZ = waterInitialVertices[i3 + 2];

        // Волновой синус
        const wave = Math.sin(origX * 0.08 + time * 2.2) * 0.14 +
                     Math.cos(origZ * 0.12 + time * 1.6) * 0.09;

        arr[i3 + 1] = waterInitialVertices[i3 + 1] + wave;
      }
      pos.needsUpdate = true;
    }

    // Покачивание филиппинской лодки banca на волнах
    if (bancaBoat) {
      bancaBoat.position.y = bancaBaseY + Math.sin(time * 2.0) * 0.08;
      bancaBoat.rotation.z = Math.sin(time * 1.8) * 0.04;
      bancaBoat.rotation.x = Math.cos(time * 1.5) * 0.03;
    }

    // Покачивание буев в лагуне
    buoys.forEach((b, idx) => {
      b.position.y = 12.80 + Math.sin(time * 2.4 + idx * 1.2) * 0.07;
      b.rotation.z = Math.sin(time * 1.8 + idx) * 0.05;
    });
  }

  return {
    buildTracks: buildTracks,
    getRoadElevation: getRoadElevation,
    updateWater: updateWater,
    getCheckpoints: () => philippinesCheckpoints
  };
})();
