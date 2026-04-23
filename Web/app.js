// ============================================================
// Echo NAT - NAT Detection + Apple CDN Domestic Speed
// ============================================================

const STUN_SERVERS = [
  { name: 'Bethesda', url: 'stun:stun.bethesda.net:3478' },
  { name: 'B站 (Bilibili)', url: 'stun:stun.chat.bilibili.com:3478' },
  { name: '小米 (Xiaomi)', url: 'stun:stun.miui.com:3478' },
  { name: '腾讯 (Tencent)', url: 'stun:stun.qq.com:3478' },
  { name: '群晖 (Synology)', url: 'stun:stun.synology.com:3478' },
  { name: '谷歌 (Google)', url: 'stun:stun.l.google.com:19302' },
  { name: 'Cloudflare', url: 'stun:stun.cloudflare.com:3478' },
];

const DOMESTIC_SPEED_API = '/api/domestic-speed';
const SPEED_STAGE_FRAMES = ['正在选择 Apple CDN 节点', '正在测下载', '正在测上传'];
const SPEED_TEST_MODES = {
  single: {
    label: '单线程',
    buttonId: 'singleSpeedBtn',
    buttonText: '国内单线程测速',
    roundMode: 'single',
    threads: 1,
    max: '64M',
    timeout: 8,
    latencyCount: 6,
  },
  multi: {
    label: '多线程',
    buttonId: 'multiSpeedBtn',
    buttonText: '国内多线程测速',
    roundMode: 'multi',
    threads: 4,
    max: '24M',
    timeout: 8,
    latencyCount: 6,
  },
};

const logState = {
  nat: 0,
  speed: 0,
};

function getLogElements(scope = 'nat') {
  if (scope === 'speed') {
    return {
      body: document.getElementById('speedLogBody'),
      count: document.getElementById('speedLogCount'),
      emptyText: '0 条',
      suffix: '条',
    };
  }

  return {
    body: document.getElementById('logBody'),
    count: document.getElementById('logCount'),
    emptyText: '0 次测试',
    suffix: '次测试',
  };
}

function addLog(server, message, type = 'result', scope = 'nat') {
  const logElements = getLogElements(scope);
  const logBody = logElements.body;
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  const cssClass = type === 'fail' ? 'log-fail' : type === 'info' ? 'log-info' : 'log-result';
  entry.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-server">${server}</span>
    <span class="${cssClass}">${message}</span>
  `;
  logBody.appendChild(entry);
  logBody.scrollTop = logBody.scrollHeight;
  logState[scope] += 1;
  logElements.count.textContent = `${logState[scope]} ${logElements.suffix}`;
}

function resetLogs(scope = 'nat') {
  const logElements = getLogElements(scope);
  logElements.body.innerHTML = '';
  logState[scope] = 0;
  logElements.count.textContent = logElements.emptyText;
}

function showSection(id, shouldScroll = true) {
  const section = document.getElementById(id);
  section.style.display = 'block';
  if (shouldScroll) {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function hideSection(id) {
  document.getElementById(id).style.display = 'none';
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function formatMbps(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  return `${value.toFixed(1)} Mbps`;
}

function formatLatencyMs(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  return `${value.toFixed(1)} ms`;
}

function formatDurationMs(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '-';
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)} s`;
  }
  return `${Math.round(value)} ms`;
}

