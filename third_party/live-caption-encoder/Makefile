# Live Caption Encoder (vendored)
#
# Upstream: https://github.com/videoengineeringtutorials-wq/Live-Caption-Encoder
# License: see LICENSE in this directory.
#
# Build (Ubuntu 24.04):
#   make && sudo make install
# Or: sudo bash scripts/install-ubuntu.sh cc-injector

CXX ?= g++
PKG_CFLAGS := $(shell pkg-config --cflags libavformat libavcodec libavutil libswresample)
PKG_LIBS := $(shell pkg-config --libs libavformat libavcodec libavutil libswresample)
CXXFLAGS ?= -std=c++17 -O2 -Wall $(PKG_CFLAGS)
LDFLAGS ?= $(PKG_LIBS) -pthread

PREFIX ?= /usr/local
BINDIR ?= $(PREFIX)/bin

.PHONY: all clean install

all: cc_injector

cc_injector: cc_injector.cpp
	$(CXX) $(CXXFLAGS) cc_injector.cpp -o $@ $(LDFLAGS)

install: cc_injector
	install -d $(DESTDIR)$(BINDIR)
	install -m 755 cc_injector $(DESTDIR)$(BINDIR)/cc_injector

clean:
	rm -f cc_injector
