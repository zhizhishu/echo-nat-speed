# Mock STUN Server (PowerShell) for testing nat_detect.ps1
# Usage: .\mock_stun.ps1 [-Mode cone|symmetric]
param(
    [string]$Mode = "cone"  # cone or symmetric
)

$PORT1 = 3478
$PORT2 = 3479
$FAKE_IP = "203.0.113.45"
$FAKE_PORT_BASE = 12345

Write-Host ""
Write-Host "  Mock STUN Server - Mode: $Mode" -ForegroundColor Cyan
Write-Host "  Server 1: 127.0.0.1:$PORT1"
Write-Host "  Server 2: 127.0.0.1:$PORT2"
Write-Host "  Fake external IP: $FAKE_IP"
Write-Host ""

function Build-StunResponse {
    param(
        [byte[]]$TxId,
        [string]$MappedIP,
        [int]$MappedPort
    )
    $magic = 0x2112A442

    # XOR-MAPPED-ADDRESS attribute
    $xport = $MappedPort -bxor ($magic -shr 16)
    $ipParts = $MappedIP.Split('.')
    $ipInt = ([int]$ipParts[0] -shl 24) -bor ([int]$ipParts[1] -shl 16) -bor ([int]$ipParts[2] -shl 8) -bor [int]$ipParts[3]
    $xip = $ipInt -bxor $magic

    # Attr: type(2) + len(2) + padding(1) + family(1) + xport(2) + xip(4) = 12 bytes
    $attr = [byte[]]::new(12)
    $attr[0] = 0x00; $attr[1] = 0x20  # XOR-MAPPED-ADDRESS
    $attr[2] = 0x00; $attr[3] = 0x08  # Length = 8
    $attr[4] = 0x00                    # Reserved
    $attr[5] = 0x01                    # Family: IPv4
    $attr[6] = [byte](($xport -shr 8) -band 0xFF)
    $attr[7] = [byte]($xport -band 0xFF)
    $attr[8]  = [byte](($xip -shr 24) -band 0xFF)
    $attr[9]  = [byte](($xip -shr 16) -band 0xFF)
    $attr[10] = [byte](($xip -shr 8) -band 0xFF)
    $attr[11] = [byte]($xip -band 0xFF)

    # Header: type(2) + length(2) + magic(4) + txid(12) = 20 bytes
    $header = [byte[]]::new(20)
    $header[0] = 0x01; $header[1] = 0x01  # Binding Response
    $header[2] = 0x00; $header[3] = [byte]$attr.Length
    $header[4] = 0x21; $header[5] = 0x12; $header[6] = 0xA4; $header[7] = 0x42
    [Array]::Copy($TxId, 0, $header, 8, 12)

    $response = [byte[]]::new($header.Length + $attr.Length)
    [Array]::Copy($header, 0, $response, 0, $header.Length)
    [Array]::Copy($attr, 0, $response, $header.Length, $attr.Length)
    return $response
}

# Create 2 UDP listeners
$sock1 = New-Object System.Net.Sockets.UdpClient($PORT1)
$sock2 = New-Object System.Net.Sockets.UdpClient($PORT2)

Write-Host "  [Ready] Listening... Press Ctrl+C to stop" -ForegroundColor Green
Write-Host ""

