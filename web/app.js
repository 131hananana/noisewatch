// NoiseWatch web — same logic as noise_watch.py v1.1:
// measure dBFS once per second; if it stays >= threshold for N seconds, alert,
// then wait `cooldown` seconds before alerting again.

const $ = (id) => document.getElementById(id);

const DEFAULTS = { threshold: -20, duration: 10, cooldown: 60, sound: true };
const BASS_CUTOFF_HZ = 150;
const DB_MIN = -60; // left edge of the meter

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

const settings = { ...DEFAULTS, ...load("nw-settings", {}) };
let events = load("nw-events", []);

// ---------- settings UI ----------
const fmt = {
  threshold: (v) => `${v} dBFS`,
  duration: (v) => `${v} dtk`,
  cooldown: (v) => (v >= 60 ? `${Math.floor(v / 60)} mnt${v % 60 ? ` ${v % 60} dtk` : ""}` : `${v} dtk`),
};
for (const key of ["threshold", "duration", "cooldown"]) {
  const input = $(key);
  input.value = settings[key];
  $(`${key}-out`).textContent = fmt[key](settings[key]);
  input.addEventListener("input", () => {
    settings[key] = Number(input.value);
    $(`${key}-out`).textContent = fmt[key](settings[key]);
    save("nw-settings", settings);
    updateThresholdMarker();
  });
}
$("sound").checked = settings.sound;
$("sound").addEventListener("change", () => { settings.sound = $("sound").checked; save("nw-settings", settings); });

function dbToPercent(db) {
  return Math.max(0, Math.min(100, ((db - DB_MIN) / -DB_MIN) * 100));
}
function updateThresholdMarker() {
  $("bar-threshold").style.left = `${dbToPercent(settings.threshold)}%`;
}
updateThresholdMarker();

// ---------- online / offline badge ----------
function updateNet() {
  const on = navigator.onLine;
  $("net").textContent = on ? "online" : "offline";
  $("net").classList.toggle("offline", !on);
}
addEventListener("online", updateNet);
addEventListener("offline", updateNet);
updateNet();

// ---------- audio ----------
let ctx, stream, analyser, timeBuf, freqBuf, tickTimer, wakeLock;
let sumSquares = 0, sampleCount = 0, bassSum = 0, totalSum = 0;
let loudSeconds = 0, lastAlertTime = 0, alertCount = 0, running = false;

async function start() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // Turn off processing: auto gain would flatten the levels we're measuring.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (err) {
    setStatus("idle", "Izin mikrofon ditolak atau tidak tersedia");
    console.error(err);
    return;
  }
  ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);
  timeBuf = new Float32Array(analyser.fftSize);
  freqBuf = new Float32Array(analyser.frequencyBinCount);

  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
  requestWakeLock();

  running = true;
  loudSeconds = 0;
  $("toggle").textContent = "Berhenti";
  $("toggle").classList.add("stop");
  setStatus("normal", "Memantau…");
  sample();
  tickTimer = setInterval(tick, 1000);
}

function stop() {
  running = false;
  clearInterval(tickTimer);
  stream?.getTracks().forEach((t) => t.stop());
  ctx?.close();
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  $("toggle").textContent = "Mulai monitor";
  $("toggle").classList.remove("stop");
  setStatus("idle", "Berhenti");
  $("db").textContent = "--.-";
  $("bar-fill").style.width = "0";
  $("progress-fill").style.width = "0";
}

// Collect samples continuously so each 1-second reading covers the whole second.
function sample() {
  if (!running) return;
  analyser.getFloatTimeDomainData(timeBuf);
  for (let i = 0; i < timeBuf.length; i++) sumSquares += timeBuf[i] * timeBuf[i];
  sampleCount += timeBuf.length;

  analyser.getFloatFrequencyData(freqBuf);
  const binHz = ctx.sampleRate / analyser.fftSize;
  for (let i = 1; i < freqBuf.length; i++) {
    const p = Math.pow(10, freqBuf[i] / 10);
    totalSum += p;
    if (i * binHz < BASS_CUTOFF_HZ) bassSum += p;
  }
  setTimeout(sample, 50);
}

