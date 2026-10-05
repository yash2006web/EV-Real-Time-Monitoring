// Firebase Web SDK modules are loaded from Firebase's CDN, so npm is not needed.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getDatabase, get, limitToLast, onValue, orderByChild, query, ref, set } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyA3M1boZm5_7Udglt2Uri8gokBBdUT5wqg",
  authDomain: "ev-real-time-monitoring.firebaseapp.com",
  databaseURL: "https://ev-real-time-monitoring-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ev-real-time-monitoring",
  storageBucket: "ev-real-time-monitoring.firebasestorage.app",
  messagingSenderId: "668440369165",
  appId: "1:668440369165:web:1e3f60f311914cc191dd44",
};

const database = getDatabase(initializeApp(firebaseConfig));
const connectionTestReference = ref(database, "/EV_Monitoring/connectionTest");
const liveMonitoringReference = ref(database, "/EV_Monitoring/live");
const HISTORY_DISPLAY_LIMIT = 20;
const historyMonitoringQuery = query(ref(database, "/EV_Monitoring/history"), orderByChild("recordedAt"), limitToLast(HISTORY_DISPLAY_LIMIT));

const byId = (id) => document.getElementById(id);
const connectionState = byId("connectionState");
const connectionDot = byId("connectionDot");
const lastUpdated = byId("lastUpdated");
const dataFreshness = byId("dataFreshness");
const historyStatus = byId("historyStatus");
const historyTableBody = byId("historyTableBody");
const warningCount = byId("warningCount");
const systemStatusCard = byId("systemStatusCard");
const primaryDiagnosisCard = byId("primaryDiagnosisCard");
const activeWarningsCard = byId("activeWarningsCard");
const diagnosticSystemStatus = byId("diagnosticSystemStatus");
const diagnosticPrimaryDiagnosis = byId("diagnosticPrimaryDiagnosis");
const chargingCard = byId("chargingCard");
const selectedSensorLabel = byId("selectedSensorLabel");
const selectedSensorName = byId("selectedSensorName");
const selectedSensorValue = byId("selectedSensorValue");
const selectedSensorStatus = byId("selectedSensorStatus");
const valueElements = {
  batteryVoltage: byId("batteryVoltage"), batteryCurrent: byId("batteryCurrent"), batteryTemperature: byId("batteryTemperature"), motorTemperature: byId("motorTemperature"), vehicleSpeed: byId("vehicleSpeed"), motorTorque: byId("motorTorque"), tyrePressure: byId("tyrePressure"), charging: byId("chargingStatus"), systemStatus: byId("systemStatus"), primaryDiagnosis: byId("primaryDiagnosis"), activeWarnings: byId("activeWarnings"), rtcTime: byId("rtcTime"), monitoringPage: byId("monitoringPage"), source: byId("dataSource"),
};
const unitElements = {
  batteryVoltage: byId("batteryVoltageUnit"), batteryCurrent: byId("batteryCurrentUnit"), batteryTemperature: byId("batteryTemperatureUnit"), motorTemperature: byId("motorTemperatureUnit"), vehicleSpeed: byId("vehicleSpeedUnit"), motorTorque: byId("motorTorqueUnit"), tyrePressure: byId("tyrePressureUnit"),
};
const sensorMeta = {
  batteryVoltage: { name: "Battery Voltage", unit: "V", warning: "LOW BATTERY VOLTAGE" },
  batteryCurrent: { name: "Battery Current", unit: "A", warning: "OVERCURRENT" },
  batteryTemperature: { name: "Battery Temperature", unit: "°C", warning: "HIGH BATTERY TEMPERATURE" },
  motorTemperature: { name: "Motor Temperature", unit: "°C", warning: "HIGH MOTOR TEMPERATURE" },
  vehicleSpeed: { name: "Vehicle Speed", unit: "km/h", warning: "OVERSPEED" },
  motorTorque: { name: "Motor Torque", unit: "Nm", warning: "HIGH MOTOR TORQUE" },
  tyrePressure: { name: "Tyre Pressure", unit: "PSI", warning: "LOW TYRE PRESSURE" },
};
const sensorCards = Object.fromEntries(Object.entries(sensorMeta).map(([key, meta]) => [meta.warning, byId(`${key}Card`)]));
const chartElements = {
  batteryPerformance: { canvas: byId("batteryPerformanceChart"), container: byId("batteryPerformanceChartContainer"), state: byId("batteryPerformanceChartState") },
  temperature: { canvas: byId("temperatureChart"), container: byId("temperatureChartContainer"), state: byId("temperatureChartState") },
  vehiclePerformance: { canvas: byId("vehiclePerformanceChart"), container: byId("vehiclePerformanceChartContainer"), state: byId("vehiclePerformanceChartState") },
  tyrePressure: { canvas: byId("tyrePressureChart"), container: byId("tyrePressureChartContainer"), state: byId("tyrePressureChartState") },
};
const historyCharts = {};
let currentLiveData = null;
let selectedSensorKey = null;
let allHistoryRecords = [];
let historyRange = 20;
let lastLiveReceivedAt = null;
const visibleSeries = Object.fromEntries(Object.keys(sensorMeta).map((key) => [key, true]));

