import mongoose from 'mongoose';
import { Device, DeviceSchema, DeviceType } from './device.schema';

const MODEL_NAME = 'DeviceSchemaSanitizationSpec';
const DeviceModel =
  (mongoose.models[MODEL_NAME] as mongoose.Model<mongoose.Document>) ||
  mongoose.model(MODEL_NAME, DeviceSchema);

function buildDeviceDoc() {
  return new DeviceModel({
    device_id: 'DEV-1',
    machine_id: new mongoose.Types.ObjectId(),
    label: 'Line 3 gateway',
    device_type: DeviceType.GATEWAY,
    api_key_hash: '$2b$10$hashedapikeyvalue',
    key_prefix: 'gwk_ab12',
    is_active: true,
  } satisfies Partial<Device>);
}

describe('Device schema — toJSON/toObject sanitization backstop', () => {
  it('strips api_key_hash from toJSON() while keeping safe fields', () => {
    const json = buildDeviceDoc().toJSON() as Record<string, unknown>;

    expect(json.api_key_hash).toBeUndefined();

    expect(json.device_id).toBe('DEV-1');
    expect(json.label).toBe('Line 3 gateway');
    expect(json.key_prefix).toBe('gwk_ab12');
  });

  it('strips api_key_hash from toObject() as well', () => {
    const obj = buildDeviceDoc().toObject() as unknown as Record<
      string,
      unknown
    >;

    expect(obj.api_key_hash).toBeUndefined();
    expect(obj.device_id).toBe('DEV-1');
  });
});
