# Real-Time Monitoring & Diagnosis of Electric Vehicle Performance

An ESP32 and Wokwi prototype for monitoring simulated electric-vehicle telemetry, running rule-based diagnostics, publishing readings to Firebase Realtime Database, and presenting live and historical data in a browser dashboard.

## Features

- Reads simulated battery voltage, battery/motor current, battery temperature, motor temperature, vehicle speed, motor torque, and tyre pressure.
- Prints a monitoring report to the ESP32 Serial Monitor about every 2 seconds at 115200 baud.
- Supports multiple simultaneous diagnostic warnings and reports an overall `NORMAL`, `WARNING`, or `CRITICAL` status.
- Records charging start/end events from two buttons using a DS1307 RTC.
- Uses a rotary encoder to change the monitoring page from 1 to 3.
- Publishes current readings to Firebase Realtime Database over HTTPS.
- Stores timestamped history records approximately every 15 seconds.
- Displays live telemetry, firmware-provided diagnostics, the latest 20 history records, and four historical charts in a responsive web dashboard.

## System Architecture

```text
Wokwi ESP32 → Sensors/Simulation → Diagnosis → Wi-Fi → Firebase Realtime Database → Web Dashboard
```

More specifically:

```text
Wokwi controls
  └─ ESP32 firmware (main.cpp)
       ├─ Serial Monitor report
       ├─ PUT  /EV_Monitoring/live
       └─ POST /EV_Monitoring/history
                ↓
       Firebase Realtime Database
                ↓
       dashboard/app.js realtime listeners
                ↓
       Live cards, diagnostics, history table, and Chart.js charts
```

## Simulated Hardware

| Wokwi component | Purpose in this project | ESP32 connection |
| --- | --- | --- |
| ESP32 DevKit C V4 | Main controller | — |
| `pot1` potentiometer | Battery voltage sensor input | GPIO 34 |
| `pot2` potentiometer | Battery/current sensor input | GPIO 35 |
| `ntc1` NTC temperature sensor | Battery temperature | GPIO 32 |
| `pot3` potentiometer | Tyre pressure sensor input | GPIO 33 |
| `pot6` slide potentiometer | Vehicle speed sensor input | GPIO 39 / VN |
| `pot7` slide potentiometer | Motor torque sensor input | GPIO 36 / VP |
| `temp1` DS18B20 | Motor temperature | GPIO 15 |
| `rtc1` DS1307 | RTC for reports and charging events | SDA GPIO 21, SCL GPIO 22 |
| `btn1` pushbutton | Charging start | GPIO 18 |
| `btn2` pushbutton | Charging end | GPIO 19 |
| `encoder1` KY-040 rotary encoder | Monitoring-page control | CLK GPIO 25, DT GPIO 26 |

The potentiometers represent low-voltage sensor outputs. They are converted in firmware to EV-oriented values; they do not represent direct high-voltage connections to the ESP32.

## Sensor Conversion Ranges

| Reading | Simulation range |
| --- | --- |
| Battery voltage | 300–450 V |
| Battery current | 0–200 A |
| Tyre pressure | 20–40 PSI |
| Vehicle speed | 0–160 km/h |
| Motor torque | 0–400 Nm |
| Battery temperature | Calculated from the 10K NTC/10K divider using beta 3950 |
| Motor temperature | Read from the DS18B20 |

## Firmware Diagnosis Rules

The ESP32 firmware is the source of all diagnosis. The dashboard displays the status and warning strings received from Firebase; it does not create its own thresholds.

| Condition | Warning text | Severity |
| --- | --- | --- |
| Battery voltage < 320 V | `LOW BATTERY VOLTAGE` | Warning |
| Battery current > 180 A | `OVERCURRENT` | Critical |
| Battery temperature > 50 °C | `HIGH BATTERY TEMPERATURE` | Warning |
| Battery temperature > 60 °C | `HIGH BATTERY TEMPERATURE` | Critical |
| Motor temperature > 90 °C | `HIGH MOTOR TEMPERATURE` | Warning |
| Motor temperature > 105 °C | `HIGH MOTOR TEMPERATURE` | Critical |
| Vehicle speed > 140 km/h | `OVERSPEED` | Warning |
| Tyre pressure < 25 PSI | `LOW TYRE PRESSURE` | Warning |
| Motor torque > 350 Nm | `HIGH MOTOR TORQUE` | Warning |
| Battery temperature unavailable | `BATTERY TEMPERATURE SENSOR UNAVAILABLE` | Warning |
| Motor temperature unavailable | `MOTOR TEMPERATURE SENSOR UNAVAILABLE` | Warning |

The firmware collects all applicable warnings. If none apply, it reports `SYSTEM NORMAL` with a `NORMAL` system status. The first applicable condition in the firmware's diagnostic evaluation order becomes the primary diagnosis.

## Software Requirements

### Firmware and Wokwi

- A Wokwi-compatible ESP32 Arduino environment.
- Wokwi VS Code extension to launch the local simulation.
- ESP32 Arduino core, which provides `Arduino.h`, `WiFi.h`, `WiFiClientSecure.h`, `HTTPClient.h`, and `Wire.h`.
- The external libraries listed in `libraries.txt`.

### Dashboard

- A modern browser with JavaScript enabled.
- A local static web server to serve the `dashboard/` folder. The repository does not include a dashboard server or Node package configuration.
- Internet access to load the Firebase and Chart.js CDN scripts.

## Firmware Dependencies

These are the external Arduino libraries listed in [`libraries.txt`](libraries.txt) and included by the firmware:

