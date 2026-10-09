"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Skeleton } from "@/components/Skeleton";
import { apiService } from "@/services/api";
import {
  DIGITAL_TWIN_MACHINES_CHANGED_EVENT,
  DIGITAL_TWIN_MACHINES_CHANGED_STORAGE_KEY,
} from "@/services/digitalTwinMachines";
import { fetchAllPaginated } from "@/services/pagination";
import { useAuth } from "@/contexts/AuthContext";

type TwinStatus = "running" | "stopped" | "fault" | "offline";
type TwinFloor = "first" | "second";
type FactoryViewMode = "complete" | "first" | "second";
type MachineSort = "name" | "floor";

type MachineRecord = {
  _id: string;
  machine_id: string;
  fabricant?: string;
  model?: string;
  location?: string;
  status?: string;
};

type TwinMachine = {
  id: string;
  name: string;
  backendMachineId: string | null;
  assetUrl: string | null;
  floor: TwinFloor;
  position: [number, number, number];
  rotationY: number;
  targetSize: number;
  status: TwinStatus;
  location: string;
  health: number;
  manufacturer?: string;
  model?: string;
  simulatedMetrics: {
    temperatureC: number;
    vibrationMms: number;
    loadPercent: number;
    availabilityPercent: number;
  };
  lastUpdate: string;
};

type FactoryCanvasProps = {
  machines: TwinMachine[];
  selectedId: string;
  viewMode: FactoryViewMode;
  resetCameraTick: number;
  editingLayout: boolean;
  snapToGrid: boolean;
  onSelect: (machine: TwinMachine) => void;
  onPositionChange: (machineId: string, position: [number, number, number]) => void;
  onPositionSwap: (
    draggedMachineId: string,
    targetMachineId: string,
    draggedStartPosition: [number, number, number],
    targetPosition: [number, number, number],
  ) => void;
  onLoaded: () => void;
  onError: (message: string) => void;
};

const FLOOR_HEIGHT = 2.7;
const FACTORY_WIDTH = 12;
const FACTORY_DEPTH = 7;
const FACTORY_LAYOUT_STORAGE_KEY = "iprotex:digital-twin-layout:v1";

type StoredMachinePlacement = {
  position: [number, number, number];
  rotationY: number;
};

function readStoredPlacements(): Record<string, StoredMachinePlacement> {
  if (typeof window === "undefined") return {};
  try {
    const rawLayout = window.localStorage.getItem(FACTORY_LAYOUT_STORAGE_KEY);
    return rawLayout
      ? (JSON.parse(rawLayout) as Record<string, StoredMachinePlacement>)
      : {};
  } catch {
    window.localStorage.removeItem(FACTORY_LAYOUT_STORAGE_KEY);
    return {};
  }
}

const floorViewOptions: Array<{ key: FactoryViewMode; label: string }> = [
  { key: "complete", label: "Complete Factory" },
  { key: "first", label: "First Floor" },
  { key: "second", label: "Second Floor" },
];

const cameraViews: Record<FactoryViewMode, { position: THREE.Vector3Tuple; target: THREE.Vector3Tuple }> = {
  complete: {
    position: [8.2, 5.4, 8.5],
    target: [0, 1.25, 0],
  },
  first: {
    position: [7.2, 3.1, 6.4],
    target: [0, 0.45, 0.15],
  },
  second: {
    position: [7.1, 5.9, 5.8],
    target: [0, FLOOR_HEIGHT + 0.45, 0.05],
  },
};

const firstFloorAssetMachines: TwinMachine[] = [
  {
    id: "asset-harry-lucas-rv4s",
    name: "Harry Lucas RV-4s",
    backendMachineId: null,
    assetUrl: "/models/machine-a.glb",
    floor: "first",
    position: [-2.8, 0, 0.9],
    rotationY: Math.PI / 7,
    targetSize: 1.45,
    status: "running",
    location: "First Floor - modeled machine bay",
    health: 92,
    manufacturer: "Modeled asset",
    simulatedMetrics: {
      temperatureC: 41.8,
      vibrationMms: 1.2,
      loadPercent: 72,
      availabilityPercent: 96,
    },
    lastUpdate: "First floor 3D asset - simulated live state",
  },
  {
    id: "asset-pw800",
    name: "PW800",
    backendMachineId: null,
    assetUrl: "/models/machine-b.glb",
    floor: "first",
    position: [2.6, 0, 0.55],
    rotationY: -Math.PI / 8,
    targetSize: 1.45,
    status: "running",
    location: "First Floor - modeled machine bay",
    health: 89,
    manufacturer: "Modeled asset",
    simulatedMetrics: {
      temperatureC: 44.2,
      vibrationMms: 1.5,
      loadPercent: 68,
      availabilityPercent: 94,
    },
    lastUpdate: "First floor 3D asset - simulated live state",
  },
];

const statusStyle: Record<TwinStatus, { label: string; color: string; bg: string }> = {
  running: { label: "Running", color: "#16a34a", bg: "bg-green-100 text-green-800" },
  stopped: { label: "Stopped", color: "#f59e0b", bg: "bg-amber-100 text-amber-800" },
  fault: { label: "Fault", color: "#dc2626", bg: "bg-red-100 text-red-800" },
  offline: { label: "Offline", color: "#64748b", bg: "bg-slate-100 text-slate-700" },
};

