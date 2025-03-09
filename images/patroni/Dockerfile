# TODO: we'll need Postgres AND Python+pip
FROM ubuntu:24.04

ENV POSTGRES_EXTENSIONS postgresql-17-pgvector
RUN apt-get -qq update && \
    apt-get install -qq -y python3-venv python3-pip pipx postgresql-common curl && \
    YES=1 /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh && \
    apt-get install -qq -y postgresql-17 ${POSTGRES_EXTENSIONS} && \
    rm -rf /var/lib/apt/lists/*
RUN PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install patroni[etcd3,psycopg3]==4.0.5

ENV PATH=${PATH}:/usr/lib/postgresql/17/bin
COPY start.sh /opt

CMD [ "/opt/start.sh" ]