$serverJob1 = {
    param($sock, $serverId, $mode, $fakeIP, $fakePortBase)
    while ($true) {
        try {
            $ep = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
            $data = $sock.Receive([ref]$ep)
            if ($data.Length -lt 20) { continue }
            $msgType = ($data[0] -shl 8) -bor $data[1]
            if ($msgType -ne 0x0001) { continue }
            $txid = [byte[]]::new(12)
            [Array]::Copy($data, 8, $txid, 0, 12)

            if ($mode -eq "symmetric") {
                $mappedPort = $fakePortBase + $serverId * 100
            } else {
                $mappedPort = $fakePortBase
            }

            # Build XOR-MAPPED-ADDRESS
            $magic = 0x2112A442
            $xport = $mappedPort -bxor ($magic -shr 16)
            $ipParts = $fakeIP.Split('.')
            $ipInt = ([int]$ipParts[0] -shl 24) -bor ([int]$ipParts[1] -shl 16) -bor ([int]$ipParts[2] -shl 8) -bor [int]$ipParts[3]
            $xip = $ipInt -bxor $magic

            $attr = [byte[]]::new(12)
            $attr[0] = 0x00; $attr[1] = 0x20
            $attr[2] = 0x00; $attr[3] = 0x08
            $attr[4] = 0x00; $attr[5] = 0x01
            $attr[6] = [byte](($xport -shr 8) -band 0xFF)
            $attr[7] = [byte]($xport -band 0xFF)
            $attr[8]  = [byte](($xip -shr 24) -band 0xFF)
            $attr[9]  = [byte](($xip -shr 16) -band 0xFF)
            $attr[10] = [byte](($xip -shr 8) -band 0xFF)
            $attr[11] = [byte]($xip -band 0xFF)

            $header = [byte[]]::new(20)
            $header[0] = 0x01; $header[1] = 0x01
            $header[2] = 0x00; $header[3] = [byte]$attr.Length
            $header[4] = 0x21; $header[5] = 0x12; $header[6] = 0xA4; $header[7] = 0x42
            [Array]::Copy($txid, 0, $header, 8, 12)

            $response = [byte[]]::new(32)
            [Array]::Copy($header, 0, $response, 0, 20)
            [Array]::Copy($attr, 0, $response, 20, 12)

            [void]$sock.Send($response, $response.Length, $ep)
        } catch { }
    }
}

# Run servers as background jobs
$j1 = Start-Job -ScriptBlock $serverJob1 -ArgumentList $sock1, 1, $Mode, $FAKE_IP, $FAKE_PORT_BASE
$j2 = Start-Job -ScriptBlock $serverJob1 -ArgumentList $sock2, 2, $Mode, $FAKE_IP, $FAKE_PORT_BASE

# Wait - but Jobs can't share the UdpClient across processes. Use runspaces instead.
$sock1.Close()
$sock2.Close()
Stop-Job $j1, $j2 -ErrorAction SilentlyContinue
Remove-Job $j1, $j2 -ErrorAction SilentlyContinue

# Use runspaces for in-process threading
$rs1 = [runspacefactory]::CreateRunspace()
$rs1.Open()
$ps1 = [powershell]::Create().AddScript({
    param($port, $serverId, $mode, $fakeIP, $fakePortBase)
    $sock = New-Object System.Net.Sockets.UdpClient($port)
    while ($true) {
        try {
            $ep = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
            $data = $sock.Receive([ref]$ep)
            if ($data.Length -lt 20) { continue }
            if ((($data[0] -shl 8) -bor $data[1]) -ne 0x0001) { continue }
            $txid = [byte[]]::new(12)
            [Array]::Copy($data, 8, $txid, 0, 12)
            $magic = 0x2112A442
            $mappedPort = if ($mode -eq "symmetric") { $fakePortBase + $serverId * 100 } else { $fakePortBase }
            $xport = $mappedPort -bxor ($magic -shr 16)
            $ipParts = $fakeIP.Split('.')
            $ipInt = ([int]$ipParts[0] -shl 24) -bor ([int]$ipParts[1] -shl 16) -bor ([int]$ipParts[2] -shl 8) -bor [int]$ipParts[3]
            $xip = $ipInt -bxor $magic
            $resp = [byte[]]::new(32)
            $resp[0]=0x01;$resp[1]=0x01;$resp[2]=0x00;$resp[3]=0x0C
            $resp[4]=0x21;$resp[5]=0x12;$resp[6]=0xA4;$resp[7]=0x42
            [Array]::Copy($txid,0,$resp,8,12)
            $resp[20]=0x00;$resp[21]=0x20;$resp[22]=0x00;$resp[23]=0x08
            $resp[24]=0x00;$resp[25]=0x01
            $resp[26]=[byte](($xport-shr 8)-band 0xFF);$resp[27]=[byte]($xport-band 0xFF)
            $resp[28]=[byte](($xip-shr 24)-band 0xFF);$resp[29]=[byte](($xip-shr 16)-band 0xFF)
            $resp[30]=[byte](($xip-shr 8)-band 0xFF);$resp[31]=[byte]($xip-band 0xFF)
            [void]$sock.Send($resp,$resp.Length,$ep)
        } catch { }
    }
}).AddArgument($PORT1).AddArgument(1).AddArgument($Mode).AddArgument($FAKE_IP).AddArgument($FAKE_PORT_BASE)
$ps1.Runspace = $rs1

