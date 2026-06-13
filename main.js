import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// 安全获取 TWEEN（兼容 UMD 版本）
const TWEEN = window.TWEEN || window.tween;

// --- 全局变量 ---
let scene, camera, renderer, controls;
let raycaster, mouse;
let currentModelGroup = null;
let hotspots = [];
let isPlaying = false;
let isExploded = false;
const originalPositions = new Map(); // 存储构件原始位置
let currentModelType = 'sunmao';     // 记录当前模型类型
let hoveredObj = null;
let originalMat = null;
const loader = new GLTFLoader();

// --- 模型配置文件 ---
const modelConfig = {
    'sunmao': {
        path: 'models/榫卯.gltf',   // ⚠️ 建议换成实际对应的模型文件
        explodeFactor: 2, // 【新增】榫卯拆解散开距离
        explodeDirection: 'horizontal',
        hotspots: [
            { pos: [-1, 0,1], title: "榫", text: "凸出来的负责插入与传力，将构件连接起来，并将受到的重量均匀分散" },
            { pos: [1, 0,1], title: "卯", text: "凹进去的负责容纳与锁紧，精准卡住榫头，限制构件各个方向的扭动与滑移" }
        ]
    },
    'dougong': {
        path: 'models/斗拱（基础）.gltf',  // ⚠️ 建议换成实际对应的模型文件
        explodeFactor: 3,           // 拆分距离
        explodeDirection: 'vertical', // ← 关键：垂直拆分
        hotspots: [
            { pos: [0, -0.1,0.21], title: "斗", text: "最底层的方形木块，承托整个斗拱。" },
            //左边
            { pos: [-0.4, 0.1,0], title: "拱", text: "层层出挑，将屋檐重量传递到柱子上。" },
            //右边
            { pos: [0, 0.2, 0.4], title: "拱", text: "层层出挑，将屋檐重量传递到柱子上。" }
        ]
    },
    'tailiang': {
        path: 'models/抬梁式构架.gltf', // ⚠️ 建议换成实际对应的模型文件
        scaleFactor: 2,  // 抬梁放大 2 倍
        positionOffset: [1, 0, 0],  // 向右偏移
        hotspots: [
            { pos: [-1.95, 0.5, 0.25], title: "脊檩", text: "支撑屋顶重量的垂直构件。" },
            { pos: [-1.9, 0.3, 0.5], title: "立柱", text: "支撑屋顶重量的垂直构件。" },
            { pos: [0, 0.55, 0.25], title: "大梁", text: "架在柱头上，承受上部荷载。" },
            { pos: [0, 0.4,0.5], title: "大梁", text: "架在柱头上，承受上部荷载。" },
            { pos: [0, 0.2, 0.75], title: "大梁", text: "架在柱头上，承受上部荷载。" }
        ]
    }
};

// --- 初始化 ---
function init() {
    const container = document.getElementById('canvas-container');

    // 1. 场景
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#1a1a1a');
    scene.fog = new THREE.Fog('#1a1a1a', 10, 50);

    // 2. 相机
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 12);

    // 3. 渲染器
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // 限制像素比，优化性能
    renderer.shadowMap.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // 4. 灯光
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(5, 10, 7);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
    fillLight.position.set(-5, 0, -5);
    scene.add(fillLight);

    // 5. 控制器
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 30;
    controls.minDistance = 2;

    // 6. 交互工具
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // 7. 事件监听
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('click', onMouseClick);
    window.addEventListener('mousemove', onMouseHover);
    // 8. 初始化 UI 按钮事件
    setupUI();

    // 9. 默认加载第一个模型
    loadExternalModel('sunmao');

    // 【插入到这里】初始化使用指南
    initGuide();

    // 10. 开始动画循环
    animate();
}

