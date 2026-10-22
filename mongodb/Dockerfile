FROM mongo:8

# Clave en formato Base64 estricto requerido por MongoDB (sin guiones)
RUN echo "c2VjcmV0a2V5Zm9ybW9uZ29kYnJlcGxpY2FzZXQxMjM0NTY=" > /data/replica.key \
    && chmod 400 /data/replica.key \
    && chown 999:999 /data/replica.key
