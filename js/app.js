/* ================= ESTADO DE LA RED (VLSM) ================= */
let osiTimeouts = []; // <-- FIX: Variable requerida para limpiar animaciones

const RANGES = { A: [1, 6], B: [9, 14], M: [17, 18] };

// MAC del router por interfaz (lado A, lado B, lado Marcador)
const ROUTER_MAC = {
  A: 'AA:BB:CC:00:00:FA',
  B: 'AA:BB:CC:00:00:FB',
  M: 'AA:BB:CC:00:00:FE'
};

const devices = [
  { id: 'Control A1', net: 'A', ip: '192.168.1.1',  mac: 'AA:BB:CC:00:00:11' },
  { id: 'Control A2', net: 'A', ip: '192.168.1.2',  mac: 'AA:BB:CC:00:00:12' },
  { id: 'Robot A1',   net: 'A', ip: '192.168.1.3',  mac: 'AA:BB:CC:00:00:01' },
  { id: 'Robot A2',   net: 'A', ip: '192.168.1.4',  mac: 'AA:BB:CC:00:00:02' },
  { id: 'Control B1', net: 'B', ip: '192.168.1.9',  mac: 'AA:BB:CC:00:00:21' },
  { id: 'Control B2', net: 'B', ip: '192.168.1.10', mac: 'AA:BB:CC:00:00:22' },
  { id: 'Robot B1',   net: 'B', ip: '192.168.1.11', mac: 'AA:BB:CC:00:00:03' },
  { id: 'Robot B2',   net: 'B', ip: '192.168.1.12', mac: 'AA:BB:CC:00:00:04' },
  { id: 'Marcador',   net: 'M', ip: '192.168.1.18', mac: 'AA:BB:CC:00:00:99' }
];

const GATEWAYS = { A: '192.168.1.6', B: '192.168.1.14', M: '192.168.1.17' };

let noise = 0;
let score = { naranja: 0, verde: 0 };
let autoInterval = null;

// Datos para las fórmulas de clase
const LINK_BPS = 1000000;      // R: ancho de banda del enlace (bps)
const DISTANCE_M = 10;         // d: distancia (m)
const PROP_SPEED = 300000000;  // s: velocidad de propagación (m/s)
const BANDWIDTH_HZ = 500000;   // B: ancho de banda del canal (Hz)
const TCP_FLAGS = ['CWR', 'ECE', 'URG', 'ACK', 'PSH', 'RST', 'SYN', 'FIN'];

/* ================= ELEMENTOS DEL DOM ================= */
const logBox = document.getElementById('log');
const noiseSlider = document.getElementById('noise-slider');
const noiseVal = document.getElementById('noise-val');

/* ================= VALIDACIÓN DE DIRECCIÓN IPv4 ================= */
function isValidIP(ip, currentIndex) {
  if (!/^192\.168\.1\.\d+$/.test(ip)) return false;
  const num = parseInt(ip.split('.')[3], 10);
  const [min, max] = RANGES[devices[currentIndex].net];
  if (num < min || num > max) return false;

  for (let i = 0; i < devices.length; i++) {
    if (i !== currentIndex && devices[i].ip === ip) return false;
  }
  return true;
}

/* ================= INTERFAZ: DISPOSITIVOS ================= */
function renderDevices() {
  const container = document.getElementById('device-list');
  container.innerHTML = '';

  devices.forEach((dev, index) => {
    const row = document.createElement('div');
    row.className = 'device-item';

    const label = document.createElement('span');
    label.className = 'dev-name';
    label.textContent = dev.id;

    const ipInput = document.createElement('input');
    ipInput.type = 'text';
    ipInput.value = dev.ip;
    if (!isValidIP(dev.ip, index)) ipInput.classList.add('invalid');

    ipInput.addEventListener('change', (e) => {
      const newIp = e.target.value.trim();
      devices[index].ip = newIp;
      if (isValidIP(newIp, index)) {
        e.target.classList.remove('invalid');
        log('CONFIG | IPv4', `${dev.id}: IP actualizada a ${newIp}.`, 'info');
      } else {
        e.target.classList.add('invalid');
        log('ERROR | CAPA 3', `IP inválida o duplicada en ${dev.id} (${newIp}).`, 'err');
      }
    });

    row.appendChild(label);
    row.appendChild(ipInput);
    container.appendChild(row);
  });
}

