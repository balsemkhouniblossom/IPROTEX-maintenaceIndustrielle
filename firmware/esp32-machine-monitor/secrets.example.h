#pragma once

// Copy to secrets.h. Never commit the real values.
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define MQTT_BROKER_HOST "mqtt.example.com"
#define MQTT_BROKER_PORT 8883
#define MQTT_USERNAME "device-publisher"
#define MQTT_PASSWORD "YOUR_MQTT_PASSWORD"
#define DEVICE_ID "esp32-machine-01"
#define DEVICE_API_KEY "KEY_RETURNED_ONCE_BY_IPROTEX_DEVICE_REGISTRATION"

// PEM root CA used by the MQTT broker. Do not use setInsecure in production.
static const char MQTT_ROOT_CA[] = R"EOF(
-----BEGIN CERTIFICATE-----
REPLACE_WITH_BROKER_ROOT_CA
-----END CERTIFICATE-----
)EOF";
