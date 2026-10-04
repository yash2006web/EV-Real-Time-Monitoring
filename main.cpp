#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <RTClib.h>
#include <math.h>

// Pin mapping verified against diagram.json.
constexpr uint8_t BATTERY_VOLTAGE_PIN = 34;
constexpr uint8_t BATTERY_CURRENT_PIN = 35;
constexpr uint8_t BATTERY_TEMPERATURE_PIN = 32;
constexpr uint8_t TYRE_PRESSURE_PIN = 33;
constexpr uint8_t VEHICLE_SPEED_PIN = 39;  // VN
constexpr uint8_t MOTOR_TORQUE_PIN = 36;   // VP
constexpr uint8_t MOTOR_TEMPERATURE_PIN = 15;
constexpr uint8_t CHARGING_START_BUTTON_PIN = 18;
constexpr uint8_t CHARGING_END_BUTTON_PIN = 19;
constexpr uint8_t ENCODER_CLK_PIN = 25;
constexpr uint8_t ENCODER_DT_PIN = 26;
constexpr uint8_t RTC_SDA_PIN = 21;
constexpr uint8_t RTC_SCL_PIN = 22;

// ADC and sensor calibration constants. Adjust these when real sensor circuits are fitted.
constexpr int ADC_MAX_VALUE = 4095;
constexpr float BATTERY_VOLTAGE_MIN_V = 300.0f;
constexpr float BATTERY_VOLTAGE_MAX_V = 450.0f;
constexpr float BATTERY_CURRENT_MIN_A = 0.0f;
constexpr float BATTERY_CURRENT_MAX_A = 200.0f;
constexpr float TYRE_PRESSURE_MIN_PSI = 20.0f;
constexpr float TYRE_PRESSURE_MAX_PSI = 40.0f;
constexpr float VEHICLE_SPEED_MIN_KMH = 0.0f;
constexpr float VEHICLE_SPEED_MAX_KMH = 160.0f;
constexpr float MOTOR_TORQUE_MIN_NM = 0.0f;
constexpr float MOTOR_TORQUE_MAX_NM = 400.0f;
constexpr float NTC_BETA = 3950.0f;

// Diagnostic thresholds.
constexpr float LOW_BATTERY_VOLTAGE_V = 320.0f;
constexpr float OVERCURRENT_A = 180.0f;
constexpr float HIGH_BATTERY_TEMPERATURE_C = 50.0f;
constexpr float CRITICAL_BATTERY_TEMPERATURE_C = 60.0f;
constexpr float HIGH_MOTOR_TEMPERATURE_C = 90.0f;
constexpr float CRITICAL_MOTOR_TEMPERATURE_C = 105.0f;
constexpr float OVERSPEED_KMH = 140.0f;
constexpr float LOW_TYRE_PRESSURE_PSI = 25.0f;
constexpr float HIGH_MOTOR_TORQUE_NM = 350.0f;

constexpr unsigned long REPORT_INTERVAL_MS = 2000;
constexpr unsigned long BUTTON_DEBOUNCE_MS = 40;
constexpr unsigned long MOTOR_TEMPERATURE_INTERVAL_MS = 1000;
constexpr unsigned long WIFI_RETRY_INTERVAL_MS = 15000;
constexpr unsigned long HISTORY_INTERVAL_MS = 15000;
constexpr uint16_t FIREBASE_TIMEOUT_MS = 1500;

// Wokwi's standard simulated Wi-Fi network.
constexpr char WIFI_SSID[] = "Wokwi-GUEST";
constexpr char WIFI_PASSWORD[] = "";
constexpr int32_t WOKWI_WIFI_CHANNEL = 6;
constexpr char FIREBASE_LIVE_URL[] =
    "https://ev-real-time-monitoring-default-rtdb.asia-southeast1.firebasedatabase.app/"
    "EV_Monitoring/live.json";