const simulatedMetricsByStatus: Record<TwinStatus, TwinMachine["simulatedMetrics"]> = {
  running: {
    temperatureC: 42.6,
    vibrationMms: 1.3,
    loadPercent: 74,
    availabilityPercent: 96,
  },
  stopped: {
    temperatureC: 27.4,
    vibrationMms: 0.1,
    loadPercent: 0,
    availabilityPercent: 88,
  },
  fault: {
    temperatureC: 69.2,
    vibrationMms: 5.8,
    loadPercent: 28,
    availabilityPercent: 63,
  },
  offline: {
    temperatureC: 0,
    vibrationMms: 0,
    loadPercent: 0,
    availabilityPercent: 0,
  },
};

const healthByStatus: Record<TwinStatus, number> = {
  running: 92,
  stopped: 78,
  fault: 41,
  offline: 0,
};

const stateMessageByStatus: Record<TwinStatus, string> = {
  running: "Normal operation",
  stopped: "Planned stop",
  fault: "Fault scenario",
  offline: "Disconnected",
};

function toTwinStatus(status?: string): TwinStatus {
  if (status === "maintenance") return "stopped";
  if (status === "out_of_service" || status === "retired") return "offline";
  return "running";
}

function floorFromLocation(location?: string): TwinFloor | null {
  const normalized = location?.trim().toLowerCase() ?? "";
  if (/\b(first|1st|floor 1|level 1|ground)\b/.test(normalized)) {
    return "first";
  }
  if (/\b(second|2nd|floor 2|level 2)\b/.test(normalized)) {
    return "second";
  }
  return null;
}

function toFactoryMachine(
  record: MachineRecord,
  index: number,
  totalMachines: number,
  floor: TwinFloor,
): TwinMachine {
  const usableWidth = FACTORY_WIDTH - 1.8;
  const usableDepth = FACTORY_DEPTH - 1.6;
  const columns = Math.max(
    1,
    Math.min(
      totalMachines,
      Math.ceil(
        Math.sqrt(totalMachines * (usableWidth / usableDepth)),
      ),
    ),
  );
  const rows = Math.max(1, Math.ceil(totalMachines / columns));
  const spacingX = columns > 1 ? usableWidth / (columns - 1) : 0;
  const spacingZ = rows > 1 ? usableDepth / (rows - 1) : 0;
  const row = Math.floor(index / columns);
  const column = index % columns;
  const status = toTwinStatus(record.status);
  const targetSize = Math.max(
    0.45,
    Math.min(1, Math.min(spacingX || 1, spacingZ || 1) * 0.62),
  );

  return {
    id: `machine-${record._id}`,
    name: record.machine_id || `Machine ${index + 1}`,
    backendMachineId: record._id,
    assetUrl: null,
    floor,
    position: [
      columns > 1 ? -usableWidth / 2 + column * spacingX : 0,
      floor === "second" ? FLOOR_HEIGHT : 0,
      rows > 1 ? -usableDepth / 2 + row * spacingZ : 0,
    ],
    rotationY: column % 2 === 0 ? Math.PI / 2 : -Math.PI / 2,
    targetSize,
    status,
    location:
      record.location || (floor === "first" ? "First Floor" : "Second Floor"),
    health: healthByStatus[status],
    manufacturer: record.fabricant,
    model: record.model,
    simulatedMetrics: simulatedMetricsByStatus[status],
    lastUpdate: "Machine-table placeholder - 3D asset not available yet",
  };
}

function fitObjectToSize(object: THREE.Object3D, targetSize: number) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z);
  if (maxDimension > 0) {
    object.scale.multiplyScalar(targetSize / maxDimension);
  }

  const fittedBox = new THREE.Box3().setFromObject(object);
  const center = fittedBox.getCenter(new THREE.Vector3());
  object.position.sub(center);
  object.position.y -= fittedBox.min.y - center.y;
}

function createStatusRing(machine: TwinMachine) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.74, 0.022, 12, 72),
    new THREE.MeshStandardMaterial({
      color: statusStyle[machine.status].color,
      emissive: statusStyle[machine.status].color,
      emissiveIntensity: 0.35,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.035;
  ring.name = "status-ring";
  return ring;
}

function createSelectionRing() {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.9, 0.032, 12, 72),
    new THREE.MeshStandardMaterial({
      color: "#2563eb",
      emissive: "#2563eb",
      emissiveIntensity: 0.45,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.065;
  return ring;
}

function createLabelSprite(text: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.Sprite();

  context.fillStyle = "rgba(15, 23, 42, 0.86)";
  context.roundRect(8, 20, 496, 88, 18);
  context.fill();
  context.font = "700 38px Arial";
  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text.slice(0, 22), 256, 64, 460);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true }),
  );
  sprite.scale.set(1.7, 0.42, 1);
  sprite.position.y = 1.15;
  return sprite;
}

function createPlaceholderMachine(machine: TwinMachine) {
  const group = new THREE.Group();
  group.name = machine.id;
  group.userData.machineId = machine.id;
  group.position.set(...machine.position);
  group.rotation.y = machine.rotationY;

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.72, 0.42, 0.56),
    new THREE.MeshStandardMaterial({
      color: "#c7d2fe",
      metalness: 0.15,
      roughness: 0.55,
    }),
  );
  body.position.y = 0.23;
  body.castShadow = true;
  body.receiveShadow = true;

  const top = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.16, 0.36),
    new THREE.MeshStandardMaterial({ color: "#64748b", roughness: 0.6 }),
  );
  top.position.y = 0.52;
  top.castShadow = true;

  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.24, 0.3),
    new THREE.MeshStandardMaterial({
      color: statusStyle[machine.status].color,
      emissive: statusStyle[machine.status].color,
      emissiveIntensity: 0.2,
    }),
  );
  panel.position.set(0.38, 0.29, 0);
  panel.name = "status-panel";

  const label = createLabelSprite(machine.name);
  label.scale.set(1.05, 0.26, 1);
  label.position.y = 0.78;

  group.add(body, top, panel, createStatusRing(machine), label);
  group.scale.setScalar(machine.targetSize);
  return group;
}

