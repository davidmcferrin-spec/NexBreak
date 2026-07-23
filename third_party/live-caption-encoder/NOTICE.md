Live Caption Encoder — vendored for NexBreak

Upstream: https://github.com/videoengineeringtutorials-wq/Live-Caption-Encoder
Files here: cc_injector.cpp, LICENSE, README.md (upstream), Makefile (NexBreak).

NexBreak uses cc_injector on the asr_insert path:
  ffmpeg ingest → cc_injector (pipe:0→pipe:1, --cc-udp) → tsp → local feed → SRT

Build/install on Ubuntu:
  sudo bash scripts/install-ubuntu.sh cc-injector
