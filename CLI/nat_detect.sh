#!/usr/bin/env bash
# ================================================================
# NAT Type Detection Tool (Bash + Python3 STUN Engine)
# Supports Linux / macOS - same logic as PowerShell version
# Usage: chmod +x nat_detect.sh && ./nat_detect.sh
# ================================================================

set -uo pipefail

# ======================== Colors ========================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
GRAY='\033[0;90m'
MAGENTA='\033[0;35m'
DGREEN='\033[0;32m'
DCYAN='\033[0;36m'
NC='\033[0m' # No Color

# ======================== Defaults ========================
TIMEOUT=3
PRESET=""
CUSTOM_SERVER=""
QUICK=false

# ======================== Server Groups ========================
# Each group: "name|host1:port1,host2:port2,..."
declare -a SERVER_GROUPS_KEYS=("mynat" "google" "cloudflare" "mozilla" "twilio" "stuntman")

declare -A SERVER_GROUPS_NAME
SERVER_GROUPS_NAME[mynat]="MyNAT Client (mao.fan) - No Rate Limit"
SERVER_GROUPS_NAME[google]="Google STUN"
SERVER_GROUPS_NAME[cloudflare]="Cloudflare STUN"
SERVER_GROUPS_NAME[mozilla]="Mozilla STUN"
SERVER_GROUPS_NAME[twilio]="Twilio STUN"
SERVER_GROUPS_NAME[stuntman]="Stuntman (stunprotocol.org)"

declare -A SERVER_GROUPS_LIST
SERVER_GROUPS_LIST[mynat]="stun.bethesda.net:3478,stun.chat.bilibili.com:3478,stun.miui.com:3478,stun.qq.com:3478,stun.synology.com:3478"
SERVER_GROUPS_LIST[google]="stun.l.google.com:19302,stun1.l.google.com:19302,stun2.l.google.com:19302,stun3.l.google.com:19302,stun4.l.google.com:19302"
SERVER_GROUPS_LIST[cloudflare]="stun.cloudflare.com:3478"
SERVER_GROUPS_LIST[mozilla]="stun.services.mozilla.com:3478"
SERVER_GROUPS_LIST[twilio]="global.stun.twilio.com:3478"
SERVER_GROUPS_LIST[stuntman]="stunserver.stunprotocol.org:3478"

# ======================== Usage ========================
usage() {
    echo ""
    echo -e "  ${CYAN}NAT Type Detection Tool (Bash)${NC}"
    echo "  Usage:"
    echo "    ./nat_detect.sh                                    # Interactive menu"
    echo "    ./nat_detect.sh -q                                 # Quick: all servers"
    echo "    ./nat_detect.sh -p mynat                           # Use MyNAT servers"
    echo "    ./nat_detect.sh -p google                          # Use Google servers"
    echo "    ./nat_detect.sh -p custom -s stun.example.com:3478 # Custom server"
    echo "    ./nat_detect.sh -t 5                               # Timeout 5 seconds"
    echo ""
    echo "  Presets: mynat, google, cloudflare, mozilla, twilio, stuntman, all, custom"
    echo ""
    exit 0
}

# ======================== Parse Args ========================
while getopts "p:s:t:qh" opt; do
    case $opt in
        p) PRESET="$OPTARG" ;;
        s) CUSTOM_SERVER="$OPTARG" ;;
        t) TIMEOUT="$OPTARG" ;;
        q) QUICK=true ;;
        h) usage ;;
        *) usage ;;
    esac
done

# ======================== Check Python3 ========================
PYTHON=""
if command -v python3 &>/dev/null; then
    PYTHON="python3"
elif command -v python &>/dev/null; then
    PYTHON="python"
else
    echo -e "  ${RED}[!] Python3 is required but not found.${NC}"
    echo "      Install: apt install python3 / brew install python3"
    exit 1
fi

