# ================================================================
# NAT Type Detection Tool (Pure PowerShell, No Dependencies)
# STUN Protocol (RFC 5389) - MyNAT-style multi-server detection
# ================================================================

param(
    [int]$Timeout = 3000,
    [string]$ServerPreset = "",       # Skip menu: google, cloudflare, mozilla, all, custom
    [string]$CustomServer = "",       # host:port for custom server
    [switch]$Quick,                   # Quick mode: skip interactive menu
    [switch]$Help
)

$ErrorActionPreference = 'Stop'

if ($Help) {
    Write-Host ""
    Write-Host "  NAT Type Detection Tool" -ForegroundColor Cyan
    Write-Host "  Usage:"
    Write-Host "    .\nat_detect.ps1                  # Interactive mode (menu)"
    Write-Host "    .\nat_detect.ps1 -Quick            # Quick detect with all servers"
    Write-Host "    .\nat_detect.ps1 -ServerPreset google"
    Write-Host "    .\nat_detect.ps1 -ServerPreset custom -CustomServer stun.example.com:3478"
    Write-Host "    .\nat_detect.ps1 -Timeout 5000     # Set UDP timeout in ms"
    Write-Host ""
    Write-Host "  Server Presets: mynat, google, cloudflare, mozilla, twilio, stuntman, all, custom"
    Write-Host ""
    exit 0
}

# ================================================================
# STUN/TURN Server Presets
# ================================================================
$ServerGroups = [ordered]@{
    "mynat" = @{
        Name = "MyNAT Client (mao.fan) - Recommended"
        Servers = @(
            @{ Host = 'stun.bethesda.net';      Port = 3478 },
            @{ Host = 'stun.chat.bilibili.com'; Port = 3478 },
            @{ Host = 'stun.miui.com';          Port = 3478 },
            @{ Host = 'stun.qq.com';            Port = 3478 },
            @{ Host = 'stun.synology.com';      Port = 3478 }
        )
    }
    "google" = @{
        Name = "Google STUN"
        Servers = @(
            @{ Host = 'stun.l.google.com';  Port = 19302 },
            @{ Host = 'stun1.l.google.com'; Port = 19302 },
            @{ Host = 'stun2.l.google.com'; Port = 19302 },
            @{ Host = 'stun3.l.google.com'; Port = 19302 },
            @{ Host = 'stun4.l.google.com'; Port = 19302 }
        )
    }
    "cloudflare" = @{
        Name = "Cloudflare STUN"
        Servers = @(
            @{ Host = 'stun.cloudflare.com'; Port = 3478 }
        )
    }
    "mozilla" = @{
        Name = "Mozilla STUN"
        Servers = @(
            @{ Host = 'stun.services.mozilla.com'; Port = 3478 }
        )
    }
    "twilio" = @{
        Name = "Twilio STUN"
        Servers = @(
            @{ Host = 'global.stun.twilio.com'; Port = 3478 }
        )
    }
    "stuntman" = @{
        Name = "Stuntman (stunprotocol.org)"
        Servers = @(
            @{ Host = 'stunserver.stunprotocol.org'; Port = 3478 }
        )
    }
}

# ================================================================
# STUN Protocol Implementation
# ================================================================
function New-StunBindingRequest {
    $msg = [byte[]]::new(20)
    $msg[0] = 0x00; $msg[1] = 0x01  # Binding Request
    $msg[2] = 0x00; $msg[3] = 0x00  # Length
    $msg[4] = 0x21; $msg[5] = 0x12; $msg[6] = 0xA4; $msg[7] = 0x42  # Magic Cookie
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $txid = [byte[]]::new(12)
    $rng.GetBytes($txid)
    [Array]::Copy($txid, 0, $msg, 8, 12)
    return $msg
}