constexpr char FIREBASE_HISTORY_URL[] =
    "https://ev-real-time-monitoring-default-rtdb.asia-southeast1.firebasedatabase.app/"
    "EV_Monitoring/history.json";

OneWire oneWire(MOTOR_TEMPERATURE_PIN);
DallasTemperature motorTemperatureSensor(&oneWire);
RTC_DS1307 rtc;
WiFiClientSecure firebaseSecureClient;

bool rtcAvailable = false;
bool charging = false;
bool hasChargingStartTime = false;
bool hasChargingEndTime = false;
DateTime chargingStartTime;
DateTime chargingEndTime;
float latestMotorTemperatureC = NAN;
unsigned long lastMotorTemperatureRequestMs = 0;
unsigned long lastReportMs = 0;
unsigned long lastHistoryPublishMs = 0;
unsigned long lastWiFiAttemptMs = 0;
int monitoringPage = 1;
int lastEncoderClkState = HIGH;
bool wifiWasConnected = false;
bool wifiConnectionRequested = false;

enum class FirebaseStatus { NOT_ATTEMPTED, UPLOADED, UPLOAD_FAILED };
FirebaseStatus firebaseStatus = FirebaseStatus::NOT_ATTEMPTED;
String lastFirebaseError;
unsigned long lastFirebaseErrorLogMs = 0;

struct ButtonState {
  uint8_t pin;
  bool stableState;
  bool lastReading;
  unsigned long lastChangeMs;
};

ButtonState startButton{CHARGING_START_BUTTON_PIN, HIGH, HIGH, 0};
ButtonState endButton{CHARGING_END_BUTTON_PIN, HIGH, HIGH, 0};

enum class SystemStatus { NORMAL, WARNING, CRITICAL };

struct DiagnosisResult {
  const char* primaryDiagnosis;
  SystemStatus status;
  const char* warnings[9];
  uint8_t warningCount;
};

struct MonitoringData {
  float batteryVoltage;
  float batteryCurrent;
  float batteryTemperature;
  float motorTemperature;
  float vehicleSpeed;
  float motorTorque;
  float tyrePressure;
};

float mapAdcToRange(int adcValue, float outputMin, float outputMax) {
  const int constrainedValue = constrain(adcValue, 0, ADC_MAX_VALUE);
  return outputMin + (outputMax - outputMin) * constrainedValue / ADC_MAX_VALUE;
}

float readBatteryVoltage() {
  return mapAdcToRange(analogRead(BATTERY_VOLTAGE_PIN), BATTERY_VOLTAGE_MIN_V,
                       BATTERY_VOLTAGE_MAX_V);
}

float readBatteryCurrent() {
  return mapAdcToRange(analogRead(BATTERY_CURRENT_PIN), BATTERY_CURRENT_MIN_A,
                       BATTERY_CURRENT_MAX_A);
}

float readBatteryTemperature() {
  const int adcValue = analogRead(BATTERY_TEMPERATURE_PIN);

  // The Wokwi NTC module is a 10K NTC and 10K resistor divider.
  if (adcValue <= 0 || adcValue >= ADC_MAX_VALUE) {
    return NAN;
  }

  const float resistanceRatio = (static_cast<float>(ADC_MAX_VALUE) / adcValue) - 1.0f;
  return 1.0f / (log(resistanceRatio) / NTC_BETA + 1.0f / 298.15f) - 273.15f;
}

float readMotorTemperature() {
  return latestMotorTemperatureC;
}

float readTyrePressure() {
  return mapAdcToRange(analogRead(TYRE_PRESSURE_PIN), TYRE_PRESSURE_MIN_PSI,
                       TYRE_PRESSURE_MAX_PSI);
}

float readVehicleSpeed() {
  return mapAdcToRange(analogRead(VEHICLE_SPEED_PIN), VEHICLE_SPEED_MIN_KMH,
                       VEHICLE_SPEED_MAX_KMH);
}

