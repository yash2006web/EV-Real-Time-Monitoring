// Firebase Web SDK modules are loaded from Firebase's CDN, so npm is not needed.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getDatabase,
  get,
  limitToLast,
  onValue,
  orderByChild,
  query,
  ref,
  set,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";

const connectionState = document.getElementById("connectionState");
const connectionDot = document.getElementById("connectionDot");
const lastUpdated = document.getElementById("lastUpdated");
const historyStatus = document.getElementById("historyStatus");
const historyTableBody = document.getElementById("historyTableBody");
const chartElements = {
  batteryPerformance: {
    canvas: document.getElementById("batteryPerformanceChart"),
    container: document.getElementById("batteryPerformanceChartContainer"),
    state: document.getElementById("batteryPerformanceChartState"),
  },
  temperature: {
    canvas: document.getElementById("temperatureChart"),
    container: document.getElementById("temperatureChartContainer"),
    state: document.getElementById("temperatureChartState"),
  },
  vehiclePerformance: {
    canvas: document.getElementById("vehiclePerformanceChart"),
    container: document.getElementById("vehiclePerformanceChartContainer"),
    state: document.getElementById("vehiclePerformanceChartState"),
  },
  tyrePressure: {
    canvas: document.getElementById("tyrePressureChart"),
    container: document.getElementById("tyrePressureChartContainer"),
    state: document.getElementById("tyrePressureChartState"),
  },
};
const historyCharts = {};

// Firebase configuration supplied for the "EV Monitoring Dashboard" web app.
const firebaseConfig = {
  apiKey: "AIzaSyA3M1boZm5_7Udglt2Uri8gokBBdUT5wqg",
  authDomain: "ev-real-time-monitoring.firebaseapp.com",
  databaseURL: "https://ev-real-time-monitoring-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ev-real-time-monitoring",
  storageBucket: "ev-real-time-monitoring.firebasestorage.app",
  messagingSenderId: "668440369165",
  appId: "1:668440369165:web:1e3f60f311914cc191dd44",
};

const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);
const connectionTestReference = ref(database, "/EV_Monitoring/connectionTest");
const liveMonitoringReference = ref(database, "/EV_Monitoring/live");
const HISTORY_DISPLAY_LIMIT = 20;
const historyMonitoringQuery = query(
  ref(database, "/EV_Monitoring/history"),
  orderByChild("recordedAt"),
  limitToLast(HISTORY_DISPLAY_LIMIT),
);

const valueElements = {
  batteryVoltage: document.getElementById("batteryVoltage"),
  batteryCurrent: document.getElementById("batteryCurrent"),
  batteryTemperature: document.getElementById("batteryTemperature"),
  motorTemperature: document.getElementById("motorTemperature"),
  vehicleSpeed: document.getElementById("vehicleSpeed"),
  motorTorque: document.getElementById("motorTorque"),
  tyrePressure: document.getElementById("tyrePressure"),
  charging: document.getElementById("chargingStatus"),
  systemStatus: document.getElementById("systemStatus"),
  primaryDiagnosis: document.getElementById("primaryDiagnosis"),
  activeWarnings: document.getElementById("activeWarnings"),
  rtcTime: document.getElementById("rtcTime"),
  monitoringPage: document.getElementById("monitoringPage"),
  source: document.getElementById("dataSource"),
};

const unitElements = {
  batteryVoltage: document.getElementById("batteryVoltageUnit"),
  batteryCurrent: document.getElementById("batteryCurrentUnit"),
  batteryTemperature: document.getElementById("batteryTemperatureUnit"),
  motorTemperature: document.getElementById("motorTemperatureUnit"),
  vehicleSpeed: document.getElementById("vehicleSpeedUnit"),
  motorTorque: document.getElementById("motorTorqueUnit"),
  tyrePressure: document.getElementById("tyrePressureUnit"),
};

