#pragma once

// Non-secret device behavior. Adjust these values for the installation;
// credentials and broker identity remain in the untracked secrets.h file.
constexpr unsigned long WIFI_RECONNECT_INTERVAL_MS = 10000;
constexpr unsigned long MQTT_RECONNECT_INTERVAL_MS = 5000;
constexpr unsigned long TELEMETRY_INTERVAL_MS = 2000;
constexpr unsigned long HEARTBEAT_INTERVAL_MS = 30000;
constexpr const char *FIRMWARE_VERSION = "1.0.0";
constexpr const char *NTP_SERVER_PRIMARY = "pool.ntp.org";
constexpr const char *NTP_SERVER_SECONDARY = "time.google.com";
constexpr size_t MQTT_PACKET_BUFFER_BYTES = 1536;
constexpr size_t TELEMETRY_JSON_BYTES = 1024;