float readMotorTorque() {
  return mapAdcToRange(analogRead(MOTOR_TORQUE_PIN), MOTOR_TORQUE_MIN_NM,
                       MOTOR_TORQUE_MAX_NM);
}

MonitoringData readMonitoringData() {
  return {
      readBatteryVoltage(),
      readBatteryCurrent(),
      readBatteryTemperature(),
      readMotorTemperature(),
      readVehicleSpeed(),
      readMotorTorque(),
      readTyrePressure(),
  };
}

bool getRtcNow(DateTime& now) {
  if (!rtcAvailable || !rtc.isrunning()) {
    return false;
  }

  now = rtc.now();
  return now.year() >= 2000 && now.year() <= 2099;
}

void printDateTime(const DateTime& time) {
  char timestamp[22];
  snprintf(timestamp, sizeof(timestamp), "%02d/%02d/%04d %02d:%02d:%02d", time.day(),
           time.month(), time.year(), time.hour(), time.minute(), time.second());
  Serial.println(timestamp);
}

void printRtcTime() {
  DateTime now;
  if (getRtcNow(now)) {
    Serial.print("RTC Time: ");
    printDateTime(now);
  } else {
    Serial.println("RTC WARNING: unavailable, stopped, or invalid time.");
  }
}

void updateMotorTemperature() {
  const unsigned long nowMs = millis();
  if (nowMs - lastMotorTemperatureRequestMs < MOTOR_TEMPERATURE_INTERVAL_MS) {
    return;
  }

  const float measuredTemperature = motorTemperatureSensor.getTempCByIndex(0);
  latestMotorTemperatureC =
      measuredTemperature == DEVICE_DISCONNECTED_C ? NAN : measuredTemperature;
  motorTemperatureSensor.requestTemperatures();  // Non-blocking conversion request.
  lastMotorTemperatureRequestMs = nowMs;
}

bool wasButtonPressed(ButtonState& button) {
  const bool reading = digitalRead(button.pin);
  const unsigned long nowMs = millis();

  if (reading != button.lastReading) {
    button.lastChangeMs = nowMs;
    button.lastReading = reading;
  }

  if (nowMs - button.lastChangeMs >= BUTTON_DEBOUNCE_MS && reading != button.stableState) {
    button.stableState = reading;
    return button.stableState == LOW;
  }

  return false;
}

void handleChargingButtons() {
  if (wasButtonPressed(startButton)) {
    charging = true;
    DateTime now;
    hasChargingStartTime = getRtcNow(now);
    if (hasChargingStartTime) {
      chargingStartTime = now;
    }
    Serial.println("CHARGING STARTED");
    if (hasChargingStartTime) {
      Serial.print("Start Time: ");
      printDateTime(chargingStartTime);
    } else {
      Serial.println("Start Time: RTC unavailable");
    }
  }

  if (wasButtonPressed(endButton)) {
    charging = false;
    DateTime now;
    hasChargingEndTime = getRtcNow(now);
    if (hasChargingEndTime) {
      chargingEndTime = now;
    }
    Serial.println("CHARGING ENDED");
    if (hasChargingEndTime) {
      Serial.print("End Time: ");
      printDateTime(chargingEndTime);
    } else {
      Serial.println("End Time: RTC unavailable");
    }
  }
}

void handleEncoder() {
  const int clkState = digitalRead(ENCODER_CLK_PIN);
  if (clkState == LOW && lastEncoderClkState == HIGH) {
    if (digitalRead(ENCODER_DT_PIN) == HIGH) {
      monitoringPage++;
    } else {
      monitoringPage--;
    }

    if (monitoringPage > 3) {
      monitoringPage = 1;
    } else if (monitoringPage < 1) {
      monitoringPage = 3;
    }
    Serial.printf("Monitoring Page: %d\n", monitoringPage);
  }
  lastEncoderClkState = clkState;
}