function Parse-StunResponse {
    param([byte[]]$Data)
    if ($Data.Length -lt 20) { return $null }
    $msgType = [int]$Data[0] * 256 + [int]$Data[1]
    if ($msgType -ne 0x0101) { return $null }
    $msgLen = [int]$Data[2] * 256 + [int]$Data[3]
    $mc = @(0x21, 0x12, 0xA4, 0x42)
    $offset = 20
    $result = $null
    while ($offset -lt (20 + $msgLen)) {
        if (($offset + 4) -gt $Data.Length) { break }
        $attrType = [int]$Data[$offset] * 256 + [int]$Data[$offset + 1]
        $attrLen  = [int]$Data[$offset + 2] * 256 + [int]$Data[$offset + 3]
        $offset += 4
        if (($offset + $attrLen) -gt $Data.Length) { break }
        if ($attrType -eq 0x0020) {
            $family = $Data[$offset + 1]
            if ($family -eq 0x01) {
                $xPort = [int]$Data[$offset + 2] * 256 + [int]$Data[$offset + 3]
                $port = $xPort -bxor 0x2112
                $ip1 = $Data[$offset + 4] -bxor $mc[0]
                $ip2 = $Data[$offset + 5] -bxor $mc[1]
                $ip3 = $Data[$offset + 6] -bxor $mc[2]
                $ip4 = $Data[$offset + 7] -bxor $mc[3]
                $result = @{ IP = "$ip1.$ip2.$ip3.$ip4"; Port = $port }
            }
        }
        elseif ($attrType -eq 0x0001 -and $null -eq $result) {
            $family = $Data[$offset + 1]
            if ($family -eq 0x01) {
                $port = [int]$Data[$offset + 2] * 256 + [int]$Data[$offset + 3]
                $ip1 = $Data[$offset + 4]; $ip2 = $Data[$offset + 5]
                $ip3 = $Data[$offset + 6]; $ip4 = $Data[$offset + 7]
                $result = @{ IP = "$ip1.$ip2.$ip3.$ip4"; Port = $port }
            }
        }
        $offset += $attrLen
        if ($attrLen % 4 -ne 0) { $offset += (4 - ($attrLen % 4)) }
    }
    return $result
}

function Send-StunRequest {
    param(
        [System.Net.Sockets.UdpClient]$Client,
        [string]$StunHost,
        [int]$StunPort
    )
    try {
        $serverIP = [System.Net.Dns]::GetHostAddresses($StunHost) |
            Where-Object { $_.AddressFamily -eq 'InterNetwork' } |
            Select-Object -First 1
        if (-not $serverIP) { return $null }
        $endpoint = New-Object System.Net.IPEndPoint($serverIP, $StunPort)
        $request = New-StunBindingRequest
        [void]$Client.Send($request, $request.Length, $endpoint)
        $remoteEP = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $response = $Client.Receive([ref]$remoteEP)
        $sw.Stop()
        $latency = $sw.ElapsedMilliseconds
        $parsed = Parse-StunResponse -Data $response
        if ($parsed) {
            $parsed.ServerIP = $serverIP.ToString()
            $parsed.ServerHost = $StunHost
            $parsed.ServerPort = $StunPort
            $parsed.LatencyMs = $latency
        }
        return $parsed
    }
    catch { return $null }
}

function Get-LocalIP {
    try {
        $socket = New-Object System.Net.Sockets.Socket(
            [System.Net.Sockets.AddressFamily]::InterNetwork,
            [System.Net.Sockets.SocketType]::Dgram,
            [System.Net.Sockets.ProtocolType]::Udp)
        $socket.Connect('8.8.8.8', 53)
        $localIP = $socket.LocalEndPoint.Address.ToString()
        $socket.Close()
        return $localIP
    } catch { return '0.0.0.0' }
}

# ================================================================
# Interactive Server Selection Menu
# ================================================================
function Show-ServerMenu {
    Write-Host ""
    Write-Host "  =========================================" -ForegroundColor Cyan
    Write-Host "       NAT Type Detection Tool             " -ForegroundColor Cyan
    Write-Host "       STUN Protocol - RFC 5389            " -ForegroundColor Cyan
    Write-Host "  =========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Select STUN/TURN server group:" -ForegroundColor White
    Write-Host ""
    Write-Host "   [1] MyNAT Client       (mao.fan endpoints, no rate limit) - Recommended" -ForegroundColor Green
    Write-Host "       bethesda / bilibili / miui / qq / synology" -ForegroundColor DarkGreen
    Write-Host "   [2] Google STUN        (stun.l.google.com:19302)" -ForegroundColor White
    Write-Host "   [3] Cloudflare STUN    (stun.cloudflare.com:3478)" -ForegroundColor White
    Write-Host "   [4] Mozilla STUN       (stun.services.mozilla.com:3478)" -ForegroundColor White
    Write-Host "   [5] Twilio STUN        (global.stun.twilio.com:3478)" -ForegroundColor White
    Write-Host "   [6] Stuntman           (stunserver.stunprotocol.org:3478)" -ForegroundColor White
    Write-Host ""
    Write-Host "   [A] ALL servers         - Use all of the above (full scan)" -ForegroundColor Yellow
    Write-Host "   [C] Custom server       - Enter your own STUN server" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "   [Q] Quit" -ForegroundColor DarkGray
    Write-Host ""

    $choice = Read-Host "  Enter choice [1-6/A/C/Q]"
    return $choice.Trim().ToUpper()
}