// --- 核心功能：加载外部模型 ---
// --- 核心功能：加载外部模型 ---
function loadExternalModel(type) {
    currentModelType = type; // 【新增】记录当前模型类型
    clearHover(); // ✅【新增】防止切换模型时，hoveredObj 指向已销毁的对象
    const config = modelConfig[type];
    if (!config) return;

    const loaderDiv = document.getElementById('loader');
    if (loaderDiv) loaderDiv.classList.remove('hidden');
     // 【新增】清理爆炸视图数据
    originalPositions.clear();
    isExploded = false;
    // 清理旧模型（彻底释放内存）
    if (currentModelGroup) {
        scene.remove(currentModelGroup);
        currentModelGroup.traverse((child) => {
            if (child.isMesh) {
                child.geometry.dispose();
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => disposeMaterial(m));
                } else {
                    disposeMaterial(child.material);
                }
            }
        });
        currentModelGroup = null;
    }

    // 清理旧热点（彻底释放内存）
    hotspots.forEach(h => {
        scene.remove(h);
        h.geometry.dispose();
        h.material.dispose();
    });
    hotspots = [];

    // 加载新模型
    loader.load(
        config.path,
        (gltf) => {
            const model = gltf.scene;

            // 自动调整模型大小和位置
            const box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            model.position.sub(center); // 居中
            // 清除所有子对象的偏移，重新计算整体包围盒
            model.updateMatrixWorld(true);

            // 重新计算包围盒（确保包含所有子对象）
            const newBox = new THREE.Box3().setFromObject(model);
            const newCenter = newBox.getCenter(new THREE.Vector3());
            const newSize = newBox.getSize(new THREE.Vector3());

            // 将整个模型组移到中心
            model.position.sub(newCenter);

            // 同时将子对象位置也相应调整（防止嵌套偏移）
            model.traverse((child) => {
                if (child.isMesh && child !== model) {
                    child.position.sub(newCenter);
                }
            });

            const maxDim = Math.max(size.x, size.y, size.z);
            const baseScale = 5 / maxDim;
            const scale = baseScale * (config.scaleFactor || 1);
            model.scale.set(scale, scale, scale);
            console.log("模型缩放倍数 scale:", scale); // ✅ 加这行
            // 【新增】应用位置偏移修正
            if (config.positionOffset) {
                model.position.add(new THREE.Vector3(...config.positionOffset));
            }

            // 开启阴影
            model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            currentModelGroup = model;
            scene.add(currentModelGroup);
            // 【新增】预存构件原始位置（用于拆解复原）
            if (config.explodeFactor) {
                currentModelGroup.traverse((child) => {
                    if (child.isMesh) {
                        originalPositions.set(child.uuid, child.position.clone());
                    }
                });
            }
                        // 创建热点（将热点作为模型的子对象，确保跟随模型变换）
            if (config.hotspots) {
                config.hotspots.forEach(h => {
                    // ✅ 直接用原始本地坐标，因为热点已经挂在 model 下，会自动继承缩放
                    const localPos = new THREE.Vector3(...h.pos);
                    createHotspot(model, localPos, h.title, h.text);
                    console.log("创建热点:", h.title, "位置:", localPos); // ✅ 加这行 
                });
            }
            
   // 【新增】更新拆解按钮状态
            updateExplodeButtons();

            if(loaderDiv) loaderDiv.classList.add('hidden');
        },
        (xhr) => { 
            if (xhr.total > 0) {
                console.log((xhr.loaded / xhr.total * 100).toFixed(1) + '% loaded');
            }
        },
        (error) => {
            console.error('模型加载失败:', error);
            alert(`无法加载模型: ${config.path}\n请检查文件路径是否正确。`);
            if(loaderDiv) loaderDiv.classList.add('hidden');
        }
    );
}

// 辅助：彻底释放材质及其贴图
function disposeMaterial(material) {
    if (!material) return;
    // 释放所有可能的贴图
    const textureKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'displacementMap'];
    textureKeys.forEach(key => {
        if (material[key]) {
            material[key].dispose();
        }
    });
    material.dispose();
}