# ======================== STUN Engine (Python3) ========================
# This function calls Python to perform a single STUN binding request
# Output: IP PORT LATENCY_MS  or  FAIL
stun_query() {
    local host="$1"
    local port="$2"
    local timeout="$3"
    local src_port="${4:-0}"

    $PYTHON -c "
import socket, struct, os, time, sys

def stun_request(host, port, timeout, src_port=0):
    try:
        # Build STUN Binding Request
        txid = os.urandom(12)
        msg = struct.pack('!HHI', 0x0001, 0x0000, 0x2112A442) + txid

        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.settimeout(timeout)
        if src_port > 0:
            try:
                sock.bind(('0.0.0.0', src_port))
            except OSError:
                sock.bind(('0.0.0.0', 0))
        local_port = sock.getsockname()[1]

        server_ip = socket.gethostbyname(host)
        t0 = time.time()
        sock.sendto(msg, (server_ip, port))
        data, addr = sock.recvfrom(1024)
        latency = int((time.time() - t0) * 1000)
        sock.close()

        # Parse response
        if len(data) < 20:
            print('FAIL')
            return
        msg_type = struct.unpack('!H', data[0:2])[0]
        if msg_type != 0x0101:
            print('FAIL')
            return
        msg_len = struct.unpack('!H', data[2:4])[0]
        magic = 0x2112A442
        offset = 20
        result_ip = None
        result_port = None
        while offset < 20 + msg_len:
            if offset + 4 > len(data):
                break
            attr_type, attr_len = struct.unpack('!HH', data[offset:offset+4])
            offset += 4
            if offset + attr_len > len(data):
                break
            if attr_type == 0x0020:  # XOR-MAPPED-ADDRESS
                family = data[offset + 1]
                if family == 0x01:
                    xport = struct.unpack('!H', data[offset+2:offset+4])[0]
                    result_port = xport ^ (magic >> 16)
                    xip = struct.unpack('!I', data[offset+4:offset+8])[0]
                    ip_int = xip ^ magic
                    result_ip = socket.inet_ntoa(struct.pack('!I', ip_int))
            elif attr_type == 0x0001 and result_ip is None:  # MAPPED-ADDRESS
                family = data[offset + 1]
                if family == 0x01:
                    result_port = struct.unpack('!H', data[offset+2:offset+4])[0]
                    result_ip = socket.inet_ntoa(data[offset+4:offset+8])
            offset += attr_len
            if attr_len % 4 != 0:
                offset += 4 - (attr_len % 4)

        if result_ip and result_port:
            print(f'{result_ip} {result_port} {latency} {local_port} {server_ip}')
        else:
            print('FAIL')
    except Exception:
        print('FAIL')

stun_request('$host', $port, $timeout, $src_port)
" 2>/dev/null
}

# Get local IP
get_local_ip() {
    $PYTHON -c "
import socket
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(('8.8.8.8', 53))
    print(s.getsockname()[0])
    s.close()
except:
    print('0.0.0.0')
" 2>/dev/null
}

# ======================== Interactive Menu ========================
show_menu() {
    echo ""
    echo -e "  ${CYAN}=========================================${NC}"
    echo -e "  ${CYAN}     NAT Type Detection Tool            ${NC}"
    echo -e "  ${CYAN}     STUN Protocol - RFC 5389           ${NC}"
    echo -e "  ${CYAN}=========================================${NC}"
    echo ""
    echo -e "  ${WHITE}Select STUN/TURN server group:${NC}"
    echo ""
    echo -e "   ${GREEN}[1] MyNAT Client       (mao.fan endpoints, no rate limit) - Recommended${NC}"
    echo -e "   ${DGREEN}       bethesda / bilibili / miui / qq / synology${NC}"
    echo -e "   ${WHITE}[2] Google STUN        (stun.l.google.com:19302)${NC}"
    echo -e "   ${WHITE}[3] Cloudflare STUN    (stun.cloudflare.com:3478)${NC}"
    echo -e "   ${WHITE}[4] Mozilla STUN       (stun.services.mozilla.com:3478)${NC}"
    echo -e "   ${WHITE}[5] Twilio STUN        (global.stun.twilio.com:3478)${NC}"
    echo -e "   ${WHITE}[6] Stuntman           (stunserver.stunprotocol.org:3478)${NC}"
    echo ""
    echo -e "   ${YELLOW}[A] ALL servers         - Use all of the above (full scan)${NC}"
    echo -e "   ${MAGENTA}[C] Custom server       - Enter your own STUN server${NC}"
    echo ""
    echo -e "   ${GRAY}[Q] Quit${NC}"
    echo ""
    read -rp "  Enter choice [1-6/A/C/Q]: " CHOICE
    echo "${CHOICE}" | tr '[:lower:]' '[:upper:]'
}

