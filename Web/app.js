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
const LATENCY_SAMPLE_COUNT = 7;
const DOWNLOAD_SINGLE_BYTES = 24 * 1024 * 1024;
const DOWNLOAD_MULTI_STREAM_BYTES = 16 * 1024 * 1024;
const UPLOAD_SINGLE_BYTES = 12 * 1024 * 1024;
const UPLOAD_MULTI_STREAM_BYTES = 6 * 1024 * 1024;
const DOWNLOAD_MULTI_CONCURRENCY = 4;
const UPLOAD_MULTI_CONCURRENCY = 4;
const PROGRESS_THROTTLE_MS = 120;
const LOAD_LATENCY_INTERVAL_MS = 180;
const SPEED_STAGE_PAUSE_MS = 180;

const uploadPayloadCache = new Map();
const SPEED_TEST_MODES = {
  single: {
    label: '单线程',
    buttonId: 'singleSpeedBtn',
    buttonText: '单线程测速',
    downloadMetricId: 'speedDownloadSingle',
    uploadMetricId: 'speedUploadSingle',
    otherDownloadMetricId: 'speedDownloadMulti',
    otherUploadMetricId: 'speedUploadMulti',
    concurrency: 1,
    downloadBytes: DOWNLOAD_SINGLE_BYTES,
    uploadBytes: UPLOAD_SINGLE_BYTES,
  },
  multi: {
    label: '多线程',
    buttonId: 'multiSpeedBtn',
    buttonText: '多线程测速',
    downloadMetricId: 'speedDownloadMulti',
    uploadMetricId: 'speedUploadMulti',
    otherDownloadMetricId: 'speedDownloadSingle',
    otherUploadMetricId: 'speedUploadSingle',
    concurrency: DOWNLOAD_MULTI_CONCURRENCY,
    downloadBytes: DOWNLOAD_MULTI_STREAM_BYTES,
    uploadBytes: UPLOAD_MULTI_STREAM_BYTES,
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

function formatDeltaMs(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)} ms`;
}

function formatDualSpeed(downloadMbps, uploadMbps) {
  if (!Number.isFinite(downloadMbps) && !Number.isFinite(uploadMbps)) {
    return '-- Mbps';
  }
  if (!Number.isFinite(downloadMbps)) {
    return `${uploadMbps.toFixed(1)}↑ Mbps`;
  }
  if (!Number.isFinite(uploadMbps)) {
    return `${downloadMbps.toFixed(1)}↓ Mbps`;
  }
  return `${downloadMbps.toFixed(1)}↓ / ${uploadMbps.toFixed(1)}↑ Mbps`;
}

function summarizeLatencySamples(values) {
  const samples = Array.isArray(values)
    ? values.filter((value) => typeof value === 'number' && Number.isFinite(value))
    : [];

  if (samples.length === 0) {
    return {
      samples: [],
      medianMs: null,
      avgMs: null,
      jitterMs: null,
      minMs: null,
      maxMs: null,
    };
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

function trimmedAverage(values) {
  const samples = Array.isArray(values)
    ? values.filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
    : [];
  if (samples.length === 0) {
    return null;
  }

  const warmTrim = samples.length > 5
    ? Math.min(Math.floor(samples.length * 0.18), samples.length - 3)
    : 0;
  const warmed = samples.slice(warmTrim);
  const sorted = [...warmed].sort((left, right) => left - right);
  const lower = sorted.length > 4 ? Math.floor(sorted.length * 0.1) : 0;
  const upper = sorted.length > 4 ? Math.ceil(sorted.length * 0.9) : sorted.length;
  const trimmed = sorted.slice(lower, upper);
  return average(trimmed.length > 0 ? trimmed : warmed);
}

function summarizeSpeedSamples(values, fallbackMbps = null) {
  const samples = Array.isArray(values)
    ? values.filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
    : [];
  if (samples.length === 0) {
    return {
      representativeMbps: fallbackMbps,
      peakMbps: fallbackMbps,
      medianMbps: fallbackMbps,
      sampleCount: 0,
    };
  }

  return {
    representativeMbps: trimmedAverage(samples) ?? average(samples) ?? fallbackMbps,
    peakMbps: Math.max(...samples),
    medianMbps: median(samples) ?? fallbackMbps,
    sampleCount: samples.length,
  };
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

function renderSpeedEndpoint() {
  updateSpeedMetric('speedEndpoint', speedEndpointLabel(), '当前用户浏览器 → 当前部署节点');
}

function getSpeedModeConfig(mode = 'multi') {
  return SPEED_TEST_MODES[mode] || SPEED_TEST_MODES.multi;
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
    button.textContent = config.label === getSpeedModeConfig(runningMode).label ? '测速中...' : '等待中...';
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

function resetBrowserSpeedCard(mode = null) {
  const modeConfig = mode ? getSpeedModeConfig(mode) : null;
  setSpeedCardState({
    showSpinner: false,
    borderColor: 'rgba(0, 122, 255, 0.16)',
    status: '等待测速',
    mainValue: '-- Mbps',
    summary: modeConfig
      ? `本次将只执行${modeConfig.label}测速。另一种模式不会自动连带执行，需要单独点击对应按钮。`
      : '通过当前浏览器向当前部署节点发起真实下载与上传流量。单线程和多线程现在是两个独立入口，不会再一次混跑。',
  });
  updateSpeedMetric(
    'speedDownloadMulti',
    mode === 'single' ? '未执行' : '-',
    mode === 'single' ? '本次未运行多线程下载' : '独立执行多线程测速后显示'
  );
  updateSpeedMetric(
    'speedDownloadSingle',
    mode === 'multi' ? '未执行' : '-',
    mode === 'multi' ? '本次未运行单线程下载' : '独立执行单线程测速后显示'
  );
  updateSpeedMetric(
    'speedUploadMulti',
    mode === 'single' ? '未执行' : '-',
    mode === 'single' ? '本次未运行多线程上传' : '独立执行多线程测速后显示'
  );
  updateSpeedMetric(
    'speedUploadSingle',
    mode === 'multi' ? '未执行' : '-',
    mode === 'multi' ? '本次未运行单线程上传' : '独立执行单线程测速后显示'
  );
  updateSpeedMetric('speedLatencyIdle', '-', '测速前空载基线');
  updateSpeedMetric('speedLatencyDownload', '-', '当前测速模式的下载阶段同步采样');
  updateSpeedMetric('speedLatencyUpload', '-', '当前测速模式的上传阶段同步采样');
  updateSpeedMetric('speedJitter', '-', '空载延迟波动');
  renderSpeedEndpoint();
  setSpeedHint(
    modeConfig
      ? `等待开始${modeConfig.label}测速。该测试会真实占用当前用户设备的上下行带宽，并同步采集当前模式下的负载延迟。`
      : '等待开始浏览器测速。该测试会真实占用当前用户设备的上下行带宽，并同步采集负载中的延迟变化。'
  );
}

function setBrowserSpeedPreparing(mode) {
  const modeConfig = getSpeedModeConfig(mode);
  setSpeedCardState({
    showSpinner: true,
    borderColor: 'var(--accent-blue)',
    status: `${modeConfig.label}测速准备中...`,
    mainValue: '-- Mbps',
    summary: `正在预热${modeConfig.label}测速链路并校验部署节点是否可用。`,
  });
  renderSpeedEndpoint();
  setSpeedHint(`测速流量将直接由当前浏览器发起。本次只执行${modeConfig.label}模式，若页面部署在远端，你本地网卡应会出现真实吞吐变化。`);
}

function renderLatencyBaseline(latencyStats) {
  updateSpeedMetric(
    'speedLatencyIdle',
    formatLatencyMs(latencyStats.medianMs),
    `平均 ${formatLatencyMs(latencyStats.avgMs)} · ${latencyStats.samples.length} 次采样`
  );
  updateSpeedMetric(
    'speedJitter',
    formatLatencyMs(latencyStats.jitterMs),
    `最小 ${formatLatencyMs(latencyStats.minMs)} · 最大 ${formatLatencyMs(latencyStats.maxMs)}`
  );
}

function renderLatencyProgress(samples) {
  const latencyStats = summarizeLatencySamples(samples);
  setSpeedCardState({
    showSpinner: true,
    borderColor: 'var(--accent-blue)',
    status: '空载延迟测试中...',
    mainValue: latencyStats.medianMs != null ? formatLatencyMs(latencyStats.medianMs) : '-- ms',
    summary: '先建立浏览器到部署节点的空载 RTT 基线，再对比下载与上传阶段的负载延迟。',
  });
  updateSpeedMetric(
    'speedLatencyIdle',
    formatLatencyMs(latencyStats.medianMs),
    `已采样 ${latencyStats.samples.length}/${LATENCY_SAMPLE_COUNT} 次 · 平均 ${formatLatencyMs(latencyStats.avgMs)}`
  );
  updateSpeedMetric(
    'speedJitter',
    formatLatencyMs(latencyStats.jitterMs),
    latencyStats.samples.length > 1
      ? `最小 ${formatLatencyMs(latencyStats.minMs)} · 最大 ${formatLatencyMs(latencyStats.maxMs)}`
      : '等待更多样本'
  );
  renderSpeedEndpoint();
  setSpeedHint('测速过程完全由当前浏览器发起，不会读取服务器侧 CLI 带宽结果。');
}

async function pingBrowserSpeed(sampleKey = 'ping') {
  const startedAt = performance.now();
  const response = await fetch(`${BROWSER_SPEED_PING_API}?r=${Date.now()}-${sampleKey}`, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-store' },
  });
  if (!response.ok) {
    throw new Error(`延迟探测失败 (${response.status})`);
  }
  await response.json().catch(() => ({}));
  return performance.now() - startedAt;
}

async function measureBrowserLatency(sampleCount = LATENCY_SAMPLE_COUNT) {
  const samples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const durationMs = await pingBrowserSpeed(`idle-${index}`);
    samples.push(durationMs);
    renderLatencyProgress(samples);
    addLog('浏览器测速', `延迟样本 ${index + 1}: ${formatLatencyMs(durationMs)}`, 'info', 'speed');
    await delay(120);
  }

  return summarizeLatencySamples(samples);
}

function createTransferTracker(totalBytes, onProgress) {
  const tracker = {
    totalBytes,
    transferredBytes: 0,
    startedAt: performance.now(),
    lastEmittedAt: performance.now(),
    lastEmittedBytes: 0,
    samples: [],
    peakMbps: 0,
  };

  function emit(force = false) {
    const now = performance.now();
    if (!force && now - tracker.lastEmittedAt < PROGRESS_THROTTLE_MS) {
      return;
    }

    const currentMbps = bytesToMbps(
      tracker.transferredBytes - tracker.lastEmittedBytes,
      now - tracker.lastEmittedAt
    );
    const averageMbps = bytesToMbps(tracker.transferredBytes, now - tracker.startedAt);
    const effectiveMbps = currentMbps || averageMbps;

    if (effectiveMbps && Number.isFinite(effectiveMbps)) {
      tracker.samples.push(effectiveMbps);
      tracker.peakMbps = Math.max(tracker.peakMbps, effectiveMbps);
    } else if (averageMbps && Number.isFinite(averageMbps)) {
      tracker.peakMbps = Math.max(tracker.peakMbps, averageMbps);
    }

    onProgress?.({
      currentMbps: effectiveMbps || averageMbps,
      averageMbps,
      transferredBytes: tracker.transferredBytes,
      totalBytes: tracker.totalBytes,
      samples: tracker.samples,
      peakMbps: tracker.peakMbps,
    });

    tracker.lastEmittedAt = now;
    tracker.lastEmittedBytes = tracker.transferredBytes;
  }

  return {
    addBytes(byteCount) {
      tracker.transferredBytes += byteCount;
      emit(false);
    },
    finalize() {
      emit(true);
      const durationMs = performance.now() - tracker.startedAt;
      const rawAverageMbps = bytesToMbps(tracker.transferredBytes, durationMs);
      const speedSummary = summarizeSpeedSamples(tracker.samples, rawAverageMbps);
      return {
        totalBytes: tracker.transferredBytes,
        durationMs,
        rawAverageMbps,
        mbps: speedSummary.representativeMbps ?? rawAverageMbps,
        peakMbps: speedSummary.peakMbps ?? rawAverageMbps,
        medianMbps: speedSummary.medianMbps ?? rawAverageMbps,
        sampleCount: speedSummary.sampleCount,
      };
    },
  };
}

async function readDownloadStream(totalBytes, streamIndex, onChunk) {
  const response = await fetch(`${BROWSER_SPEED_DOWNLOAD_API}?bytes=${totalBytes}&r=${Date.now()}-${streamIndex}`, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-store' },
  });
  if (!response.ok) {
    throw new Error(`下载测速失败 (${response.status})`);
  }

  if (!response.body || !response.body.getReader) {
    const buffer = await response.arrayBuffer();
    onChunk(buffer.byteLength);
    return buffer.byteLength;
  }

  const reader = response.body.getReader();
  let transferredBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    transferredBytes += value.byteLength;
    onChunk(value.byteLength);
  }
  return transferredBytes;
}

async function runDownloadPhase({ concurrency, bytesPerStream, onProgress }) {
  const tracker = createTransferTracker(concurrency * bytesPerStream, onProgress);
  const received = await Promise.all(
    Array.from({ length: concurrency }, (_, index) =>
      readDownloadStream(bytesPerStream, index, (chunkBytes) => {
        tracker.addBytes(chunkBytes);
      })
    )
  );

  return {
    direction: 'download',
    concurrency,
    ...tracker.finalize(),
    totalBytes: received.reduce((sum, current) => sum + current, 0),
  };
}

function getUploadPayload(totalBytes) {
  if (!uploadPayloadCache.has(totalBytes)) {
    uploadPayloadCache.set(totalBytes, new Blob([new Uint8Array(totalBytes)], { type: 'application/octet-stream' }));
  }
  return uploadPayloadCache.get(totalBytes);
}

function uploadStream(totalBytes, streamIndex, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let uploadedBytes = 0;

    xhr.open('POST', `${BROWSER_SPEED_UPLOAD_API}?r=${Date.now()}-${streamIndex}`, true);
    xhr.responseType = 'json';
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.loaded <= uploadedBytes) {
        return;
      }
      onProgress(event.loaded - uploadedBytes);
      uploadedBytes = event.loaded;
    };

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`上传测速失败 (${xhr.status})`));
        return;
      }

      const response = xhr.response && typeof xhr.response === 'object'
        ? xhr.response
        : JSON.parse(xhr.responseText || '{}');
      const receivedBytes = typeof response.receivedBytes === 'number' ? response.receivedBytes : totalBytes;
      if (receivedBytes > uploadedBytes) {
        onProgress(receivedBytes - uploadedBytes);
        uploadedBytes = receivedBytes;
      }
      resolve(receivedBytes);
    };

    xhr.onerror = () => reject(new Error('上传测速网络异常'));
    xhr.ontimeout = () => reject(new Error('上传测速超时'));
    xhr.timeout = 120000;
    xhr.send(getUploadPayload(totalBytes));
  });
}

async function runUploadPhase({ concurrency, bytesPerStream, onProgress }) {
  const tracker = createTransferTracker(concurrency * bytesPerStream, onProgress);
  const received = await Promise.all(
    Array.from({ length: concurrency }, (_, index) =>
      uploadStream(bytesPerStream, index, (chunkBytes) => {
        tracker.addBytes(chunkBytes);
      })
    )
  );

  return {
    direction: 'upload',
    concurrency,
    ...tracker.finalize(),
    totalBytes: received.reduce((sum, current) => sum + current, 0),
  };
}

function createLoadLatencyProbe(onSample) {
  let stopped = false;
  const runner = (async () => {
    const samples = [];
    while (!stopped) {
      try {
        const durationMs = await pingBrowserSpeed(`load-${samples.length}`);
        samples.push(durationMs);
        onSample?.(summarizeLatencySamples(samples));
      } catch (error) {
        // Ignore transient ping failures during load and keep throughput sampling running.
      }

      if (stopped) {
        break;
      }
      await delay(LOAD_LATENCY_INTERVAL_MS);
    }
    return summarizeLatencySamples(samples);
  })();

  return {
    async stop() {
      stopped = true;
      return runner;
    },
  };
}

function renderLoadLatencyMetric(metricId, latencyStats, baselineLatency, detailPrefix) {
  if (!latencyStats || latencyStats.medianMs === null) {
    updateSpeedMetric(metricId, '-', `${detailPrefix}等待采样`);
    return;
  }

  const deltaMs = baselineLatency?.medianMs != null && latencyStats.medianMs != null
    ? latencyStats.medianMs - baselineLatency.medianMs
    : null;
  updateSpeedMetric(
    metricId,
    formatLatencyMs(latencyStats.medianMs),
    `${detailPrefix}${latencyStats.samples.length} 次采样 · 较空载 ${formatDeltaMs(deltaMs)}`
  );
}

function getThroughputMetricId(direction, concurrency) {
  if (direction === 'download') {
    return concurrency > 1 ? 'speedDownloadMulti' : 'speedDownloadSingle';
  }
  return concurrency > 1 ? 'speedUploadMulti' : 'speedUploadSingle';
}

function renderTransferStage({ direction, concurrency, progress, baselineLatency, loadedLatency, finalResult }) {
  const isDownload = direction === 'download';
  const isMulti = concurrency > 1;
  const phaseName = `${isMulti ? '多线程' : '单线程'}${isDownload ? '下载' : '上传'}`;
  const borderColor = isDownload ? 'var(--accent-blue)' : 'var(--accent-yellow)';
  const liveMbps = finalResult?.mbps ?? progress.averageMbps ?? progress.currentMbps;
  const throughputSummary = summarizeSpeedSamples(progress.samples, progress.averageMbps);
  const representativeMbps = finalResult?.mbps ?? throughputSummary.representativeMbps ?? progress.averageMbps;
  const detailText = finalResult
    ? `${concurrency} 线程 · ${formatBytesMiB(finalResult.totalBytes)} 数据 · 峰值 ${formatMbps(finalResult.peakMbps)}`
    : `${formatBytesMiB(progress.transferredBytes)} / ${formatBytesMiB(progress.totalBytes)} · 当前 ${formatMbps(progress.currentMbps)}`;

  setSpeedCardState({
    showSpinner: true,
    borderColor,
    status: `${phaseName}测速中...`,
    mainValue: formatMbps(liveMbps),
    summary: isDownload
      ? `${phaseName}用于观察当前浏览器到部署节点的${isMulti ? '聚合下行能力' : '单连接下行能力'}。`
      : `${phaseName}用于观察当前浏览器到部署节点的${isMulti ? '聚合上行能力' : '单连接上行能力'}。`,
  });

  updateSpeedMetric(getThroughputMetricId(direction, concurrency), formatMbps(representativeMbps), detailText);
  renderLatencyBaseline(baselineLatency);
  if (isDownload && isMulti) {
    renderLoadLatencyMetric('speedLatencyDownload', loadedLatency, baselineLatency, '多线程下载 · ');
  }
  if (!isDownload && isMulti) {
    renderLoadLatencyMetric('speedLatencyUpload', loadedLatency, baselineLatency, '多线程上传 · ');
  }
  renderSpeedEndpoint();
  setSpeedHint(
    isDownload
      ? `当前大号数值是浏览器实时下载吞吐，当前运行模式为${phaseName}。`
      : `当前大号数值是浏览器实时上传吞吐，当前运行模式为${phaseName}。`,
    isDownload ? 'info' : 'warn'
  );
}

async function runMeasuredTransfer({ direction, concurrency, bytesPerStream, baselineLatency, captureLoadLatency = false }) {
  let latestLoadLatency = null;
  let probeStopped = false;
  const latencyProbe = captureLoadLatency
    ? createLoadLatencyProbe((latencyStats) => {
      latestLoadLatency = latencyStats;
    })
    : null;

  async function stopProbe() {
    if (!latencyProbe || probeStopped) {
      return latestLoadLatency;
    }
    probeStopped = true;
    latestLoadLatency = await latencyProbe.stop();
    return latestLoadLatency;
  }

  try {
    const runner = direction === 'download' ? runDownloadPhase : runUploadPhase;
    const result = await runner({
      concurrency,
      bytesPerStream,
      onProgress(progress) {
        renderTransferStage({
          direction,
          concurrency,
          progress,
          baselineLatency,
          loadedLatency: latestLoadLatency,
        });
      },
    });

    const loadedLatency = await stopProbe();
    renderTransferStage({
      direction,
      concurrency,
      progress: {
        currentMbps: result.rawAverageMbps ?? result.mbps,
        averageMbps: result.mbps,
        transferredBytes: result.totalBytes,
        totalBytes: result.totalBytes,
        samples: [],
      },
      baselineLatency,
      loadedLatency,
      finalResult: result,
    });

    return {
      ...result,
      loadedLatency,
    };
  } catch (error) {
    await stopProbe().catch(() => null);
    throw error;
  }
}

function renderBrowserSpeedResult({
  mode,
  idleLatency,
  download,
  upload,
  downloadLoadedLatency,
  uploadLoadedLatency,
}) {
  const modeConfig = getSpeedModeConfig(mode);
  const otherModeLabel = mode === 'single' ? '多线程' : '单线程';
  setSpeedCardState({
    showSpinner: false,
    borderColor: 'var(--accent-green)',
    status: '已完成',
    mainValue: formatDualSpeed(download?.mbps, upload?.mbps),
    summary: `${modeConfig.label}测速完成。本页现在不会混跑另一种模式，如需对比请单独点击“${otherModeLabel}测速”。`,
  });

  updateSpeedMetric(
    modeConfig.downloadMetricId,
    formatMbps(download?.mbps),
    `${modeConfig.concurrency} 线程 · ${formatBytesMiB(download?.totalBytes)} · 峰值 ${formatMbps(download?.peakMbps)}`
  );
  updateSpeedMetric(
    modeConfig.otherDownloadMetricId,
    '未执行',
    `本次未运行${otherModeLabel}下载`
  );
  updateSpeedMetric(
    modeConfig.uploadMetricId,
    formatMbps(upload?.mbps),
    `${modeConfig.concurrency} 线程 · ${formatBytesMiB(upload?.totalBytes)} · 峰值 ${formatMbps(upload?.peakMbps)}`
  );
  updateSpeedMetric(
    modeConfig.otherUploadMetricId,
    '未执行',
    `本次未运行${otherModeLabel}上传`
  );
  renderLatencyBaseline(idleLatency);
  renderLoadLatencyMetric('speedLatencyDownload', downloadLoadedLatency, idleLatency, `${modeConfig.label}下载 · `);
  renderLoadLatencyMetric('speedLatencyUpload', uploadLoadedLatency, idleLatency, `${modeConfig.label}上传 · `);
  renderSpeedEndpoint();
  setSpeedHint(`当前结果来自“用户浏览器 → 当前部署节点”的真实流量，本次只执行了${modeConfig.label}模式。`, 'success');

  addLog('浏览器测速', `目标节点 ${speedEndpointLabel()}`, 'info', 'speed');
  addLog(
    '浏览器测速',
    `${modeConfig.label}结果 下载 ${formatMbps(download.mbps)} / 上传 ${formatMbps(upload.mbps)}`,
    'result',
    'speed'
  );
  addLog('浏览器测速', `${modeConfig.label}测速完成 ✓`, 'result', 'speed');
}

function renderBrowserSpeedError(message) {
  document.getElementById('speedSpinner').style.display = 'none';
  document.getElementById('speedCard').style.borderColor = 'var(--accent-red)';
  setText('speedStatus', '测速失败');
  setText('speedMainValue', '-- Mbps');
  setText('speedSummary', '无法完成浏览器测速');
  renderSpeedEndpoint();
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

async function startBrowserSpeedTest(mode = 'multi') {
  const modeConfig = getSpeedModeConfig(mode);
  setSpeedButtonsState(mode);

  hideSection('resultSection');
  showSection('speedResultSection');
  resetLogs('speed');
  resetBrowserSpeedCard(mode);
  setBrowserSpeedPreparing(mode);
  addLog('浏览器测速', `开始从当前浏览器发起${modeConfig.label}测速流程...`, 'info', 'speed');

  try {
    await pingBrowserSpeed('warmup');
    addLog('浏览器测速', '测速端点预热完成', 'info', 'speed');

    const idleLatency = await measureBrowserLatency();
    addLog(
      '浏览器测速',
      `空载延迟 ${formatLatencyMs(idleLatency.medianMs)} · 抖动 ${formatLatencyMs(idleLatency.jitterMs)}`,
      'info',
      'speed'
    );

    await delay(SPEED_STAGE_PAUSE_MS);
    const download = await runMeasuredTransfer({
      direction: 'download',
      concurrency: modeConfig.concurrency,
      bytesPerStream: modeConfig.downloadBytes,
      baselineLatency: idleLatency,
      captureLoadLatency: true,
    });
    addLog('浏览器测速', `${modeConfig.label}下载 ${formatMbps(download.mbps)}`, 'result', 'speed');
    if (download.loadedLatency?.medianMs != null) {
      addLog('浏览器测速', `下载负载延迟 ${formatLatencyMs(download.loadedLatency.medianMs)}`, 'info', 'speed');
    }

    await delay(SPEED_STAGE_PAUSE_MS);
    const upload = await runMeasuredTransfer({
      direction: 'upload',
      concurrency: modeConfig.concurrency,
      bytesPerStream: modeConfig.uploadBytes,
      baselineLatency: idleLatency,
      captureLoadLatency: true,
    });
    addLog('浏览器测速', `${modeConfig.label}上传 ${formatMbps(upload.mbps)}`, 'result', 'speed');
    if (upload.loadedLatency?.medianMs != null) {
      addLog('浏览器测速', `上传负载延迟 ${formatLatencyMs(upload.loadedLatency.medianMs)}`, 'info', 'speed');
    }

    renderBrowserSpeedResult({
      mode,
      idleLatency,
      download,
      upload,
      downloadLoadedLatency: download.loadedLatency,
      uploadLoadedLatency: upload.loadedLatency,
    });
  } catch (error) {
    renderBrowserSpeedError(error instanceof Error ? error.message : '浏览器测速失败');
  } finally {
    document.getElementById('speedSpinner').style.display = 'none';
    setSpeedButtonsState(null);
  }
}

resetBrowserSpeedCard();
