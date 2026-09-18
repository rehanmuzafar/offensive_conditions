FROM python:3.12-alpine

# The platform runs this with a read-only root filesystem, so Python must not
# try to drop .pyc files beside the source, and stdout must not be buffered
# behind a file it cannot flush.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Every capability is dropped and no-new-privileges is set, so there is nothing
# to gain from root here -- run as a normal user and keep it honest.
RUN adduser -D -u 10001 player
USER player

WORKDIR /srv
COPY app.py /srv/app.py

EXPOSE 8080
CMD ["python", "/srv/app.py"]
