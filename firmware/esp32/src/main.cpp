/**
 * Smart Home 'Rumah' — Firmware ESP32 Native C++ (PlatformIO)
 * Mendukung:
 * 1. Mode Provisioning SoftAP dengan Captive Portal otomatis (192.168.4.1)
 * 2. Tombol Fisik Factory Reset (Tahan BOOT/GPIO 0 selama 7 detik)
 * 3. Indikator Status LED (SoftAP: Cepat, Konek: Sedang, Online: Nyala Tetap)
 * 4. MQTT LWT, Kontrol Relay/Lampu, Alarm Gas Otonom (Non-Blocking), Telemetri, OTA.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ArduinoOTA.h>
#include <esp_task_wdt.h>

#include "config.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.h.example"
#endif

// --- VARIABEL PROVISIONING & IDENTITAS PERANGKAT ---
Preferences prefs;
DNSServer dnsServer;
WebServer webServer(80);

bool isApMode = false;
String apSsid = "";
String apPassword = "";
String activeDeviceId = "";
String activeClaimToken = "";

String configuredSsid = "";
String configuredPass = "";
String configuredMqttHost = "";
uint16_t configuredMqttPort = 1883;

// Pewaktu Tombol Reset Pabrik & Status LED
uint32_t resetButtonHoldStart = 0;
bool isResetButtonHeld = false;
uint32_t lastLedBlinkTime = 0;
bool statusLedState = false;

// --- VARIABEL KONEKSI & MQTT ---
WiFiClient espClient;
PubSubClient mqttClient(espClient);

// Status Output Lokal
bool stateLampTengah = false;
bool stateLampDapurTamu = false;
bool stateLampKamar = false;
bool stateRelay = false;
bool stateBuzzer = false;

// Status Sensor
uint16_t currentGasRaw = 0;
bool currentIsDark = false;
bool isGasAlarmActive = false;

// Pewaktu Asinkron (Non-Blocking Millis)
uint32_t lastTelemetryTime = 0;
uint32_t lastWifiRetryTime = 0;
uint32_t lastMqttRetryTime = 0;
uint32_t lastBuzzerToggleTime = 0;
bool buzzerBeepState = false;

// Topik MQTT
String topicAvailability;
String topicCmd;
String topicState;
String topicEvent;
String topicAck;

// Deklarasi Fungsi
void initDeviceIdentity();
void setupPins();
void startSoftAP();
void handleCaptivePortal();
void handleSaveConfig();
void checkFactoryResetButton();
void updateStatusLed();
void setupWifi();
void setupMqtt();
void setupOTA();
void reconnectMqtt();
void handleMqttMessage(char* topic, byte* payload, unsigned int length);
void publishState();
void publishEvent(const char* eventName, const char* channel, float value);
void updateHardwareOutputs();
void processSensorsAndAlarm();

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n========================================================");
    Serial.println(" SMART HOME 'RUMAH' — FIRMWARE ESP32 PROVISIONING SIAP ");
    Serial.println("========================================================");

    initDeviceIdentity();
    setupPins();

    // 1. Inisialisasi Hardware Watchdog Timer (WDT)
    esp_task_wdt_init(WDT_TIMEOUT_SECONDS, true);
    esp_task_wdt_add(NULL);

    // 2. Baca konfigurasi WiFi dari NVS
    prefs.begin("rumah_config", false);
    configuredSsid = prefs.getString("wifi_ssid", "");
    configuredPass = prefs.getString("wifi_pass", "");
    configuredMqttHost = prefs.getString("mqtt_host", "");
    configuredMqttPort = prefs.getUShort("mqtt_port", 1883);
    prefs.end();

    // Fallback ke secrets.h jika NVS kosong dan secrets.h memiliki nilai valid
    #ifdef WIFI_SSID
    if (configuredSsid.isEmpty() && String(WIFI_SSID) != "Nama_WiFi_Rumah") {
        configuredSsid = String(WIFI_SSID);
        configuredPass = String(WIFI_PASSWORD);
        configuredMqttHost = String(MQTT_HOST);
        configuredMqttPort = MQTT_PORT;
    }
    #endif

    // 3. Tentukan apakah masuk ke mode SoftAP atau Station
    if (configuredSsid.isEmpty()) {
        Serial.println("[PROVISION] Belum ada konfigurasi WiFi tersimpan. Memulai mode SoftAP...");
        startSoftAP();
    } else {
        Serial.printf("[PROVISION] Menggunakan konfigurasi WiFi tersimpan: %s\n", configuredSsid.c_str());
        setupWifi();
        setupMqtt();
        setupOTA();
    }

    Serial.println("[RUMAH] Inisialisasi selesai. Memulai loop kontrol utama.");
}

void loop() {
    esp_task_wdt_reset();

    // 1. Cek tombol Factory Reset fisik (GPIO 0 / BOOT button)
    checkFactoryResetButton();

    // 2. Perbarui indikator visual status LED
    updateStatusLed();

    // 3. Baca sensor & sirine darurat (berjalan mandiri secara otonom)
    processSensorsAndAlarm();

    // 4. Jika dalam mode SoftAP / Captive Portal
    if (isApMode) {
        dnsServer.processNextRequest();
        webServer.handleClient();
        return; // Selesai untuk iterasi loop saat mode SoftAP
    }

    // 5. Tangani OTA update saat di mode Station
    ArduinoOTA.handle();

    // 6. Manajemen Koneksi WiFi (Non-blocking reconnect)
    uint32_t now = millis();
    if (WiFi.status() != WL_CONNECTED) {
        if (now - lastWifiRetryTime > 10000) {
            lastWifiRetryTime = now;
            Serial.println("[WiFi] Koneksi terputus. Mencoba menghubungkan kembali...");
            WiFi.disconnect();
            WiFi.reconnect();
        }
    } else {
        // 7. Manajemen Koneksi MQTT (hanya jika WiFi terhubung)
        if (!mqttClient.connected()) {
            if (now - lastMqttRetryTime > 5000) {
                lastMqttRetryTime = now;
                reconnectMqtt();
            }
        } else {
            mqttClient.loop();
        }
    }

    // 8. Pengiriman Telemetri Berkala (Setiap 10 Detik)
    if (mqttClient.connected() && (now - lastTelemetryTime >= TELEMETRY_INTERVAL_MS)) {
        lastTelemetryTime = now;
        publishState();
    }
}

void initDeviceIdentity() {
    uint64_t mac = ESP.getEfuseMac();
    char macSuffix[5];
    snprintf(macSuffix, sizeof(macSuffix), "%04X", (uint16_t)(mac & 0xFFFF));

    char fullDevId[20];
    snprintf(fullDevId, sizeof(fullDevId), "esp32_%06llX", (mac & 0xFFFFFF));
    activeDeviceId = String(fullDevId);

    // SSID & Password unik dicetak di bodi stiker fisik
    apSsid = String("Rumah-Smart-") + macSuffix;
    apPassword = String("rumah-") + macSuffix;

    // Token Klaim Pairing
    char claimTokenBuf[15];
    snprintf(claimTokenBuf, sizeof(claimTokenBuf), "NEXA-%04X-%04X", (uint16_t)((mac >> 16) & 0xFFFF), (uint16_t)(mac & 0xFFFF));
    activeClaimToken = String(claimTokenBuf);

    topicAvailability = String("home/") + activeDeviceId + "/availability";
    topicCmd          = String("home/") + activeDeviceId + "/cmd";
    topicState        = String("home/") + activeDeviceId + "/state";
    topicEvent        = String("home/") + activeDeviceId + "/event";
    topicAck          = String("home/") + activeDeviceId + "/ack";

    Serial.printf("[IDENTITAS] Device ID    : %s\n", activeDeviceId.c_str());
    Serial.printf("[IDENTITAS] SoftAP SSID  : %s\n", apSsid.c_str());
    Serial.printf("[IDENTITAS] SoftAP Pass  : %s\n", apPassword.c_str());
    Serial.printf("[IDENTITAS] Claim Token  : %s\n", activeClaimToken.c_str());
}

void setupPins() {
    pinMode(PIN_LAMP_TENGAH, OUTPUT);
    pinMode(PIN_LAMP_DAPUR_TAMU, OUTPUT);
    pinMode(PIN_LAMP_KAMAR, OUTPUT);
    pinMode(PIN_BUZZER, OUTPUT);
    pinMode(PIN_RELAY, OUTPUT);

    pinMode(PIN_STATUS_LED, OUTPUT);
    pinMode(PIN_FACTORY_RESET_BUTTON, INPUT_PULLUP);

    pinMode(PIN_MQ2_GAS, INPUT);
    pinMode(PIN_LDR_DIGITAL, INPUT);

    updateHardwareOutputs();
}

void startSoftAP() {
    isApMode = true;
    WiFi.disconnect(true);
    delay(100);
    WiFi.mode(WIFI_AP);
    WiFi.softAP(apSsid.c_str(), apPassword.c_str());

    delay(200);
    IPAddress apIP(192, 168, 4, 1);
    WiFi.softAPConfig(apIP, apIP, IPAddress(255, 255, 255, 0));

    Serial.printf("[SoftAP] Memulai Access Point: %s (Password: %s)\n", apSsid.c_str(), apPassword.c_str());
    Serial.printf("[SoftAP] Alamat IP Konfigurasi: %s\n", WiFi.softAPIP().toString().c_str());

    // Inisialisasi Captive Portal DNS Server (redirect semua DNS query ke 192.168.4.1)
    dnsServer.setErrorReplyCode(DNSReplyCode::NoError);
    dnsServer.start(53, "*", apIP);

    // Setup WebServer Rute Captive Portal
    webServer.on("/", HTTP_GET, handleCaptivePortal);
    webServer.on("/save", HTTP_POST, handleSaveConfig);

    // Endpoint deteksi captive portal Android, iOS, Windows
    webServer.on("/generate_204", HTTP_GET, handleCaptivePortal);
    webServer.on("/fwlink", HTTP_GET, handleCaptivePortal);
    webServer.on("/hotspot-detect.html", HTTP_GET, handleCaptivePortal);
    webServer.onNotFound(handleCaptivePortal);

    webServer.begin();
    Serial.println("[SoftAP] Server konfigurasi web lokal aktif di port 80.");
}

void handleCaptivePortal() {
    int n = WiFi.scanNetworks();
    String wifiOptions = "";
    for (int i = 0; i < n; ++i) {
        wifiOptions += "<option value='" + WiFi.SSID(i) + "'>" + WiFi.SSID(i) + " (" + String(WiFi.RSSI(i)) + " dBm)</option>";
    }

    String qrPayload = "{\"id\":\"" + activeDeviceId + "\",\"token\":\"" + activeClaimToken + "\",\"type\":\"esp32\"}";

    String html = R"rawliteral(
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Setup Smart Home 'Rumah'</title>
<style>
  :root {
    --bg: #121316; --surface: #1e2025; --border: #2e323b;
    --text: #f0f2f5; --text-sec: #9ba1b0; --accent: #4a72ff;
  }
  body {
    margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg); color: var(--text); display: flex; justify-content: center;
  }
  .card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
    padding: 24px; max-width: 420px; width: 100%; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  }
  h2 { margin-top: 0; font-size: 20px; font-weight: 700; color: #fff; }
  p { font-size: 13px; color: var(--text-sec); line-height: 1.5; }
  .badge {
    background: rgba(74, 114, 255, 0.15); border: 1px solid var(--accent); color: #82a0ff;
    padding: 4px 8px; border-radius: 6px; font-size: 11px; font-family: monospace; display: inline-block;
  }
  label { font-size: 12px; font-weight: 600; margin-top: 14px; display: block; color: var(--text-sec); }
  input, select {
    width: 100%; padding: 10px 12px; margin-top: 6px; box-sizing: border-box;
    background: #141518; border: 1px solid var(--border); border-radius: 8px; color: #fff; font-size: 14px;
  }
  input:focus, select:focus { outline: none; border-color: var(--accent); }
  button {
    width: 100%; padding: 12px; margin-top: 24px; background: var(--accent);
    color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;
  }
  .info-box {
    background: #15171c; border: 1px dashed var(--border); border-radius: 8px;
    padding: 12px; margin-top: 16px; font-size: 12px; color: var(--text-sec);
  }
</style>
</head>
<body>
<div class="card">
  <h2>Hubungkan ke WiFi Rumah</h2>
  <p>Pilih WiFi rumah Anda agar perangkat ini dapat terhubung ke server Smart Home.</p>
  
  <div class="info-box">
    <div><strong>Device ID:</strong> <code>)rawliteral" + activeDeviceId + R"rawliteral(</code></div>
    <div style="margin-top: 4px;"><strong>Kode Pairing:</strong> <span class="badge">)rawliteral" + activeClaimToken + R"rawliteral(</span></div>
  </div>

  <form method="POST" action="/save">
    <label for="ssid">Nama WiFi Rumah (SSID)</label>
    <select id="ssid" name="ssid">
      )rawliteral" + wifiOptions + R"rawliteral(
    </select>

    <label for="pass">Kata Sandi WiFi</label>
    <input type="password" id="pass" name="pass" placeholder="Masukkan sandi WiFi rumah" required>

    <label for="host">IP / Host Server Smart Home</label>
    <input type="text" id="host" name="host" value="192.168.1.50" required>

    <button type="submit">Sambungkan Perangkat</button>
  </form>
  <p style="margin-top: 16px; text-align: center; font-size: 11px;">
    Setelah tersambung, buka aplikasi <strong>Rumah</strong> di HP Anda lalu scan stiker QR di badan perangkat ini.
  </p>
</div>
</body>
</html>
)rawliteral";

    webServer.send(200, "text/html", html);
}

void handleSaveConfig() {
    String ssid = webServer.arg("ssid");
    String pass = webServer.arg("pass");
    String host = webServer.arg("host");

    if (ssid.isEmpty()) {
        webServer.send(400, "text/plain", "SSID WiFi tidak boleh kosong.");
        return;
    }

    prefs.begin("rumah_config", false);
    prefs.putString("wifi_ssid", ssid);
    prefs.putString("wifi_pass", pass);
    prefs.putString("mqtt_host", host.isEmpty() ? "192.168.1.50" : host);
    prefs.putUShort("mqtt_port", 1883);
    prefs.end();

    String successHtml = R"rawliteral(
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pengaturan Tersimpan</title>
<style>
  body {
    background: #121316; color: #f0f2f5; font-family: sans-serif;
    display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; padding: 20px;
  }
  .card {
    background: #1e2025; border: 1px solid #2e323b; border-radius: 12px;
    padding: 24px; max-width: 400px; text-align: center;
  }
  h3 { color: #4ade80; margin-top: 0; }
  p { font-size: 14px; color: #9ba1b0; line-height: 1.5; }
</style>
</head>
<body>
<div class="card">
  <h3>✓ Pengaturan Disimpan!</h3>
  <p>Perangkat sedang memulai ulang untuk menghubungkan diri ke WiFi rumah Anda.</p>
  <p>Silakan buka aplikasi <strong>Rumah</strong> di HP Anda, tekan tombol <strong>+</strong>, dan scan stiker QR pada perangkat ini untuk menghubungkannya ke akun Anda.</p>
</div>
</body>
</html>
)rawliteral";

    webServer.send(200, "text/html", successHtml);
    delay(2000);
    ESP.restart();
}

void checkFactoryResetButton() {
    // Tombol BOOT (GPIO 0) aktif LOW
    if (digitalRead(PIN_FACTORY_RESET_BUTTON) == LOW) {
        if (!isResetButtonHeld) {
            isResetButtonHeld = true;
            resetButtonHoldStart = millis();
            Serial.println("[RESET] Tombol reset pabrik tertekan...");
        } else {
            uint32_t duration = millis() - resetButtonHoldStart;
            // Jika tombol ditahan selama >= 10 detik (FACTORY_RESET_HOLD_MS)
            if (duration >= FACTORY_RESET_HOLD_MS) {
                Serial.println("[RESET] Tahan 10 detik tercapai! Melakukan FACTORY RESET...");

                // Berikan umpan balik visual kedip sangat cepat 30 kali (3 detik)
                for (int i = 0; i < 30; ++i) {
                    digitalWrite(PIN_STATUS_LED, HIGH);
                    delay(50);
                    digitalWrite(PIN_STATUS_LED, LOW);
                    delay(50);
                }

                // Hapus memori konfigurasi NVS
                prefs.begin("rumah_config", false);
                prefs.clear();
                prefs.end();

                Serial.println("[RESET] Konfigurasi terhapus. Memulai ulang ke mode SoftAP...");
                delay(500);
                ESP.restart();
            }
        }
    } else {
        if (isResetButtonHeld) {
            uint32_t duration = millis() - resetButtonHoldStart;
            if (duration >= 3000 && duration < FACTORY_RESET_HOLD_MS) {
                Serial.println("[PAIR] Tahan 3 detik terdeteksi: Refresh sesi pairing!");
                char newCode[7];
                snprintf(newCode, sizeof(newCode), "%06u", (uint32_t)esp_random() % 1000000);
                activeClaimToken = String(newCode);
                Serial.printf("[PAIR] Kode pairing baru: %s\n", activeClaimToken.c_str());
            }
            isResetButtonHeld = false;
        }
    }
}

void updateStatusLed() {
    uint32_t now = millis();
    if (isApMode) {
        // Mode SoftAP / Provisioning: Kedip Cepat (100 ms)
        if (now - lastLedBlinkTime >= 100) {
            lastLedBlinkTime = now;
            statusLedState = !statusLedState;
            digitalWrite(PIN_STATUS_LED, statusLedState ? HIGH : LOW);
        }
    } else if (WiFi.status() != WL_CONNECTED || !mqttClient.connected()) {
        // Mode Menghubungkan ke Jaringan: Kedip Sedang (500 ms)
        if (now - lastLedBlinkTime >= 500) {
            lastLedBlinkTime = now;
            statusLedState = !statusLedState;
            digitalWrite(PIN_STATUS_LED, statusLedState ? HIGH : LOW);
        }
    } else {
        // Terhubung Normal & Online: Menyala Solid ON
        digitalWrite(PIN_STATUS_LED, HIGH);
    }
}

void setupWifi() {
    WiFi.mode(WIFI_STA);
    WiFi.begin(configuredSsid.c_str(), configuredPass.c_str());
    Serial.printf("[WiFi] Menghubungkan ke %s...\n", configuredSsid.c_str());
    lastWifiRetryTime = millis();
}

void setupMqtt() {
    const char* host = configuredMqttHost.isEmpty() ? "192.168.1.50" : configuredMqttHost.c_str();
    mqttClient.setServer(host, configuredMqttPort);
    mqttClient.setCallback(handleMqttMessage);
    mqttClient.setBufferSize(1024);
}

void setupOTA() {
    ArduinoOTA.setHostname(activeDeviceId.c_str());
    #ifdef OTA_PASSWORD
    ArduinoOTA.setPassword(OTA_PASSWORD);
    #endif

    ArduinoOTA.onStart([]() {
        String type = (ArduinoOTA.getCommand() == U_FLASH) ? "sketch" : "filesystem";
        Serial.println("[OTA] Memulai update: " + type);
    });
    ArduinoOTA.onEnd([]() {
        Serial.println("\n[OTA] Update selesai!");
    });
    ArduinoOTA.onError([](ota_error_t error) {
        Serial.printf("[OTA] Error[%u]\n", error);
    });

    ArduinoOTA.begin();
    Serial.println("[OTA] Siap menerima update over-the-air.");
}

void reconnectMqtt() {
    Serial.printf("[MQTT] Mencoba terhubung ke broker %s:%d...\n", configuredMqttHost.c_str(), configuredMqttPort);

    // Sambungkan dengan Last Will and Testament (LWT)
    if (mqttClient.connect(activeDeviceId.c_str(), activeDeviceId.c_str(), activeClaimToken.c_str(),
                           topicAvailability.c_str(), 1, true, "offline")) {
        Serial.println("[MQTT] Terhubung ke broker!");

        // 1. Publikasikan status online retained
        mqttClient.publish(topicAvailability.c_str(), "online", true);

        // 2. Langganan topik perintah kontrol
        mqttClient.subscribe(topicCmd.c_str(), 1);

        // 3. Publikasikan status awal ke broker
        publishState();
    } else {
        Serial.printf("[MQTT] Gagal terhubung, rc=%d. Akan mencoba lagi...\n", mqttClient.state());
    }
}

void handleMqttMessage(char* topic, byte* payload, unsigned int length) {
    char jsonBuffer[1024];
    if (length >= sizeof(jsonBuffer)) {
        Serial.println("[MQTT] Pesan terlalu besar untuk diproses.");
        return;
    }

    memcpy(jsonBuffer, payload, length);
    jsonBuffer[length] = '\0';

    Serial.printf("[MQTT] Perintah diterima di topik [%s]: %s\n", topic, jsonBuffer);

    StaticJsonDocument<512> doc;
    DeserializationError error = deserializeJson(doc, jsonBuffer);
    if (error) {
        Serial.println("[MQTT] Gagal mem-parsing payload JSON.");
        return;
    }

    const char* cmdId = doc["id"] | "";
    const char* cmdStr = doc["cmd"] | "";
    const char* channel = doc["channel"] | "";
    const char* action = doc["action"] | "set";

    // Tangani perintah factory_reset saat diputus dari akun (unbind)
    if (strcmp(cmdStr, "factory_reset") == 0 || strcmp(action, "factory_reset") == 0 || strcmp(action, "unbind") == 0 || strcmp(channel, "reset") == 0) {
        Serial.println("[MQTT] Perintah factory_reset diterima dari server!");
        StaticJsonDocument<256> ackDoc;
        ackDoc["id"] = cmdId;
        ackDoc["status"] = "resetting";
        ackDoc["device_id"] = activeDeviceId;
        char ackBuffer[256];
        serializeJson(ackDoc, ackBuffer);
        mqttClient.publish(topicAck.c_str(), ackBuffer, 1);
        delay(200);

        // Kedip cepat LED indikator reset selama 3 detik
        for (int i = 0; i < 30; ++i) {
            digitalWrite(PIN_STATUS_LED, HIGH);
            delay(50);
            digitalWrite(PIN_STATUS_LED, LOW);
            delay(50);
        }

        // Hapus konfigurasi NVS
        prefs.begin("rumah_config", false);
        prefs.clear();
        prefs.end();

        Serial.println("[RESET] Konfigurasi terhapus karena unbind oleh pemilik. Memulai ulang ke mode SoftAP...");
        delay(200);
        ESP.restart();
        return;
    }

    JsonVariant value = doc["value"];

    bool targetState = false;
    if (value.is<bool>()) {
        targetState = value.as<bool>();
    } else if (value.is<int>()) {
        targetState = (value.as<int>() > 0);
    }

    if (strcmp(channel, "lamp_tengah") == 0) {
        stateLampTengah = (strcmp(action, "toggle") == 0) ? !stateLampTengah : targetState;
    } else if (strcmp(channel, "lamp_dapur_tamu") == 0) {
        stateLampDapurTamu = (strcmp(action, "toggle") == 0) ? !stateLampDapurTamu : targetState;
    } else if (strcmp(channel, "lamp_kamar") == 0) {
        stateLampKamar = (strcmp(action, "toggle") == 0) ? !stateLampKamar : targetState;
    } else if (strcmp(channel, "relay_fan") == 0) {
        stateRelay = (strcmp(action, "toggle") == 0) ? !stateRelay : targetState;
    } else if (strcmp(channel, "buzzer") == 0) {
        stateBuzzer = (strcmp(action, "toggle") == 0) ? !stateBuzzer : targetState;
    }

    updateHardwareOutputs();

    StaticJsonDocument<256> ackDoc;
    ackDoc["id"] = cmdId;
    ackDoc["channel"] = channel;
    ackDoc["status"] = "ok";
    ackDoc["value"] = targetState;

    char ackBuffer[256];
    serializeJson(ackDoc, ackBuffer);
    mqttClient.publish(topicAck.c_str(), ackBuffer);

    publishState();
}

void publishState() {
    if (!mqttClient.connected()) return;

    StaticJsonDocument<512> doc;
    JsonObject channels = doc.createNestedObject("channels");
    channels["lamp_tengah"] = stateLampTengah;
    channels["lamp_dapur_tamu"] = stateLampDapurTamu;
    channels["lamp_kamar"] = stateLampKamar;
    channels["relay_fan"] = stateRelay;
    channels["buzzer"] = stateBuzzer;

    JsonObject sensors = doc.createNestedObject("sensors");
    sensors["gas_raw"] = currentGasRaw;
    sensors["is_dark"] = currentIsDark;

    doc["ts"] = millis();

    char buffer[512];
    serializeJson(doc, buffer);
    mqttClient.publish(topicState.c_str(), buffer, true);
}

void publishEvent(const char* eventName, const char* channel, float value) {
    if (!mqttClient.connected()) return;

    StaticJsonDocument<256> doc;
    doc["event"] = eventName;
    doc["channel"] = channel;
    doc["value"] = value;
    doc["threshold"] = GAS_RAW_THRESHOLD;
    doc["ts"] = millis();

    char buffer[256];
    serializeJson(doc, buffer);
    mqttClient.publish(topicEvent.c_str(), buffer, 2);
}

void updateHardwareOutputs() {
    digitalWrite(PIN_LAMP_TENGAH, stateLampTengah ? HIGH : LOW);
    digitalWrite(PIN_LAMP_DAPUR_TAMU, stateLampDapurTamu ? HIGH : LOW);
    digitalWrite(PIN_LAMP_KAMAR, stateLampKamar ? HIGH : LOW);
    digitalWrite(PIN_RELAY, stateRelay ? RELAY_ACTIVE_LEVEL : RELAY_INACTIVE_LEVEL);

    if (!isGasAlarmActive) {
        digitalWrite(PIN_BUZZER, stateBuzzer ? HIGH : LOW);
    }
}

void processSensorsAndAlarm() {
    currentGasRaw = analogRead(PIN_MQ2_GAS);
    currentIsDark = (digitalRead(PIN_LDR_DIGITAL) == HIGH);

    uint32_t now = millis();

    if (currentGasRaw >= GAS_RAW_THRESHOLD) {
        if (!isGasAlarmActive) {
            isGasAlarmActive = true;
            Serial.printf("[ALARM GAS] Nilai gas tinggi terdeteksi: %u >= %u!\n", currentGasRaw, GAS_RAW_THRESHOLD);
            publishEvent("gas_alarm", "mq2", currentGasRaw);
        }

        if (now - lastBuzzerToggleTime >= 200) {
            lastBuzzerToggleTime = now;
            buzzerBeepState = !buzzerBeepState;
            digitalWrite(PIN_BUZZER, buzzerBeepState ? HIGH : LOW);
        }
    } else {
        if (isGasAlarmActive) {
            isGasAlarmActive = false;
            Serial.println("[ALARM GAS] Level gas kembali normal.");
            digitalWrite(PIN_BUZZER, stateBuzzer ? HIGH : LOW);
        }
    }
}