$rs2 = [runspacefactory]::CreateRunspace()
$rs2.Open()
$ps2 = [powershell]::Create().AddScript({
    param($port, $serverId, $mode, $fakeIP, $fakePortBase)
    $sock = New-Object System.Net.Sockets.UdpClient($port)
    while ($true) {
        try {
            $ep = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
            $data = $sock.Receive([ref]$ep)
            if ($data.Length -lt 20) { continue }
            if ((($data[0] -shl 8) -bor $data[1]) -ne 0x0001) { continue }
            $txid = [byte[]]::new(12)
            [Array]::Copy($data, 8, $txid, 0, 12)
            $magic = 0x2112A442
            $mappedPort = if ($mode -eq "symmetric") { $fakePortBase + $serverId * 100 } else { $fakePortBase }
            $xport = $mappedPort -bxor ($magic -shr 16)
            $ipParts = $fakeIP.Split('.')
            $ipInt = ([int]$ipParts[0] -shl 24) -bor ([int]$ipParts[1] -shl 16) -bor ([int]$ipParts[2] -shl 8) -bor [int]$ipParts[3]
            $xip = $ipInt -bxor $magic
            $resp = [byte[]]::new(32)
            $resp[0]=0x01;$resp[1]=0x01;$resp[2]=0x00;$resp[3]=0x0C
            $resp[4]=0x21;$resp[5]=0x12;$resp[6]=0xA4;$resp[7]=0x42
            [Array]::Copy($txid,0,$resp,8,12)
            $resp[20]=0x00;$resp[21]=0x20;$resp[22]=0x00;$resp[23]=0x08
            $resp[24]=0x00;$resp[25]=0x01
            $resp[26]=[byte](($xport-shr 8)-band 0xFF);$resp[27]=[byte]($xport-band 0xFF)
            $resp[28]=[byte](($xip-shr 24)-band 0xFF);$resp[29]=[byte](($xip-shr 16)-band 0xFF)
            $resp[30]=[byte](($xip-shr 8)-band 0xFF);$resp[31]=[byte]($xip-band 0xFF)
            [void]$sock.Send($resp,$resp.Length,$ep)
        } catch { }
    }
}).AddArgument($PORT2).AddArgument(2).AddArgument($Mode).AddArgument($FAKE_IP).AddArgument($FAKE_PORT_BASE)
$ps2.Runspace = $rs2

$handle1 = $ps1.BeginInvoke()
$handle2 = $ps2.BeginInvoke()

Write-Host "  [Server 1] Listening on 127.0.0.1:$PORT1 (mapped port: $(if($Mode -eq 'symmetric'){$FAKE_PORT_BASE+100}else{$FAKE_PORT_BASE}))" -ForegroundColor Green
Write-Host "  [Server 2] Listening on 127.0.0.1:$PORT2 (mapped port: $(if($Mode -eq 'symmetric'){$FAKE_PORT_BASE+200}else{$FAKE_PORT_BASE}))" -ForegroundColor Green
Write-Host ""
Write-Host "  Press Enter to stop..." -ForegroundColor DarkGray
Read-Host | Out-Null

$ps1.Stop(); $ps2.Stop()
$rs1.Close(); $rs2.Close()
Write-Host "  Stopped." -ForegroundColor Yellow
