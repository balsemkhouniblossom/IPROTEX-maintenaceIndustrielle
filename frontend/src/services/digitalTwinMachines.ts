export const DIGITAL_TWIN_MACHINES_CHANGED_EVENT =
  "gmao:digital-twin-machines-changed";

export const DIGITAL_TWIN_MACHINES_CHANGED_STORAGE_KEY =
  "gmao.digitalTwinMachinesChangedAt";

export function notifyDigitalTwinMachinesChanged(): void {
  if (typeof window === "undefined") return;

  window.dispatchEvent(new Event(DIGITAL_TWIN_MACHINES_CHANGED_EVENT));

  try {
    window.localStorage.setItem(
      DIGITAL_TWIN_MACHINES_CHANGED_STORAGE_KEY,
      Date.now().toString(),
    );
  } catch {
    // The in-window event still works when storage is unavailable.
  }
}