function readableError(error) { return error.code || error.message || "Unknown Firebase error"; }
function validNumber(value) { return typeof value === "number" && Number.isFinite(value); }
function displayText(element, value, fallback = "Unavailable") { element.textContent = value === null || value === undefined || value === "" ? fallback : value; }
function displayNumber(key, value) { const { unit } = sensorMeta[key]; valueElements[key].textContent = validNumber(value) ? value.toFixed(1) : "Unavailable"; unitElements[key].textContent = validNumber(value) ? unit : ""; }
function historyNumber(value, unit) { return validNumber(value) ? `${value.toFixed(1)} ${unit}` : "Unavailable"; }
function historyText(value) { return value === null || value === undefined || value === "" ? "Unavailable" : String(value); }
function historyTime(record) { if (typeof record.rtcTime === "string" && record.rtcTime.trim() && record.rtcTime.toUpperCase() !== "UNAVAILABLE") return record.rtcTime; const timestamp = Number(record.recordedAt); return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : "Unavailable"; }
function historyCharging(value) { return value === true ? "Charging" : value === false ? "Not Charging" : "Unavailable"; }
function warningItems(warnings) { return Array.isArray(warnings) ? warnings.filter((item) => typeof item === "string" && item.trim()) : typeof warnings === "string" && warnings.trim() ? [warnings] : []; }
function statusClass(status) { const value = typeof status === "string" ? status.toUpperCase() : ""; return value === "NORMAL" ? "status-badge--normal" : value === "WARNING" ? "status-badge--warning" : value === "CRITICAL" ? "status-badge--critical" : ""; }

function showConnectionState(message, state) { connectionState.textContent = message; connectionDot.classList.remove("status-dot--pending", "status-dot--connected", "status-dot--error"); connectionDot.classList.add(`status-dot--${state}`); }
function updateFreshness() { const seconds = lastLiveReceivedAt ? Math.floor((Date.now() - lastLiveReceivedAt) / 1000) : null; dataFreshness.classList.remove("freshness-state--waiting", "freshness-state--stale"); if (seconds === null) { dataFreshness.textContent = "WAITING · No recent live data"; dataFreshness.classList.add("freshness-state--waiting"); } else if (seconds > 10) { dataFreshness.textContent = `STALE · Updated ${seconds} seconds ago`; dataFreshness.classList.add("freshness-state--stale"); } else { dataFreshness.textContent = `LIVE · Updated ${seconds} second${seconds === 1 ? "" : "s"} ago`; } }

function updateFocus() {
  document.querySelectorAll(".metric-card").forEach((card) => card.classList.toggle("metric-card--selected", card.dataset.sensor === selectedSensorKey));
  if (!selectedSensorKey || !currentLiveData) { selectedSensorLabel.textContent = "SELECT A SENSOR"; selectedSensorName.textContent = "Click a telemetry card"; selectedSensorValue.textContent = "—"; selectedSensorStatus.textContent = "Inspect its live reading and status here."; return; }
  const meta = sensorMeta[selectedSensorKey]; const value = currentLiveData[selectedSensorKey]; const warnings = warningItems(currentLiveData.activeWarnings);
  selectedSensorLabel.textContent = "SELECTED SENSOR"; selectedSensorName.textContent = meta.name; selectedSensorValue.textContent = validNumber(value) ? `${value.toFixed(1)} ${meta.unit}` : "Unavailable"; selectedSensorStatus.textContent = warnings.includes(meta.warning) ? meta.warning : "Normal";
}

