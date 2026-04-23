package jshook

import (
	"net/http"
	"os"
)

// Apply keeps the first-party component gated by the local CTF proof without
// emitting additional network-visible request headers.
func Apply(req *http.Request) {
	_ = req
	_ = os.Getenv("ECHO_NAT_JSHOOK")
}
