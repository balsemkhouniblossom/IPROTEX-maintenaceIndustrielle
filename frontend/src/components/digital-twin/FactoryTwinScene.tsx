"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Skeleton } from "@/components/Skeleton";
import { apiService } from "@/services/api";
import { fetchAllPaginated } from "@/services/pagination";

type TwinStatus = "running" | "stopped" | "fault" | "offline";
type TwinFloor = "first" | "second";
type FactoryViewMode = "complete" | "first" | "second";

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
  onSelect: (machine: TwinMachine) => void;
  onLoaded: () => void;
  onError: (message: string) => void;
};

const FLOOR_HEIGHT = 2.7;
const FACTORY_WIDTH = 12;
const FACTORY_DEPTH = 7;

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

function toSecondFloorMachine(record: MachineRecord, index: number): TwinMachine {
  const columns = 5;
  const spacingX = 2.05;
  const spacingZ = 1.35;
  const row = Math.floor(index / columns);
  const column = index % columns;
  const status = toTwinStatus(record.status);

  return {
    id: `machine-${record._id}`,
    name: record.machine_id || `Machine ${index + 1}`,
    backendMachineId: record._id,
    assetUrl: null,
    floor: "second",
    position: [
      (column - (columns - 1) / 2) * spacingX,
      FLOOR_HEIGHT,
      -2.1 + row * spacingZ,
    ],
    rotationY: column % 2 === 0 ? Math.PI / 2 : -Math.PI / 2,
    targetSize: 1,
    status,
    location: record.location || "Second Floor",
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
    new THREE.BoxGeometry(1.15, 0.7, 0.86),
    new THREE.MeshStandardMaterial({
      color: "#c7d2fe",
      metalness: 0.15,
      roughness: 0.55,
    }),
  );
  body.position.y = 0.38;
  body.castShadow = true;
  body.receiveShadow = true;

  const top = new THREE.Mesh(
    new THREE.BoxGeometry(0.78, 0.32, 0.62),
    new THREE.MeshStandardMaterial({ color: "#64748b", roughness: 0.6 }),
  );
  top.position.y = 0.92;
  top.castShadow = true;

  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.38, 0.42),
    new THREE.MeshStandardMaterial({
      color: statusStyle[machine.status].color,
      emissive: statusStyle[machine.status].color,
      emissiveIntensity: 0.2,
    }),
  );
  panel.position.set(0.61, 0.48, 0);
  panel.name = "status-panel";

  group.add(body, top, panel, createStatusRing(machine), createLabelSprite(machine.name));
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
  onSelect,
  onLoaded,
  onError,
}: Readonly<FactoryCanvasProps>) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const machinesRef = useRef(machines);
  const selectedIdRef = useRef(selectedId);
  const viewModeRef = useRef(viewMode);
  const resetCameraTickRef = useRef(resetCameraTick);
  const onSelectRef = useRef(onSelect);
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
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f8fafc");

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
        .map((hit) => hit.object.userData.machineId)
        .find((value): value is string => typeof value === "string");
      const machine = machinesRef.current.find((item) => item.id === machineId);
      if (machine) onSelectRef.current(machine);
    };

    const animate = () => {
      const resetCameraRequested = resetCameraTickRef.current !== activeResetCameraTick;
      if (resetCameraRequested) activeResetCameraTick = resetCameraTickRef.current;
      applyViewMode(resetCameraRequested);
      controls.update();
      updateSelection();
      updateStatusIndicators();
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    };

    resize();
    window.addEventListener("resize", resize);
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    void loadMachines();
    animate();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} className="absolute inset-0" />;
}

export default function FactoryTwinScene() {
  const [machines, setMachines] = useState<TwinMachine[]>(firstFloorAssetMachines);
  const [selectedMachineId, setSelectedMachineId] = useState(firstFloorAssetMachines[0].id);
  const [viewMode, setViewMode] = useState<FactoryViewMode>("complete");
  const [resetCameraTick, setResetCameraTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadMachineTable() {
      try {
        const rows = await fetchAllPaginated<MachineRecord>(
          (params) => apiService.getMachines(params),
          100,
        );
        if (cancelled || rows.length === 0) return;

        const secondFloorMachines = rows.map(toSecondFloorMachine);
        setMachines([...firstFloorAssetMachines, ...secondFloorMachines]);
      } catch (loadError) {
        console.error("Unable to load IPROTEX machine table for digital twin:", loadError);
      }
    }

    void loadMachineTable();

    return () => {
      cancelled = true;
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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
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
              onSelect={(machine) => setSelectedMachineId(machine.id)}
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
          <div className="grid max-h-80 gap-2 overflow-y-auto pr-1">
            {machines.map((machine) => (
              <button
                key={machine.id}
                type="button"
                className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition ${
                  selectedMachine.id === machine.id
                    ? "border-blue-500 bg-blue-50 text-blue-950"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
                onClick={() => setSelectedMachineId(machine.id)}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{machine.name}</span>
                  <span className="block text-xs text-slate-500">
                    {machine.floor === "first" ? "First Floor" : "Second Floor"}
                  </span>
                </span>
                <span
                  className="ml-3 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: statusStyle[machine.status].color }}
                  aria-hidden="true"
                />
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
            <div className="rounded-md border border-slate-200 p-3">
              <dt className="font-medium text-slate-500">Machine table ID</dt>
              <dd className="mt-1 break-all font-semibold text-slate-900">
                {selectedMachine.backendMachineId ?? "3D asset only"}
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