function displayWarnings(warnings) {
  const warningsList = warningItems(warnings); valueElements.activeWarnings.replaceChildren(); valueElements.activeWarnings.classList.toggle("warning-list--clear", warningsList.length === 0); activeWarningsCard.classList.toggle("warnings-card--active", warningsList.length > 0);
  (warningsList.length ? warningsList : ["No active warnings"]).forEach((warning) => { const item = document.createElement("li"); item.textContent = warning; valueElements.activeWarnings.append(item); });
  warningCount.textContent = `${warningsList.length} Active Warning${warningsList.length === 1 ? "" : "s"}`; return warningsList;
}
function updateDiagnosisVisuals(status, warnings) {
  const upper = typeof status === "string" ? status.toUpperCase() : ""; systemStatusCard.classList.remove("status-card--normal", "status-card--warning", "status-card--critical"); primaryDiagnosisCard.classList.remove("diagnosis-card--warning", "diagnosis-card--critical"); if (["NORMAL", "WARNING", "CRITICAL"].includes(upper)) systemStatusCard.classList.add(`status-card--${upper.toLowerCase()}`); if (upper === "WARNING" || upper === "CRITICAL") primaryDiagnosisCard.classList.add(`diagnosis-card--${upper.toLowerCase()}`);
  Object.values(sensorCards).forEach((card) => card.classList.remove("metric-card--alert", "metric-card--critical")); Object.entries(sensorCards).forEach(([warning, card]) => { if (warnings.includes(warning)) card.classList.add(upper === "CRITICAL" ? "metric-card--critical" : "metric-card--alert"); });
  Object.entries(sensorMeta).forEach(([key, meta]) => { const indicator = byId(`${key}Availability`); indicator.textContent = warnings.includes(meta.warning) ? meta.warning : "Normal"; });
}
function updateLiveDashboard(data) {
  currentLiveData = data; Object.keys(sensorMeta).forEach((key) => displayNumber(key, data[key])); valueElements.charging.textContent = typeof data.charging === "boolean" ? data.charging ? "CHARGING" : "NOT CHARGING" : "Unavailable"; chargingCard.classList.toggle("charging-card--active", data.charging === true);
  displayText(valueElements.systemStatus, data.systemStatus, "Waiting for Firebase data"); displayText(valueElements.primaryDiagnosis, data.primaryDiagnosis, "Waiting for Firebase data"); displayText(diagnosticSystemStatus, data.systemStatus, "Waiting for Firebase data"); displayText(diagnosticPrimaryDiagnosis, data.primaryDiagnosis, "Waiting for Firebase data"); const warnings = displayWarnings(data.activeWarnings); updateDiagnosisVisuals(data.systemStatus, warnings); displayText(valueElements.rtcTime, data.rtcTime); displayText(valueElements.monitoringPage, data.monitoringPage); displayText(valueElements.source, data.source);
  lastLiveReceivedAt = Date.now(); lastUpdated.textContent = new Date(lastLiveReceivedAt).toLocaleTimeString(); updateFreshness(); updateFocus();
}

