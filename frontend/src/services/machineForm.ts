export interface MachineFormValues {
  machine_id: string;
  serial_no: string;
  type_id: string | number;
  status: string;
  installation_date: string;
  poids_kg: string;
  fabricant: string;
  model: string;
  location: string;
}

export function machineTextOrNotAvailable(value: string): string {
  return value.trim() || "N/A";
}

export function buildMachinePayload(formData: MachineFormValues) {
  return {
    machine_id: formData.machine_id.trim(),
    serial_no: machineTextOrNotAvailable(formData.serial_no),
    type_id: formData.type_id,
    status: formData.status,
    installation_date: formData.installation_date || undefined,
    poids_kg: formData.poids_kg
      ? Number.parseFloat(formData.poids_kg)
      : undefined,
    fabricant: machineTextOrNotAvailable(formData.fabricant),
    model: machineTextOrNotAvailable(formData.model),
    location: machineTextOrNotAvailable(formData.location),
  };
}
