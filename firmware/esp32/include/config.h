#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// --- KONFIGURASI PIN HARDWARE (ESP32) ---
// Saklar Lampu (Output Digital, Aktif HIGH)
constexpr uint8_t PIN_LAMP_TENGAH     = 21;
constexpr uint8_t PIN_LAMP_DAPUR_TAMU = 17;
constexpr uint8_t PIN_LAMP_KAMAR      = 16;

// Sirine / Buzzer Alarm (Output Digital)
constexpr uint8_t PIN_BUZZER          = 19;

// Relay Beban / Kipas (Output Digital, Aktif LOW)
constexpr uint8_t PIN_RELAY           = 32;
constexpr uint8_t RELAY_ACTIVE_LEVEL  = LOW;
constexpr uint8_t RELAY_INACTIVE_LEVEL= HIGH;

// Sensor Lingkungan
// Catatan Keamanan: Output analog MQ-2 adalah 5V, gunakan voltage divider ke ADC ESP32 (maks 3.3V)!
constexpr uint8_t PIN_MQ2_GAS         = 33;  // ADC1 Channel 5
constexpr uint8_t PIN_LDR_DIGITAL     = 22;  // Digital Input

// Tombol Factory Reset Fisik (GPIO 0 adalah tombol BOOT pada ESP32)
constexpr uint8_t PIN_FACTORY_RESET_BUTTON = 0;
constexpr uint32_t FACTORY_RESET_HOLD_MS   = 10000; // Tahan 10 detik untuk reset pabrik (S3/S4)

// LED Indikator Status (GPIO 2 adalah built-in LED ESP32)
constexpr uint8_t PIN_STATUS_LED           = 2;

// --- PARAMETER LOGIKA & AMBANG BATAS ---
constexpr uint16_t GAS_RAW_THRESHOLD  = 1500;  // Ambang batas gas darurat
constexpr uint32_t TELEMETRY_INTERVAL_MS = 10000; // Kirim telemetri setiap 10 detik
constexpr uint32_t WDT_TIMEOUT_SECONDS = 15;     // Watchdog timeout 15 detik

#endif // CONFIG_H

