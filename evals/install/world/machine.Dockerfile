# The clean machine: what a developer's Linux machine has (a shell, git, curl,
# openssl, cron and Bun, which docs/install.md asks for), a user `owner`
# without root, and nothing of Cota. The world adds the owner's files, the
# checkout and the stand-in clients when it starts.
#
# The hub's machine (`--target hub`) also has Docker: its own engine, started
# with the machine, and the owner in its group, as a developer's machine with
# Docker has. Its binaries are Docker's static ones, from the image below.
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS bun

FROM docker:29.9.2-dind@sha256:9e79b879b177fbd72c34376a3dd3d91747da5db49e1f560f76aea59561471977 AS docker

FROM ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852 AS machine
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates cron curl git openssl procps \
  && rm -rf /var/lib/apt/lists/*
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
# cron's PAM session wants a login uid, which a container does not give.
RUN ln -s bun /usr/local/bin/bunx \
  && sed -i '/pam_loginuid/s/^/#/' /etc/pam.d/cron \
  && userdel --remove ubuntu \
  && useradd --create-home --shell /bin/bash owner
CMD ["cron", "-f"]

FROM machine AS hub
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    iptables \
  && rm -rf /var/lib/apt/lists/*
COPY --from=docker /usr/local/bin/ /usr/local/bin/
COPY --from=docker /usr/local/libexec/docker/cli-plugins/ /usr/local/libexec/docker/cli-plugins/
RUN groupadd --system docker && usermod --append --groups docker owner
# Docker's `dind` script readies the cgroups and mounts a container needs to
# run an engine; the engine's log is the machine's, not the owner's.
CMD ["sh", "-c", "dind dockerd --host=unix:///var/run/docker.sock --group=docker > /var/log/dockerd.log 2>&1 & exec cron -f"]