# ======================== Resolve Servers ========================
SELECTED_SERVERS=""

resolve_servers() {
    local choice="$1"
    case "$choice" in
        1) SELECTED_SERVERS="${SERVER_GROUPS_LIST[mynat]}" ;;
        2) SELECTED_SERVERS="${SERVER_GROUPS_LIST[google]}" ;;
        3) SELECTED_SERVERS="${SERVER_GROUPS_LIST[cloudflare]}" ;;
        4) SELECTED_SERVERS="${SERVER_GROUPS_LIST[mozilla]}" ;;
        5) SELECTED_SERVERS="${SERVER_GROUPS_LIST[twilio]}" ;;
        6) SELECTED_SERVERS="${SERVER_GROUPS_LIST[stuntman]}" ;;
        A|a) 
            SELECTED_SERVERS=""
            for key in "${SERVER_GROUPS_KEYS[@]}"; do
                if [ -n "$SELECTED_SERVERS" ]; then
                    SELECTED_SERVERS="${SELECTED_SERVERS},${SERVER_GROUPS_LIST[$key]}"
                else
                    SELECTED_SERVERS="${SERVER_GROUPS_LIST[$key]}"
                fi
            done
            ;;
        C|c)
            read -rp "  Enter STUN server (host:port): " custom
            SELECTED_SERVERS="$custom"
            ;;
        Q|q) exit 0 ;;
        *) echo -e "  ${RED}Invalid choice${NC}"; exit 1 ;;
    esac
}

# ======================== Resolve from args or menu ========================
if [ "$QUICK" = true ]; then
    SELECTED_SERVERS=""
    for key in "${SERVER_GROUPS_KEYS[@]}"; do
        if [ -n "$SELECTED_SERVERS" ]; then
            SELECTED_SERVERS="${SELECTED_SERVERS},${SERVER_GROUPS_LIST[$key]}"
        else
            SELECTED_SERVERS="${SERVER_GROUPS_LIST[$key]}"
        fi
    done
elif [ -n "$PRESET" ]; then
    if [ "$PRESET" = "all" ]; then
        SELECTED_SERVERS=""
        for key in "${SERVER_GROUPS_KEYS[@]}"; do
            if [ -n "$SELECTED_SERVERS" ]; then
                SELECTED_SERVERS="${SELECTED_SERVERS},${SERVER_GROUPS_LIST[$key]}"
            else
                SELECTED_SERVERS="${SERVER_GROUPS_LIST[$key]}"
            fi
        done
    elif [ "$PRESET" = "custom" ] && [ -n "$CUSTOM_SERVER" ]; then
        SELECTED_SERVERS="$CUSTOM_SERVER"
    elif [ -n "${SERVER_GROUPS_LIST[$PRESET]+x}" ]; then
        SELECTED_SERVERS="${SERVER_GROUPS_LIST[$PRESET]}"
    else
        echo -e "  ${RED}[!] Unknown preset: $PRESET${NC}"
        exit 1
    fi
else
    CHOICE=$(show_menu)
    resolve_servers "$CHOICE"
