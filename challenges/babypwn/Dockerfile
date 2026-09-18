FROM python:3.12-alpine
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN adduser -D -u 10001 player
USER player
WORKDIR /srv
COPY app.py /srv/app.py
EXPOSE 9001
CMD ["python", "/srv/app.py"]