function getMostRecentHistoryRecords(historyData) { return Object.entries(historyData || {}).map(([key, record]) => ({ key, record: record && typeof record === "object" ? record : {}, recordedAt: Number(record?.recordedAt) })).sort((a, b) => (Number.isFinite(b.recordedAt) ? b.recordedAt : -Infinity) - (Number.isFinite(a.recordedAt) ? a.recordedAt : -Infinity) || b.key.localeCompare(a.key)).slice(0, HISTORY_DISPLAY_LIMIT); }
function selectedHistoryRecords() { return allHistoryRecords.slice(0, historyRange); }
function showHistoryMessage(message, isError = false) { historyTableBody.replaceChildren(); const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 11; cell.className = `history-message${isError ? " history-message--error" : ""}`; cell.textContent = message; row.append(cell); historyTableBody.append(row); }
function appendCell(row, value) { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); }
function renderHistoryTable(records) { if (!records.length) { historyStatus.textContent = "No historical data available"; showHistoryMessage("No historical data available"); return; } historyTableBody.replaceChildren(); for (const { record } of records) { const row = document.createElement("tr"); appendCell(row, historyTime(record)); appendCell(row, historyNumber(record.batteryVoltage, "V")); appendCell(row, historyNumber(record.batteryCurrent, "A")); appendCell(row, historyNumber(record.batteryTemperature, "°C")); appendCell(row, historyNumber(record.motorTemperature, "°C")); appendCell(row, historyNumber(record.vehicleSpeed, "km/h")); appendCell(row, historyNumber(record.motorTorque, "Nm")); appendCell(row, historyNumber(record.tyrePressure, "PSI")); appendCell(row, historyCharging(record.charging)); const status = document.createElement("td"); const badge = document.createElement("span"); badge.className = `status-badge ${statusClass(record.systemStatus)}`; badge.textContent = historyText(record.systemStatus); status.append(badge); row.append(status); appendCell(row, historyText(record.primaryDiagnosis)); historyTableBody.append(row); } historyStatus.textContent = `Showing ${records.length} most recent record${records.length === 1 ? "" : "s"}`; }
function numbers(records, field) { return records.map(({ record }) => record[field]).filter(validNumber); }
function statistic(records, field, operation, unit) { const values = numbers(records, field); if (!values.length) return "Unavailable"; const result = operation === "max" ? Math.max(...values) : values.reduce((sum, value) => sum + value, 0) / values.length; return `${result.toFixed(1)} ${unit}`; }
function renderAnalysis(records) { byId("averageBatteryVoltage").textContent = statistic(records, "batteryVoltage", "average", "V"); byId("maxBatteryCurrent").textContent = statistic(records, "batteryCurrent", "max", "A"); byId("maxMotorTemperature").textContent = statistic(records, "motorTemperature", "max", "°C"); byId("averageVehicleSpeed").textContent = statistic(records, "vehicleSpeed", "average", "km/h"); byId("warningRecords").textContent = records.filter(({ record }) => ["WARNING", "CRITICAL"].includes(String(record.systemStatus).toUpperCase())).length; }