function createMachineGroup(machine: TwinMachine, gltf: GLTF) {
  const group = new THREE.Group();
  group.name = machine.id;
  group.userData.machineId = machine.id;
  group.position.set(...machine.position);
  group.rotation.y = machine.rotationY;

  const model = gltf.scene.clone(true);
  fitObjectToSize(model, machine.targetSize);
  model.traverse((child) => {
    child.userData.machineId = machine.id;
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  group.add(model, createStatusRing(machine), createLabelSprite(machine.name));
  return group;
}

async function loadMachineGroup(loader: GLTFLoader, machine: TwinMachine, isDisposed: () => boolean) {
  if (!machine.assetUrl) {
    return isDisposed() ? null : createPlaceholderMachine(machine);
  }

  const gltf = await loader.loadAsync(machine.assetUrl);
  return isDisposed() ? null : createMachineGroup(machine, gltf);
}

function createFloorLabel(text: string, position: THREE.Vector3) {
  const sprite = createLabelSprite(text);
  sprite.position.copy(position);
  sprite.scale.set(2.3, 0.55, 1);
  return sprite;
}

function createFactoryStructure(scene: THREE.Scene) {
  const firstFloorGroup = new THREE.Group();
  const secondFloorGroup = new THREE.Group();
  const sharedGroup = new THREE.Group();
  firstFloorGroup.name = "first-floor-structure";
  secondFloorGroup.name = "second-floor-structure";
  sharedGroup.name = "shared-factory-structure";
  scene.add(firstFloorGroup, secondFloorGroup, sharedGroup);

  const slabMaterial = new THREE.MeshStandardMaterial({
    color: "#e2e8f0",
    roughness: 0.82,
    metalness: 0.05,
  });
  const edgeMaterial = new THREE.MeshStandardMaterial({ color: "#475569" });
  const railMaterial = new THREE.MeshStandardMaterial({ color: "#2563eb" });

  const createSlab = (y: number, label: string, group: THREE.Group) => {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(FACTORY_WIDTH, 0.12, FACTORY_DEPTH),
      slabMaterial,
    );
    slab.position.y = y - 0.06;
    slab.receiveShadow = true;
    group.add(slab);

    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(FACTORY_WIDTH + 0.1, 0.16, FACTORY_DEPTH + 0.1),
      edgeMaterial,
    );
    edge.position.y = y - 0.13;
    edge.scale.y = 0.35;
    group.add(edge);
    group.add(createFloorLabel(label, new THREE.Vector3(-4.25, y + 0.45, -3.08)));
  };

  createSlab(0, "First Floor", firstFloorGroup);
  createSlab(FLOOR_HEIGHT, "Second Floor", secondFloorGroup);

  for (const x of [-5.7, -1.9, 1.9, 5.7]) {
    for (const z of [-3.2, 3.2]) {
      const column = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, FLOOR_HEIGHT, 0.16),
        edgeMaterial,
      );
      column.position.set(x, FLOOR_HEIGHT / 2, z);
      column.castShadow = true;
      sharedGroup.add(column);
    }
  }

  for (const z of [-3.25, 3.25]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(FACTORY_WIDTH, 0.08, 0.08),
      railMaterial,
    );
    rail.position.set(0, FLOOR_HEIGHT + 0.55, z);
    secondFloorGroup.add(rail);
  }

  const stairs = new THREE.Group();
  for (let i = 0; i < 9; i += 1) {
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 0.12, 0.42),
      new THREE.MeshStandardMaterial({ color: "#94a3b8", roughness: 0.7 }),
    );
    step.position.set(-5.15 + i * 0.35, i * (FLOOR_HEIGHT / 9), 3.55 - i * 0.32);
    stairs.add(step);
  }
  sharedGroup.add(stairs);

  const firstGrid = new THREE.GridHelper(FACTORY_WIDTH, 18, "#64748b", "#cbd5e1");
  firstGrid.position.y = 0.004;
  firstFloorGroup.add(firstGrid);

  const secondGrid = new THREE.GridHelper(FACTORY_WIDTH, 18, "#475569", "#bfdbfe");
  secondGrid.position.y = FLOOR_HEIGHT + 0.004;
  secondFloorGroup.add(secondGrid);

  return { firstFloorGroup, secondFloorGroup, sharedGroup };
}