void addWarning(DiagnosisResult& result, const char* message, bool critical) {
  if (result.warningCount < sizeof(result.warnings) / sizeof(result.warnings[0])) {
    result.warnings[result.warningCount++] = message;
  }
  if (result.primaryDiagnosis == nullptr) {
    result.primaryDiagnosis = message;
  }
  if (critical) {
    result.status = SystemStatus::CRITICAL;
  } else if (result.status == SystemStatus::NORMAL) {
    result.status = SystemStatus::WARNING;
  }
}

DiagnosisResult runDiagnosis(float batteryVoltage, float batteryCurrent, float batteryTemperature,
                             float motorTemperature, float vehicleSpeed, float motorTorque,
                             float tyrePressure) {
  DiagnosisResult result{nullptr, SystemStatus::NORMAL, {}, 0};

  // Critical conditions are checked first so the primary diagnosis is the most urgent one.
  if (batteryCurrent > OVERCURRENT_A) {
    addWarning(result, "OVERCURRENT", true);
  }
  if (!isnan(batteryTemperature) && batteryTemperature > HIGH_BATTERY_TEMPERATURE_C) {
    addWarning(result, "HIGH BATTERY TEMPERATURE",
               batteryTemperature > CRITICAL_BATTERY_TEMPERATURE_C);
  }
  if (!isnan(motorTemperature) && motorTemperature > HIGH_MOTOR_TEMPERATURE_C) {
    addWarning(result, "HIGH MOTOR TEMPERATURE", motorTemperature > CRITICAL_MOTOR_TEMPERATURE_C);
  }
  if (batteryVoltage < LOW_BATTERY_VOLTAGE_V) {
    addWarning(result, "LOW BATTERY VOLTAGE", false);
  }
  if (vehicleSpeed > OVERSPEED_KMH) {
    addWarning(result, "OVERSPEED", false);
  }
  if (tyrePressure < LOW_TYRE_PRESSURE_PSI) {
    addWarning(result, "LOW TYRE PRESSURE", false);
  }
  if (motorTorque > HIGH_MOTOR_TORQUE_NM) {
    addWarning(result, "HIGH MOTOR TORQUE", false);
  }
  if (isnan(batteryTemperature)) {
    addWarning(result, "BATTERY TEMPERATURE SENSOR UNAVAILABLE", false);
  }
  if (isnan(motorTemperature)) {
    addWarning(result, "MOTOR TEMPERATURE SENSOR UNAVAILABLE", false);
  }

  if (result.primaryDiagnosis == nullptr) {
    result.primaryDiagnosis = "SYSTEM NORMAL";
  }
  return result;
}

const char* statusToText(SystemStatus status) {
  switch (status) {
    case SystemStatus::NORMAL:
      return "NORMAL";
    case SystemStatus::WARNING:
      return "WARNING";
    case SystemStatus::CRITICAL:
      return "CRITICAL";
  }
  return "UNKNOWN";
}

const char* firebaseStatusToText() {
  switch (firebaseStatus) {
    case FirebaseStatus::NOT_ATTEMPTED:
      return "NOT ATTEMPTED";
    case FirebaseStatus::UPLOADED:
      return "UPLOADED";
    case FirebaseStatus::UPLOAD_FAILED:
      return "UPLOAD FAILED";
  }
  return "UNKNOWN";
}

const char* wifiStatusToText() {
  return WiFi.status() == WL_CONNECTED ? "CONNECTED" : "DISCONNECTED";
}

String getRtcTimeForFirebase() {
  DateTime now;
  if (!getRtcNow(now)) {
    return "UNAVAILABLE";
  }

  char timestamp[22];
  snprintf(timestamp, sizeof(timestamp), "%02d/%02d/%04d %02d:%02d:%02d", now.day(),
           now.month(), now.year(), now.hour(), now.minute(), now.second());
  return String(timestamp);
}

String jsonNumberOrNull(float value) {
  return isnan(value) ? "null" : String(value, 1);
}