const chartDefinitions = {
  batteryPerformance: { fields: [{ key: "batteryVoltage", label: "Battery Voltage (V)", color: "#35d596", axis: "voltage" }, { key: "batteryCurrent", label: "Battery Current (A)", color: "#67b9ff", axis: "current" }], axes: { voltage: ["Battery Voltage (V)", "left"], current: ["Battery Current (A)", "right"] } },
  temperature: { fields: [{ key: "batteryTemperature", label: "Battery Temperature (°C)", color: "#f4b84c", axis: "temperature" }, { key: "motorTemperature", label: "Motor Temperature (°C)", color: "#ff6d73", axis: "temperature" }], axes: { temperature: ["Temperature (°C)", "left"] } },
  vehiclePerformance: { fields: [{ key: "vehicleSpeed", label: "Vehicle Speed (km/h)", color: "#a78bfa", axis: "speed" }, { key: "motorTorque", label: "Motor Torque (Nm)", color: "#f97316", axis: "torque" }], axes: { speed: ["Vehicle Speed (km/h)", "left"], torque: ["Motor Torque (Nm)", "right"] } },
  tyrePressure: { fields: [{ key: "tyrePressure", label: "Tyre Pressure (PSI)", color: "#22d3ee", axis: "pressure" }], axes: { pressure: ["Tyre Pressure (PSI)", "left"] } },
};
function destroyChart(key) { if (historyCharts[key]) { historyCharts[key].destroy(); delete historyCharts[key]; } }
function setChartMessage(key, message) { const element = chartElements[key]; destroyChart(key); element.state.textContent = message; element.state.hidden = false; element.container.hidden = true; }
function updateHistoryChart(key, chronologicalRecords) { const definition = chartDefinitions[key]; const element = chartElements[key]; const availableFields = definition.fields.filter((field) => visibleSeries[field.key]); const validRecords = chronologicalRecords.filter(({ record }) => availableFields.some((field) => validNumber(record[field.key]))); if (!availableFields.length) { setChartMessage(key, "All datasets are hidden by Dashboard Controls"); return; } if (validRecords.length < 2) { setChartMessage(key, "Not enough historical data for chart"); return; } if (!window.Chart) { setChartMessage(key, "Chart library failed to load"); return; }
  const scales = { x: { title: { display: true, text: "Time", color: "#9bb1c3" }, ticks: { color: "#9bb1c3", maxRotation: 45 }, grid: { color: "#29496366" } } }; Object.entries(definition.axes).forEach(([axis, [title, position]]) => { scales[axis] = { type: "linear", position, title: { display: true, text: title, color: "#9bb1c3" }, ticks: { color: "#9bb1c3" }, grid: { color: "#29496366", drawOnChartArea: position !== "right" } }; });
  destroyChart(key); element.state.hidden = true; element.container.hidden = false; historyCharts[key] = new window.Chart(element.canvas, { type: "line", data: { labels: validRecords.map(({ record }) => historyTime(record)), datasets: availableFields.map((field) => ({ label: field.label, data: validRecords.map(({ record }) => validNumber(record[field.key]) ? record[field.key] : null), borderColor: field.color, backgroundColor: field.color, yAxisID: field.axis, borderWidth: 2.5, pointRadius: 2.5, pointHoverRadius: 5, tension: .28, spanGaps: false })) }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { labels: { color: "#eef7ff", usePointStyle: true } }, tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${context.parsed.y}` } } }, scales } }); }
function renderHistoryCharts(records) { const chronological = [...records].reverse(); Object.keys(chartDefinitions).forEach((key) => updateHistoryChart(key, chronological)); }
function renderHistoryView() { const records = selectedHistoryRecords(); renderHistoryTable(records); renderAnalysis(records); renderHistoryCharts(records); }

function startHistoryListener() { onValue(historyMonitoringQuery, (snapshot) => { allHistoryRecords = getMostRecentHistoryRecords(snapshot.val()); renderHistoryView(); }, (error) => { historyStatus.textContent = `Historical data failed: ${readableError(error)}`; showHistoryMessage(`Historical data failed: ${readableError(error)}`, true); Object.keys(chartDefinitions).forEach((key) => setChartMessage(key, "Historical chart data failed to load")); }); }
function startLiveDataListener() { onValue(liveMonitoringReference, (snapshot) => { if (!snapshot.exists()) { showConnectionState("Firebase Connected - Waiting for live data", "connected"); return; } updateLiveDashboard(snapshot.val()); showConnectionState("Firebase Connected - Live data received", "connected"); }, (error) => { console.error("Firebase live-data listener failed:", error); showConnectionState(`Live data failed: ${readableError(error)}`, "error"); }); }
async function runConnectionTest() { try { showConnectionState("CONNECTING TO FIREBASE...", "pending"); const data = { status: "connected", source: "dashboard", timestamp: Date.now() }; await set(connectionTestReference, data); const snapshot = await get(connectionTestReference); if (!snapshot.exists() || snapshot.val().status !== "connected" || snapshot.val().source !== "dashboard") throw new Error("Connection test data could not be verified after writing."); showConnectionState("Firebase Connected - Waiting for live data", "connected"); } catch (error) { console.error("Firebase connection test failed:", error); showConnectionState(`Connection failed: ${readableError(error)}`, "error"); } }

document.querySelectorAll(".metric-card").forEach((card) => card.addEventListener("click", () => { selectedSensorKey = card.dataset.sensor; updateFocus(); }));
document.querySelectorAll("[data-range]").forEach((button) => button.addEventListener("click", () => { historyRange = Number(button.dataset.range); document.querySelectorAll("[data-range]").forEach((item) => item.classList.toggle("is-active", item === button)); renderHistoryView(); }));
document.querySelectorAll("[data-series]").forEach((input) => input.addEventListener("change", () => { visibleSeries[input.dataset.series] = input.checked; renderHistoryCharts(selectedHistoryRecords()); }));
setInterval(updateFreshness, 1000);
runConnectionTest(); startLiveDataListener(); startHistoryListener();