| Library | Used for |
| --- | --- |
| `OneWire` | DS18B20 single-wire communication |
| `DallasTemperature` | DS18B20 motor-temperature readings |
| `RTClib` | DS1307 RTC access |

The firmware also uses ESP32 Arduino-core networking APIs: `WiFi`, `WiFiClientSecure`, and `HTTPClient`.

## Dashboard Dependencies

The dashboard uses plain HTML, CSS, and JavaScript—there is no npm, package manager, framework, or build system.

| Dependency | How it is loaded | Use |
| --- | --- | --- |
| Firebase Web SDK 12.19.0 | Firebase CDN ES-module imports in `dashboard/app.js` | Firebase initialization and Realtime Database listeners |
| Chart.js 4.4.9 | jsDelivr CDN script in `dashboard/index.html` | Historical line charts |

## Firebase Realtime Database

The firmware and dashboard use the following paths:

| Path | Writer / reader | Purpose |
| --- | --- | --- |
| `/EV_Monitoring/connectionTest` | Dashboard | Writes and reads a browser connection test |
| `/EV_Monitoring/live` | ESP32 writes; dashboard listens | Current monitoring values, diagnosis, warnings, RTC time, monitoring page, and source |
| `/EV_Monitoring/history` | ESP32 writes; dashboard listens | Timestamped history records for the table and charts |

### Publishing behavior

- The firmware sends the current `live` object with an HTTPS `PUT` once per monitoring/report cycle (approximately every 2 seconds).
- The firmware sends a history record with an HTTPS `POST` approximately every 15 seconds. Firebase creates the unique history key and resolves `recordedAt` as its server timestamp.
- The dashboard limits its rendered history view to the newest 20 records and uses the same records for all four charts.

The Firebase client configuration is already kept in `dashboard/app.js`. Do not commit service-account keys, private keys, passwords, or replacement credentials.

## Run the Wokwi Simulation

1. Clone the repository and open its root folder in VS Code.
2. Install the three external Arduino libraries in `libraries.txt` in your ESP32 Arduino environment.
3. Build the Arduino sketch named `Real-Time-Monitoring-Diagnosis-of-Electric-Vehicle-Performance.ino`. The sketch is only an entry point; the application implementation is in `main.cpp`.
4. Confirm that the build produces these files expected by [`wokwi.toml`](wokwi.toml):

   ```text
   build/Real-Time-Monitoring-Diagnosis-of-Electric-Vehicle-Performance.ino.bin
   build/Real-Time-Monitoring-Diagnosis-of-Electric-Vehicle-Performance.ino.elf
   ```

5. Open `diagram.json` and start the Wokwi simulation from the VS Code Wokwi extension.
6. Open the Serial Monitor at **115200 baud**.
7. Adjust the potentiometers/slide potentiometers, DS18B20 temperature, buttons, and encoder in Wokwi to observe updates in the Serial Monitor, Firebase, and dashboard.

`wokwi.toml` references the compiled firmware under `build/`. Rebuild the firmware after changing `main.cpp` so Wokwi uses the updated binary.

## Run the Dashboard

1. Start the Wokwi simulation so it can publish live data and history records.
2. Serve the `dashboard/` folder with a local static web server of your choice.
3. Open `dashboard/index.html` through that local server in a browser.
4. The dashboard runs its Firebase connection test, then listens for live and history changes automatically.

The dashboard has no npm installation step. If you use VS Code, a local static-server/Live Server workflow can serve the folder; that server is not included in this repository.

## Project Structure

```text
.
├── main.cpp
├── Real-Time-Monitoring-Diagnosis-of-Electric-Vehicle-Performance.ino
├── diagram.json
├── libraries.txt
├── wokwi.toml
├── .gitignore
├── README.md
└── dashboard/
    ├── index.html
    ├── style.css
    └── app.js
```

`build/` is generated locally during the firmware build and is excluded from Git by `.gitignore`.

## Important Configuration Notes

- The Wokwi network configuration in firmware uses the simulated `Wokwi-GUEST` network, an empty password, and channel 6.
- HTTPS certificate verification is deliberately relaxed with `setInsecure()` for this Wokwi development prototype. Replace this with certificate validation for a production device.
- The dashboard requires Firebase Realtime Database access that permits the existing browser connection test, live reads, and history reads. The ESP32 REST client also requires permission to write the existing live and history paths.
- The DS1307 must be detected and running for RTC timestamps and charge start/end timestamps to be available.

## Prototype Limitations

- This is a simulation: the analog controls are calibrated representations of sensor-circuit outputs, not production EV measurement circuits.
- The dashboard reads only the newest 20 history records; it does not provide historical pagination, export, or retention management.
- History records accumulate in Firebase; define database retention and access rules before production use.
- The firmware uses development-only relaxed HTTPS certificate verification in Wokwi.
- The dashboard has no authentication flow, and the repository does not define Firebase security rules.

## Team Collaboration Workflow

Use a feature branch and Pull Request for each change:

```bash
git clone <repository-url>
cd Real-Time-Monitoring-Diagnosis-of-Electric-Vehicle-Performance
git checkout -b feature/<short-description>
```

1. Make a focused change on the feature branch.
2. Test the affected firmware simulation and/or dashboard behavior.
3. Review `git status` and ensure unrelated files are not included.
4. Commit the work with a clear message:

   ```bash
   git add <changed-files>
   git commit -m "Describe the change"
   git push -u origin feature/<short-description>
   ```

5. Create a Pull Request from the feature branch, describe the change and test results, and request review before merging.