// --- 辅助功能：创建热点 ---
function createHotspot(parent, localPosition, title, text) {
    const geometry = new THREE.SphereGeometry(0.15, 16, 16);
    const material = new THREE.MeshBasicMaterial({ 
        color: 0xffaa00, 
        depthTest: false, 
        transparent: true, 
        opacity: 0.9 
    });
    const sphere = new THREE.Mesh(geometry, material);
    
    // 【关键修改】直接计算世界坐标，加到场景根节点
    const worldPos = localPosition.clone();
    // 如果 parent 有缩放或旋转，需要转换坐标
    if (parent && parent !== scene) {
        parent.localToWorld(worldPos);
    }
    sphere.position.copy(worldPos);

    sphere.renderOrder = 999;
    sphere.userData = { isHotspot: true, title: title, text: text };
    
    // 【关键修改】直接加到场景，不加到模型组
    scene.add(sphere); 
    
    hotspots.push(sphere);
}
// --- 爆炸视图（拆解/复原）功能 ---

// 更新拆解按钮可用状态
function updateExplodeButtons() {
    const btnExplode = document.getElementById('btn-explode');
    const btnRestore = document.getElementById('btn-restore');
    const config = modelConfig[currentModelType];
    const hasExplode = config && config.explodeFactor;

    if (!btnExplode || !btnRestore) return;

    if (!hasExplode) {
        // 当前模型不支持拆解（如斗拱、抬梁）
        btnExplode.classList.add('disabled');
        btnRestore.classList.add('disabled');
        return;
    }

    if (isExploded) {
        btnExplode.classList.add('disabled');
        btnRestore.classList.remove('disabled');
    } else {
        btnExplode.classList.remove('disabled');
        btnRestore.classList.add('disabled');
    }
}

// 拆解模型
// ========== 【新增】配置：直接写死要移动的构件名 ==========
// 【修改这里】把名字换成你模型里实际的构件名
const EXPLODE_TARGETS = {
    topGong: '003',    // ← 替换成最上面拱的 child.name
    bottomDou: '001'   // ← 替换成最下面斗的 child.name
};
// =======================================================

function explodeModel() {
    if (!currentModelGroup || isExploded) return;
    const config = modelConfig[currentModelType];
    if (!config || !config.explodeFactor) return;

    const factor = config.explodeFactor;
    const direction = config.explodeDirection || 'horizontal';
    const center = new THREE.Vector3();
    currentModelGroup.getWorldPosition(center);

    currentModelGroup.traverse((child) => {
        if (!child.isMesh || child.userData.isHotspot) return;

        if (!originalPositions.has(child.uuid)) {
            originalPositions.set(child.uuid, child.position.clone());
        }

        const worldPos = new THREE.Vector3();
        child.getWorldPosition(worldPos);

        let targetWorld;

        if (direction === 'vertical') {
            // 只控制指定名字的构件
            let moveDir = 0;

            if (child.name === EXPLODE_TARGETS.topGong) {
                moveDir = 1;  // 最上面的拱 → 向上
            } else if (child.name === EXPLODE_TARGETS.bottomDou) {
                moveDir = -1; // 最下面的斗 → 向下
            }

            targetWorld = worldPos.clone().add(new THREE.Vector3(0, factor * moveDir, 0));

        } else {
            // 水平拆分（榫卯）
            const dirX = worldPos.x - center.x;
            const dir = new THREE.Vector3(dirX, 0, 0);

            if (dir.lengthSq() === 0) {
                dir.set(1, 0, 0);
            }
            dir.normalize();

            targetWorld = worldPos.clone().add(dir.multiplyScalar(factor));
        }

        const targetLocal = targetWorld.clone();
        child.parent.worldToLocal(targetLocal);

        new TWEEN.Tween(child.position)
            .to({ x: targetLocal.x, y: targetLocal.y, z: targetLocal.z }, 1000)
            .easing(TWEEN.Easing.Quadratic.Out)
            .start();
    });

    isExploded = true;
    updateExplodeButtons();
}