String activeWarningsToJson(const DiagnosisResult& diagnosis) {
  String warnings = "[";
  for (uint8_t i = 0; i < diagnosis.warningCount; ++i) {
    if (i > 0) {
      warnings += ',';
    }
    warnings += '"';
    warnings += diagnosis.warnings[i];
    warnings += '"';
  }
  warnings += ']';
  return warnings;
}

String buildFirebasePayload(const MonitoringData& data, const DiagnosisResult& diagnosis) {
  String payload = "{";
  payload += "\"batteryVoltage\":" + jsonNumberOrNull(data.batteryVoltage);
  payload += ",\"batteryCurrent\":" + jsonNumberOrNull(data.batteryCurrent);
  payload += ",\"batteryTemperature\":" + jsonNumberOrNull(data.batteryTemperature);
  payload += ",\"motorTemperature\":" + jsonNumberOrNull(data.motorTemperature);
  payload += ",\"vehicleSpeed\":" + jsonNumberOrNull(data.vehicleSpeed);
  payload += ",\"motorTorque\":" + jsonNumberOrNull(data.motorTorque);
  payload += ",\"tyrePressure\":" + jsonNumberOrNull(data.tyrePressure);
  payload += ",\"charging\":";
  payload += charging ? "true" : "false";
  payload += ",\"systemStatus\":\"" + String(statusToText(diagnosis.status)) + "\"";
  payload += ",\"primaryDiagnosis\":\"" + String(diagnosis.primaryDiagnosis) + "\"";
  payload += ",\"activeWarnings\":" + activeWarningsToJson(diagnosis);
  payload += ",\"rtcTime\":\"" + getRtcTimeForFirebase() + "\"";
  payload += ",\"monitoringPage\":" + String(monitoringPage);
  payload += ",\"source\":\"wokwi\"";
  payload += '}';
  return payload;
}

String buildHistoryPayload(const MonitoringData& data, const DiagnosisResult& diagnosis) {
  String payload = "{";
  // Firebase resolves this REST server-value placeholder to Unix time in milliseconds.
  payload += "\"recordedAt\":{\".sv\":\"timestamp\"}";
  payload += ",\"rtcTime\":\"" + getRtcTimeForFirebase() + "\"";
  payload += ",\"batteryVoltage\":" + jsonNumberOrNull(data.batteryVoltage);
  payload += ",\"batteryCurrent\":" + jsonNumberOrNull(data.batteryCurrent);
  payload += ",\"batteryTemperature\":" + jsonNumberOrNull(data.batteryTemperature);
  payload += ",\"motorTemperature\":" + jsonNumberOrNull(data.motorTemperature);
  payload += ",\"vehicleSpeed\":" + jsonNumberOrNull(data.vehicleSpeed);
  payload += ",\"motorTorque\":" + jsonNumberOrNull(data.motorTorque);
  payload += ",\"tyrePressure\":" + jsonNumberOrNull(data.tyrePressure);
  payload += ",\"charging\":";
  payload += charging ? "true" : "false";
  payload += ",\"systemStatus\":\"" + String(statusToText(diagnosis.status)) + "\"";
  payload += ",\"primaryDiagnosis\":\"" + String(diagnosis.primaryDiagnosis) + "\"";
  payload += '}';
  return payload;
}

void logFirebaseError(const String& message) {
  const unsigned long nowMs = millis();
  if (message != lastFirebaseError || nowMs - lastFirebaseErrorLogMs >= WIFI_RETRY_INTERVAL_MS) {
    Serial.printf("Firebase: %s\n", message.c_str());
    lastFirebaseError = message;
    lastFirebaseErrorLogMs = nowMs;
  }
}

void connectToWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  const unsigned long nowMs = millis();
  if (wifiConnectionRequested && nowMs - lastWiFiAttemptMs < WIFI_RETRY_INTERVAL_MS) {
    return;
  }

  lastWiFiAttemptMs = nowMs;
  wifiConnectionRequested = true;
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD, WOKWI_WIFI_CHANNEL);
  Serial.println("WiFi: connecting to Wokwi-GUEST...");
}

