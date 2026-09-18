#!/bin/bash
# Lab (challenge) containers 172.31.0.0/16 par chalte hain.
# Unhein bahar naya connection banane ki ijazat nahi: na internet, na
# infra (172.18.0.0/16), na ghar ka LAN. Player ka inbound connection
# published port se aata hai aur uska jawab ESTABLISHED hone ki wajah
# se pass ho jata hai.
LAB=172.31.0.0/16
# purani rules hatao taake dobara chalane par duplicate na banein
while sudo iptables -D DOCKER-USER -s "$LAB" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null; do :; done
while sudo iptables -D DOCKER-USER -s "$LAB" -j DROP 2>/dev/null; do :; done
iptables -I DOCKER-USER 1 -s "$LAB" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -I DOCKER-USER 2 -s "$LAB" -j DROP

# Frontend (172.18.0.250) ko bhi bahar jane ki ijazat nahi. Yeh sirf render
# karta hai aur edge ko proxy karta hai -- internet ki zaroorat hai hi nahi.
# 17 Sep 2026 ko ek Next.js RCE ke zariye is container mein do din tak miner
# chalta raha, aur payload iske apne outbound wget se utra tha. Patch alag
# masla hai; yeh rule us raste ko hi band kar deta hai.
FRONTEND=172.18.0.250
while iptables -D DOCKER-USER -s "$FRONTEND" -d 172.18.0.0/16 -j ACCEPT 2>/dev/null; do :; done
while iptables -D DOCKER-USER -s "$FRONTEND" -j DROP 2>/dev/null; do :; done
iptables -I DOCKER-USER 1 -s "$FRONTEND" -d 172.18.0.0/16 -j ACCEPT
iptables -I DOCKER-USER 2 -s "$FRONTEND" -j DROP
