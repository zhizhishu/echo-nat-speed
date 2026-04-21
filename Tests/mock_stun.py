"""
Mock STUN Server - for testing nat_detect.ps1 locally
Listens on 2 UDP ports, responds with STUN Binding Response
Uses different mapped ports per server to simulate different NAT types
Usage: python mock_stun.py [cone|symmetric]
"""
import socket, struct, sys, threading, os

MODE = sys.argv[1] if len(sys.argv) > 1 else "cone"
PORT1 = 3478
PORT2 = 3479
FAKE_IP = "203.0.113.45"  # Fake external IP
FAKE_PORT_BASE = 12345

print(f"  Mock STUN Server - Mode: {MODE}")
print(f"  Server 1: 127.0.0.1:{PORT1}")
print(f"  Server 2: 127.0.0.1:{PORT2}")
print(f"  Fake external IP: {FAKE_IP}")
print()

def build_xor_mapped_address(ip_str, port, txid):
    """Build XOR-MAPPED-ADDRESS attribute"""
    magic = 0x2112A442
    xport = port ^ (magic >> 16)
    ip_bytes = socket.inet_aton(ip_str)
    ip_int = struct.unpack('!I', ip_bytes)[0]
    xip = ip_int ^ magic

    # Attribute: type=0x0020, length=8
    # Value: 0x00, family=0x01, xport(2), xip(4)
    attr = struct.pack('!HH', 0x0020, 8)
    attr += struct.pack('!BBH', 0x00, 0x01, xport)
    attr += struct.pack('!I', xip)
    return attr

def handle_stun(sock, server_id):
    print(f"  [Server {server_id}] Listening on port {sock.getsockname()[1]}...")
    while True:
        try:
            data, addr = sock.recvfrom(1024)
            if len(data) < 20:
                continue

            msg_type = struct.unpack('!H', data[0:2])[0]
            if msg_type != 0x0001:  # Not Binding Request
                continue

            txid = data[8:20]
            print(f"  [Server {server_id}] Binding Request from {addr[0]}:{addr[1]}")

            # Decide mapped port based on mode
            if MODE == "symmetric":
                # Different port per server = Symmetric NAT
                mapped_port = FAKE_PORT_BASE + server_id * 100
            else:
                # Same port for all = Cone NAT
                mapped_port = FAKE_PORT_BASE

            print(f"  [Server {server_id}] -> Responding: {FAKE_IP}:{mapped_port}")

            # Build response
            attr = build_xor_mapped_address(FAKE_IP, mapped_port, txid)
            # Header: type=0x0101 (Binding Response), length, magic, txid
            header = struct.pack('!HHI', 0x0101, len(attr), 0x2112A442) + txid
            response = header + attr

            sock.sendto(response, addr)
        except Exception as e:
            print(f"  [Server {server_id}] Error: {e}")

# Start 2 servers on different ports
sock1 = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock1.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock1.bind(('127.0.0.1', PORT1))

sock2 = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock2.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock2.bind(('127.0.0.1', PORT2))

t1 = threading.Thread(target=handle_stun, args=(sock1, 1), daemon=True)
t2 = threading.Thread(target=handle_stun, args=(sock2, 2), daemon=True)
t1.start()
t2.start()

print("  [Ready] Waiting for STUN requests... (Ctrl+C to stop)")
print()

try:
    while True:
        import time
        time.sleep(1)
except KeyboardInterrupt:
    print("\n  Shutting down.")