function FactoryCanvas({
  machines,
  selectedId,
  viewMode,
  resetCameraTick,
  editingLayout,
  snapToGrid,
  onSelect,
  onPositionChange,
  onPositionSwap,
  onLoaded,
  onError,
}: Readonly<FactoryCanvasProps>) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const machinesRef = useRef(machines);
  const selectedIdRef = useRef(selectedId);
  const viewModeRef = useRef(viewMode);
  const resetCameraTickRef = useRef(resetCameraTick);
  const onSelectRef = useRef(onSelect);
  const editingLayoutRef = useRef(editingLayout);
  const snapToGridRef = useRef(snapToGrid);
  const onPositionChangeRef = useRef(onPositionChange);
  const onPositionSwapRef = useRef(onPositionSwap);
  const onLoadedRef = useRef(onLoaded);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    machinesRef.current = machines;
  }, [machines]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    resetCameraTickRef.current = resetCameraTick;
  }, [resetCameraTick]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    editingLayoutRef.current = editingLayout;
  }, [editingLayout]);

  useEffect(() => {
    snapToGridRef.current = snapToGrid;
  }, [snapToGrid]);

  useEffect(() => {
    onPositionChangeRef.current = onPositionChange;
  }, [onPositionChange]);

  useEffect(() => {
    onPositionSwapRef.current = onPositionSwap;
  }, [onPositionSwap]);

  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const syncSceneTheme = () => {
      const isDark = document.documentElement.dataset.theme === "dark";
      scene.background = new THREE.Color(isDark ? "#07101f" : "#f8fafc");
    };
    syncSceneTheme();
    const themeObserver = new MutationObserver(syncSceneTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.fromArray(cameraViews.complete.position);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 4;
    controls.maxDistance = 17;
    controls.maxPolarAngle = Math.PI / 2.04;
    controls.target.fromArray(cameraViews.complete.target);

    scene.add(new THREE.AmbientLight("#ffffff", 1.25));
    const mainLight = new THREE.DirectionalLight("#ffffff", 2.4);
    mainLight.position.set(3.5, 8, 4.5);
    mainLight.castShadow = true;
    mainLight.shadow.camera.near = 0.5;
    mainLight.shadow.camera.far = 18;
    scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight("#dbeafe", 0.8);
    fillLight.position.set(-4, 5, -4);
    scene.add(fillLight);

    const factoryGroups = createFactoryStructure(scene);

    const machineGroups = new Map<string, THREE.Group>();
    const selectionRing = createSelectionRing();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const loader = new GLTFLoader();
    let disposed = false;
    let frame = 0;
    let activeViewMode: FactoryViewMode | null = null;
    let activeResetCameraTick = resetCameraTickRef.current;
    let draggedMachineId: string | null = null;
    let draggedStartPosition: [number, number, number] | null = null;
    const dragPlane = new THREE.Plane();
    const dragPoint = new THREE.Vector3();

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const updateSelection = () => {
      const selectedGroup = machineGroups.get(selectedIdRef.current);
      if (selectedGroup && selectionRing.parent !== selectedGroup) {
        selectedGroup.add(selectionRing);
      }
    };

    const updateStatusIndicators = () => {
      machinesRef.current.forEach((machine) => {
        const group = machineGroups.get(machine.id);
        for (const name of ["status-ring", "status-panel"]) {
          const item = group?.getObjectByName(name);
          const material = item instanceof THREE.Mesh ? item.material : null;
          if (!(material instanceof THREE.MeshStandardMaterial)) continue;

          const nextColor = statusStyle[machine.status].color;
          material.color.set(nextColor);
          material.emissive.set(nextColor);
        }
      });
    };

    const updateMachineTransforms = () => {
      machinesRef.current.forEach((machine) => {
        const group = machineGroups.get(machine.id);
        if (!group || group.userData.dragging) return;
        group.position.fromArray(machine.position);
        group.rotation.y = machine.rotationY;
      });
    };

    const applyViewMode = (forceCameraReset = false) => {
      const nextMode = viewModeRef.current;
      const modeChanged = nextMode !== activeViewMode;
      if (!modeChanged && !forceCameraReset) return;

      factoryGroups.firstFloorGroup.visible = nextMode !== "second";
      factoryGroups.secondFloorGroup.visible = nextMode !== "first";
      factoryGroups.sharedGroup.visible = nextMode === "complete";

      machinesRef.current.forEach((machine) => {
        const group = machineGroups.get(machine.id);
        if (!group) return;
        group.visible = nextMode === "complete" || machine.floor === nextMode;
      });

      const cameraView = cameraViews[nextMode];
      camera.position.fromArray(cameraView.position);
      controls.target.fromArray(cameraView.target);
      controls.update();
      activeViewMode = nextMode;
    };

    const loadMachines = async () => {
      try {
        const groups = await Promise.all(
          machinesRef.current.map((machine) => loadMachineGroup(loader, machine, () => disposed)),
        );
        groups.forEach((group) => {
          if (!group) return;
          scene.add(group);
          machineGroups.set(group.userData.machineId, group);
        });
        applyViewMode(true);
        updateSelection();
        onLoadedRef.current();
      } catch (error) {
        onErrorRef.current(error instanceof Error ? error.message : "Unable to load digital twin assets");
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const visibleGroups = Array.from(machineGroups.values()).filter((group) => group.visible);
      const intersects = raycaster.intersectObjects(visibleGroups, true);
      const machineId = intersects
        .map((hit) => {
          let object: THREE.Object3D | null = hit.object;
          while (object) {
            if (typeof object.userData.machineId === "string") {
              return object.userData.machineId as string;
            }
            object = object.parent;
          }
          return undefined;
        })
        .find((value): value is string => typeof value === "string");
      const machine = machinesRef.current.find((item) => item.id === machineId);
      if (!machine) return;
      onSelectRef.current(machine);
      if (!editingLayoutRef.current) return;

      draggedMachineId = machine.id;
      draggedStartPosition = [...machine.position];
      const group = machineGroups.get(machine.id);
      if (group) group.userData.dragging = true;
      dragPlane.set(new THREE.Vector3(0, 1, 0), -machine.position[1]);
      controls.enabled = false;
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!draggedMachineId) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;

      const machine = machinesRef.current.find(
        (item) => item.id === draggedMachineId,
      );
      if (!machine) return;
      const gridSize = snapToGridRef.current ? 0.5 : 0.05;
      const snap = (value: number) => Math.round(value / gridSize) * gridSize;
      const x = snap(THREE.MathUtils.clamp(dragPoint.x, -5.2, 5.2));
      const z = snap(THREE.MathUtils.clamp(dragPoint.z, -2.9, 2.9));
      const position: [number, number, number] = [x, machine.position[1], z];
      const group = machineGroups.get(machine.id);
      if (group) group.position.fromArray(position);
      onPositionChangeRef.current(machine.id, position);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!draggedMachineId) return;
      const finishedMachineId = draggedMachineId;
      const group = machineGroups.get(finishedMachineId);
      if (group) group.userData.dragging = false;
      const draggedMachine = machinesRef.current.find(
        (machine) => machine.id === finishedMachineId,
      );
      const dropPosition = group
        ? ([group.position.x, group.position.y, group.position.z] as [
            number,
            number,
            number,
          ])
        : draggedMachine?.position;
      const swapTarget =
        draggedMachine && dropPosition
          ? machinesRef.current
              .filter(
                (machine) =>
                  machine.id !== finishedMachineId &&
                  machine.floor === draggedMachine.floor,
              )
              .map((machine) => ({
                machine,
                distance: Math.hypot(
                  machine.position[0] - dropPosition[0],
                  machine.position[2] - dropPosition[2],
                ),
              }))
              .filter(
                ({ machine, distance }) =>
                  distance <=
                  Math.max(
                    0.75,
                    (draggedMachine.targetSize + machine.targetSize) * 0.45,
                  ),
              )
              .sort((left, right) => left.distance - right.distance)[0]?.machine
          : undefined;

      if (swapTarget && draggedStartPosition) {
        const targetPosition: [number, number, number] = [
          ...swapTarget.position,
        ];
        group?.position.fromArray(targetPosition);
        machineGroups.get(swapTarget.id)?.position.fromArray(draggedStartPosition);
        onPositionSwapRef.current(
          finishedMachineId,
          swapTarget.id,
          draggedStartPosition,
          targetPosition,
        );
      }
      draggedMachineId = null;
      draggedStartPosition = null;
      controls.enabled = true;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    };

    const animate = () => {
      const resetCameraRequested = resetCameraTickRef.current !== activeResetCameraTick;
      if (resetCameraRequested) activeResetCameraTick = resetCameraTickRef.current;
      applyViewMode(resetCameraRequested);
      controls.update();
      updateSelection();
      updateStatusIndicators();
      updateMachineTransforms();
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    };

    resize();
    window.addEventListener("resize", resize);
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointercancel", handlePointerUp);
    void loadMachines();
    animate();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointercancel", handlePointerUp);
      controls.dispose();
      themeObserver.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} className="absolute inset-0" />;
}

