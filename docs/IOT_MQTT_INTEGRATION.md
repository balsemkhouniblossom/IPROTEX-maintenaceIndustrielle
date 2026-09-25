# ESP32 MQTT integration

The supported flow is ESP32 → authenticated TLS MQTT broker → NestJS MQTT ingestion → existing telemetry and sensor-measurement collections → WebSocket/UI. The browser never connects to the broker.

## Provisioning

1. In **Connected devices**, register an `ESP32` device against the correct machine. Copy the API key shown once.
2. Copy `firmware/esp32-machine-monitor/secrets.example.h` to `secrets.h` and insert the Wi-Fi, broker, device ID, and API key values. `secrets.h` is ignored by Git. Non-secret sampling, heartbeat, NTP, firmware-version, and buffer settings live in `device-config.h` rather than being embedded in the sketch.
3. Configure the backend variables shown in `backend/.env.example`. Use `mqtts://` and broker ACLs that allow devices to publish only to `devices/{deviceId}/#` while the backend account subscribes to `devices/+/#`.
4. Configure each existing sensor's `mqtt_topic` as `devices/{deviceId}/telemetry#metric_name`. Example: `devices/esp32-machine-01/telemetry#current_a`.

## Payload contract

Telemetry uses a flat `metrics` object. Metric names use lowercase letters, numbers and underscores, and every value must be a finite JSON number. The firmware omits unavailable readings; it never sends `NaN`, `Infinity`, or `null`. `recorded_at` is ISO-8601 UTC and is omitted until NTP is synchronized, in which case the server receive time is used.

The firmware checks sensor initialization and every reading. Unavailable or non-finite values are omitted; when no valid metric remains, it does not publish a telemetry packet. The backend rejects malformed, empty, nested, oversized, and non-finite telemetry before persistence. Sensor projection uses deterministic measurement IDs, so replaying the same device timestamp does not duplicate measurements. Telemetry is retained according to `TELEMETRY_RETENTION_SECONDS`.

## Cache and live updates

Telemetry is persisted first, then emitted through the existing live-monitoring WebSocket. The UI's next REST refresh reads the same persisted record. This avoids a separate browser cache as a source of truth. If the browser missed a WebSocket event, refreshing or the existing polling path returns the stored value.

## Troubleshooting

- Device offline: verify Wi-Fi, broker DNS/port, CA certificate, MQTT credentials, ACL, and heartbeat topic.
- Rejected message: verify device ID/API key and the flat metric contract.
- Telemetry visible but no sensor measurement: verify the sensor belongs to a module of the device's machine and that its `mqtt_topic` exactly matches the documented binding.
- No MQTT connection: `MQTT_BROKER_URL` is optional; when absent, ingestion is intentionally disabled.