function formatBytesMiB(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '-';
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatDeltaMs(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)} ms`;
}

function formatDualSpeed(downloadMbps, uploadMbps) {
  if (!Number.isFinite(downloadMbps) && !Number.isFinite(uploadMbps)) {
    return '-- / -- Mbps';
  }
  if (!Number.isFinite(downloadMbps)) {
    return `-- / ${uploadMbps.toFixed(1)}↑ Mbps`;
  }
  if (!Number.isFinite(uploadMbps)) {
    return `${downloadMbps.toFixed(1)}↓ / -- Mbps`;
  }
  return `${downloadMbps.toFixed(1)}↓ / ${uploadMbps.toFixed(1)}↑ Mbps`;
}

function getSpeedModeConfig(mode = 'multi') {
  return SPEED_TEST_MODES[mode] || SPEED_TEST_MODES.multi;
}

function endpointLabel(endpoint) {
  if (!endpoint || typeof endpoint !== 'object') {
    return '-';
  }

  const parts = [];
  if (endpoint.ip) {
    parts.push(endpoint.ip);
  }
  if (endpoint.description) {
    parts.push(endpoint.description);
  }
  return parts.length > 0 ? parts.join(' · ') : '-';
}

function setSpeedCardState({ showSpinner = true, borderColor, status, mainValue, summary }) {
  document.getElementById('speedSpinner').style.display = showSpinner ? 'block' : 'none';
  document.getElementById('speedCard').style.borderColor = borderColor;
  setText('speedStatus', status);
  setText('speedMainValue', mainValue);
  setText('speedSummary', summary);
}

function updateSpeedMetric(id, value, detail = '') {
  setText(id, value);
  const detailElement = document.getElementById(`${id}Detail`);
  if (detailElement) {
    detailElement.textContent = detail;
  }
}

function renderSpeedEndpoint(endpoint = null) {
  const detail = endpoint?.rttMs != null
    ? `选点 RTT ${formatLatencyMs(endpoint.rttMs)}`
    : 'Apple CDN 自动选点';
  updateSpeedMetric('speedEndpoint', endpointLabel(endpoint), detail);
}

function setSpeedButtonsState(runningMode = null) {
  Object.values(SPEED_TEST_MODES).forEach((config) => {
    const button = document.getElementById(config.buttonId);
    if (!button) {
      return;
    }

    if (!runningMode) {
      button.disabled = false;
      button.textContent = config.buttonText;
      return;
    }

    button.disabled = true;
    button.textContent = config.roundMode === runningMode ? '测速中...' : '等待中...';
  });
}

function setSpeedHint(text, tone = 'info') {
  const box = document.getElementById('speedHintBox');
  box.classList.remove('is-success', 'is-warn', 'is-fail');
  if (tone === 'success') {
    box.classList.add('is-success');
  } else if (tone === 'warn') {
    box.classList.add('is-warn');
  } else if (tone === 'fail') {
    box.classList.add('is-fail');
  }
  setText('speedHintText', text);
}

function renderLatencyBaseline(latency) {
  updateSpeedMetric(
    'speedLatencyIdle',
    formatLatencyMs(latency?.medianMs),
    `平均 ${formatLatencyMs(latency?.avgMs)} · ${latency?.samples ?? 0} 次采样`
  );
  updateSpeedMetric(
    'speedJitter',
    formatLatencyMs(latency?.jitterMs),
    `最小 ${formatLatencyMs(latency?.minMs)} · 最大 ${formatLatencyMs(latency?.maxMs)}`
  );
}

function renderLoadedLatency(metricId, label, loadedLatency, baselineLatency) {
  const median = loadedLatency?.medianMs;
  if (!Number.isFinite(median)) {
    updateSpeedMetric(metricId, '-', `${label} · 无样本`);
    return;
  }

  const delta = Number.isFinite(baselineLatency?.medianMs)
    ? median - baselineLatency.medianMs
    : null;
  updateSpeedMetric(
    metricId,
    formatLatencyMs(median),
    `${label} · ${loadedLatency?.samples ?? 0} 次采样 · ${formatDeltaMs(delta)}`
  );
}

function detailForRound(round) {
  if (!round || typeof round !== 'object') {
    return '等待测速';
  }

  return `${round.threads ?? '-'} 线程 · ${formatBytesMiB(round.totalBytes)} · ${formatDurationMs(round.durationMs)}`;
}

function resetDomesticSpeedCard(mode = null) {
  const modeConfig = mode ? getSpeedModeConfig(mode) : null;
  setSpeedCardState({
    showSpinner: false,
    borderColor: 'rgba(0, 122, 255, 0.16)',
    status: '等待测速',
    mainValue: '-- / -- Mbps',
    summary: modeConfig ? `Apple CDN ${modeConfig.label}测速` : 'Apple CDN 国内测速',
  });
  updateSpeedMetric('speedDownload', '-', '等待测速');
  updateSpeedMetric('speedUpload', '-', '等待测速');
  updateSpeedMetric('speedLatencyIdle', '-', '等待测速');
  updateSpeedMetric('speedLatencyDownload', '-', '等待测速');
  updateSpeedMetric('speedLatencyUpload', '-', '等待测速');
  updateSpeedMetric('speedJitter', '-', '等待测速');
  renderSpeedEndpoint(null);
  setSpeedHint('来源：iNetSpeed-CLI · Apple CDN');
}

function startSpeedTicker(mode) {
  const modeConfig = getSpeedModeConfig(mode);
  let index = 0;

  const paint = () => {
    setSpeedCardState({
      showSpinner: true,
      borderColor: 'var(--accent-blue)',
      status: `${modeConfig.label}测速中...`,
      mainValue: '-- / -- Mbps',
      summary: SPEED_STAGE_FRAMES[index % SPEED_STAGE_FRAMES.length],
    });
    renderSpeedEndpoint(null);
    index += 1;
  };

  paint();
  return window.setInterval(paint, 1400);
}

function stopSpeedTicker(timerId) {
  if (timerId) {
    window.clearInterval(timerId);
  }
}

function buildSpeedPayload(modeConfig) {
  return {
    round_mode: modeConfig.roundMode,
    threads: modeConfig.threads,
    max: modeConfig.max,
    timeout: modeConfig.timeout,
    latency_count: modeConfig.latencyCount,
    no_metadata: true,
  };
}

function renderDomesticSpeedResult(summary) {
  const tone = summary.degraded ? 'warn' : 'success';
  const borderColor = summary.degraded ? 'var(--accent-yellow)' : 'var(--accent-green)';
  const status = summary.degraded ? '已完成（降级）' : '已完成';
  const modeLabel = summary.modeLabel || '测速';

  setSpeedCardState({
    showSpinner: false,
    borderColor,
    status,
    mainValue: formatDualSpeed(summary.download?.mbps, summary.upload?.mbps),
    summary: `Apple CDN ${modeLabel}测速完成`,
  });

  updateSpeedMetric('speedDownload', formatMbps(summary.download?.mbps), detailForRound(summary.download));
  updateSpeedMetric('speedUpload', formatMbps(summary.upload?.mbps), detailForRound(summary.upload));
  renderLatencyBaseline(summary.latency);
  renderLoadedLatency('speedLatencyDownload', `${modeLabel}下载`, summary.download?.loadedLatency, summary.latency);
  renderLoadedLatency('speedLatencyUpload', `${modeLabel}上传`, summary.upload?.loadedLatency, summary.latency);
  renderSpeedEndpoint(summary.endpoint);
  setSpeedHint('来源：iNetSpeed-CLI · Apple CDN', tone);

  if (summary.endpoint?.ip) {
    addLog('国内测速', `节点 ${summary.endpoint.ip}`, 'info', 'speed');
  }
  addLog('国内测速', `${modeLabel}下载 ${formatMbps(summary.download?.mbps)}`, 'result', 'speed');
  addLog('国内测速', `${modeLabel}上传 ${formatMbps(summary.upload?.mbps)}`, 'result', 'speed');
  addLog(
    '国内测速',
    `空载延迟 ${formatLatencyMs(summary.latency?.medianMs)} · 抖动 ${formatLatencyMs(summary.latency?.jitterMs)}`,
    'info',
    'speed'
  );
  (summary.warnings || []).forEach((warning) => {
    if (warning?.message) {
      addLog('国内测速', warning.message, 'info', 'speed');
    }
  });
  addLog('国内测速', '测速完成 ✓', 'result', 'speed');
}

function renderDomesticSpeedError(message) {
  setSpeedCardState({
    showSpinner: false,
    borderColor: 'var(--accent-red)',
    status: '测速失败',
    mainValue: '-- / -- Mbps',
    summary: '无法完成国内测速',
  });
  renderSpeedEndpoint(null);
  setSpeedHint(message, 'fail');
  addLog('国内测速', message, 'fail', 'speed');
}

function normalizeSpeedError(responseStatus, data) {
  const rawMessage = data?.error || data?.message || '';
  if (responseStatus === 429 || String(rawMessage).includes('429')) {
    return '请求过快，请稍后再试。';
  }
  if (rawMessage) {
    return rawMessage;
  }
  return `国内测速失败 (${responseStatus})`;
}

async function startDomesticSpeedTest(mode = 'multi') {
  const modeConfig = getSpeedModeConfig(mode);
  const payload = buildSpeedPayload(modeConfig);

  hideSection('resultSection');
  showSection('speedResultSection');
  resetLogs('speed');
  resetDomesticSpeedCard(mode);
  setSpeedButtonsState(mode);

  addLog('国内测速', `开始 ${modeConfig.label}测速...`, 'info', 'speed');
  const ticker = startSpeedTicker(mode);

  try {
    const response = await fetch(DOMESTIC_SPEED_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !data.summary) {
      throw new Error(normalizeSpeedError(response.status, data));
    }
    renderDomesticSpeedResult(data.summary);
  } catch (error) {
    renderDomesticSpeedError(error instanceof Error ? error.message : '国内测速失败');
  } finally {
    stopSpeedTicker(ticker);
    setSpeedButtonsState(null);
  }
}

function probeSTUN(stunUrl, serverName) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pc.close();
      addLog(serverName, '连接超时', 'fail');
      resolve(null);
    }, 5000);

    const pc = new RTCPeerConnection({ iceServers: [{ urls: stunUrl }] });
    pc.createDataChannel('echo-nat');

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      const candidate = event.candidate.candidate;
      if (!candidate.includes('srflx')) {
        return;
      }

      clearTimeout(timeout);
      const parts = candidate.split(' ');
      const ip = parts[4];
      const port = parseInt(parts[5], 10);
      const latency = Date.now() - startTime;
      addLog(serverName, `${ip}:${port} (${latency}ms)`);
      pc.close();
      resolve({ ip, port, latency, server: serverName });
    };

    const startTime = Date.now();
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch(() => {
        clearTimeout(timeout);
        addLog(serverName, 'WebRTC 异常', 'fail');
        resolve(null);
      });
  });
}

function jsonp(url, callbackName, timeout = 6000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(null);
      cleanup();
    }, timeout);
    window[callbackName] = (data) => {
      clearTimeout(timer);
      resolve(data);
      cleanup();
    };
    const script = document.createElement('script');
    script.src = url;
    script.onerror = () => {
      clearTimeout(timer);
      resolve(null);
      cleanup();
    };
    document.head.appendChild(script);

    function cleanup() {
      delete window[callbackName];
      script.remove();
    }
  });
}

async function testIPv6() {
  const el = document.getElementById('ipv6Status');
  const sub = document.getElementById('ipv6Addr');
  const data = await jsonp('https://ds.v6ns.tokyo.test-ipv6.com/ip/?callback=_echoIPv6', '_echoIPv6');
  if (data && data.ip) {
    el.innerHTML = '<div class="dot dot-green"></div> 已连接';
    sub.textContent = data.ip;
    addLog('IPv6 测试', `${data.ip} (${data.type || 'ok'})`, 'info');
    return true;
  }

  el.innerHTML = '<div class="dot dot-red"></div> 不可用';
  sub.textContent = '无 IPv6 连通性';
  addLog('IPv6 测试', '连接不可用', 'fail');
  return false;
}

async function testMTU() {
  const el = document.getElementById('mtuStatus');
  const sub = document.getElementById('mtuInfo');
  const data = await jsonp('https://mtu1280.tokyo.test-ipv6.com/ip/?callback=_echoMTU&size=1600', '_echoMTU');
  if (data && data.ip) {
    el.innerHTML = '<div class="dot dot-green"></div> 正常';
    const padLen = data.padding ? data.padding.length : 0;
    sub.textContent = `支持 PMTUD (填充: ${padLen}B)`;
    addLog('MTU 探测', `PMTUD 正常 (${data.ip})`, 'info');
    return true;
  }

  el.innerHTML = '<div class="dot dot-red"></div> 异常';
  sub.textContent = 'PMTUD 可能被拦截';
  addLog('MTU 探测', '失败或被拦截', 'fail');
  return false;
}

function analyzeNAT(results) {
  const valid = results.filter((result) => result !== null);
  if (valid.length === 0) {
    return { type: 'UDP 被阻断', level: '无法连接 STUN 服务器', color: 'var(--accent-red)', emoji: '🚫' };
  }

  const uniquePorts = [...new Set(valid.map((result) => result.port))];
  const uniqueIPs = [...new Set(valid.map((result) => result.ip))];

  if (uniquePorts.length > 1 || uniqueIPs.length > 1) {
    return {
      type: '对称型 NAT',
      level: 'NAT4 · 严格限制',
      color: 'var(--accent-red)',
      emoji: '🔴',
      desc: '每个目标分配不同端口。P2P 极困难，建议使用 TURN 中继。',
    };
  }
  if (valid.length >= 3) {
    return {
      type: '圆锥型 NAT',
      level: '可能是 NAT1 / NAT2',
      color: 'var(--accent-green)',
      emoji: '🟢',
      desc: '映射一致，P2P 友好。网页端受限于浏览器安全模型，无法继续精确细分 NAT1/2/3。',
    };
  }
  if (valid.length >= 1) {
    return {
      type: '可能是圆锥型',
      level: '可能是 NAT1/2/3',
      color: 'var(--accent-yellow)',
      emoji: '🟡',
      desc: '响应服务器较少，结果仅供参考。',
    };
  }
  return { type: '未知类型', level: '数据不足', color: 'var(--accent-yellow)', emoji: '❓' };
}

async function startDetection() {
  const btn = document.getElementById('startBtn');
  btn.disabled = true;
  btn.textContent = '检测中...';

  hideSection('speedResultSection');
  showSection('resultSection');
  resetLogs('nat');

  document.getElementById('spinner').style.display = 'block';
  document.getElementById('natType').style.display = 'none';
  document.getElementById('natDetails').style.display = 'none';
  document.getElementById('natStatus').textContent = '正在连接 STUN 节点...';
  document.getElementById('natLevel').textContent = '正在分析 NAT 映射行为...';
  document.getElementById('natCard').style.borderColor = 'var(--accent-blue)';

  addLog('系统', '开始检测 NAT 类型...', 'info');

  const results = [];
  for (const server of STUN_SERVERS) {
    const result = await probeSTUN(server.url, server.name);
    results.push(result);
  }

  const nat = analyzeNAT(results);
  const valid = results.filter((result) => result !== null);

  document.getElementById('spinner').style.display = 'none';
  const natTypeEl = document.getElementById('natType');
  natTypeEl.style.display = 'block';
  natTypeEl.textContent = `${nat.emoji} ${nat.type}`;
  natTypeEl.style.color = nat.color;
  document.getElementById('natLevel').textContent = nat.level;
  document.getElementById('natStatus').textContent = nat.desc || '';
  document.getElementById('natCard').style.borderColor = nat.color;

  if (valid.length > 0) {
    const uniquePorts = [...new Set(valid.map((result) => result.port))];
    const avgLatency = Math.round(valid.reduce((sum, result) => sum + result.latency, 0) / valid.length);

    document.getElementById('natDetails').style.display = 'grid';
    setText('extIP', valid[0].ip);
    setText('extPort', String(valid[0].port));
    setText('mapping', uniquePorts.length === 1 ? `一致 (${valid.length} 节点)` : `动态变化 (${uniquePorts.length} 端口)`);
    setText('latencyValue', `${avgLatency} ms`);
    setText('latencyServer', `${valid.length} 节点平均值`);
  }

  addLog('系统', '开始探测 IPv6 与 MTU...', 'info');
  await Promise.all([testIPv6(), testMTU()]);
  addLog('系统', '所有检测完成 ✓', 'info');

  btn.disabled = false;
  btn.textContent = '重新检测';
}

resetDomesticSpeedCard();