/* ================= DIARIO DE RED ================= */
function log(msgTag, msg, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${msgTag}] ${msg}`;
  logBox.prepend(entry);
  if (logBox.children.length > 60) {
    logBox.lastChild.remove();
  }
}

/* ================= PILA OSI DOBLE CON ANIMACIÓN ================= */
function animateDualOSI(transport, srcIp, dstIp, payloadSize, totalBits, isLost, macSrc, macDst, rejectL5 = false) {
  osiTimeouts.forEach(clearTimeout);
  osiTimeouts = [];

  document.querySelectorAll('.osi-list li').forEach(el => el.className = '');

  const frame = `[${macDst} | ${macSrc} | Checksum]`;

  const outTexts = [
    `7. Aplicación: Orden`,
    `6. Presentación: ${payloadSize}B`,
    `5. Sesión: Activa`,
    `4. Transporte: ${transport}`,
    `3. Red: ${srcIp}`,
    `2. Enlace: ${frame}`,
    `1. Física: ${totalBits}b`
  ];

  const cut = isLost || rejectL5;
  const inTexts = [
    `1. Física: Recibe bits`,
    isLost ? `2. Enlace: Checksum FAIL` : `2. Enlace: ${frame} OK`,
    isLost ? `3. Red: —` : `3. Red: ${dstIp} OK`,
    isLost ? `4. Transporte: —` : `4. Transporte: ${transport}`,
    isLost ? `5. Sesión: —` : (rejectL5 ? `5. Sesión: control no emparejado` : `5. Sesión: Sincronizada`),
    cut ? `6. Presentación: —` : `6. Presentación: Decodificado`,
    cut ? `7. Aplicación: —` : `7. Aplicación: Ejecutado`
  ];

  let delay = 0;
  const stepTime = 80;

  for (let i = 0; i < 7; i++) {
    const el = document.getElementById('OUT-L' + (7 - i));
    osiTimeouts.push(setTimeout(() => {
      el.textContent = outTexts[i];
      el.className = 'active';
    }, delay));
    delay += stepTime;
  }

  for (let i = 0; i < 7; i++) {
    const el = document.getElementById('IN-L' + (i + 1));
    osiTimeouts.push(setTimeout(() => {
      el.textContent = inTexts[i];
      if (isLost && i === 1) el.className = 'error';
      else if (isLost && i > 1) el.className = '';
      else if (rejectL5 && i === 4) el.className = 'error';
      else if (rejectL5 && i > 4) el.className = '';
      else el.className = 'ok-in';
    }, delay));
    delay += stepTime;
  }
}

/* ================= CÁLCULOS VISIBLES ================= */

// 1. Retardos: R_tran = L / R   y   R_prop = d / s   (en ms)
function showDelays(totalBits) {
  const tran = (totalBits / LINK_BPS) * 1000;
  const prop = (DISTANCE_M / PROP_SPEED) * 1000;
  document.getElementById('calc-tran').textContent =
    `R_tran = ${totalBits} / 1,000,000 = ${tran.toFixed(3)} ms`;
  document.getElementById('calc-prop').textContent =
    `R_prop = ${DISTANCE_M} / 300,000,000 = ${prop.toFixed(6)} ms (despreciable)`;
}

// 2. Shannon: C = B · log2(1 + SNR), con SNR ligado al slider de ruido
function updateShannon() {
  const el = document.getElementById('calc-shan');
  if (noise === 0) {
    el.textContent = 'SNR = ∞ (sin ruido: aplica Nyquist)';
    return;
  }
  const snr = (1 - noise) / noise;
  const c = BANDWIDTH_HZ * Math.log2(1 + snr);
  el.textContent =
    `SNR = (1 − ${noise.toFixed(2)}) / ${noise.toFixed(2)} = ${snr.toFixed(2)}\n` +
    `C = 500,000 · log₂(1 + ${snr.toFixed(2)}) = ${Math.round(c).toLocaleString('en-US')} bps`;
}

// 3. Encabezado TCP: ilumina las banderas activas
function setTcpFlags(active) {
  TCP_FLAGS.forEach(f => {
    document.getElementById('flag-' + f).classList.toggle('on', active.includes(f));
  });
}

// 4. Checksum de 4 bits en complemento a 1
function showChecksum(isLost) {
  const bin = n => n.toString(2).padStart(4, '0');
  const blocks = [0b1010, 0b1100, 0b0011];
  const lines = [`Bloques enviados: ${blocks.map(bin).join(', ')}`];

  let acc = blocks[0];
  for (let i = 1; i < blocks.length; i++) {
    const raw = acc + blocks[i];
    if (raw > 15) {
      const wrapped = (raw & 15) + 1;
      lines.push(`${bin(acc)} + ${bin(blocks[i])} = ${raw.toString(2)} → acarreo circular: ${bin(raw & 15)} + 1 = ${bin(wrapped)}`);
      acc = wrapped;
    } else {
      lines.push(`${bin(acc)} + ${bin(blocks[i])} = ${bin(raw)} (sin acarreo)`);
      acc = raw;
    }
  }

  const checksum = (~acc) & 15;
  lines.push(`Suma = ${bin(acc)}`);
  lines.push(`Complemento a 1 = ${bin(checksum)} → Checksum`);

  // En el receptor: si el ruido dañó el paquete, un bit llega volteado
  const received = blocks.slice();
  if (isLost) {
    const bi = Math.floor(Math.random() * received.length);
    const bit = Math.floor(Math.random() * 4);
    const before = received[bi];
    received[bi] ^= (1 << bit);
    lines.push(`Ruido: el bloque ${bin(before)} llega como ${bin(received[bi])}`);
  }

  let rx = received[0];
  for (let i = 1; i < received.length; i++) {
    const raw = rx + received[i];
    rx = raw > 15 ? (raw & 15) + 1 : raw;
  }
  let total = rx + checksum;
  if (total > 15) total = (total & 15) + 1;

  const ok = total === 15;
  lines.push(`Receptor: ${bin(rx)} + ${bin(checksum)} = ${bin(total)} → ${ok ? 'VÁLIDO (1111)' : 'INVÁLIDO (≠ 1111): se descarta'}`);

  document.getElementById('calc-chk').textContent = lines.join('\n');
}

/* ================= SIMULACIÓN DE RED ================= */
function simulateNetwork(action, team, player) {
  let srcId, dstId, transport, payloadSize, actionLabel;

  if (action === 'move' || action === 'kick') {
    transport = 'UDP';
    payloadSize = 6;
    srcId = `Control ${player}`;
    dstId = `Robot ${player}`;
    actionLabel = action === 'move' ? 'MOVIMIENTO' : 'PATADA';
  } else if (action === 'goal') {
    transport = 'TCP';
    payloadSize = 30;
    srcId = `Robot ${player}`;
    dstId = 'Marcador';
    actionLabel = 'GOL';
  }

  const srcIdx = devices.findIndex(d => d.id === srcId);
  const dstIdx = devices.findIndex(d => d.id === dstId);
  const srcDev = devices[srcIdx];
  const dstDev = devices[dstIdx];

  if (!srcDev || !dstDev) return;

  if (!isValidIP(srcDev.ip, srcIdx) || !isValidIP(dstDev.ip, dstIdx)) {
    log(`BLOQUEO L3 | ${actionLabel}`, `IP inválida entre ${srcId} (${srcDev.ip}) y ${dstId} (${dstDev.ip}).`, 'err');
    return;
  }

  // L = tamaño de la trama en bits
  const transportBytes = transport === 'UDP' ? 8 : 20;
  const totalBytes = 14 + 20 + transportBytes + payloadSize;
  const totalBits = totalBytes * 8;

  showDelays(totalBits);
  setTcpFlags([]);

  const isLost = Math.random() < noise;
  const msgTag = `${transport} | ${actionLabel} (${player})`;

  const macSrc = srcDev.mac;
  const macDst = transport === 'TCP' ? ROUTER_MAC[srcDev.net] : dstDev.mac;

  if (transport === 'UDP') {
    animateDualOSI(transport, srcDev.ip, dstDev.ip, payloadSize, totalBits, isLost, macSrc, macDst);
    showChecksum(isLost);

    if (isLost) {
      log(msgTag, `Salida ${srcDev.ip} -> Entrada ${dstDev.ip} | DROP en L2: Checksum FALLÓ. Sin retransmisión UDP.`, 'err');
      return;
    }
    log(msgTag, `Salida ${srcDev.ip} -> Entrada ${dstDev.ip} | Checksum OK. ${dstId} ejecuta acción.`, 'ok');

  } else if (transport === 'TCP') {
    let attempts = 0;
    const maxAttempts = 3;

    function tryTCP() {
      attempts++;
      const fail = attempts === 1 ? isLost : (Math.random() < noise);
      animateDualOSI(transport, srcDev.ip, dstDev.ip, payloadSize, totalBits, fail, macSrc, macDst);
      showChecksum(fail);

      if (!fail) {
        score[team]++;
        document.getElementById('stat-score').textContent = `${score.naranja} - ${score.verde}`;
        setTcpFlags(['SYN', 'PSH', 'ACK']);
        log('TRAMO 1 | RADIO', `${srcId} (${srcDev.ip}) -> Router lado ${srcDev.net} | [${ROUTER_MAC[srcDev.net]} | ${srcDev.mac} | Checksum OK]`, 'ok');
        log('TRAMO 2 | CABLE', `Router lado Marcador -> ${dstId} (${dstDev.ip}) | [${dstDev.mac} | ${ROUTER_MAC.M} | Checksum OK]`, 'ok');
        log(msgTag, `Salida ${srcDev.ip} -> Entrada ${dstDev.ip} | TCP ACK (Intento ${attempts}). GOL confirmado.`, 'ok');
      } else {
        log('TRAMO 1 | RADIO', `${srcId} -> Router lado ${srcDev.net} | DROP en L2 (Intento ${attempts}/${maxAttempts}): Checksum fallido.`, 'err');
        if (attempts < maxAttempts) {
          log('TCP | REINTENTO', `Retransmitiendo trama de gol...`, 'warn');
          setTimeout(tryTCP, 850);
        } else {
          log('TCP | FALLO', `Se agotaron los intentos. Gol no registrado.`, 'err');
        }
      }
    }
    tryTCP();
  }
}

/* ================= EVENTOS ================= */
document.querySelectorAll('.btn-group button').forEach(btn => {
  btn.addEventListener('click', () => {
    simulateNetwork(btn.dataset.action, btn.dataset.team, btn.dataset.player);
  });
});

noiseSlider.addEventListener('input', (e) => {
  noise = Number(e.target.value) / 100;
  noiseVal.textContent = `${e.target.value}%`;
  noiseVal.style.color = e.target.value > 50 ? '#c0392b' : 'inherit';
  updateShannon();
});

document.getElementById('auto-btn').addEventListener('click', function() {
  if (autoInterval) {
    clearInterval(autoInterval);
    autoInterval = null;
    this.textContent = 'Simular Partido Completo';
    this.classList.remove('running');
    log('SIMULACIÓN', 'Partido automático detenido.', 'info');
  } else {
    this.textContent = 'Detener Partido';
    this.classList.add('running');
    log('SIMULACIÓN', 'Iniciando tráfico continuo de los 4 controles y 4 robots...', 'info');

    autoInterval = setInterval(() => {
      const roster = [
        { team: 'naranja', player: 'A1' }, { team: 'naranja', player: 'A2' },
        { team: 'verde', player: 'B1' }, { team: 'verde', player: 'B2' }
      ];
      const chosen = roster[Math.floor(Math.random() * roster.length)];
      const actions = ['move', 'move', 'kick', 'goal'];
      const action = actions[Math.floor(Math.random() * actions.length)];
      simulateNetwork(action, chosen.team, chosen.player);
    }, 1800);
  }
});

// Inicialización
renderDevices();
updateShannon();

/* ================= CONSOLA ICMP (ping / tracert) ================= */
function runICMP(cmd, srcDev) {
  const parts = cmd.trim().split(/\s+/);
  const verb = parts[0].toLowerCase();
  const target = parts[1];
  const prompt = `${srcDev.id} (${srcDev.ip})> ${cmd.trim()}`;

  if ((verb !== 'ping' && verb !== 'tracert') || !target) {
    log('CONSOLA', `${prompt}\nUso: ping <IP>  |  tracert <IP>`, 'warn');
    return;
  }

  const dst = devices.find(d => d.ip === target);
  if (!dst) {
    log('ICMP', `${prompt}\nDestination host unreachable (${target} no existe en la red)`, 'err');
    return;
  }

  if (!isValidIP(srcDev.ip, devices.indexOf(srcDev)) || !isValidIP(dst.ip, devices.indexOf(dst))) {
    log('ICMP', `${prompt}\nRequest timed out (IP inválida en origen o destino)`, 'err');
    return;
  }

  const sameNet = srcDev.net === dst.net;
  const robotToScore = srcDev.id.startsWith('Robot') && dst.net === 'M';

  // Misma subred: responde directo
  if (sameNet) {
    if (verb === 'ping') {
      const reply = `Reply from ${target}: bytes=32 TTL=128`;
      log('ICMP', `${prompt}\n${[reply, reply, reply, reply].join('\n')}`, 'ok');
    } else {
      log('ICMP', `${prompt}\nTracing route to ${target}\n  1    <1 ms    ${target}\nTrace complete.`, 'ok');
    }
    return;
  }

  // Robot -> Marcador: pasa por el router (2 saltos)
  if (robotToScore) {
    const gw = GATEWAYS[srcDev.net];
    if (verb === 'ping') {
      const reply = `Reply from ${target}: bytes=32 TTL=127`;
      log('ICMP', `${prompt}\n${[reply, reply, reply, reply].join('\n')}`, 'ok');
    } else {
      log('ICMP', `${prompt}\nTracing route to ${target}\n  1    <1 ms    ${gw} (Gateway)\n  2    <1 ms    ${target} (Marcador)\nTrace complete.`, 'ok');
    }
    return;
  }

  // Todo lo demás lo bloquea el router
  const reason = (srcDev.net !== 'M' && dst.net !== 'M')
    ? 'BLOQUEADO en Router (Subred A ↔ Subred B aisladas)'
    : 'BLOQUEADO en Router (solo se reenvía Robot → Marcador)';
  log('ICMP', `${prompt}\nRequest timed out\n${reason}`, 'err');
}

const cmdSrc = document.getElementById('cmd-src');
devices.forEach(d => {
  const opt = document.createElement('option');
  opt.value = d.id;
  opt.textContent = d.id;
  cmdSrc.appendChild(opt);
});

function execCmd() {
  const input = document.getElementById('cmd-input');
  if (!input.value.trim()) return;
  runICMP(input.value, devices.find(d => d.id === cmdSrc.value));
  input.value = '';
}

document.getElementById('cmd-run').addEventListener('click', execCmd);
document.getElementById('cmd-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') execCmd();
});

document.getElementById('ping-quick').addEventListener('click', () => {
  const src = devices.find(d => d.id === 'Control A1');
  const dst = devices.find(d => d.id === 'Robot B1');
  runICMP(`ping ${dst.ip}`, src);
});

/* ================= INTENTO NO EMPAREJADO (Control A1 → Robot A2) ================= */
function attemptWrongPair() {
  const srcIdx = devices.findIndex(d => d.id === 'Control A1');
  const dstIdx = devices.findIndex(d => d.id === 'Robot A2');
  const src = devices[srcIdx];
  const dst = devices[dstIdx];

  if (!isValidIP(src.ip, srcIdx) || !isValidIP(dst.ip, dstIdx)) {
    log('BLOQUEO L3 | INTENTO', `IP inválida entre ${src.id} (${src.ip}) y ${dst.id} (${dst.ip}).`, 'err');
    return;
  }

  const totalBits = (14 + 20 + 8 + 6) * 8; // trama UDP de 6 bytes de payload

  showDelays(totalBits);
  setTcpFlags([]);
  animateDualOSI('UDP', src.ip, dst.ip, 6, totalBits, false, src.mac, dst.mac, true);
  showChecksum(false);

  log('UDP | INTENTO (A1 → A2)', `Salida ${src.ip} -> Entrada ${dst.ip} | Checksum OK, pero la sesión falla en L5.`, 'warn');
  log('SESIÓN | L5', 'RECHAZADO: Robot A2 solo acepta a Control A2', 'err');
}

document.getElementById('reject-btn').addEventListener('click', attemptWrongPair);

log('SISTEMA | INICIO', `VLSM activa: A 192.168.1.0/29 (.1 a .6), B 192.168.1.8/29 (.9 a .14), Marcador 192.168.1.16/30 (.17 a .18)`, 'info');

/* ================= DIAPOSITIVAS ================= */
const TOTAL_SLIDES = 27;
let currentSlide = 1;

function showSlide(n) {
  currentSlide = Math.min(Math.max(n, 1), TOTAL_SLIDES);
  document.getElementById('slide-img').src = `assets/slides/${currentSlide}.png`;
  document.getElementById('slide-count').textContent = `${currentSlide} / ${TOTAL_SLIDES}`;
}

document.getElementById('slide-prev').addEventListener('click', () => showSlide(currentSlide - 1));
document.getElementById('slide-next').addEventListener('click', () => showSlide(currentSlide + 1));

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === 'ArrowLeft') showSlide(currentSlide - 1);
  if (e.key === 'ArrowRight') showSlide(currentSlide + 1);
});

showSlide(1);