function mergeInventoryMachines(
  rows: MachineRecord[],
  currentMachines: TwinMachine[],
): TwinMachine[] {
  const assignedRows: Record<TwinFloor, MachineRecord[]> = {
    first: [],
    second: [],
  };

  rows.forEach((row) => {
    const explicitFloor = floorFromLocation(row.location);
    const fallbackFloor =
      assignedRows.first.length + firstFloorAssetMachines.length <=
      assignedRows.second.length
        ? "first"
        : "second";
    assignedRows[explicitFloor ?? fallbackFloor].push(row);
  });

  const inventoryMachines = (["first", "second"] as const).flatMap((floor) =>
    assignedRows[floor].map((row, index) =>
      toFactoryMachine(row, index, assignedRows[floor].length, floor),
    ),
  );
  const storedPlacements = readStoredPlacements();
  return [...firstFloorAssetMachines, ...inventoryMachines].map((machine) => {
    const currentMachine = currentMachines.find(
      (candidate) => candidate.id === machine.id,
    );
    const placement = currentMachine ?? storedPlacements[machine.id];
    return placement
      ? {
          ...machine,
          position: placement.position,
          rotationY: placement.rotationY,
        }
      : machine;
  });
}

function applyStoredMachinePlacements(machines: TwinMachine[]): TwinMachine[] {
  const placements = readStoredPlacements();
  return machines.map((machine) => {
    const placement = placements[machine.id];
    return placement
      ? {
          ...machine,
          position: placement.position,
          rotationY: placement.rotationY,
        }
      : machine;
  });
}