function tick() {
  if (!sampleCount) return;
  const rms = Math.max(Math.sqrt(sumSquares / sampleCount), 1e-10);
  const db = 20 * Math.log10(rms);
  const bassPct = totalSum > 0 ? (bassSum / totalSum) * 100 : 0;
  sumSquares = sampleCount = bassSum = totalSum = 0;

  const t = settings.threshold;
  if (db >= t) setStatus("loud", "🔴 KERAS");
  else if (db >= t - 10) setStatus("elevated", "🟡 Meningkat");
  else setStatus("normal", "🟢 Normal");

  $("db").textContent = db.toFixed(1);
  $("bass").textContent = `${bassPct.toFixed(0)}%`;
  const fill = $("bar-fill");
  fill.style.width = `${dbToPercent(db)}%`;
  fill.style.background = db >= t ? "var(--red)" : db >= t - 10 ? "var(--yellow)" : "var(--green)";

  loudSeconds = db >= t ? loudSeconds + 1 : 0;
  $("loud").textContent = `${loudSeconds}s`;
  $("progress-fill").style.width = `${Math.min(100, (loudSeconds / settings.duration) * 100)}%`;

  const now = Date.now();
  if (loudSeconds >= settings.duration && now - lastAlertTime >= settings.cooldown * 1000) {
    alert_(db, bassPct, loudSeconds);
    lastAlertTime = now;
    loudSeconds = 0;
  }
}

function alert_(db, bassPct, seconds) {
  alertCount++;
  $("alerts").textContent = alertCount;
  events.unshift({ time: new Date().toISOString(), db: +db.toFixed(1), bass: Math.round(bassPct), seconds });
  events = events.slice(0, 500);
  save("nw-events", events);
  renderLog();

  const body = `Bising sekali (${db.toFixed(1)} dBFS) selama ${seconds}+ detik.`;
  if ("Notification" in window && Notification.permission === "granted") {
    navigator.serviceWorker?.ready
      .then((reg) => reg.showNotification("⚠️ NoiseWatch", { body, icon: "icon-192.png", tag: "noisewatch" }))
      .catch(() => new Notification("⚠️ NoiseWatch", { body }));
  }
  navigator.vibrate?.([300, 150, 300]);
  if (settings.sound) beep();
}

function beep() {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = 1320;
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.65);
}

async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* not supported */ }
}
document.addEventListener("visibilitychange", () => {
  if (running && document.visibilityState === "visible") requestWakeLock();
});

function setStatus(cls, text) {
  const el = $("status");
  el.className = `status ${cls}`;
  el.textContent = text;
}

$("toggle").addEventListener("click", () => (running ? stop() : start()));

// ---------- log ----------
function renderLog() {
  const ul = $("log");
  ul.replaceChildren(...events.map((e) => {
    const li = document.createElement("li");
    const when = new Date(e.time).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "medium" });
    li.innerHTML = `<span></span><span class="meta"></span>`;
    li.children[0].textContent = when;
    li.children[1].textContent = `${e.db} dBFS · ${e.seconds}s · bass ${e.bass}%`;
    return li;
  }));
  $("log-empty").hidden = events.length > 0;
}
renderLog();

$("clear").addEventListener("click", () => {
  if (!events.length || !confirm("Hapus semua riwayat?")) return;
  events = [];
  save("nw-events", events);
  renderLog();
});

$("export").addEventListener("click", () => {
  const rows = [["waktu", "dbfs", "durasi_detik", "bass_persen"], ...events.map((e) => [e.time, e.db, e.seconds, e.bass])];
  const blob = new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `noisewatch-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- offline ----------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW gagal:", err));
}
