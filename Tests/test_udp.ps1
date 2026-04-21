# Quick test: send STUN to both mock ports and parse
function Test-StunPort {
    param([int]$Port)
    $c = New-Object System.Net.Sockets.UdpClient(0)
    $c.Client.ReceiveTimeout = 2000
    $msg = [byte[]]::new(20)
    $msg[0] = 0x00; $msg[1] = 0x01
    $msg[4] = 0x21; $msg[5] = 0x12; $msg[6] = 0xA4; $msg[7] = 0x42
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $txid = [byte[]]::new(12); $rng.GetBytes($txid)
    [Array]::Copy($txid, 0, $msg, 8, 12)
    $ep = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Loopback, $Port)
    try {
        [void]$c.Send($msg, 20, $ep)
        $rep = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
        $resp = $c.Receive([ref]$rep)
        # Parse manually
        $b0 = [int]$resp[0]; $b1 = [int]$resp[1]
        $type = $b0 * 256 + $b1
        Write-Host "  Port ${Port}: received $($resp.Length) bytes, type=0x$($type.ToString('X4'))" -NoNewline
        if ($type -eq 0x0101) {
            # Parse XOR-MAPPED-ADDRESS at offset 20
            $mc = @(0x21, 0x12, 0xA4, 0x42)
            $xPort = [int]$resp[26] * 256 + [int]$resp[27]
            $mappedPort = $xPort -bxor 0x2112
            $ip = "$([int]$resp[28] -bxor $mc[0]).$([int]$resp[29] -bxor $mc[1]).$([int]$resp[30] -bxor $mc[2]).$([int]$resp[31] -bxor $mc[3])"
            Write-Host " -> $ip`:$mappedPort" -ForegroundColor Green
        } else {
            Write-Host " (not binding response)" -ForegroundColor Red
        }
    } catch {
        Write-Host "  Port ${Port}: TIMEOUT" -ForegroundColor Red
    }
    $c.Close()
}

Write-Host "Testing mock STUN servers..." -ForegroundColor Cyan
Test-StunPort -Port 3478
Test-StunPort -Port 3479