void maintainWiFiConnection() {
  const bool wifiConnected = WiFi.status() == WL_CONNECTED;
  if (wifiConnected && !wifiWasConnected) {
    Serial.printf("WiFi: connected (%s)\n", WiFi.localIP().toString().c_str());
  } else if (!wifiConnected && wifiWasConnected) {
    Serial.println("WiFi: disconnected; retrying in the background.");
  }
  wifiWasConnected = wifiConnected;

  if (!wifiConnected) {
    connectToWiFi();
  }
}

void publishToFirebase(const MonitoringData& data, const DiagnosisResult& diagnosis) {
  if (WiFi.status() != WL_CONNECTED) {
    firebaseStatus = FirebaseStatus::UPLOAD_FAILED;
    return;
  }

  HTTPClient http;
  http.setConnectTimeout(FIREBASE_TIMEOUT_MS);
  http.setTimeout(FIREBASE_TIMEOUT_MS);
  if (!http.begin(firebaseSecureClient, FIREBASE_LIVE_URL)) {
    firebaseStatus = FirebaseStatus::UPLOAD_FAILED;
    logFirebaseError("HTTPS client could not start.");
    return;
  }

  http.addHeader("Content-Type", "application/json");
  const int responseCode = http.PUT(buildFirebasePayload(data, diagnosis));
  http.end();

  if (responseCode >= 200 && responseCode < 300) {
    firebaseStatus = FirebaseStatus::UPLOADED;
    lastFirebaseError = "";
    return;
  }

  firebaseStatus = FirebaseStatus::UPLOAD_FAILED;
  logFirebaseError("upload failed (HTTP " + String(responseCode) + ").");
}

void publishHistoryIfDue(const MonitoringData& data, const DiagnosisResult& diagnosis) {
  const unsigned long nowMs = millis();
  // lastHistoryPublishMs starts at zero, so the first attempt is about 15 seconds after startup.
  if (nowMs - lastHistoryPublishMs < HISTORY_INTERVAL_MS) {
    return;
  }
  lastHistoryPublishMs = nowMs;

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("History: upload failed (WiFi disconnected).");
    return;
  }

  HTTPClient http;
  http.setConnectTimeout(FIREBASE_TIMEOUT_MS);
  http.setTimeout(FIREBASE_TIMEOUT_MS);
  if (!http.begin(firebaseSecureClient, FIREBASE_HISTORY_URL)) {
    Serial.println("History: upload failed (HTTPS client could not start).");
    return;
  }

  http.addHeader("Content-Type", "application/json");
  // POST lets Firebase create one unique push key under /EV_Monitoring/history.
  const int responseCode = http.POST(buildHistoryPayload(data, diagnosis));
  http.end();

  if (responseCode >= 200 && responseCode < 300) {
    Serial.println("History: uploaded");
  } else {
    Serial.printf("History: upload failed (HTTP %d).\n", responseCode);
  }
}

void printReading(const char* label, float value, const char* unit) {
  Serial.print(label);
  if (isnan(value)) {
    Serial.println("UNAVAILABLE");
    return;
  }
  Serial.print(value, 1);
  Serial.print(' ');
  Serial.println(unit);
}