function Get-SelectedServers {
    param([string]$Choice)

    $keys = @($ServerGroups.Keys)

    switch ($Choice) {
        "1" { return $ServerGroups["mynat"].Servers }
        "2" { return $ServerGroups["google"].Servers }
        "3" { return $ServerGroups["cloudflare"].Servers }
        "4" { return $ServerGroups["mozilla"].Servers }
        "5" { return $ServerGroups["twilio"].Servers }
        "6" { return $ServerGroups["stuntman"].Servers }
        "A" {
            $all = @()
            foreach ($key in $keys) { $all += $ServerGroups[$key].Servers }
            return $all
        }
        "C" {
            $input_server = Read-Host "  Enter STUN server (host:port, e.g. stun.example.com:3478)"
            $parts = $input_server.Split(':')
            $h = $parts[0].Trim()
            $p = 3478
            if ($parts.Length -gt 1) { $p = [int]$parts[1].Trim() }
            return @(@{ Host = $h; Port = $p })
        }
        "Q" { exit 0 }
        default { return $null }
    }
}

# ================================================================
# Resolve server list from params or menu
# ================================================================
$selectedServers = $null

if ($Quick) {
    $selectedServers = @()
    foreach ($key in $ServerGroups.Keys) { $selectedServers += $ServerGroups[$key].Servers }
} elseif ($ServerPreset -ne "") {
    if ($ServerPreset -eq "all") {
        $selectedServers = @()
        foreach ($key in $ServerGroups.Keys) { $selectedServers += $ServerGroups[$key].Servers }
    } elseif ($ServerPreset -eq "custom" -and $CustomServer -ne "") {
        $parts = $CustomServer.Split(':')
        $h = $parts[0].Trim()
        $p = 3478
        if ($parts.Length -gt 1) { $p = [int]$parts[1].Trim() }
        $selectedServers = @(@{ Host = $h; Port = $p })
    } elseif ($ServerGroups.Contains($ServerPreset)) {
        $selectedServers = $ServerGroups[$ServerPreset].Servers
    } else {
        Write-Host "  [!] Unknown preset: $ServerPreset" -ForegroundColor Red
        exit 1
    }
} else {
    # Interactive menu
    $choice = Show-ServerMenu
    $selectedServers = Get-SelectedServers -Choice $choice
    if (-not $selectedServers) {
        Write-Host "  [!] Invalid choice." -ForegroundColor Red
        exit 1
    }
}

# ================================================================
# NAT Detection (MyNAT-style multi-server approach)
# ================================================================
if (-not $Quick -and $ServerPreset -eq "") {
    Write-Host ""
    Write-Host "  =========================================" -ForegroundColor Cyan
    Write-Host "       NAT Type Detection Tool             " -ForegroundColor Cyan
    Write-Host "  =========================================" -ForegroundColor Cyan
} elseif ($Quick -or $ServerPreset -ne "") {
    Write-Host ""
    Write-Host "  =========================================" -ForegroundColor Cyan
    Write-Host "       NAT Type Detection Tool             " -ForegroundColor Cyan
    Write-Host "       STUN Protocol - RFC 5389            " -ForegroundColor Cyan
    Write-Host "  =========================================" -ForegroundColor Cyan
}

Write-Host ""
$localIP = Get-LocalIP
Write-Host "  [*] Local IP: $localIP" -ForegroundColor Gray
Write-Host "  [*] Servers:  $($selectedServers.Count) selected" -ForegroundColor Gray
Write-Host "  [*] Timeout:  ${Timeout}ms" -ForegroundColor Gray