export default function FactoryTwinScene() {
  const { user } = useAuth();
  const canEditLayout = user?.role === "admin";
  const [machines, setMachines] = useState<TwinMachine[]>(firstFloorAssetMachines);
  const [selectedMachineId, setSelectedMachineId] = useState(firstFloorAssetMachines[0].id);
  const [viewMode, setViewMode] = useState<FactoryViewMode>("complete");
  const [machineSort, setMachineSort] = useState<MachineSort>("name");
  const [inspectedMachineIds, setInspectedMachineIds] = useState<Set<string>>(
    () => new Set([firstFloorAssetMachines[0].id]),
  );
  const [resetCameraTick, setResetCameraTick] = useState(0);
  const [editingLayout, setEditingLayout] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const layoutBeforeEditRef = useRef<TwinMachine[] | null>(null);

  useEffect(() => {
    setMachines(applyStoredMachinePlacements);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let refreshInProgress = false;

    async function loadMachineTable() {
      if (refreshInProgress) return;
      refreshInProgress = true;

      try {
        const rows = await fetchAllPaginated<MachineRecord>(
          (params) => apiService.getMachines(params),
          100,
        );
        if (cancelled) return;

        setMachines((currentMachines) =>
          mergeInventoryMachines(rows, currentMachines),
        );
      } catch (loadError) {
        console.error("Unable to load IPROTEX machine table for digital twin:", loadError);
      } finally {
        refreshInProgress = false;
      }
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadMachineTable();
    };

    const refreshFromStorage = (event: StorageEvent) => {
      if (event.key === DIGITAL_TWIN_MACHINES_CHANGED_STORAGE_KEY) {
        void loadMachineTable();
      }
    };

    void loadMachineTable();
    const refreshInterval = window.setInterval(() => void loadMachineTable(), 10_000);
    window.addEventListener(DIGITAL_TWIN_MACHINES_CHANGED_EVENT, loadMachineTable);
    window.addEventListener("storage", refreshFromStorage);
    window.addEventListener("focus", loadMachineTable);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      cancelled = true;
      window.clearInterval(refreshInterval);
      window.removeEventListener(DIGITAL_TWIN_MACHINES_CHANGED_EVENT, loadMachineTable);
      window.removeEventListener("storage", refreshFromStorage);
      window.removeEventListener("focus", loadMachineTable);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  const selectedMachine =
    machines.find((machine) => machine.id === selectedMachineId) ?? machines[0];

  useEffect(() => {
    if (viewMode === "complete") return;

    const selectedMachineIsVisible = selectedMachine?.floor === viewMode;
    if (selectedMachineIsVisible) return;

    const nextMachine = machines.find((machine) => machine.floor === viewMode);
    if (nextMachine) setSelectedMachineId(nextMachine.id);
  }, [machines, selectedMachine, viewMode]);

  const floorCounts = useMemo(
    () => ({
      first: machines.filter((machine) => machine.floor === "first").length,
      second: machines.filter((machine) => machine.floor === "second").length,
    }),
    [machines],
  );

  const sortedMachines = useMemo(() => {
    return [...machines].sort((left, right) => {
      if (machineSort === "floor") {
        const floorComparison = left.floor.localeCompare(right.floor);
        if (floorComparison !== 0) return floorComparison;
      }

      return left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
  }, [machineSort, machines]);

  const inspectedCount = useMemo(
    () => machines.filter((machine) => inspectedMachineIds.has(machine.id)).length,
    [inspectedMachineIds, machines],
  );
  const inspectionProgress = machines.length
    ? Math.round((inspectedCount / machines.length) * 100)
    : 0;
  const firstFloorInspected = machines.some(
    (machine) =>
      machine.floor === "first" && inspectedMachineIds.has(machine.id),
  );
  const secondFloorInspected = machines.some(
    (machine) =>
      machine.floor === "second" && inspectedMachineIds.has(machine.id),
  );
  const nextUninspectedMachine = sortedMachines.find(
    (machine) => !inspectedMachineIds.has(machine.id),
  );

  const inspectMachine = (machine: TwinMachine) => {
    setSelectedMachineId(machine.id);
    setInspectedMachineIds((currentIds) => {
      if (currentIds.has(machine.id)) return currentIds;
      const nextIds = new Set(currentIds);
      nextIds.add(machine.id);
      return nextIds;
    });
  };

  const updateMachinePosition = (
    machineId: string,
    position: [number, number, number],
  ) => {
    setMachines((currentMachines) =>
      currentMachines.map((machine) =>
        machine.id === machineId ? { ...machine, position } : machine,
      ),
    );
  };

  const swapMachinePositions = (
    draggedMachineId: string,
    targetMachineId: string,
    draggedStartPosition: [number, number, number],
    targetPosition: [number, number, number],
  ) => {
    setMachines((currentMachines) =>
      currentMachines.map((machine) => {
        if (machine.id === draggedMachineId) {
          return { ...machine, position: targetPosition };
        }
        if (machine.id === targetMachineId) {
          return { ...machine, position: draggedStartPosition };
        }
        return machine;
      }),
    );
  };

  const rotateSelectedMachine = (degrees: number) => {
    const radians = THREE.MathUtils.degToRad(degrees);
    setMachines((currentMachines) =>
      currentMachines.map((machine) =>
        machine.id === selectedMachineId
          ? { ...machine, rotationY: machine.rotationY + radians }
          : machine,
      ),
    );
  };

  const beginLayoutEditing = () => {
    layoutBeforeEditRef.current = machines.map((machine) => ({ ...machine }));
    setEditingLayout(true);
  };

  const cancelLayoutEditing = () => {
    if (layoutBeforeEditRef.current) {
      setMachines(layoutBeforeEditRef.current);
    }
    layoutBeforeEditRef.current = null;
    setEditingLayout(false);
  };

  const saveLayout = () => {
    const placements = Object.fromEntries(
      machines.map((machine) => [
        machine.id,
        { position: machine.position, rotationY: machine.rotationY },
      ]),
    );
    window.localStorage.setItem(
      FACTORY_LAYOUT_STORAGE_KEY,
      JSON.stringify(placements),
    );
    layoutBeforeEditRef.current = null;
    setEditingLayout(false);
  };

  const sceneKey = machines.map((machine) => machine.id).join("|");

  const updateSelectedMachineStatus = (status: TwinStatus) => {
    setMachines((currentMachines) =>
      currentMachines.map((machine) =>
        machine.id === selectedMachineId
          ? {
              ...machine,
              status,
              health: healthByStatus[status],
              simulatedMetrics: simulatedMetricsByStatus[status],
              lastUpdate: stateMessageByStatus[status],
            }
          : machine,
      ),
    );
  };

  return (
    <div className="digital-twin-theme grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="panel overflow-hidden p-0">
        <div className="flex min-h-[680px] flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 px-5 py-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">IPROTEX Factory Twin</h2>
              <p className="mt-1 text-sm text-slate-500">
                Two-floor factory view: {floorCounts.first} first-floor modeled assets, {floorCounts.second} second-floor machine-table records
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(statusStyle).map(([key, value]) => (
                <span key={key} className={`rounded-md px-2.5 py-1 text-xs font-semibold ${value.bg}`}>
                  {value.label}
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 bg-slate-50/80 px-5 py-3">
            <div className="flex flex-wrap gap-2" aria-label="Factory floor view controls">
              {floorViewOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`rounded-md border px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                    viewMode === option.key
                      ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:text-blue-700"
                  }`}
                  onClick={() => setViewMode(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              onClick={() => setResetCameraTick((currentTick) => currentTick + 1)}
            >
              Reset Camera
            </button>
          </div>
          <div className="relative min-h-[600px] flex-1">
            {loading && (
              <div className="absolute inset-0 z-10 p-6">
                <Skeleton className="h-full w-full rounded-lg" />
              </div>
            )}
            {error && (
              <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
                <div className="max-w-md rounded-lg border border-red-200 bg-white p-4 text-sm text-red-700 shadow-sm">
                  {error}
                </div>
              </div>
            )}
            <FactoryCanvas
              key={sceneKey}
              machines={machines}
              selectedId={selectedMachine.id}
              viewMode={viewMode}
              resetCameraTick={resetCameraTick}
              editingLayout={editingLayout}
              snapToGrid={snapToGrid}
              onSelect={inspectMachine}
              onPositionChange={updateMachinePosition}
              onPositionSwap={swapMachinePositions}
              onLoaded={() => setLoading(false)}
              onError={(message) => {
                setError(message);
                setLoading(false);
              }}
            />
          </div>
        </div>
      </section>

      <aside className="panel self-start p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{selectedMachine.name}</h3>
            <p className="mt-1 text-sm text-slate-500">{selectedMachine.location}</p>
          </div>
          <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${statusStyle[selectedMachine.status].bg}`}>
            {statusStyle[selectedMachine.status].label}
          </span>
        </div>

        <div className="mt-6 space-y-4">
          {canEditLayout ? (
          <section className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-950/40">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="font-bold text-slate-900 dark:text-slate-100">
                  Factory layout
                </h4>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {editingLayout
                    ? "Drag a machine onto another machine to swap their places."
                    : "Enter layout mode to reposition machines."}
                </p>
              </div>
              <span
                className={`rounded-full px-2 py-1 text-[11px] font-bold ${
                  editingLayout
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                    : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {editingLayout ? "EDITING" : "VIEW ONLY"}
              </span>
            </div>
            {editingLayout ? (
              <div className="mt-3 space-y-3">
                <label className="flex items-center justify-between gap-3 text-sm font-medium text-slate-700 dark:text-slate-300">
                  <span>Snap to 0.5 m grid</span>
                  <input
                    type="checkbox"
                    checked={snapToGrid}
                    onChange={(event) => setSnapToGrid(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    onClick={() => rotateSelectedMachine(-15)}
                  >
                    ↶ Rotate 15°
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    onClick={() => rotateSelectedMachine(15)}
                  >
                    Rotate 15° ↷
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    onClick={cancelLayoutEditing}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700"
                    onClick={saveLayout}
                  >
                    Save layout
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="mt-3 w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-700"
                onClick={beginLayoutEditing}
              >
                Edit layout
              </button>
            )}
          </section>
          ) : null}

          <section
            className="rounded-lg border border-blue-200 bg-gradient-to-br from-blue-50 to-cyan-50 p-4 dark:border-blue-800 dark:from-blue-950/50 dark:to-cyan-950/30"
            aria-labelledby="inspection-challenge-title"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4
                  id="inspection-challenge-title"
                  className="font-bold text-blue-950 dark:text-blue-100"
                >
                  Factory inspection challenge
                </h4>
                <p className="mt-1 text-xs text-blue-800 dark:text-blue-200">
                  Explore each machine to learn its location, condition, and simulated telemetry.
                </p>
              </div>
              <span className="rounded-full bg-blue-600 px-2.5 py-1 text-xs font-bold text-white">
                {inspectionProgress}%
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs font-semibold text-blue-900 dark:text-blue-100">
              <span>Machines inspected</span>
              <output aria-live="polite">
                {inspectedCount} / {machines.length}
              </output>
            </div>
            <progress
              className="mt-2 h-2 w-full overflow-hidden rounded-full bg-blue-100 accent-blue-600 dark:bg-blue-950"
              aria-label="Factory inspection progress"
              max={machines.length}
              value={inspectedCount}
            />
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
              <span
                className={`rounded-full border px-2 py-1 ${
                  firstFloorInspected
                    ? "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200"
                    : "border-slate-300 bg-white/70 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                }`}
              >
                {firstFloorInspected ? "✓ " : "○ "}First floor discovered
              </span>
              <span
                className={`rounded-full border px-2 py-1 ${
                  secondFloorInspected
                    ? "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200"
                    : "border-slate-300 bg-white/70 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                }`}
              >
                {secondFloorInspected ? "✓ " : "○ "}Second floor discovered
              </span>
            </div>
            <button
              type="button"
              className="mt-3 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-emerald-600"
              disabled={!nextUninspectedMachine}
              onClick={() => {
                if (nextUninspectedMachine) inspectMachine(nextUninspectedMachine);
              }}
            >
              {nextUninspectedMachine
                ? `Inspect next: ${nextUninspectedMachine.name}`
                : "Inspection complete ✓"}
            </button>
          </section>

          <label className="block text-sm font-medium text-slate-700">
            <span>Sort machines</span>
            <select
              value={machineSort}
              onChange={(event) =>
                setMachineSort(event.target.value as MachineSort)
              }
              className="mt-1 block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="name">Name</option>
              <option value="floor">Floor</option>
            </select>
          </label>

          <div className="grid max-h-80 gap-2 overflow-y-auto pr-1">
            {sortedMachines.map((machine) => (
              <button
                key={machine.id}
                type="button"
                className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition ${
                  selectedMachine.id === machine.id
                    ? "border-blue-500 bg-blue-50 text-blue-950"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
                onClick={() => inspectMachine(machine)}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{machine.name}</span>
                  <span className="block text-xs text-slate-500">
                    {machine.floor === "first" ? "First Floor" : "Second Floor"}
                  </span>
                </span>
                <span
                  className="ml-3 flex shrink-0 items-center gap-2"
                >
                  {inspectedMachineIds.has(machine.id) ? (
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      Seen ✓
                    </span>
                  ) : null}
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: statusStyle[machine.status].color }}
                    aria-hidden="true"
                  />
                </span>
              </button>
            ))}
          </div>

          <div>
            <div className="mb-2 text-sm font-medium text-slate-700">Simulation state</div>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(statusStyle) as TwinStatus[]).map((status) => (
                <button
                  key={status}
                  type="button"
                  className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${
                    selectedMachine.status === status
                      ? "border-blue-500 bg-blue-50 text-blue-950"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                  }`}
                  onClick={() => updateSelectedMachineStatus(status)}
                >
                  {statusStyle[status].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex justify-between text-sm font-medium text-slate-700">
              <span>Health score</span>
              <span>{selectedMachine.health}%</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-100">
              <div
                className="h-2 rounded-full bg-blue-600"
                style={{ width: `${selectedMachine.health}%` }}
              />
            </div>
          </div>

          <dl className="grid gap-3 text-sm">
            <div className="rounded-md border border-slate-200 p-3">
              <dt className="font-medium text-slate-500">Factory level</dt>
              <dd className="mt-1 font-semibold text-slate-900">
                {selectedMachine.floor === "first" ? "First Floor" : "Second Floor"}
              </dd>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-slate-200 p-3">
                <dt className="font-medium text-slate-500">Temperature</dt>
                <dd className="mt-1 font-semibold text-slate-900">
                  {selectedMachine.simulatedMetrics.temperatureC.toFixed(1)} C
                </dd>
              </div>
              <div className="rounded-md border border-slate-200 p-3">
                <dt className="font-medium text-slate-500">Vibration</dt>
                <dd className="mt-1 font-semibold text-slate-900">
                  {selectedMachine.simulatedMetrics.vibrationMms.toFixed(1)} mm/s
                </dd>
              </div>
              <div className="rounded-md border border-slate-200 p-3">
                <dt className="font-medium text-slate-500">Load</dt>
                <dd className="mt-1 font-semibold text-slate-900">
                  {selectedMachine.simulatedMetrics.loadPercent}%
                </dd>
              </div>
              <div className="rounded-md border border-slate-200 p-3">
                <dt className="font-medium text-slate-500">Availability</dt>
                <dd className="mt-1 font-semibold text-slate-900">
                  {selectedMachine.simulatedMetrics.availabilityPercent}%
                </dd>
              </div>
            </div>
            <div className="rounded-md border border-slate-200 p-3">
              <dt className="font-medium text-slate-500">Manufacturer / model</dt>
              <dd className="mt-1 font-semibold text-slate-900">
                {[selectedMachine.manufacturer, selectedMachine.model]
                  .filter((value) => value && value !== "N/A")
                  .join(" / ") || "Not available"}
              </dd>
            </div>
            <div className="rounded-md border border-slate-200 p-3">
              <dt className="font-medium text-slate-500">3D representation</dt>
              <dd className="mt-1 break-all font-semibold text-slate-900">
                {selectedMachine.assetUrl ?? "Named placeholder until asset is added"}
              </dd>
            </div>
            <div className="rounded-md border border-slate-200 p-3">
              <dt className="font-medium text-slate-500">Twin state</dt>
              <dd className="mt-1 font-semibold text-slate-900">{selectedMachine.lastUpdate}</dd>
            </div>
          </dl>
        </div>
      </aside>
    </div>
  );
}
