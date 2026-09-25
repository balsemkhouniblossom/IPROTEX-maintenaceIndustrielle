#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_INA219.h>
#include <time.h>
#include "device-config.h"
#include "secrets.h"

namespace {
WiFiClientSecure secureClient;
PubSubClient mqtt(secureClient);
Adafruit_MPU6050 mpu;
Adafruit_INA219 ina219;
unsigned long lastTelemetryAt = 0;
unsigned long lastHeartbeatAt = 0;
unsigned long lastReconnectAt = 0;
unsigned long lastWifiReconnectAt = 0;
bool mpuReady = false;
bool powerSensorReady = false;

String topic(const char *kind) {
  return String("devices/") + DEVICE_ID + "/" + kind;
}

void addFinite(JsonObject metrics, const char *name, float value) {
  if (isfinite(value)) metrics[name] = value;
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  const unsigned long now = millis();
  if (now - lastWifiReconnectAt < WIFI_RECONNECT_INTERVAL_MS) return;
  lastWifiReconnectAt = now;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void connectMqtt() {
  if (mqtt.connected() || WiFi.status() != WL_CONNECTED) return;
  const unsigned long now = millis();
  if (now - lastReconnectAt < MQTT_RECONNECT_INTERVAL_MS) return;
  lastReconnectAt = now;
  mqtt.connect(DEVICE_ID, MQTT_USERNAME, MQTT_PASSWORD);
}

void addRecordedAt(JsonDocument &doc) {
  time_t now = time(nullptr);
  if (now < 1700000000) return; // NTP not synchronized: backend uses receive time.
  struct tm utc;
  gmtime_r(&now, &utc);
  char value[25];
  strftime(value, sizeof(value), "%Y-%m-%dT%H:%M:%SZ", &utc);
  doc["recorded_at"] = value;
}

bool publishJson(const String &destination, JsonDocument &doc) {
  char payload[1024];
  const size_t length = serializeJson(doc, payload, sizeof(payload));
  if (length == 0 || length >= sizeof(payload)) return false;
  return mqtt.publish(destination.c_str(), reinterpret_cast<const uint8_t *>(payload), length, false);
}

void publishTelemetry() {
  StaticJsonDocument<TELEMETRY_JSON_BYTES> doc;
  doc["api_key"] = DEVICE_API_KEY;
  addRecordedAt(doc);
  JsonObject metrics = doc.createNestedObject("metrics");
  if (mpuReady) {
    sensors_event_t acceleration, gyro, temperature;
    if (mpu.getEvent(&acceleration, &gyro, &temperature)) {
      addFinite(metrics, "accel_x_ms2", acceleration.acceleration.x);
      addFinite(metrics, "accel_y_ms2", acceleration.acceleration.y);
      addFinite(metrics, "accel_z_ms2", acceleration.acceleration.z);
      addFinite(metrics, "gyro_x_rads", gyro.gyro.x);
      addFinite(metrics, "gyro_y_rads", gyro.gyro.y);
      addFinite(metrics, "gyro_z_rads", gyro.gyro.z);
      addFinite(metrics, "sensor_temp_c", temperature.temperature);
    }
  }
  if (powerSensorReady) {
    addFinite(metrics, "bus_voltage_v", ina219.getBusVoltage_V());
    addFinite(metrics, "current_a", ina219.getCurrent_mA() / 1000.0f);
    addFinite(metrics, "power_w", ina219.getPower_mW() / 1000.0f);
  }
  if (metrics.size() > 0) publishJson(topic("telemetry"), doc);
}

void publishHeartbeat() {
  StaticJsonDocument<256> doc;
  doc["api_key"] = DEVICE_API_KEY;
  doc["firmware_version"] = FIRMWARE_VERSION;
  publishJson(topic("heartbeat"), doc);
}
} // namespace

void setup() {
  Serial.begin(115200);
  Wire.begin();
  mpuReady = mpu.begin();
  powerSensorReady = ina219.begin();
  secureClient.setCACert(MQTT_ROOT_CA);
  mqtt.setServer(MQTT_BROKER_HOST, MQTT_BROKER_PORT);
  mqtt.setBufferSize(MQTT_PACKET_BUFFER_BYTES);
  configTime(0, 0, NTP_SERVER_PRIMARY, NTP_SERVER_SECONDARY);
  connectWifi();
}

void loop() {
  connectWifi();
  connectMqtt();
  mqtt.loop();
  if (!mqtt.connected()) return;

  const unsigned long now = millis();
  if (now - lastTelemetryAt >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryAt = now;
    publishTelemetry();
  }
  if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatAt = now;
    publishHeartbeat();
  }
}