# ---- Phase 1: Probe all servers with ONE fixed source port ----
Write-Host ""
Write-Host "  [Phase 1] STUN binding - fixed source port" -ForegroundColor Yellow
Write-Host "  ----------------------------------------" -ForegroundColor DarkGray

$client1 = New-Object System.Net.Sockets.UdpClient(0)
$client1.Client.ReceiveTimeout = $Timeout
$srcPort1 = $client1.Client.LocalEndPoint.Port
Write-Host "  Source port: $srcPort1" -ForegroundColor Gray
Write-Host ""

$results1 = @()
foreach ($srv in $selectedServers) {
    $label = "$($srv.Host):$($srv.Port)"
    Write-Host "    $($label.PadRight(45))" -ForegroundColor Gray -NoNewline
    $r = Send-StunRequest -Client $client1 -StunHost $srv.Host -StunPort $srv.Port
    if ($r) {
        Write-Host "$($r.IP):$($r.Port)".PadRight(25) -ForegroundColor White -NoNewline
        Write-Host "$($r.LatencyMs)ms" -ForegroundColor DarkGray
        $results1 += $r
    } else {
        Write-Host "Timeout / Unreachable" -ForegroundColor Red
    }
}
$client1.Close()

if ($results1.Count -eq 0) {
    Write-Host ""
    Write-Host "  =========================================" -ForegroundColor Red
    Write-Host "  NAT Type: Blocked" -ForegroundColor Red
    Write-Host "  UDP is blocked or all STUN servers unreachable." -ForegroundColor Red
    Write-Host "  =========================================" -ForegroundColor Red
    Write-Host ""
    exit 1
}

# Check open internet
$firstResult = $results1[0]
if ($firstResult.IP -eq $localIP) {
    Write-Host ""
    Write-Host "  =========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  NAT Type:      Open Internet (No NAT)" -ForegroundColor Green
    Write-Host "  External IP:   $($firstResult.IP)" -ForegroundColor White
    Write-Host ""
    Write-Host "  Direct public IP, no NAT restrictions." -ForegroundColor Gray
    Write-Host ""
    Write-Host "  =========================================" -ForegroundColor Green
    Write-Host ""
    exit 0
}

# ---- Phase 2: Check mapping consistency (Symmetric NAT detection) ----
Write-Host ""
Write-Host "  [Phase 2] Mapping consistency analysis" -ForegroundColor Yellow
Write-Host "  ----------------------------------------" -ForegroundColor DarkGray

$mappedPorts = @($results1 | ForEach-Object { $_.Port } | Select-Object -Unique)
$mappedIPs   = @($results1 | ForEach-Object { $_.IP }   | Select-Object -Unique)

$isSymmetric = $false
if ($mappedPorts.Count -gt 1 -or $mappedIPs.Count -gt 1) {
    $isSymmetric = $true
    Write-Host "  Mapped ports: $($mappedPorts -join ', ')" -ForegroundColor Red
    Write-Host "  Result: DIFFERENT mappings per destination -> Symmetric NAT" -ForegroundColor Red
} else {
    Write-Host "  Mapped port:  $($mappedPorts[0]) (consistent across $($results1.Count) server(s))" -ForegroundColor Green
    Write-Host "  Mapped IP:    $($mappedIPs[0])" -ForegroundColor Green
    Write-Host "  Result: Consistent mapping -> Cone NAT" -ForegroundColor Green
}

# ---- Phase 3: New source port test ----
Write-Host ""
Write-Host "  [Phase 3] Port mapping behavior (new source port)" -ForegroundColor Yellow
Write-Host "  ----------------------------------------" -ForegroundColor DarkGray