const systemStatusCard = document.getElementById("systemStatusCard");
const primaryDiagnosisCard = document.getElementById("primaryDiagnosisCard");
const activeWarningsCard = document.getElementById("activeWarningsCard");
const diagnosticSystemStatus = document.getElementById("diagnosticSystemStatus");
const diagnosticPrimaryDiagnosis = document.getElementById("diagnosticPrimaryDiagnosis");

// These associations use only firmware-generated warning text; no browser thresholds are added.
const sensorCards = {
  "LOW BATTERY VOLTAGE": document.getElementById("batteryVoltageCard"),
  OVERCURRENT: document.getElementById("batteryCurrentCard"),
  "HIGH BATTERY TEMPERATURE": document.getElementById("batteryTemperatureCard"),
  "HIGH MOTOR TEMPERATURE": document.getElementById("motorTemperatureCard"),
  OVERSPEED: document.getElementById("vehicleSpeedCard"),
  "HIGH MOTOR TORQUE": document.getElementById("motorTorqueCard"),
  "LOW TYRE PRESSURE": document.getElementById("tyrePressureCard"),
};

function showConnectionState(message, state) {
  connectionState.textContent = message;
  connectionDot.classList.remove("status-dot--pending", "status-dot--connected", "status-dot--error");
  connectionDot.classList.add(`status-dot--${state}`);
}

function readableError(error) {
  return error.code || error.message || "Unknown Firebase error";
}

function displayText(element, value, unavailableText = "Unavailable") {
  element.textContent = value === null || value === undefined || value === "" ? unavailableText : value;
}

function displayNumber(element, unitElement, value, unit) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    element.textContent = "Unavailable";
    unitElement.textContent = "";
    return;
  }
  element.textContent = value.toFixed(1);
  unitElement.textContent = unit;
}

function updateDiagnosticsPanel(liveData) {
  const waitingText = "Waiting for Firebase data";
  const systemStatus = liveData.systemStatus;
  const primaryDiagnosis = liveData.primaryDiagnosis;

  diagnosticSystemStatus.textContent =
    typeof systemStatus === "string" && systemStatus.trim() !== "" ? systemStatus : waitingText;
  diagnosticPrimaryDiagnosis.textContent =
    typeof primaryDiagnosis === "string" && primaryDiagnosis.trim() !== "" ? primaryDiagnosis : waitingText;
}

function displayWarnings(warnings) {
  const warningItems = Array.isArray(warnings)
    ? warnings.filter((warning) => typeof warning === "string" && warning.trim() !== "")
    : typeof warnings === "string" && warnings.trim() !== ""
      ? [warnings]
      : [];

  valueElements.activeWarnings.replaceChildren();
  valueElements.activeWarnings.classList.toggle("warning-list--clear", warningItems.length === 0);
  activeWarningsCard.classList.toggle("warnings-card--active", warningItems.length > 0);

  const itemsToDisplay = warningItems.length > 0 ? warningItems : ["✓ No active warnings"];
  for (const warning of itemsToDisplay) {
    const warningItem = document.createElement("li");
    warningItem.textContent = warning;
    valueElements.activeWarnings.append(warningItem);
  }

  return warningItems;
}

function updateDiagnosisVisuals(systemStatus, warnings) {
  const status = typeof systemStatus === "string" ? systemStatus.toUpperCase() : "";
  const statusClasses = ["status-card--normal", "status-card--warning", "status-card--critical"];
  const diagnosisClasses = ["diagnosis-card--warning", "diagnosis-card--critical"];
  const statusClass =
    status === "NORMAL"
      ? "status-card--normal"
      : status === "WARNING"
        ? "status-card--warning"
        : status === "CRITICAL"
          ? "status-card--critical"
          : null;

  systemStatusCard.classList.remove(...statusClasses);
  primaryDiagnosisCard.classList.remove(...diagnosisClasses);
  if (statusClass) {
    systemStatusCard.classList.add(statusClass);
  }
  if (status === "WARNING") {
    primaryDiagnosisCard.classList.add("diagnosis-card--warning");
  } else if (status === "CRITICAL") {
    primaryDiagnosisCard.classList.add("diagnosis-card--critical");
  }

  Object.values(sensorCards).forEach((card) => card.classList.remove("sensor-card--alert"));
  warnings.forEach((warning) => sensorCards[warning]?.classList.add("sensor-card--alert"));
}