// 复原模型
function restoreModel() {
    if (!currentModelGroup || !isExploded) return;

    currentModelGroup.traverse((child) => {
        if (!child.isMesh || child.userData.isHotspot || !originalPositions.has(child.uuid)) return;

        const original = originalPositions.get(child.uuid);
        new TWEEN.Tween(child.position)
            .to({ x: original.x, y: original.y, z: original.z }, 800)
            .easing(TWEEN.Easing.Quadratic.Out)
            .start();
    });

    isExploded = false;
    updateExplodeButtons();
}
// 【插入到这里】
// --- 视图模式切换 ---
function setViewMode(mode) {
    if (!currentModelGroup) return;
    currentModelGroup.traverse((child) => {
        if (!child.isMesh || child.userData.isHotspot) return;
        if (mode === 'wireframe') {
            child.material.wireframe = true;
            child.material.transparent = false;
        } else if (mode === 'xray') {
            child.material.wireframe = false;
            child.material.transparent = true;
            child.material.opacity = 0.4;
            child.material.depthWrite = false;
        } else {
            child.material.wireframe = false;
            child.material.transparent = false;
            child.material.opacity = 1;
            child.material.depthWrite = true;
        }
    });
}

// --- UI 按钮绑定逻辑 ---
function setupUI() {
    // 菜单切换
    const menuBtns = document.querySelectorAll('.menu-btn');
    menuBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            menuBtns.forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            const modelType = e.currentTarget.getAttribute('data-model');
            if (modelType) loadExternalModel(modelType);
        });
    });

    //显示模式切换（侧边栏 mode-btn 版本）
    const modeBtns = document.querySelectorAll('.mode-btn');
    modeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            modeBtns.forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            const mode = e.currentTarget.getAttribute('data-mode');
            setViewMode(mode);
        });
    });

    // 重置视角
    document.getElementById('btn-reset').addEventListener('click', () => {
        if (TWEEN) {
            new TWEEN.Tween(camera.position)
                .to({ x: 0, y: 5, z: 12 }, 1000)
                .easing(TWEEN.Easing.Quadratic.Out)
                .start();
        } else {
            camera.position.set(0, 5, 12);
        }
        controls.target.set(0, 0, 0);
        controls.update();
    });
    // 【新增】拆解视图按钮
    const btnExplode = document.getElementById('btn-explode');
    const btnRestore = document.getElementById('btn-restore');

    if (btnExplode) {
        btnExplode.addEventListener('click', () => {
            if (!btnExplode.classList.contains('disabled')) {
                explodeModel();
            }
        });
    }
    if (btnRestore) {
        btnRestore.addEventListener('click', () => {
            if (!btnRestore.classList.contains('disabled')) {
                restoreModel();
            }
        });
    }

    // 演示控制
    const playBtn = document.getElementById('btn-play');
    const pauseBtn = document.getElementById('btn-pause');

    playBtn.addEventListener('click', () => {
        isPlaying = true;
        playBtn.classList.add('disabled');
        playBtn.classList.remove('highlight');
        pauseBtn.classList.remove('disabled');
        controls.enabled = false;
    });

    pauseBtn.addEventListener('click', () => {
        isPlaying = false;
        pauseBtn.classList.add('disabled');
        playBtn.classList.remove('disabled');
        playBtn.classList.add('highlight');
        controls.enabled = true;
    });

    // 关闭提示框
    document.getElementById('btn-close-tip').addEventListener('click', () => {
        document.getElementById('help-tip').style.display = 'none';
    });

        // 周边产品展示
    const productItems = document.querySelectorAll('.product-item');
    const productPanel = document.getElementById('product-panel');
    const productOverlay = document.getElementById('product-overlay');
    const btnCloseProduct = document.getElementById('btn-close-product');

    const productData = {
    // 3D 产品
    'building-blocks': {
        title: '榫卯拼接模型',
        type: '3d',
        img: 'images/榫卯套装.png',
        desc: '以中国古建筑直榫卯结构为原型的3D打印教学模型，由榫头与卯眼两部分组成，可直观展示凹凸咬合的连接方式，帮助理解榫卯的力学原理与装配逻辑，可作为科普教具或桌面摆件。适合12岁以上爱好者使用。',
        material: 'PLA环保塑料',
        spec: '40×90×30mm',
        price: '¥39（单模型）/¥49（含模型+产品说明书）',
        link: 'https://example.com/product/building-blocks'
    },
    'dougongg-model': {
        title: '斗拱拼装模型（基础）',
        type: '3d',
        img: 'images/榫卯套装.png',
        desc: '以中国古建筑斗拱构件为原型的3D打印教学模型，包含斗、拱、昂等基础构件，可直观展示斗拱层层堆叠、榫卯咬合的构造逻辑，帮助理解其承重传力与减震原理，可作为科普教具或桌面摆件。适合12岁以上爱好者使用。',
        material: 'PLA环保塑料',
        spec: '100×100×100mm',
        price: '¥39（单模型）/¥49（含模型+产品说明书）',
        link: 'https://example.com/product/sunmao-kit'
    },
    'dougong-model': {
        title: '斗拱拼装模型（进阶）',
        type: '3d',
        img: 'images/榫卯套装.png',
        desc: '以中国古建筑高阶斗拱为原型打造的3D打印教学模型，完整还原斗拱层叠、榫卯咬合的复杂构造，可直观展示其承重传力与抗震卸力原理，是深入理解古建力学的优质模型，可作为科普教具或桌面摆件。适合12岁以上爱好者使用。',
        material: 'PLA环保塑料',
        spec: '1:2 比例，80×12×85cm',
        price: '¥59（单模型）/¥69（含模型+产品说明书）',
        link: 'https://example.com/product/dougong-model'
    },
'tailiangshigoujia-model': {
        title: '抬梁式构架拼装模型',
        type: '3d',
        img: 'images/榫卯套装.png',
        desc: '以中国古建筑抬梁式构架为原型打造的3D打印教学模型，完整还原“立柱抬梁、梁上叠梁”的核心结构，可直观展示大殿大跨度室内空间的构建逻辑与受力传导路径，可作为科普教具或桌面摆件。适合12岁以上爱好者使用。',
        material: 'PLA环保塑料',
        spec: '37×230×85mm',
        price: '¥49（单模型）/¥59（含模型+产品说明书）',
        link: 'https://example.com/product/dougong-model'
        
    },
    '3Dshouban-model': {
        title: '3D手办',
        type: '3d',
        img: 'images/手办笔筒.png',
        desc: '以中国古建筑抬梁式构架为原型打造的3D打印教学模型，完整还原“立柱抬梁、梁上叠梁”的核心结构，可直观展示大殿大跨度室内空间的构建逻辑与受力传导路径，可作为科普教具或桌面摆件。适合12岁以上爱好者使用。',
        material: 'PLA环保塑料',
        spec: '150×128×170mm',
        price: '¥89（单模型）',
        link: 'https://example.com/product/dougong-model'
        
    },'muxiaohebitong-model': {
        title: '“木小和”笔筒',
        type: '3d',
        img: 'images/手办笔筒.png',
        desc: '以中国古建筑抬梁式构架为原型打造的3D打印教学模型，完整还原“立柱抬梁、梁上叠梁”的核心结构，可直观展示大殿大跨度室内空间的构建逻辑与受力传导路径，可作为科普教具或桌面摆件。适合12岁以上爱好者使用。',
        material: 'PLA环保塑料',
        spec: '150×128×170mm',
        price: '¥89（单模型）',
        link: 'https://example.com/product/dougong-model'
        
    },

    // 平面产品
    'tiezhi': {
        title: '贴纸',
        type: 'flat',
        img: 'images/贴纸产品图.png',
        desc: '以原创IP“木小和”为核心打造的系列趣味贴纸，包含“嗨嗨！”“晚安～”“爱你哟～”“谢谢～”“加油！”“棒棒哒！”等多款日常场景表情，软萌的木质形象搭配治愈文字，可用于手账装饰、笔记本美化、文具DIY、手机壳装饰等，适配多种使用场景。适合6岁以上人群使用。',
        material: '铜版纸',
        spec: '单张贴纸尺寸：约3-5cm（适配手账、笔记本常用规格）整版设计稿尺寸：16cm×10cm',
        price: '¥ 6',
        link: 'https://example.com/product/book'
    },
    'baji': {
        title: '吧唧',
        type: 'flat',
        img: 'images/吧唧产品图.png',
        desc: '以原创IP“木小和”为核心打造的圆形徽章，正面印有软萌木质感的木小和形象，搭配清新装饰元素与互动对话，可用于服饰、背包、手账等装饰，兼具IP纪念意义与日常搭配功能。是本次太和殿古建科普系列的代表性周边单品。适合8岁以上人群使用。',
        material: '马口铁金属底托 + 高清彩印覆膜工艺',
        spec: '直径：85mm',
        price: '¥ 5',
        link: 'https://example.com/product/poster'
    },
    'shoutidai': {
        title: '手提袋',
        type: 'flat',
        img: 'images/手提袋.png',
        desc: '以太和殿古建科普为主题打造的文创手提袋，正面印有“无钉之谜・木头的智慧”主题字样、太和殿主建筑IP形象“木小和”，搭配新中式山水背景与榫卯文化元素，可作为文创周边收纳袋、礼品包装袋使用。兼具纪念意义与实用价值。适合8岁以上人群使用。',
        material: '加厚牛皮纸（挺括耐用，不易变形），搭配同色系纸绳提手',
        spec: '200×110×270mm',
        price: '¥ 16',
        link: 'https://example.com/product/postcard'
    },
    'anzhuangshuomingshu': {
        title: '安装说明书',
        type: 'flat',
        img: 'images/说明书1.png',
        desc: '以太和殿木构体系为核心打造的科普说明书，围绕榫卯、斗拱、抬梁式构架等关键构件展开，搭配结构拆解图、安装步骤说明与学习小贴士，通俗讲解古建抗震原理与营造智慧，兼具知识性与趣味性，可作为科普学习辅助材料或拼装积木配套手册。适合12岁以上爱好者使用。',
        material: '铜版纸全彩印刷',
        spec: '25cm×17.6cm',
        price: '¥ 10',
        link: 'https://example.com/product/postcard'
    }
};
   function openProductPanel(key) {
    const data = productData[key];
    if (!data || !productPanel) return;

    document.getElementById('product-title').textContent = data.title;
    
    // 添加类型标签
    const typeBadge = data.type === '3d' ? '<span class="type-badge type-3d">3D 产品</span>' : '<span class="type-badge type-flat">平面产品</span>';
    document.getElementById('product-title').innerHTML = typeBadge + ' ' + data.title;
    
    const imgContainer = document.getElementById('product-img');
    imgContainer.innerHTML = `<img src="${data.img}" alt="${data.title}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;">`;
    
    document.getElementById('product-desc').textContent = data.desc;
    document.getElementById('product-material').textContent = data.material;
    document.getElementById('product-spec').textContent = data.spec;
    document.getElementById('product-price').textContent = data.price;
    
    const productLink = document.getElementById('product-link');
    if (productLink) {
        productLink.textContent = '🔍 查看大图';
        productLink.onclick = (e) => {
            e.preventDefault();
            openImageZoom(data.img, data.title);
        };
    }

    productPanel.classList.add('active');
    if (productOverlay) productOverlay.classList.add('active');
}

    function closeProductPanel() {
        if (productPanel) productPanel.classList.remove('active');
        if (productOverlay) productOverlay.classList.remove('active');
    }

    productItems.forEach(item => {
        item.addEventListener('click', () => {
            const key = item.getAttribute('data-product');
            openProductPanel(key);
        });
    });

    if (btnCloseProduct) btnCloseProduct.addEventListener('click', closeProductPanel);
    if (productOverlay) productOverlay.addEventListener('click', closeProductPanel);
        // 图片放大查看
    const zoomOverlay = document.getElementById('image-zoom-overlay');
    const zoomImg = document.getElementById('image-zoom-img');
    const zoomCaption = document.getElementById('image-zoom-caption');
    const btnCloseZoom = document.getElementById('btn-close-zoom');

    function openImageZoom(src, caption) {
        if (!zoomOverlay || !zoomImg) return;
        zoomImg.src = src;
        if (zoomCaption) zoomCaption.textContent = caption;
        zoomOverlay.classList.add('active');
    }

    function closeImageZoom() {
        if (zoomOverlay) zoomOverlay.classList.remove('active');
    }

    if (btnCloseZoom) btnCloseZoom.addEventListener('click', closeImageZoom);
    if (zoomOverlay) {
        zoomOverlay.addEventListener('click', (e) => {
            if (e.target === zoomOverlay) closeImageZoom();
        });
    }

    // ESC 键关闭图片放大
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeImageZoom();
            closeProductPanel();
        }
    });
        // 移动端侧边栏切换
    const btnMenuToggle = document.getElementById('btn-menu-toggle');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');

    function openSidebar() {
        if (sidebar) sidebar.classList.add('active');
        if (sidebarOverlay) sidebarOverlay.classList.add('active');
    }

    function closeSidebar() {
        if (sidebar) sidebar.classList.remove('active');
        if (sidebarOverlay) sidebarOverlay.classList.remove('active');
    }

    if (btnMenuToggle) {
        btnMenuToggle.addEventListener('click', () => {
            if (sidebar && sidebar.classList.contains('active')) {
                closeSidebar();
            } else {
                openSidebar();
            }
        });
    }

    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', closeSidebar);
    }

    // 点击侧边栏内的菜单项后自动关闭（移动端）
    if (sidebar) {
        sidebar.querySelectorAll('.menu-btn, .mode-btn, .product-item').forEach(item => {
            item.addEventListener('click', () => {
                if (window.innerWidth <= 768) {
                    closeSidebar();
                }
            });
        });
    }
}

