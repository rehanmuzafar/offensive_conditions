FROM alpine:3.20
RUN apk add --no-cache qemu-system-x86_64 linux-virt busybox-static cpio socat
RUN mkdir -p /skel && cp /bin/busybox.static /skel/busybox
COPY init /skel/init
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /skel/init
RUN adduser -D -u 10001 player
USER player
EXPOSE 9001
CMD ["/entrypoint.sh"]