function updateLiveDashboard(liveData) {
  displayNumber(valueElements.batteryVoltage, unitElements.batteryVoltage, liveData.batteryVoltage, "V");
  displayNumber(valueElements.batteryCurrent, unitElements.batteryCurrent, liveData.batteryCurrent, "A");
  displayNumber(valueElements.batteryTemperature, unitElements.batteryTemperature, liveData.batteryTemperature, "\u00b0C");
  displayNumber(valueElements.motorTemperature, unitElements.motorTemperature, liveData.motorTemperature, "\u00b0C");
  displayNumber(valueElements.vehicleSpeed, unitElements.vehicleSpeed, liveData.vehicleSpeed, "km/h");
  displayNumber(valueElements.motorTorque, unitElements.motorTorque, liveData.motorTorque, "Nm");
  displayNumber(valueElements.tyrePressure, unitElements.tyrePressure, liveData.tyrePressure, "PSI");

  if (typeof liveData.charging === "boolean") {
    valueElements.charging.textContent = liveData.charging ? "CHARGING" : "NOT CHARGING";
  } else {
    valueElements.charging.textContent = "Unavailable";
  }

  displayText(valueElements.systemStatus, liveData.systemStatus);
  displayText(valueElements.primaryDiagnosis, liveData.primaryDiagnosis);
  updateDiagnosticsPanel(liveData);
  const warnings = displayWarnings(liveData.activeWarnings);
  updateDiagnosisVisuals(liveData.systemStatus, warnings);
  displayText(valueElements.rtcTime, liveData.rtcTime);
  displayText(valueElements.monitoringPage, liveData.monitoringPage);
  displayText(valueElements.source, liveData.source);

  const receivedAt = new Date();
  lastUpdated.textContent = Number.isNaN(receivedAt.getTime())
    ? "Unavailable"
    : receivedAt.toLocaleTimeString();
}