// 【插入到这里】使用指南函数
function initGuide() {
    const overlay = document.getElementById('guide-overlay');
    const btnClose = document.getElementById('btn-close-guide');
    const btnStart = document.getElementById('btn-start-use');
    const btnHelp = document.getElementById('btn-help');
    const checkbox = document.getElementById('guide-never-show');

    if (!overlay) return;

    // 检查本地存储
    const neverShow = localStorage.getItem('guideNeverShow');
    if (neverShow === 'true') {
        overlay.classList.add('hidden');
    }

    function closeGuide() {
        overlay.classList.add('hidden');
        if (checkbox && checkbox.checked) {
            localStorage.setItem('guideNeverShow', 'true');
        }
    }

    if (btnClose) btnClose.addEventListener('click', closeGuide);
    if (btnStart) btnStart.addEventListener('click', closeGuide);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeGuide();
    });

    if (btnHelp) {
        btnHelp.addEventListener('click', () => {
            overlay.classList.remove('hidden');
            if (checkbox) checkbox.checked = false;
        });
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !overlay.classList.contains('hidden')) {
            closeGuide();
        }
    });
}

// --- 鼠标点击交互 ---
function onMouseClick(event) {
    // 忽略对 UI 的点击
    if (event.target.closest('#ui-layer')) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(hotspots);
    if (intersects.length > 0) {
        const data = intersects[0].object.userData;
        showTooltip(data.title, data.text, event.clientX, event.clientY);
    } else {
        hideTooltip();
    }
}

