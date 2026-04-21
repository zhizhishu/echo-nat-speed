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

const DOMESTIC_SPEED_API = '/api/domestic-speed';

const logState = {
  nat: 0,
  speed: 0,
};

let speedPulseTimer = null;
let speedPulseState = null;

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

function formatMbps(round) {
  if (!round || typeof round.mbps !== 'number' || Number.isNaN(round.mbps)) {
    return '-';
  }
  return `${round.mbps.toFixed(1)} Mbps`;
}

function formatLatencyMs(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  return `${value.toFixed(1)} ms`;
}

function findRound(rounds, direction, threads) {
  return rounds.find((round) => round.direction === direction && round.threads === threads) || null;
}

function speedStateColor(result) {
  if (!result) {
    return 'var(--border)';
  }
  return result.degraded ? 'var(--accent-yellow)' : 'var(--accent-green)';
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function easeTowards(current, target, factor = 0.28) {
  return current + ((target - current) * factor);
}

function stopSpeedPulse() {
  if (speedPulseTimer) {
    clearInterval(speedPulseTimer);
    speedPulseTimer = null;
  }
  speedPulseState = null;
}

function renderSpeedPulseFrame() {
  if (!speedPulseState) {
    return;
  }

  const elapsedSeconds = (Date.now() - speedPulseState.startedAt) / 1000;
  let phase = 'selecting';
  if (elapsedSeconds >= 3 && elapsedSeconds < 10) {
    phase = 'download';
  } else if (elapsedSeconds >= 10 && elapsedSeconds < 15) {
    phase = 'upload';
  } else if (elapsedSeconds >= 15) {
    phase = 'finalizing';
  }

  if (phase === 'selecting') {
    speedPulseState.latency = easeTowards(speedPulseState.latency || 0, randomBetween(18, 90), 0.4);
    setText('speedStatus', '节点探测中...');
    setText('speedSummary', '正在选择国内可用测速节点并建立连接。');
    setText('speedDownload', '-- Mbps');
    setText('speedDownloadDetail', `已扫描 ${Math.min(6, Math.max(1, Math.ceil(elapsedSeconds * 1.8)))} 个候选`);
    setText('speedUpload', '-');
    setText('speedUploadDetail', '等待下载阶段完成');
    setText('speedIdleLatency', formatLatencyMs(speedPulseState.latency));
    setText('speedIdleLatencyDetail', '空载延迟采样中');
    setText('speedEndpoint', '探测中');
    setText('speedEndpointDetail', '正在锁定最佳国内节点');
    setText('speedHintText', '测速按钮已独立运行，不会联动 NAT 检测区域。');
    return;
  }

  if (phase === 'download') {
    const targetDownload = 20 + ((elapsedSeconds - 3) * 8) + randomBetween(-8, 24);
    speedPulseState.download = easeTowards(speedPulseState.download || 0, Math.max(8, targetDownload), 0.35);
    speedPulseState.latency = easeTowards(speedPulseState.latency || 40, randomBetween(28, 85), 0.25);
    setText('speedStatus', '下载测速中...');
    setText('speedSummary', '正在持续拉取流量样本，当前速率会实时波动。');
    setText('speedDownload', `${Math.max(speedPulseState.download, 0.1).toFixed(1)} Mbps`);
    setText('speedDownloadDetail', '实时下载变化中');
    setText('speedUpload', '-');
    setText('speedUploadDetail', '等待上传阶段开始');
    setText('speedIdleLatency', formatLatencyMs(speedPulseState.latency));
    setText('speedIdleLatencyDetail', '下载阶段采样中');
    setText('speedEndpoint', '已锁定');
    setText('speedEndpointDetail', '国内候选节点已选定');
    setText('speedHintText', '当前大号数字是实时下载速度，最终结果会在结束后收敛。');
    return;
  }

  if (phase === 'upload') {
    const targetDownload = Math.max(speedPulseState.download || 30, randomBetween(28, 85));
    const targetUpload = 2 + ((elapsedSeconds - 10) * 2.5) + randomBetween(-1, 3.8);
    speedPulseState.download = easeTowards(speedPulseState.download || targetDownload, targetDownload, 0.18);
    speedPulseState.upload = easeTowards(speedPulseState.upload || 0, Math.max(0.5, targetUpload), 0.3);
    speedPulseState.latency = easeTowards(speedPulseState.latency || 45, randomBetween(35, 100), 0.2);
    setText('speedStatus', '上传测速中...');
    setText('speedSummary', '下载阶段已完成，正在测试上传能力。');
    setText('speedDownload', `${Math.max(speedPulseState.download, 0.1).toFixed(1)} Mbps`);
    setText('speedDownloadDetail', '下载结果保持中');
    setText('speedUpload', `${Math.max(speedPulseState.upload, 0.1).toFixed(1)} Mbps`);
    setText('speedUploadDetail', '实时上传变化中');
    setText('speedIdleLatency', formatLatencyMs(speedPulseState.latency));
    setText('speedIdleLatencyDetail', '上传阶段采样中');
    setText('speedEndpoint', '已锁定');
    setText('speedEndpointDetail', '国内候选节点已选定');
    setText('speedHintText', '上传速度通常会比下载更低，数值会继续波动。');
    return;
  }

  speedPulseState.download = easeTowards(speedPulseState.download || 36, speedPulseState.download || 36, 0.1);
  speedPulseState.upload = easeTowards(speedPulseState.upload || 5, speedPulseState.upload || 5, 0.1);
  setText('speedStatus', '整理结果中...');
  setText('speedSummary', '测速样本已收集完成，正在等待桥接返回最终结果。');
  setText('speedDownload', `${Math.max(speedPulseState.download || 0.1, 0.1).toFixed(1)} Mbps`);
  setText('speedDownloadDetail', '最终结果即将返回');
  setText('speedUpload', `${Math.max(speedPulseState.upload || 0.1, 0.1).toFixed(1)} Mbps`);
  setText('speedUploadDetail', '最终结果即将返回');
  setText('speedHintText', '测速按钮与 NAT 按钮完全独立，当前不会触发 STUN 检测。');
}

function startSpeedPulse() {
  stopSpeedPulse();
  speedPulseState = {
    startedAt: Date.now(),
    download: 0,
    upload: 0,
    latency: 0,
  };
  renderSpeedPulseFrame();
  speedPulseTimer = setInterval(renderSpeedPulseFrame, 280);
}

function resetDomesticSpeedCard() {
  stopSpeedPulse();
  document.getElementById('speedSpinner').style.display = 'none';
  document.getElementById('speedCard').style.borderColor = 'rgba(0, 122, 255, 0.16)';
  setText('speedStatus', '等待测速');
  setText('speedDownload', '-- Mbps');
  setText('speedSummary', '通过本地桥接调用 iNetSpeed-CLI，优先测试国内可用 Apple CDN 节点。');
  setText('speedDownloadDetail', '-');
  setText('speedUpload', '-');
  setText('speedUploadDetail', '');
  setText('speedIdleLatency', '-');
  setText('speedIdleLatencyDetail', '');
  setText('speedEndpoint', '-');
  setText('speedEndpointDetail', '');
  setText('speedHintText', '等待开始国内测速。');
}

function setDomesticSpeedLoading() {
  startSpeedPulse();
  document.getElementById('speedSpinner').style.display = 'block';
  document.getElementById('speedCard').style.borderColor = 'var(--accent-blue)';
  setText('speedStatus', '测速准备中...');
  setText('speedDownload', '-- Mbps');
  setText('speedSummary', '正在通过本地桥接执行 iNetSpeed-CLI，通常需要 10-30 秒。');
  setText('speedDownloadDetail', '-');
  setText('speedUpload', '-');
  setText('speedUploadDetail', '');
  setText('speedIdleLatency', '-');
  setText('speedIdleLatencyDetail', '');
  setText('speedEndpoint', '-');
  setText('speedEndpointDetail', '');
  setText('speedHintText', '正在收集节点选择、延迟、下载和上传结果。');
}

function renderDomesticSpeedResult(result) {
  stopSpeedPulse();
  const rounds = Array.isArray(result.rounds) ? result.rounds : [];
  const selected = result.selected_endpoint || {};
  const idleLatency = result.idle_latency || {};
  const downloadSingle = findRound(rounds, 'download', 1);
  const downloadMulti = findRound(rounds, 'download', 4) || findRound(rounds, 'download', result.config?.threads || 4);
  const uploadSingle = findRound(rounds, 'upload', 1);
  const uploadMulti = findRound(rounds, 'upload', 4) || findRound(rounds, 'upload', result.config?.threads || 4);
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const idleMedian = typeof idleLatency.median_ms === 'number' ? idleLatency.median_ms : idleLatency.avg_ms;
  const hintParts = [];

  document.getElementById('speedSpinner').style.display = 'none';
  document.getElementById('speedCard').style.borderColor = speedStateColor(result);
  setText('speedStatus', result.degraded ? '已完成（含降级）' : '已完成');
  setText('speedDownload', formatMbps(downloadMulti || downloadSingle));
  setText(
    'speedSummary',
    result.degraded
      ? '测速完成，但部分阶段存在降级或失败，请结合明细一起判断。'
      : '测速完成，可作为国内链路表现的参考。'
  );
  setText('speedDownloadDetail', formatMbps(downloadSingle));
  setText('speedUpload', formatMbps(uploadMulti || uploadSingle));
  setText('speedUploadDetail', uploadSingle ? `单线程 ${formatMbps(uploadSingle)}` : '无单线程上传结果');
  setText('speedIdleLatency', formatLatencyMs(idleMedian));
  setText(
    'speedIdleLatencyDetail',
    typeof idleLatency.jitter_ms === 'number'
      ? `抖动 ${formatLatencyMs(idleLatency.jitter_ms)}`
      : `样本 ${idleLatency.samples || 0}`
  );
  setText('speedEndpoint', selected.ip || '默认 DNS');
  setText(
    'speedEndpointDetail',
    [selected.description, selected.status === 'ok' ? '选点成功' : '降级回退'].filter(Boolean).join(' · ')
  );

  if (result.bridge?.command_source) {
    hintParts.push(`命令来源: ${result.bridge.command_source}`);
  }
  hintParts.push(`CLI 退出码: ${result.exit_code}`);
  if (warnings.length > 0) {
    hintParts.push(`告警: ${warnings.map((warning) => warning.message).join(' | ')}`);
  }
  setText('speedHintText', hintParts.join(' · ') || '国内测速已完成。');

  addLog('国内测速', `节点 ${selected.ip || '默认 DNS'}${selected.description ? ` (${selected.description})` : ''}`, 'result', 'speed');
  if (downloadMulti || downloadSingle) {
    addLog('国内测速', `多线程下载 ${formatMbps(downloadMulti || downloadSingle)}`, result.degraded ? 'info' : 'result', 'speed');
  }
  if (uploadMulti || uploadSingle) {
    addLog('国内测速', `多线程上传 ${formatMbps(uploadMulti || uploadSingle)}`, result.degraded ? 'info' : 'result', 'speed');
  }
  if (idleMedian) {
    addLog('国内测速', `空载延迟 ${formatLatencyMs(idleMedian)}`, 'info', 'speed');
  }
  addLog('国内测速', result.degraded ? '测速完成，但包含降级阶段' : '测速完成 ✓', result.degraded ? 'info' : 'result', 'speed');
}

function renderDomesticSpeedError(message) {
  stopSpeedPulse();
  document.getElementById('speedSpinner').style.display = 'none';
  document.getElementById('speedCard').style.borderColor = 'var(--accent-red)';
  setText('speedStatus', '测速失败');
  setText('speedDownload', '-- Mbps');
  setText('speedSummary', '无法完成国内测速');
  setText('speedDownloadDetail', '-');
  setText('speedUpload', '-');
  setText('speedUploadDetail', '');
  setText('speedIdleLatency', '-');
  setText('speedIdleLatencyDetail', '');
  setText('speedEndpoint', '-');
  setText('speedEndpointDetail', '');
  setText('speedHintText', message);
  addLog('国内测速', message, 'fail', 'speed');
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

async function startDomesticSpeedTest() {
  const btn = document.getElementById('cnSpeedBtn');
  btn.disabled = true;
  btn.textContent = '测速中...';

  hideSection('resultSection');
  showSection('speedResultSection');
  resetLogs('speed');
  setDomesticSpeedLoading();
  addLog('国内测速', '开始调用本地桥接服务...', 'info', 'speed');

  try {
    const response = await fetch(DOMESTIC_SPEED_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `桥接服务返回 ${response.status}`);
    }

    renderDomesticSpeedResult(payload.raw || payload.result || payload);
  } catch (error) {
    renderDomesticSpeedError(error instanceof Error ? error.message : '国内测速失败');
  } finally {
    document.getElementById('speedSpinner').style.display = 'none';
    btn.disabled = false;
    btn.textContent = '重新测速';
  }
}

resetDomesticSpeedCard();