void printMonitoringReport(const MonitoringData& data, const DiagnosisResult& diagnosis) {
  Serial.println("========================================");
  Serial.println("EV MONITORING SYSTEM");
  Serial.println("========================================");
  printRtcTime();
  printReading("Battery Voltage : ", data.batteryVoltage, "V");
  printReading("Battery Current : ", data.batteryCurrent, "A");
  printReading("Battery Temp    : ", data.batteryTemperature, "C");
  printReading("Motor Temp      : ", data.motorTemperature, "C");
  printReading("Vehicle Speed   : ", data.vehicleSpeed, "km/h");
  printReading("Motor Torque    : ", data.motorTorque, "Nm");
  printReading("Tyre Pressure   : ", data.tyrePressure, "PSI");
  Serial.printf("Charging        : %s\n", charging ? "CHARGING" : "NOT CHARGING");
  if (hasChargingStartTime) {
    Serial.print("Charge Start    : ");
    printDateTime(chargingStartTime);
  }
  if (hasChargingEndTime) {
    Serial.print("Charge End      : ");
    printDateTime(chargingEndTime);
  }
  Serial.printf("System Status   : %s\n", statusToText(diagnosis.status));
  Serial.printf("Primary Diagnosis: %s\n", diagnosis.primaryDiagnosis);
  if (diagnosis.warningCount > 0) {
    Serial.println("ACTIVE WARNINGS:");
    for (uint8_t i = 0; i < diagnosis.warningCount; ++i) {
      Serial.printf("* %s\n", diagnosis.warnings[i]);
    }
  }
  Serial.printf("WiFi Status     : %s\n", wifiStatusToText());
  Serial.printf("Firebase Status : %s\n", firebaseStatusToText());
  Serial.println("========================================");
}

void setup() {
  Serial.begin(115200);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  // DEVELOPMENT/WOKWI ONLY: replace with certificate validation in production.
  firebaseSecureClient.setInsecure();

  analogReadResolution(12);
  analogSetPinAttenuation(BATTERY_VOLTAGE_PIN, ADC_11db);
  analogSetPinAttenuation(BATTERY_CURRENT_PIN, ADC_11db);
  analogSetPinAttenuation(BATTERY_TEMPERATURE_PIN, ADC_11db);
  analogSetPinAttenuation(TYRE_PRESSURE_PIN, ADC_11db);
  analogSetPinAttenuation(VEHICLE_SPEED_PIN, ADC_11db);
  analogSetPinAttenuation(MOTOR_TORQUE_PIN, ADC_11db);

  pinMode(CHARGING_START_BUTTON_PIN, INPUT_PULLUP);
  pinMode(CHARGING_END_BUTTON_PIN, INPUT_PULLUP);
  pinMode(ENCODER_CLK_PIN, INPUT_PULLUP);
  pinMode(ENCODER_DT_PIN, INPUT_PULLUP);
  startButton.stableState = startButton.lastReading = digitalRead(startButton.pin);
  endButton.stableState = endButton.lastReading = digitalRead(endButton.pin);
  lastEncoderClkState = digitalRead(ENCODER_CLK_PIN);

  Wire.begin(RTC_SDA_PIN, RTC_SCL_PIN);
  rtcAvailable = rtc.begin();
  if (!rtcAvailable) {
    Serial.println("RTC WARNING: DS1307 was not detected.");
  } else if (!rtc.isrunning()) {
    Serial.println("RTC WARNING: DS1307 clock is not running.");
  }

  motorTemperatureSensor.begin();
  motorTemperatureSensor.setWaitForConversion(false);
  motorTemperatureSensor.requestTemperatures();
  lastMotorTemperatureRequestMs = millis();

  connectToWiFi();

  Serial.println("EV monitoring simulation started.");
}

void loop() {
  updateMotorTemperature();
  handleChargingButtons();
  handleEncoder();
  maintainWiFiConnection();

  if (millis() - lastReportMs >= REPORT_INTERVAL_MS) {
    lastReportMs = millis();
    const MonitoringData data = readMonitoringData();
    const DiagnosisResult diagnosis =
        runDiagnosis(data.batteryVoltage, data.batteryCurrent, data.batteryTemperature,
                     data.motorTemperature, data.vehicleSpeed, data.motorTorque,
                     data.tyrePressure);
    publishToFirebase(data, diagnosis);
    publishHistoryIfDue(data, diagnosis);
    printMonitoringReport(data, diagnosis);
  }
}
