#!/bin/sh
set -e
FLAG="${CTF_FLAG:-OFFCON{local-test-flag}}"
WORK=/tmp/build
mkdir -p "$WORK/root/bin"
cp /skel/busybox "$WORK/root/bin/busybox"
for a in sh mount id cat chmod; do ln -sf busybox "$WORK/root/bin/$a"; done
sed "s|__FLAG__|$FLAG|" /skel/init > "$WORK/root/init"
chmod +x "$WORK/root/init"
( cd "$WORK/root" && find . | cpio -o -H newc 2>/dev/null | gzip > "$WORK/initramfs.gz" )
# Per-connection wrapper. Foran ek banner bhejta hai taake NAT connection ko
# zinda samjhe (VM boot mein 3-5s lagte, us khamoshi mein ONT connection girati
# hai), phir fresh VM boot. /tmp noexec hai, is liye script ko `sh <file>` se
# chalate hain -- file execute nahi hoti, interpreter parhta hai.
cat > "$WORK/run.sh" <<'RUN'
echo "[*] booting the vm, please wait..."
exec qemu-system-x86_64 -m 128 -display none -monitor none -no-reboot \
  -kernel /boot/vmlinuz-virt -initrd /tmp/build/initramfs.gz \
  -append "console=ttyS0" -serial stdio
RUN
exec socat TCP-LISTEN:9001,reuseaddr,fork EXEC:"/bin/sh /tmp/build/run.sh"