$result_new = $null
try {
    $client2 = New-Object System.Net.Sockets.UdpClient(0)
    $client2.Client.ReceiveTimeout = $Timeout
    $srcPort2 = $client2.Client.LocalEndPoint.Port
    Write-Host "  New source port: $srcPort2" -ForegroundColor Gray

    $targetSrv = $selectedServers[0]
    Write-Host "    $("$($targetSrv.Host):$($targetSrv.Port)".PadRight(45))" -ForegroundColor Gray -NoNewline
    $result_new = Send-StunRequest -Client $client2 -StunHost $targetSrv.Host -StunPort $targetSrv.Port
    if ($result_new) {
        Write-Host "$($result_new.IP):$($result_new.Port)".PadRight(25) -ForegroundColor White -NoNewline
        Write-Host "$($result_new.LatencyMs)ms" -ForegroundColor DarkGray
    } else {
        Write-Host "Timeout" -ForegroundColor Red
    }
    $client2.Close()
} catch {
    Write-Host "  [!] Test failed" -ForegroundColor Red
}

# Port prediction analysis
$portDelta = $null
if ($result_new -and $firstResult) {
    $portDelta = [Math]::Abs($result_new.Port - $firstResult.Port)
    if ($portDelta -eq 0) {
        Write-Host "  Port delta: 0 (same external port for different source)" -ForegroundColor Green
    } else {
        Write-Host "  Port delta: $portDelta (external port differs by $portDelta)" -ForegroundColor Yellow
    }
}

# ================================================================
# Final NAT Type Determination
# ================================================================
Write-Host ""
Write-Host ""

$natType = ""
$natLevel = ""
$natDesc = ""
$natColor = "White"
$natEmoji = ""

if ($isSymmetric) {
    $natType  = "Symmetric NAT [NAT4]"
    $natLevel = "Strict"
    $natDesc  = "Each destination gets a different port mapping. P2P is very difficult. Use TURN relay."
    $natColor = "Red"
    $natEmoji = "[!!]"
} elseif ($results1.Count -ge 2 -and -not $isSymmetric) {
    $natType  = "Cone NAT [NAT1/2/3]"
    $natLevel = "Open"
    $natDesc  = "Consistent port mapping across servers. P2P friendly. (Full/Restricted/Port-Restricted)"
    $natColor = "Green"
    $natEmoji = "[OK]"
} elseif ($results1.Count -eq 1 -and -not $isSymmetric) {
    $natType  = "Likely Cone NAT (single server test)"
    $natLevel = "Probably Open"
    $natDesc  = "Only 1 server responded. Use -ServerPreset all for more accurate results."
    $natColor = "Yellow"
    $natEmoji = "[??]"
} else {
    $natType  = "Unknown"
    $natLevel = "Unknown"
    $natDesc  = "Insufficient data for classification."
    $natColor = "Yellow"
    $natEmoji = "[??]"
}

# ---- Pretty Results ----
Write-Host ("  " + "=" * 55) -ForegroundColor $natColor
Write-Host ""
Write-Host "  $natEmoji NAT Type:      $natType" -ForegroundColor $natColor
Write-Host "      Restriction:  $natLevel" -ForegroundColor $natColor
Write-Host "      External IP:  $($firstResult.IP)" -ForegroundColor White
Write-Host "      External Port:$($firstResult.Port)" -ForegroundColor White
Write-Host ""
Write-Host "      $natDesc" -ForegroundColor Gray
Write-Host ""
Write-Host ("  " + "=" * 55) -ForegroundColor $natColor

# ---- Detailed Server Results Table ----
Write-Host ""
Write-Host "  [Server Results]" -ForegroundColor DarkCyan
Write-Host "  $("-" * 75)" -ForegroundColor DarkGray
Write-Host "  $("Server".PadRight(40)) $("Mapped Address".PadRight(22)) $("Latency".PadRight(8))" -ForegroundColor DarkCyan
Write-Host "  $("-" * 75)" -ForegroundColor DarkGray
foreach ($r in $results1) {
    $srvLabel = "$($r.ServerHost):$($r.ServerPort)"
    Write-Host "  $($srvLabel.PadRight(40)) $("$($r.IP):$($r.Port)".PadRight(22)) $("$($r.LatencyMs)ms".PadRight(8))" -ForegroundColor White
}
if ($result_new) {
    $srvLabel = "$($result_new.ServerHost):$($result_new.ServerPort) (new src)"
    Write-Host "  $($srvLabel.PadRight(40)) $("$($result_new.IP):$($result_new.Port)".PadRight(22)) $("$($result_new.LatencyMs)ms".PadRight(8))" -ForegroundColor DarkYellow
}
Write-Host "  $("-" * 75)" -ForegroundColor DarkGray

