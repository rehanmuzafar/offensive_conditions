FROM python:3.12-alpine

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir flask==3.0.3

RUN adduser -D -u 10001 player
USER player

WORKDIR /srv
COPY app.py /srv/app.py

EXPOSE 8080
CMD ["python", "/srv/app.py"]
