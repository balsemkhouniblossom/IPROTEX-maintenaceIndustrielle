import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DeviceDocument = Device & Document;

export enum DeviceType {
  OPENPLC = 'openplc',
  SIMULATOR = 'simulator',
  GATEWAY = 'gateway',
}

export enum DeviceConnectionStatus {
  UNKNOWN = 'unknown',
  ONLINE = 'online',
  OFFLINE = 'offline',
}

/**
 * A registered device is the only thing that may ever call the
 * device-facing ingestion surface (REST `/device-gateway/*`, the MQTT
 * bridge, or the `device` side of the WebSocket gateway) — it is a
 * deliberately separate identity from `User` so a compromised or spoofed
 * device credential can never be used against any `@UseGuards(JwtAuthGuard)`
 * user endpoint, and a stolen user JWT can never be used to push telemetry.
 * Only `api_key_hash` (bcrypt) is stored; the raw key is returned to the
 * Admin exactly once, at registration or rotation time, and never again.
 */
@Schema({ timestamps: true })
export class Device {
  @Prop({ required: true, unique: true, trim: true })
  device_id!: string;

  @Prop({ type: Types.ObjectId, ref: 'Machine', required: true })
  machine_id!: Types.ObjectId;

  @Prop({ trim: true })
  label?: string;

  @Prop({ type: String, enum: Object.values(DeviceType), required: true })
  device_type!: DeviceType;

  @Prop({ required: true })
  api_key_hash!: string;

  /**
   * A short, non-secret prefix of the raw key stored in plaintext purely to
   * make credential lookup an indexed query instead of a full-collection
   * bcrypt-compare scan. The prefix alone is not enough to authenticate.
   */
  @Prop({ required: true })
  key_prefix!: string;

  @Prop({ type: Boolean, default: true, required: true })
  is_active!: boolean;

  @Prop({ type: Number, default: 30, required: true })
  heartbeat_interval_seconds!: number;

  @Prop({ type: Date })
  last_seen_at?: Date;

  /**
   * Cached transition state, distinct from the always-live computation in
   * `LiveStatusService.computeStatus()`. Its only purpose is letting the
   * offline-sweep cron and every ingestion path tell "this is a change"
   * (worth an event/notification) from "still the same known state", so
   * online/offline WebSocket pushes and `DEVICE_OFFLINE` notifications fire
   * exactly once per transition instead of once per heartbeat/sweep tick.
   */
  @Prop({
    type: String,
    enum: Object.values(DeviceConnectionStatus),
    default: DeviceConnectionStatus.UNKNOWN,
    required: true,
  })
  last_known_status!: DeviceConnectionStatus;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  created_by?: Types.ObjectId;

  @Prop({ type: Date })
  key_rotated_at?: Date;
}

export const DeviceSchema = SchemaFactory.createForClass(Device);

// `api_key_hash` (bcrypt) was, until now, serialized into every device
// list/detail response with no exclusion — contradicting this class's own
// doc comment ("the raw key is returned... exactly once... and never
// again"). The raw key was indeed never re-exposed, but its hash was on
// every read. Stripped here the same way `UserSchema` strips its own
// sensitive fields, rather than trusting every call site to remember to
// omit it.
function stripDeviceApiKeyHash(_doc: unknown, ret: any): any {
  delete ret.api_key_hash;
  return ret;
}

DeviceSchema.set('toJSON', { transform: stripDeviceApiKeyHash });
DeviceSchema.set('toObject', { transform: stripDeviceApiKeyHash });

DeviceSchema.index({ machine_id: 1 });
DeviceSchema.index({ key_prefix: 1 });
DeviceSchema.index({ is_active: 1 });
DeviceSchema.index(
  { is_active: 1, last_known_status: 1 },
  { name: 'devices_active_status' },
);
