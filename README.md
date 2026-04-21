# Echo NAT Speed

`EchoNAT_Project` is a lightweight network diagnostics toolkit with:

- WebRTC-based NAT detection in the browser
- IPv6 and MTU checks
- A local bridge that runs `iNetSpeed-CLI` for domestic speed testing

## Structure

- `Web/`: browser UI plus local bridge server
- `CLI/`: shell and PowerShell NAT detection scripts
- `Tests/`: mock STUN and UDP helpers

## Run locally

```bash
cd Web
INETSPEED_CLI_REPO=/path/to/iNetSpeed-CLI python3 serve.py
```

Then open `http://127.0.0.1:8080`.
