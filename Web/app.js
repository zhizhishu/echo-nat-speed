// ============================================================
// Echo NAT - Web Detection + Domestic Speed Bridge
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

const BROWSER_SPEED_BASE = '/api/browser-speed';
const BROWSER_SPEED_PING_API = `${BROWSER_SPEED_BASE}/ping`;
const BROWSER_SPEED_DOWNLOAD_API = `${BROWSER_SPEED_BASE}/download`;
const BROWSER_SPEED_UPLOAD_API = `${BROWSER_SPEED_BASE}/upload`;
const LATENCY_SAMPLE_COUNT = 5;
const DOWNLOAD_SAMPLE_BYTES = 96 * 1024 * 1024;
const UPLOAD_SAMPLE_BYTES = 32 * 1024 * 1024;
const PROGRESS_THROTTLE_MS = 120;

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
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  return `${value.toFixed(1)} ms`;
}

function formatBytesMiB(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '-';
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function computeJitter(values) {
  if (!Array.isArray(values) || values.length < 2) {
    return null;
  }
  const deltas = [];
  for (let i = 1; i < values.length; i += 1) {
    deltas.push(Math.abs(values[i] - values[i - 1]));
  }
  return average(deltas);
}

function bytesToMbps(bytes, elapsedMs) {
  if (typeof bytes !== 'number' || typeof elapsedMs !== 'number' || elapsedMs <= 0) {
    return null;
  }
  return (bytes * 8) / (elapsedMs / 1000) / 1000 / 1000;
}

function speedEndpointLabel() {
  return window.location.host || window.location.hostname || '当前部署节点';
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
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

function resetBrowserSpeedCard() {
  document.getElementById('speedSpinner').style.display = 'none';
  document.getElementById('speedCard').style.borderColor = 'rgba(0, 122, 255, 0.16)';
  setText('speedStatus', '等待测速');
  setText('speedDownload', '-- Mbps');
  setText('speedSummary', '通过当前浏览器向当前部署节点发起真实下载与上传流量，结果会占用你本地的实际网络带宽。');
  setText('speedDownloadDetail', '-');
  setText('speedUpload', '-');
  setText('speedUploadDetail', '');
  setText('speedIdleLatency', '-');
  setText('speedIdleLatencyDetail', '');
  setText('speedEndpoint', speedEndpointLabel());
  setText('speedEndpointDetail', '用户浏览器 → 当前部署节点');
  setSpeedHint('等待开始浏览器测速。该测试会真实占用当前用户设备的上下行带宽。');
}

function setBrowserSpeedPreparing() {
  document.getElementById('speedSpinner').style.display = 'block';
  document.getElementById('speedCard').style.borderColor = 'var(--accent-blue)';
  setText('speedStatus', '测速准备中...');
  setText('speedDownload', '-- Mbps');
  setText('speedSummary', '正在初始化浏览器测速并校验部署节点可用性。');
  setText('speedDownloadDetail', '-');
  setText('speedUpload', '-');
  setText('speedUploadDetail', '');
  setText('speedIdleLatency', '-');
  setText('speedIdleLatencyDetail', '');
  setText('speedEndpoint', speedEndpointLabel());
  setText('speedEndpointDetail', '用户浏览器 → 当前部署节点');
  setSpeedHint('测速流量将直接由当前浏览器发起，你本地网卡应会出现真实流量变化。');
}

function renderLatencyProgress(samples) {
  const medianMs = median(samples);
  const jitterMs = computeJitter(samples);
  document.getElementById('speedSpinner').style.display = 'block';
  document.getElementById('speedCard').style.borderColor = 'var(--accent-blue)';
  setText('speedStatus', '延迟测试中...');
  setText('speedDownload', '-- Mbps');
  setText('speedSummary', '正在测量当前浏览器到部署节点的真实往返延迟。');
  setText('speedDownloadDetail', `延迟采样 ${samples.length}/${LATENCY_SAMPLE_COUNT}`);
  setText('speedUpload', '-');
  setText('speedUploadDetail', '等待下载阶段开始');
  setText('speedIdleLatency', formatLatencyMs(medianMs));
  setText(
    'speedIdleLatencyDetail',
    jitterMs ? `抖动 ${formatLatencyMs(jitterMs)}` : `已获取 ${samples.length} 次样本`
  );
  setText('speedEndpoint', speedEndpointLabel());
  setText('speedEndpointDetail', '用户浏览器 → 当前部署节点');
  setSpeedHint('测速过程由当前浏览器直接发起，不会再读取服务器自身的 CLI 带宽结果。');
}

async function measureBrowserLatency(sampleCount = LATENCY_SAMPLE_COUNT) {
  const samples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const startedAt = performance.now();
    const response = await fetch(`${BROWSER_SPEED_PING_API}?r=${Date.now()}-${index}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-store' },
    });
    if (!response.ok) {
      throw new Error(`延迟探测失败 (${response.status})`);
    }
    await response.json().catch(() => ({}));
    const durationMs = performance.now() - startedAt;
    samples.push(durationMs);
    renderLatencyProgress(samples);
    addLog('浏览器测速', `延迟样本 ${index + 1}: ${formatLatencyMs(durationMs)}`, 'info', 'speed');
    await delay(120);
  }

  return {
    samples,
    medianMs: median(samples),
    avgMs: average(samples),
    jitterMs: computeJitter(samples),
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
  };
}

function renderDownloadProgress(progress, latencyStats) {
  document.getElementById('speedSpinner').style.display = 'block';
  document.getElementById('speedCard').style.borderColor = 'var(--accent-blue)';
  setText('speedStatus', '下载测速中...');
  setText('speedDownload', formatMbps(progress.currentMbps));
  setText('speedSummary', '正在从当前浏览器下载测试流量，数值会随着真实吞吐实时变化。');
  setText(
    'speedDownloadDetail',
    `${formatBytesMiB(progress.transferredBytes)} / ${formatBytesMiB(progress.totalBytes)} · 平均 ${formatMbps(progress.averageMbps)}`
  );
  setText('speedUpload', '-');
  setText('speedUploadDetail', '等待上传阶段开始');
  setText('speedIdleLatency', formatLatencyMs(latencyStats.medianMs));
  setText(
    'speedIdleLatencyDetail',
    latencyStats.jitterMs ? `抖动 ${formatLatencyMs(latencyStats.jitterMs)}` : `样本 ${latencyStats.samples.length}`
  );
  setText('speedEndpoint', speedEndpointLabel());
  setText('speedEndpointDetail', '用户浏览器 → 当前部署节点');
  setSpeedHint('当前大号数字是用户浏览器的实时下载速度，流量会真实经过你的本地网络。');
}

async function runBrowserDownloadTest(totalBytes, latencyStats) {
  const response = await fetch(`${BROWSER_SPEED_DOWNLOAD_API}?bytes=${totalBytes}&r=${Date.now()}`, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-store' },
  });
  if (!response.ok) {
    throw new Error(`下载测速失败 (${response.status})`);
  }

  const startedAt = performance.now();
  let transferredBytes = 0;
  let emittedAt = startedAt;
  let emittedBytes = 0;
  let peakMbps = 0;

  if (!response.body || !response.body.getReader) {
    const buffer = await response.arrayBuffer();
    const elapsedMs = performance.now() - startedAt;
    const averageMbps = bytesToMbps(buffer.byteLength, elapsedMs);
    renderDownloadProgress(
      {
        currentMbps: averageMbps,
        averageMbps,
        transferredBytes: buffer.byteLength,
        totalBytes: buffer.byteLength,
      },
      latencyStats
    );
    return {
      mbps: averageMbps,
      peakMbps: averageMbps,
      totalBytes: buffer.byteLength,
      durationMs: elapsedMs,
    };
  }

  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    transferredBytes += value.byteLength;
    const now = performance.now();
    if (now - emittedAt >= PROGRESS_THROTTLE_MS) {
      const instantMbps = bytesToMbps(transferredBytes - emittedBytes, now - emittedAt);
      const averageMbps = bytesToMbps(transferredBytes, now - startedAt);
      peakMbps = Math.max(peakMbps, instantMbps || 0, averageMbps || 0);
      renderDownloadProgress(
        {
          currentMbps: instantMbps || averageMbps,
          averageMbps,
          transferredBytes,
          totalBytes,
        },
        latencyStats
      );
      emittedAt = now;
      emittedBytes = transferredBytes;
    }
  }

  const elapsedMs = performance.now() - startedAt;
  const averageMbps = bytesToMbps(transferredBytes, elapsedMs);
  peakMbps = Math.max(peakMbps, averageMbps || 0);
  renderDownloadProgress(
    {
      currentMbps: averageMbps,
      averageMbps,
      transferredBytes,
      totalBytes,
    },
    latencyStats
  );
  return {
    mbps: averageMbps,
    peakMbps,
    totalBytes: transferredBytes,
    durationMs: elapsedMs,
  };
}

function renderUploadProgress(progress, latencyStats, downloadStats) {
  document.getElementById('speedSpinner').style.display = 'block';
  document.getElementById('speedCard').style.borderColor = 'var(--accent-yellow)';
  setText('speedStatus', '上传测速中...');
  setText('speedDownload', formatMbps(progress.currentMbps));
  setText('speedSummary', '正在从当前浏览器上传测试流量，数值会随着真实上行实时变化。');
  setText(
    'speedDownloadDetail',
    `${formatMbps(downloadStats.mbps)} · 下载样本 ${formatBytesMiB(downloadStats.totalBytes)}`
  );
  setText('speedUpload', formatMbps(progress.averageMbps));
  setText(
    'speedUploadDetail',
    `${formatBytesMiB(progress.transferredBytes)} / ${formatBytesMiB(progress.totalBytes)} · 当前 ${formatMbps(progress.currentMbps)}`
  );
  setText('speedIdleLatency', formatLatencyMs(latencyStats.medianMs));
  setText(
    'speedIdleLatencyDetail',
    latencyStats.jitterMs ? `抖动 ${formatLatencyMs(latencyStats.jitterMs)}` : `样本 ${latencyStats.samples.length}`
  );
  setText('speedEndpoint', speedEndpointLabel());
  setText('speedEndpointDetail', '用户浏览器 → 当前部署节点');
  setSpeedHint('上传阶段会真实占用当前浏览器所在设备的上行带宽，观察本地网卡更容易看到变化。', 'warn');
}

function runBrowserUploadTest(totalBytes, latencyStats, downloadStats) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const payload = new Uint8Array(totalBytes);
    let startedAt = 0;
    let emittedAt = 0;
    let emittedBytes = 0;
    let peakMbps = 0;

    xhr.open('POST', `${BROWSER_SPEED_UPLOAD_API}?r=${Date.now()}`, true);
    xhr.responseType = 'json';
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    xhr.upload.onloadstart = () => {
      startedAt = performance.now();
      emittedAt = startedAt;
    };

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }
      const now = performance.now();
      const effectiveStartedAt = startedAt || now;
      if (!startedAt) {
        startedAt = now;
        emittedAt = now;
      }
      if (now - emittedAt < PROGRESS_THROTTLE_MS && event.loaded !== event.total) {
        return;
      }
      const instantMbps = bytesToMbps(event.loaded - emittedBytes, now - emittedAt);
      const averageMbps = bytesToMbps(event.loaded, now - effectiveStartedAt);
      peakMbps = Math.max(peakMbps, instantMbps || 0, averageMbps || 0);
      renderUploadProgress(
        {
          currentMbps: instantMbps || averageMbps,
          averageMbps,
          transferredBytes: event.loaded,
          totalBytes: event.total || totalBytes,
        },
        latencyStats,
        downloadStats
      );
      emittedAt = now;
      emittedBytes = event.loaded;
    };

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`上传测速失败 (${xhr.status})`));
        return;
      }
      const elapsedMs = performance.now() - startedAt;
      const response = xhr.response && typeof xhr.response === 'object'
        ? xhr.response
        : JSON.parse(xhr.responseText || '{}');
      const transferredBytes = typeof response.receivedBytes === 'number' ? response.receivedBytes : totalBytes;
      const averageMbps = bytesToMbps(transferredBytes, elapsedMs);
      peakMbps = Math.max(peakMbps, averageMbps || 0);
      renderUploadProgress(
        {
          currentMbps: averageMbps,
          averageMbps,
          transferredBytes,
          totalBytes: transferredBytes,
        },
        latencyStats,
        downloadStats
      );
      resolve({
        mbps: averageMbps,
        peakMbps,
        totalBytes: transferredBytes,
        durationMs: elapsedMs,
      });
    };

    xhr.onerror = () => reject(new Error('上传测速网络异常'));
    xhr.ontimeout = () => reject(new Error('上传测速超时'));
    xhr.timeout = 120000;
    xhr.send(payload);
  });
}

function renderBrowserSpeedResult({ latency, download, upload }) {
  document.getElementById('speedSpinner').style.display = 'none';
  document.getElementById('speedCard').style.borderColor = 'var(--accent-green)';
  setText('speedStatus', '已完成');
  setText('speedDownload', formatMbps(download.mbps));
  setText('speedSummary', '浏览器测速完成，结果反映当前用户浏览器到当前部署节点的真实链路表现。');
  setText('speedDownloadDetail', `${formatMbps(download.mbps)} · 下载样本 ${formatBytesMiB(download.totalBytes)}`);
  setText('speedUpload', formatMbps(upload.mbps));
  setText('speedUploadDetail', `${formatBytesMiB(upload.totalBytes)} 上传样本 · 峰值 ${formatMbps(upload.peakMbps)}`);
  setText('speedIdleLatency', formatLatencyMs(latency.medianMs));
  setText('speedIdleLatencyDetail', `抖动 ${formatLatencyMs(latency.jitterMs)} · ${latency.samples.length} 次采样`);
  setText('speedEndpoint', speedEndpointLabel());
  setText('speedEndpointDetail', '用户浏览器 → 当前部署节点');
  setSpeedHint('该结果来自当前浏览器真实发起的下载与上传流量，你本地网卡应能看到实际吞吐变化。', 'success');

  addLog('浏览器测速', `目标节点 ${speedEndpointLabel()}`, 'info', 'speed');
  addLog('浏览器测速', `下载速度 ${formatMbps(download.mbps)}`, 'result', 'speed');
  addLog('浏览器测速', `上传速度 ${formatMbps(upload.mbps)}`, 'result', 'speed');
  addLog('浏览器测速', `往返延迟 ${formatLatencyMs(latency.medianMs)}`, 'info', 'speed');
  addLog('浏览器测速', '浏览器测速完成 ✓', 'result', 'speed');
}

function renderBrowserSpeedError(message) {
  document.getElementById('speedSpinner').style.display = 'none';
  document.getElementById('speedCard').style.borderColor = 'var(--accent-red)';
  setText('speedStatus', '测速失败');
  setText('speedDownload', '-- Mbps');
  setText('speedSummary', '无法完成浏览器测速');
  setText('speedDownloadDetail', '-');
  setText('speedUpload', '-');
  setText('speedUploadDetail', '');
  setText('speedIdleLatency', '-');
  setText('speedIdleLatencyDetail', '');
  setText('speedEndpoint', speedEndpointLabel());
  setText('speedEndpointDetail', '用户浏览器 → 当前部署节点');
  setSpeedHint(message, 'fail');
  addLog('浏览器测速', message, 'fail', 'speed');
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

async function startBrowserSpeedTest() {
  const btn = document.getElementById('browserSpeedBtn');
  btn.disabled = true;
  btn.textContent = '测速中...';

  hideSection('resultSection');
  showSection('speedResultSection');
  resetLogs('speed');
  setBrowserSpeedPreparing();
  addLog('浏览器测速', '开始从当前浏览器发起真实下载与上传测试...', 'info', 'speed');

  try {
    const warmup = await fetch(`${BROWSER_SPEED_PING_API}?warmup=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-store' },
    });
    if (!warmup.ok) {
      throw new Error(`测速端点不可用 (${warmup.status})`);
    }
    await warmup.json().catch(() => ({}));

    const latency = await measureBrowserLatency();
    addLog('浏览器测速', `延迟中位数 ${formatLatencyMs(latency.medianMs)}`, 'info', 'speed');

    const download = await runBrowserDownloadTest(DOWNLOAD_SAMPLE_BYTES, latency);
    addLog('浏览器测速', `下载阶段完成 ${formatMbps(download.mbps)}`, 'result', 'speed');

    const upload = await runBrowserUploadTest(UPLOAD_SAMPLE_BYTES, latency, download);
    addLog('浏览器测速', `上传阶段完成 ${formatMbps(upload.mbps)}`, 'result', 'speed');

    renderBrowserSpeedResult({ latency, download, upload });
  } catch (error) {
    renderBrowserSpeedError(error instanceof Error ? error.message : '浏览器测速失败');
  } finally {
    document.getElementById('speedSpinner').style.display = 'none';
    btn.disabled = false;
    btn.textContent = '重新测速';
  }
}

resetBrowserSpeedCard();