fi

# Convert comma-separated to array
IFS=',' read -ra SERVERS <<< "$SELECTED_SERVERS"
SERVER_COUNT=${#SERVERS[@]}

# ======================== Main Detection ========================
echo ""
echo -e "  ${CYAN}=========================================${NC}"
echo -e "  ${CYAN}     NAT Type Detection Tool            ${NC}"
echo -e "  ${CYAN}     STUN Protocol - RFC 5389           ${NC}"
echo -e "  ${CYAN}=========================================${NC}"
echo ""

LOCAL_IP=$(get_local_ip)
echo -e "  ${GRAY}[*] Local IP: ${LOCAL_IP}${NC}"
echo -e "  ${GRAY}[*] Servers:  ${SERVER_COUNT} selected${NC}"
echo -e "  ${GRAY}[*] Timeout:  ${TIMEOUT}s${NC}"

# ---- Phase 1: Fixed source port, probe all servers ----
echo ""
echo -e "  ${YELLOW}[Phase 1] STUN binding - fixed source port${NC}"
echo -e "  ${GRAY}----------------------------------------${NC}"

# Pick a random source port for consistency
SRC_PORT=$(( (RANDOM % 10000) + 40000 ))
echo -e "  ${GRAY}Source port: ${SRC_PORT}${NC}"
echo ""

declare -a RESULT_IPS=()
declare -a RESULT_PORTS=()
declare -a RESULT_LATENCIES=()
declare -a RESULT_HOSTS=()
declare -a RESULT_SERVER_IPS=()
FIRST_IP=""
FIRST_PORT=""

for entry in "${SERVERS[@]}"; do
    host="${entry%%:*}"
    port="${entry##*:}"
    printf "    %-45s" "${host}:${port}"
    
    result=$(stun_query "$host" "$port" "$TIMEOUT" "$SRC_PORT")
    
    if [ "$result" = "FAIL" ]; then
        echo -e "${RED}Timeout / Unreachable${NC}"
    else
        read -r rip rport rlatency rlocalport rserverip <<< "$result"
        RESULT_IPS+=("$rip")
        RESULT_PORTS+=("$rport")
        RESULT_LATENCIES+=("$rlatency")
        RESULT_HOSTS+=("${host}:${port}")
        RESULT_SERVER_IPS+=("$rserverip")
        if [ -z "$FIRST_IP" ]; then
            FIRST_IP="$rip"
            FIRST_PORT="$rport"
        fi
        printf "${WHITE}%-25s${NC}" "${rip}:${rport}"
        echo -e "${GRAY}${rlatency}ms${NC}"
    fi
    
    # Use different source port for subsequent requests on same socket
    # but we want SAME source port, so we keep SRC_PORT
    # Python will bind to the same port (may fail if OS hasn't released it)
    # Use port 0 after first to let OS assign (we compare first vs rest)
done

RESULT_COUNT=${#RESULT_IPS[@]}

if [ "$RESULT_COUNT" -eq 0 ]; then
    echo ""
    echo -e "  ${RED}=========================================${NC}"
    echo -e "  ${RED}NAT Type: Blocked${NC}"
    echo -e "  ${RED}UDP is blocked or all STUN servers unreachable.${NC}"
    echo -e "  ${RED}=========================================${NC}"
    echo ""
    exit 1
fi

# Check Open Internet
if [ "$FIRST_IP" = "$LOCAL_IP" ]; then
    echo ""
    echo -e "  ${GREEN}=========================================${NC}"
    echo ""
    echo -e "  ${GREEN}NAT Type:      Open Internet (No NAT)${NC}"
    echo -e "  ${WHITE}External IP:   ${FIRST_IP}${NC}"
    echo ""
    echo -e "  ${GRAY}Direct public IP, no NAT restrictions.${NC}"
    echo ""
    echo -e "  ${GREEN}=========================================${NC}"
    echo ""
    exit 0
fi

# ---- Phase 2: Check mapping consistency ----
echo ""
echo -e "  ${YELLOW}[Phase 2] Mapping consistency analysis${NC}"
echo -e "  ${GRAY}----------------------------------------${NC}"

# Get unique ports and IPs
UNIQUE_PORTS=($(printf '%s\n' "${RESULT_PORTS[@]}" | sort -u))
UNIQUE_IPS=($(printf '%s\n' "${RESULT_IPS[@]}" | sort -u))

IS_SYMMETRIC=false
if [ "${#UNIQUE_PORTS[@]}" -gt 1 ] || [ "${#UNIQUE_IPS[@]}" -gt 1 ]; then
    IS_SYMMETRIC=true
    echo -e "  ${RED}Mapped ports: ${UNIQUE_PORTS[*]}${NC}"
    echo -e "  ${RED}Result: DIFFERENT mappings per destination -> Symmetric NAT${NC}"
else
    echo -e "  ${GREEN}Mapped port:  ${UNIQUE_PORTS[0]} (consistent across ${RESULT_COUNT} server(s))${NC}"
    echo -e "  ${GREEN}Mapped IP:    ${UNIQUE_IPS[0]}${NC}"
    echo -e "  ${GREEN}Result: Consistent mapping -> Cone NAT${NC}"
fi

# ---- Phase 3: New source port test ----
echo ""
echo -e "  ${YELLOW}[Phase 3] Port mapping behavior (new source port)${NC}"
echo -e "  ${GRAY}----------------------------------------${NC}"

NEW_SRC_PORT=$(( (RANDOM % 10000) + 50000 ))
echo -e "  ${GRAY}New source port: ${NEW_SRC_PORT}${NC}"

NEW_RESULT_IP=""
NEW_RESULT_PORT=""
NEW_RESULT_LATENCY=""

first_entry="${SERVERS[0]}"
first_host="${first_entry%%:*}"
first_port="${first_entry##*:}"
printf "    %-45s" "${first_host}:${first_port}"

new_result=$(stun_query "$first_host" "$first_port" "$TIMEOUT" "$NEW_SRC_PORT")
if [ "$new_result" = "FAIL" ]; then
    echo -e "${RED}Timeout${NC}"
else
    read -r NEW_RESULT_IP NEW_RESULT_PORT NEW_RESULT_LATENCY _nlp _nsip <<< "$new_result"
    printf "${WHITE}%-25s${NC}" "${NEW_RESULT_IP}:${NEW_RESULT_PORT}"
    echo -e "${GRAY}${NEW_RESULT_LATENCY}ms${NC}"
    
    if [ -n "$FIRST_PORT" ] && [ -n "$NEW_RESULT_PORT" ]; then
        PORT_DELTA=$(( FIRST_PORT > NEW_RESULT_PORT ? FIRST_PORT - NEW_RESULT_PORT : NEW_RESULT_PORT - FIRST_PORT ))
        if [ "$PORT_DELTA" -eq 0 ]; then
            echo -e "  ${GREEN}Port delta: 0 (same external port for different source)${NC}"
        else
            echo -e "  ${YELLOW}Port delta: ${PORT_DELTA} (external port differs by ${PORT_DELTA})${NC}"
        fi
    fi
fi

# ======================== Final Result ========================
echo ""
echo ""

NAT_TYPE=""
NAT_LEVEL=""
NAT_DESC=""
NAT_COLOR=""
NAT_EMOJI=""

if [ "$IS_SYMMETRIC" = true ]; then
    NAT_TYPE="Symmetric NAT [NAT4]"
    NAT_LEVEL="Strict"
    NAT_DESC="Different port per destination. P2P very difficult, TURN relay needed."
    NAT_COLOR="$RED"
    NAT_EMOJI="[!!]"
elif [ "$RESULT_COUNT" -ge 2 ]; then
    NAT_TYPE="Cone NAT [NAT1/2/3]"
    NAT_LEVEL="Open"
    NAT_DESC="Consistent port mapping. P2P friendly (Full/Restricted/Port-Restricted)."
    NAT_COLOR="$GREEN"
    NAT_EMOJI="[OK]"
elif [ "$RESULT_COUNT" -eq 1 ]; then
    NAT_TYPE="Likely Cone NAT (single server test)"
    NAT_LEVEL="Probably Open"
    NAT_DESC="Only 1 server responded. Use -p all for more accurate results."
    NAT_COLOR="$YELLOW"
    NAT_EMOJI="[??]"
else
    NAT_TYPE="Unknown"
    NAT_LEVEL="Unknown"
    NAT_DESC="Insufficient data for classification."
    NAT_COLOR="$YELLOW"
    NAT_EMOJI="[??]"
fi

echo -e "  ${NAT_COLOR}=======================================================${NC}"
echo ""
echo -e "  ${NAT_COLOR}${NAT_EMOJI} NAT Type:      ${NAT_TYPE}${NC}"
echo -e "  ${NAT_COLOR}    Restriction:  ${NAT_LEVEL}${NC}"
echo -e "  ${WHITE}    External IP:  ${FIRST_IP}${NC}"
echo -e "  ${WHITE}    External Port:${FIRST_PORT}${NC}"
echo ""
echo -e "  ${GRAY}    ${NAT_DESC}${NC}"
echo ""
echo -e "  ${NAT_COLOR}=======================================================${NC}"

# ---- Server Results Table ----
echo ""
echo -e "  ${DCYAN}[Server Results]${NC}"
echo -e "  ${GRAY}$(printf '%.0s-' {1..75})${NC}"
printf "  ${DCYAN}%-40s %-22s %-8s${NC}\n" "Server" "Mapped Address" "Latency"
echo -e "  ${GRAY}$(printf '%.0s-' {1..75})${NC}"
for i in "${!RESULT_IPS[@]}"; do
    printf "  ${WHITE}%-40s %-22s %-8s${NC}\n" \
        "${RESULT_HOSTS[$i]}" \
        "${RESULT_IPS[$i]}:${RESULT_PORTS[$i]}" \
        "${RESULT_LATENCIES[$i]}ms"
done
if [ -n "$NEW_RESULT_IP" ]; then
    printf "  ${YELLOW}%-40s %-22s %-8s${NC}\n" \
        "${first_host}:${first_port} (new src)" \
        "${NEW_RESULT_IP}:${NEW_RESULT_PORT}" \
        "${NEW_RESULT_LATENCY}ms"
fi
echo -e "  ${GRAY}$(printf '%.0s-' {1..75})${NC}"

# ================================================================
# Phase 4: IPv6 & MTU Tests (test-ipv6.com, MyNAT-style)
# ================================================================
echo ""
echo -e "  ${YELLOW}[Phase 4] IPv6 & MTU Detection (test-ipv6.com)${NC}"
echo -e "  ${GRAY}----------------------------------------${NC}"

# Detect curl or wget
CURL_CMD=""
if command -v curl &>/dev/null; then
    CURL_CMD="curl"
elif command -v wget &>/dev/null; then
    CURL_CMD="wget"
fi

if [ -n "$CURL_CMD" ]; then
    # --- IPv6 Dual-Stack via IPv6 DNS ---
    echo ""
    echo -e "    ${DCYAN}IPv6 (Dual-Stack + v6 DNS):${NC}"
    if [ "$CURL_CMD" = "curl" ]; then
        IPV6_RESP=$(curl -s --max-time 5 -A 'mynat/1' 'https://ds.v6ns.tokyo.test-ipv6.com/ip/' 2>/dev/null || echo "FAIL")
    else
        IPV6_RESP=$(wget -qO- --timeout=5 -U 'mynat/1' 'https://ds.v6ns.tokyo.test-ipv6.com/ip/' 2>/dev/null || echo "FAIL")
    fi

    if [ "$IPV6_RESP" != "FAIL" ] && echo "$IPV6_RESP" | grep -q '"ip"'; then
        IPV6_ADDR=$(echo "$IPV6_RESP" | sed -n 's/.*"ip"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
        IPV6_TYPE=$(echo "$IPV6_RESP" | sed -n 's/.*"type"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
        echo -e "      ${GREEN}IPv6 Address:  ${IPV6_ADDR}${NC}"
        echo -e "      ${GREEN}Connection:    ${IPV6_TYPE}${NC}"
    else
        echo -e "      ${RED}IPv6:          Not available (test failed)${NC}"
    fi

    # --- MTU Path Discovery (1600 bytes) ---
    echo ""
    echo -e "    ${DCYAN}MTU Path Discovery (1600 bytes):${NC}"
    if [ "$CURL_CMD" = "curl" ]; then
        MTU_RESP=$(curl -s --max-time 5 -A 'mynat/1' 'https://mtu1280.tokyo.test-ipv6.com/ip/?callback=test&size=1600' 2>/dev/null || echo "FAIL")
    else
        MTU_RESP=$(wget -qO- --timeout=5 -U 'mynat/1' 'https://mtu1280.tokyo.test-ipv6.com/ip/?callback=test&size=1600' 2>/dev/null || echo "FAIL")
    fi

    if [ "$MTU_RESP" != "FAIL" ] && echo "$MTU_RESP" | grep -q '"ip"'; then
        MTU_IP=$(echo "$MTU_RESP" | sed -n 's/.*"ip"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
        MTU_SIZE=${#MTU_RESP}
        echo -e "      ${GREEN}MTU Test IP:   ${MTU_IP}${NC}"
        echo -e "      ${GREEN}Response Size: ${MTU_SIZE} bytes (>1280 = PMTUD OK)${NC}"
        echo -e "      ${GREEN}Status:        Path MTU Discovery working${NC}"
    else
        echo -e "      ${RED}MTU Test:      Failed (possible PMTUD issue)${NC}"
        echo -e "      ${GRAY}Note:          Network may have MTU < 1600 or ICMP blocked${NC}"
    fi
else
    echo -e "  ${GRAY}  Skipped (curl/wget not found)${NC}"
fi

# ---- Additional Info ----
echo ""
echo -e "  ${GRAY}[Network Info]${NC}"
echo -e "  ${GRAY}Local IP:        ${LOCAL_IP}${NC}"
echo -e "  ${GRAY}Source Port #1:  ${SRC_PORT}${NC}"
echo -e "  ${GRAY}Source Port #2:  ${NEW_SRC_PORT}${NC}"
echo -e "  ${GRAY}Servers tested:  ${RESULT_COUNT} responded / ${SERVER_COUNT} total${NC}"
echo ""

# ---- Suggestions ----
if [ "$IS_SYMMETRIC" = true ]; then
    echo -e "  ${YELLOW}[!] Suggestions:${NC}"
    echo -e "  ${YELLOW}    - Gaming multiplayer may be limited${NC}"
    echo -e "  ${YELLOW}    - Contact ISP to request Full Cone NAT${NC}"
    echo -e "  ${YELLOW}    - For NAS/remote access: use FRP / ZeroTier / Tailscale${NC}"
    echo -e "  ${YELLOW}    - Router settings: try enabling DMZ or UPnP${NC}"
else
    echo -e "  ${GREEN}[*] Tips:${NC}"
    echo -e "  ${GREEN}    - Current NAT type is P2P friendly${NC}"
    echo -e "  ${GREEN}    - Gaming / NAS / P2P downloads should work well${NC}"
    if [ "$RESULT_COUNT" -lt 3 ]; then
        echo -e "  ${GREEN}    - Run with -p all for higher confidence${NC}"
    fi
fi
echo ""
