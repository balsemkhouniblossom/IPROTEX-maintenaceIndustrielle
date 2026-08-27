"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Skeleton } from "@/components/Skeleton";

type TwinStatus = "running" | "stopped" | "fault" | "offline";

type TwinMachine = {
  id: string;
  name: string;
  backendMachineId: string | null;
  assetUrl: string;
  position: [number, number, number];
  rotationY: number;
  targetSize: number;
  status: TwinStatus;
  location: string;
  health: number;
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
  onSelect: (machine: TwinMachine) => void;
  onLoaded: () => void;
  onError: (message: string) => void;
};

const initialTwinMachines: TwinMachine[] = [
  {
    id: "harry-lucas-rv4s",
    name: "Harry Lucas RV-4s",
    backendMachineId: null,
    assetUrl: "/models/machine-a.glb",
    position: [-1.9, 0, 0],
    rotationY: Math.PI / 6,
    targetSize: 1.7,
    status: "running",
    location: "Prototype workshop - Line 1",
    health: 92,
    simulatedMetrics: {
      temperatureC: 41.8,
      vibrationMms: 1.2,
      loadPercent: 72,
      availabilityPercent: 96,
    },
    lastUpdate: "Prototype mode - simulated values",
  },
  {
    id: "pw800",
    name: "PW800",
    backendMachineId: null,
    assetUrl: "/models/machine-b.glb",
    position: [1.9, 0, 0],
    rotationY: -Math.PI / 8,
    targetSize: 1.7,
    status: "fault",
    location: "Prototype workshop - Line 1",
    health: 68,
    simulatedMetrics: {
      temperatureC: 58.4,
      vibrationMms: 3.7,
      loadPercent: 44,
      availabilityPercent: 81,
    },
    lastUpdate: "Prototype mode - fault scenario",
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
  running: "Prototype mode - normal operation",
  stopped: "Prototype mode - planned stop",
  fault: "Prototype mode - fault scenario",
  offline: "Prototype mode - disconnected",
};

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
    new THREE.TorusGeometry(1.05, 0.025, 12, 96),
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
    new THREE.TorusGeometry(1.2, 0.035, 12, 96),
    new THREE.MeshStandardMaterial({
      color: "#2563eb",
      emissive: "#2563eb",
      emissiveIntensity: 0.45,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.055;
  return ring;
}

function createMachineGroup(machine: TwinMachine, gltf: GLTF) {
  const group = new THREE.Group();
  group.name = machine.id;
  group.userData.machineId = machine.id;
  group.position.set(...machine.position);
  group.rotation.y = machine.rotationY;

  const model = gltf.scene;
  fitObjectToSize(model, machine.targetSize);
  model.traverse((child) => {
    child.userData.machineId = machine.id;
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  group.add(model);
  group.add(createStatusRing(machine));
  return group;
}

async function loadMachineGroup(loader: GLTFLoader, machine: TwinMachine, isDisposed: () => boolean) {
  const gltf = await loader.loadAsync(machine.assetUrl);
  return isDisposed() ? null : createMachineGroup(machine, gltf);
}

function FactoryCanvas({
  machines,
  selectedId,
  onSelect,
  onLoaded,
  onError,
}: Readonly<FactoryCanvasProps>) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const machinesRef = useRef(machines);
  const selectedIdRef = useRef(selectedId);
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

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(4.5, 3.2, 5.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 2.6;
    controls.maxDistance = 9;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.target.set(0, 0.45, 0);

    scene.add(new THREE.AmbientLight("#ffffff", 1.2));
    const mainLight = new THREE.DirectionalLight("#ffffff", 2.2);
    mainLight.position.set(5, 7, 4);
    mainLight.castShadow = true;
    scene.add(mainLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 5),
      new THREE.MeshStandardMaterial({ color: "#eef2f7", roughness: 0.92 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(8, 16, "#94a3b8", "#cbd5e1");
    grid.position.y = -0.01;
    scene.add(grid);

    const machineGroups = new Map<string, THREE.Group>();
    const selectionRing = createSelectionRing();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const loader = new GLTFLoader();
    let disposed = false;
    let frame = 0;

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

    const updateStatusRings = () => {
      machinesRef.current.forEach((machine) => {
        const ring = machineGroups.get(machine.id)?.getObjectByName("status-ring");
        const material = ring instanceof THREE.Mesh ? ring.material : null;
        if (!(material instanceof THREE.MeshStandardMaterial)) return;

        const nextColor = statusStyle[machine.status].color;
        material.color.set(nextColor);
        material.emissive.set(nextColor);
      });
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
      const intersects = raycaster.intersectObjects(Array.from(machineGroups.values()), true);
      const machineId = intersects
        .map((hit) => hit.object.userData.machineId)
        .find((value): value is string => typeof value === "string");
      const machine = machinesRef.current.find((item) => item.id === machineId);
      if (machine) onSelectRef.current(machine);
    };

    const animate = () => {
      controls.update();
      updateSelection();
      updateStatusRings();
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
  const [machines, setMachines] = useState<TwinMachine[]>(initialTwinMachines);
  const [selectedMachineId, setSelectedMachineId] = useState(initialTwinMachines[0].id);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectedMachine =
    machines.find((machine) => machine.id === selectedMachineId) ?? machines[0];

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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="panel overflow-hidden p-0">
        <div className="flex min-h-[560px] flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 px-5 py-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Factory Twin</h2>
              <p className="mt-1 text-sm text-slate-500">Prototype mode - no backend machine records yet</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(statusStyle).map(([key, value]) => (
                <span key={key} className={`rounded-md px-2.5 py-1 text-xs font-semibold ${value.bg}`}>
                  {value.label}
                </span>
              ))}
            </div>
          </div>
          <div className="relative min-h-[480px] flex-1">
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
              machines={machines}
              selectedId={selectedMachine.id}
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
          <div className="grid gap-2">
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
                <span className="font-semibold">{machine.name}</span>
                <span
                  className="h-2.5 w-2.5 rounded-full"
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
              <dt className="font-medium text-slate-500">Connection</dt>
              <dd className="mt-1 font-semibold text-slate-900">
                {selectedMachine.backendMachineId ?? "Prototype only"}
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
              <dt className="font-medium text-slate-500">3D asset</dt>
              <dd className="mt-1 break-all font-semibold text-slate-900">{selectedMachine.assetUrl}</dd>
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
