# Container egress blocks

`offcon-lab-firewall.sh` drops outbound connections for two sets of containers.
It runs at boot via `offcon-lab-firewall.service`. Both files are kept here so a
rebuilt host does not silently come up without them.

Install:

    sudo cp offcon-lab-firewall.sh /usr/local/sbin/
    sudo chmod +x /usr/local/sbin/offcon-lab-firewall.sh
    sudo cp offcon-lab-firewall.service /etc/systemd/system/
    sudo systemctl enable --now offcon-lab-firewall.service

What it blocks, and why:

* **Challenge containers (172.31.0.0/16)** — a challenge is deliberately
  vulnerable, so it gets no route to the internet, to the infra network, or to
  the house LAN. Players connect inbound to a published port and the reply is
  ESTABLISHED, so it passes.

* **Frontend (172.18.0.250)** — on 17 Sep 2026 a Next.js RCE was used to run a
  Monero miner in this container for two days, and the miner arrived over the
  container own outbound `wget`. The frontend renders and proxies to edge; it
  wants nothing from the internet. With this rule the same RCE gets code
  execution and no payload.

The frontend address is pinned in `docker-compose.yml` so the rule has a stable
target. Change it in one place and you must change it in the other.