# ================================================================
# Phase 4: IPv6 & MTU Tests (test-ipv6.com, MyNAT-style)
# ================================================================
Write-Host ""
Write-Host "  [Phase 4] IPv6 & MTU Detection (test-ipv6.com)" -ForegroundColor Yellow
Write-Host "  ----------------------------------------" -ForegroundColor DarkGray

# --- IPv6 Dual-Stack via IPv6 DNS ---
Write-Host ""
Write-Host "    IPv6 (Dual-Stack + v6 DNS):" -ForegroundColor DarkCyan
try {
    $ipv6Resp = Invoke-WebRequest -Uri 'https://ds.v6ns.tokyo.test-ipv6.com/ip/' -UserAgent 'mynat/1' -UseBasicParsing -TimeoutSec 5
    $ipv6Text = $ipv6Resp.Content
    if ($ipv6Text -match '"ip"\s*:\s*"([^"]+)"') {
        $ipv6Addr = $Matches[1]
        Write-Host "      IPv6 Address:  $ipv6Addr" -ForegroundColor Green
    }
    if ($ipv6Text -match '"type"\s*:\s*"([^"]+)"') {
        $ipv6Type = $Matches[1]
        Write-Host "      Connection:    $ipv6Type" -ForegroundColor Green
    }
    $hasIPv6 = $true
} catch {
    Write-Host "      IPv6:          Not available (test failed)" -ForegroundColor Red
    $hasIPv6 = $false
}

# --- MTU Path Discovery (1600 bytes) ---
Write-Host ""
Write-Host "    MTU Path Discovery (1600 bytes):" -ForegroundColor DarkCyan
try {
    $mtuResp = Invoke-WebRequest -Uri 'https://mtu1280.tokyo.test-ipv6.com/ip/?callback=test&size=1600' -UserAgent 'mynat/1' -UseBasicParsing -TimeoutSec 5
    $mtuText = $mtuResp.Content
    $mtuSize = $mtuText.Length
    if ($mtuText -match '"ip"\s*:\s*"([^"]+)"') {
        $mtuIP = $Matches[1]
        Write-Host "      MTU Test IP:   $mtuIP" -ForegroundColor Green
        Write-Host "      Response Size: $mtuSize bytes (>1280 = PMTUD OK)" -ForegroundColor Green
        Write-Host "      Status:        Path MTU Discovery working" -ForegroundColor Green
    }
} catch {
    Write-Host "      MTU Test:      Failed (possible PMTUD issue)" -ForegroundColor Red
    Write-Host "      Note:          Network may have MTU < 1600 or ICMP blocked" -ForegroundColor DarkGray
}

# ---- Additional Info ----
Write-Host ""
Write-Host "  [Network Info]" -ForegroundColor DarkGray
Write-Host "  Local IP:        $localIP" -ForegroundColor DarkGray
Write-Host "  Source Port #1:  $srcPort1" -ForegroundColor DarkGray
if ($srcPort2) {
    Write-Host "  Source Port #2:  $srcPort2" -ForegroundColor DarkGray
}
Write-Host "  Servers tested:  $($results1.Count) responded / $($selectedServers.Count) total" -ForegroundColor DarkGray
Write-Host ""

# ---- Suggestions ----
if ($isSymmetric) {
    Write-Host "  [!] Suggestions:" -ForegroundColor Yellow
    Write-Host "    - Gaming multiplayer may be limited" -ForegroundColor Yellow
    Write-Host "    - Contact ISP to request Full Cone NAT" -ForegroundColor Yellow
    Write-Host "    - For NAS/remote access: use FRP / ZeroTier / Tailscale" -ForegroundColor Yellow
    Write-Host "    - Router settings: try enabling DMZ or UPnP" -ForegroundColor Yellow
} else {
    Write-Host "  [*] Tips:" -ForegroundColor Green
    Write-Host "    - Current NAT type is P2P friendly" -ForegroundColor Green
    Write-Host "    - Gaming / NAS / P2P downloads should work well" -ForegroundColor Green
    if ($results1.Count -lt 3) {
        Write-Host "    - Run with -ServerPreset all for higher confidence" -ForegroundColor Green
    }
}
Write-Host ""