function onMouseHover(event) {
    // 忽略 UI 层上的鼠标移动
    if (event.target.closest('#ui-layer')) {
        clearHover();
        return;
    }

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const hits = raycaster.intersectObjects(currentModelGroup ? [currentModelGroup] : [], true);

    if (hits.length > 0) {
        const obj = hits[0].object;
        
        // 排除热点：只变光标，不高亮
        if (obj.userData && obj.userData.isHotspot) {
            clearHover();
            document.body.style.cursor = 'pointer';
            return;
        }
        
        if (obj.isMesh && hoveredObj !== obj) {
            clearHover(); // 先安全恢复上一个
            
            if (!obj.material) {
                document.body.style.cursor = 'default';
                return;
            }
            
            hoveredObj = obj;
            
            // 处理多材质（材质数组）—— 某些模型一个构件有多层贴图
            if (Array.isArray(obj.material)) {
                originalMat = obj.material.slice(); // 保存原始数组
                obj.material = obj.material.map(m => {
                    const clone = m.clone();
                    // ✅ 只有支持 emissive 的材质才设置发光
                    if ('emissive' in clone) {
                        clone.emissive = new THREE.Color(0x444444);
                    }
                    return clone;
                });
            } else {
                originalMat = obj.material;
                obj.material = obj.material.clone();
                // ✅ 安全设置：先判断属性是否存在
                if ('emissive' in obj.material) {
                    obj.material.emissive = new THREE.Color(0x444444);
                }
            }
            document.body.style.cursor = 'pointer';
        }
    } else {
        clearHover();
        document.body.style.cursor = 'default';
    }
}

