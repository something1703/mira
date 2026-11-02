#!/bin/bash
# Runs as root at every boot of the MIRA VM (its GCE startup script). Every step is idempotent.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# Docker Engine and the Compose plugin, from Docker's own Debian repository.
if ! command -v docker >/dev/null; then
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck source=/dev/null
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian ${VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

# gcloud reads the secrets and signs Docker in to Artifact Registry. Google's Debian images ship
# it; this covers an image that does not.
if ! command -v gcloud >/dev/null; then
  curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg |
    gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
    >/etc/apt/sources.list.d/google-cloud-sdk.list
  apt-get update
  apt-get install -y google-cloud-cli
fi

# Container logs rotate on disk; containers keep running while the Docker daemon restarts.
if [ ! -f /etc/docker/daemon.json ]; then
  cat >/etc/docker/daemon.json <<'JSON'
{ "log-driver": "local", "log-opts": { "max-size": "10m", "max-file": "3" }, "live-restore": true }
JSON
  systemctl restart docker
fi
systemctl enable --now docker

# Security updates install themselves.
if [ ! -f /etc/apt/apt.conf.d/20auto-upgrades ]; then
  apt-get install -y --no-install-recommends unattended-upgrades
  cat >/etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
fi

# 2 GB of swap: headroom if a build of profiles and a shade match land at once.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi
swapon -a

# Settings and secrets (root only), the deploy files, and MIRA's state. The Node images run as
# uid 1000 ("node"), which owns the state folder.
install -d -m 0700 /etc/mira
install -d -m 0755 /opt/mira
install -d -m 0755 /var/lib/mira
install -d -m 0700 -o 1000 -g 1000 /var/lib/mira/workflows