function historyNumber(value, unit) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(1)} ${unit}`
    : "Unavailable";
}

function historyText(value) {
  return value === null || value === undefined || value === "" ? "Unavailable" : String(value);
}

function historyTime(record) {
  if (typeof record.rtcTime === "string" && record.rtcTime.trim() !== "" &&
      record.rtcTime.toUpperCase() !== "UNAVAILABLE") {
    return record.rtcTime;
  }

  const timestamp = Number(record.recordedAt);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : "Unavailable";
}

function historyCharging(value) {
  if (value === true) {
    return "Charging";
  }
  if (value === false) {
    return "Not Charging";
  }
  return "Unavailable";
}

function historyStatusClass(value) {
  switch (typeof value === "string" ? value.toUpperCase() : "") {
    case "NORMAL":
      return "status-badge--normal";
    case "WARNING":
      return "status-badge--warning";
    case "CRITICAL":
      return "status-badge--critical";
    default:
      return "";
  }
}

function appendHistoryCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value;
  row.append(cell);
}

function showHistoryMessage(message, isError = false) {
  historyTableBody.replaceChildren();
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 11;
  cell.className = `history-message${isError ? " history-message--error" : ""}`;
  cell.textContent = message;
  row.append(cell);
  historyTableBody.append(row);
}

function getMostRecentHistoryRecords(historyData) {
  return Object.entries(historyData || {})
    .map(([key, record]) => ({
      key,
      record: record && typeof record === "object" ? record : {},
      recordedAt: Number(record?.recordedAt),
    }))
    .sort((first, second) => {
      const firstTime = Number.isFinite(first.recordedAt) ? first.recordedAt : -Infinity;
      const secondTime = Number.isFinite(second.recordedAt) ? second.recordedAt : -Infinity;
      return secondTime - firstTime || second.key.localeCompare(first.key);
    })
    .slice(0, HISTORY_DISPLAY_LIMIT);
}

function renderHistoryTable(records) {
  if (records.length === 0) {
    historyStatus.textContent = "No historical data available";
    showHistoryMessage("No historical data available");
    return;
  }

  historyTableBody.replaceChildren();
  for (const { record } of records) {
    const row = document.createElement("tr");
    appendHistoryCell(row, historyTime(record));
    appendHistoryCell(row, historyNumber(record.batteryVoltage, "V"));
    appendHistoryCell(row, historyNumber(record.batteryCurrent, "A"));
    appendHistoryCell(row, historyNumber(record.batteryTemperature, "\u00b0C"));
    appendHistoryCell(row, historyNumber(record.motorTemperature, "\u00b0C"));
    appendHistoryCell(row, historyNumber(record.vehicleSpeed, "km/h"));
    appendHistoryCell(row, historyNumber(record.motorTorque, "Nm"));
    appendHistoryCell(row, historyNumber(record.tyrePressure, "PSI"));
    appendHistoryCell(row, historyCharging(record.charging));

    const statusCell = document.createElement("td");
    const statusBadge = document.createElement("span");
    statusBadge.className = `status-badge ${historyStatusClass(record.systemStatus)}`.trim();
    statusBadge.textContent = historyText(record.systemStatus);
    statusCell.append(statusBadge);
    row.append(statusCell);

    appendHistoryCell(row, historyText(record.primaryDiagnosis));
    historyTableBody.append(row);
  }
  historyStatus.textContent = `Showing ${records.length} most recent record${records.length === 1 ? "" : "s"}`;
}

function validHistoryNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const chartDefinitions = {
  batteryPerformance: {
    fields: [
      { key: "batteryVoltage", label: "Battery Voltage (V)", color: "#36d399", axis: "voltage" },
      { key: "batteryCurrent", label: "Battery Current (A)", color: "#60a5fa", axis: "current" },
    ],
    axes: {
      voltage: { title: "Battery Voltage (V)", position: "left" },
      current: { title: "Battery Current (A)", position: "right" },
    },
  },
  temperature: {
    fields: [
      { key: "batteryTemperature", label: "Battery Temperature (°C)", color: "#f6c453", axis: "temperature" },
      { key: "motorTemperature", label: "Motor Temperature (°C)", color: "#ff8a8a", axis: "temperature" },
    ],
    axes: {
      temperature: { title: "Temperature (°C)", position: "left" },
    },
  },
  vehiclePerformance: {
    fields: [
      { key: "vehicleSpeed", label: "Vehicle Speed (km/h)", color: "#a78bfa", axis: "speed" },
      { key: "motorTorque", label: "Motor Torque (Nm)", color: "#f97316", axis: "torque" },
    ],
    axes: {
      speed: { title: "Vehicle Speed (km/h)", position: "left" },
      torque: { title: "Motor Torque (Nm)", position: "right" },
    },
  },
  tyrePressure: {
    fields: [
      { key: "tyrePressure", label: "Tyre Pressure (PSI)", color: "#22d3ee", axis: "pressure" },
    ],
    axes: {
      pressure: { title: "Tyre Pressure (PSI)", position: "left" },
    },
  },
};

function destroyHistoryChart(chartKey) {
  if (historyCharts[chartKey]) {
    historyCharts[chartKey].destroy();
    delete historyCharts[chartKey];
  }
}

function setChartMessage(chartKey, message) {
  const elements = chartElements[chartKey];
  destroyHistoryChart(chartKey);
  elements.state.textContent = message;
  elements.state.hidden = false;
  elements.container.hidden = true;
}

function updateHistoryChart(chartKey, chronologicalRecords) {
  const definition = chartDefinitions[chartKey];
  const elements = chartElements[chartKey];
  const validRecords = chronologicalRecords.filter(({ record }) =>
    definition.fields.some((field) => validHistoryNumber(record[field.key]) !== null),
  );

  if (validRecords.length < 2) {
    setChartMessage(chartKey, "Not enough historical data for chart");
    return;
  }

  if (!window.Chart) {
    setChartMessage(chartKey, "Chart library failed to load");
    return;
  }

  const scales = {
    x: {
      title: { display: true, text: "Time" },
      ticks: { color: "#a8bbce", maxRotation: 45, minRotation: 0 },
      grid: { color: "rgba(168, 187, 206, 0.12)" },
    },
  };
  for (const [axisKey, axis] of Object.entries(definition.axes)) {
    scales[axisKey] = {
      type: "linear",
      position: axis.position,
      title: { display: true, text: axis.title },
      ticks: { color: "#a8bbce" },
      grid: {
        color: "rgba(168, 187, 206, 0.12)",
        drawOnChartArea: axis.position !== "right",
      },
    };
  }

  destroyHistoryChart(chartKey);
  elements.state.hidden = true;
  elements.container.hidden = false;
  historyCharts[chartKey] = new window.Chart(elements.canvas, {
    type: "line",
    data: {
      labels: validRecords.map(({ record }) => historyTime(record)),
      datasets: definition.fields.map((field) => ({
        label: field.label,
        data: validRecords.map(({ record }) => validHistoryNumber(record[field.key])),
        borderColor: field.color,
        backgroundColor: field.color,
        yAxisID: field.axis,
        borderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 5,
        tension: 0.25,
        spanGaps: false,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "#edf6ff" } },
        tooltip: { enabled: true },
      },
      scales,
    },
  });
}

function renderHistoryCharts(records) {
  // The table is newest-first; charts use the same records in oldest-first order.
  const chronologicalRecords = [...records].reverse();
  Object.keys(chartDefinitions).forEach((chartKey) => updateHistoryChart(chartKey, chronologicalRecords));
}

function renderHistoryData(historyData) {
  const records = getMostRecentHistoryRecords(historyData);
  renderHistoryTable(records);
  renderHistoryCharts(records);
}

function showHistoryChartError() {
  Object.keys(chartDefinitions).forEach((chartKey) =>
    setChartMessage(chartKey, "Historical chart data failed to load"),
  );
}

function startHistoryListener() {
  // One listener drives both the table and charts from the same newest 20 records.
  onValue(
    historyMonitoringQuery,
    (snapshot) => renderHistoryData(snapshot.val()),
    (error) => {
      console.error("Firebase history listener failed:", error);
      historyStatus.textContent = `Historical data failed: ${readableError(error)}`;
      showHistoryMessage(`Historical data failed: ${readableError(error)}`, true);
      showHistoryChartError();
    },
  );
}

function startLiveDataListener() {
  // onValue keeps this page synchronized with every change at /EV_Monitoring/live.
  onValue(
    liveMonitoringReference,
    (snapshot) => {
      if (!snapshot.exists()) {
        showConnectionState("Firebase Connected - Waiting for live data", "connected");
        return;
      }

      updateLiveDashboard(snapshot.val());
      showConnectionState("Firebase Connected - Live data received", "connected");
    },
    (error) => {
      console.error("Firebase live-data listener failed:", error);
      showConnectionState(`Live data failed: ${readableError(error)}`, "error");
    },
  );
}

async function runConnectionTest() {
  try {
    showConnectionState("CONNECTING TO FIREBASE...", "pending");
    const testData = {
      status: "connected",
      source: "dashboard",
      timestamp: Date.now(),
    };
    await set(connectionTestReference, testData);

    const snapshot = await get(connectionTestReference);
    const savedData = snapshot.val();
    if (!snapshot.exists() || savedData.status !== "connected" || savedData.source !== "dashboard") {
      throw new Error("Connection test data could not be verified after writing.");
    }

    console.info("Firebase connection test succeeded:", savedData);
    showConnectionState("Firebase Connected - Waiting for live data", "connected");
  } catch (error) {
    console.error("Firebase connection test failed:", error);
    showConnectionState(`Connection failed: ${readableError(error)}`, "error");
  }
}

// Keep the connection test and live listener active when the dashboard opens.
runConnectionTest();
startLiveDataListener();
startHistoryListener();