// 【新增】安全清除高亮，防止材质泄漏
function clearHover() {
    if (!hoveredObj || !originalMat) return;
    
    if (Array.isArray(originalMat)) {
        hoveredObj.material.forEach(m => m.dispose());
        hoveredObj.material = originalMat;
    } else {
        hoveredObj.material.dispose();
        hoveredObj.material = originalMat;
    }
    hoveredObj = null;
    originalMat = null;
}
// --- Tooltip 提示框逻辑（增加边界检测）---
function showTooltip(title, text, x, y) {
    let tooltip = document.getElementById('tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'tooltip';
        tooltip.style.cssText = `
            position: fixed;
            background: rgba(0,0,0,0.9);
            color: #fff;
            padding: 12px 15px;
            border-radius: 8px;
            pointer-events: none;
            z-index: 100;
            border: 1px solid #d4af37;
            font-size: 14px;
            line-height: 1.5;
            max-width: 260px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        `;
        document.body.appendChild(tooltip);
    }
    tooltip.innerHTML = `<strong style="color:#d4af37">${title}</strong><br>${text}`;
    
    // 先设置内容，获取尺寸后再调整位置
    tooltip.style.display = 'block';
    tooltip.style.left = '0px';
    tooltip.style.top = '0px';
    
    const rect = tooltip.getBoundingClientRect();
    let left = x + 15;
    let top = y + 15;

    // 右边界检测
    if (left + rect.width > window.innerWidth) {
        left = x - rect.width - 10;
    }
    // 下边界检测
    if (top + rect.height > window.innerHeight) {
        top = y - rect.height - 10;
    }

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
}

function hideTooltip() {
    const tooltip = document.getElementById('tooltip');
    if (tooltip) tooltip.style.display = 'none';
}

// --- 窗口自适应 ---
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- 动画循环（已修复重复定义问题）---
function animate(time) {
    requestAnimationFrame(animate);

    // 更新 TWEEN 引擎
    if (TWEEN) {
        TWEEN.update(time);
    }

    controls.update();

    // 热点呼吸灯效果
    const timeNow = Date.now() * 0.002;
    hotspots.forEach((h, index) => {
        const scale = 1 + Math.sin(timeNow + index) * 0.2;
        h.scale.set(scale, scale, scale);
    });

    renderer.render(scene, camera);
}

// 启动程序
init();