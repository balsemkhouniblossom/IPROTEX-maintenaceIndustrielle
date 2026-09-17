import test from "node:test";
import assert from "node:assert/strict";
import {
  DIGITAL_TWIN_MACHINES_CHANGED_EVENT,
  DIGITAL_TWIN_MACHINES_CHANGED_STORAGE_KEY,
  notifyDigitalTwinMachinesChanged,
} from "../src/services/digitalTwinMachines.ts";

test("constants are defined", () => {
  assert.equal(DIGITAL_TWIN_MACHINES_CHANGED_EVENT, "gmao:digital-twin-machines-changed");
  assert.equal(DIGITAL_TWIN_MACHINES_CHANGED_STORAGE_KEY, "gmao.digitalTwinMachinesChangedAt");
});

test("notifyDigitalTwinMachinesChanged dispatches event and sets storage", () => {
  const events: string[] = [];
  const storage: Record<string, string> = {};
  const dispatchEvent = (event: Event) => events.push(event.type);
  const localStorage = {
    setItem: (key: string, value: string) => { storage[key] = value; },
    removeItem: () => {},
  };
  const originalWindow = globalThis.window;
  globalThis.window = {
    dispatchEvent,
    localStorage,
  } as never;
  try {
    notifyDigitalTwinMachinesChanged();
    assert.equal(events.length, 1);
    assert.equal(events[0], "gmao:digital-twin-machines-changed");
    assert.equal(storage[DIGITAL_TWIN_MACHINES_CHANGED_STORAGE_KEY] !== undefined, true);
    assert.match(storage[DIGITAL_TWIN_MACHINES_CHANGED_STORAGE_KEY]!, /^\d+$/);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("notifyDigitalTwinMachinesChanged handles undefined window", () => {
  const originalWindow = globalThis.window;
  globalThis.window = undefined as never;
  try {
    notifyDigitalTwinMachinesChanged();
  } finally {
    globalThis.window = originalWindow;
  }
});

test("notifyDigitalTwinMachinesChanged handles localStorage error", () => {
  const dispatchEvent = () => {};
  const localStorage = {
    setItem: () => { throw new Error("storage full"); },
    removeItem: () => {},
  };
  const originalWindow = globalThis.window;
  globalThis.window = { dispatchEvent, localStorage } as never;
  try {
    notifyDigitalTwinMachinesChanged();
  } finally {
    globalThis.window = originalWindow;
  }
});
