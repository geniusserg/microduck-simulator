# Build the Vite app, then serve the static bundle with nginx.
# HF Spaces docker SDK: the container must listen on app_port (8080);
# nginx-unprivileged listens on 8080 by default and runs as non-root,
# which is exactly what Spaces expects.

FROM node:22-alpine AS build
WORKDIR /build
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/ ./
RUN npm run build && \
    find /build/dist -type f \( \
      -name '*.wasm' -o -name '*.js' -o -name '*.css' -o \
      -name '*.json' -o -name '*.xml' -o -name '*.glb' -o \
      -name '*.stl' -o -name '*.onnx' -o -name '*.svg' \
    \) -exec gzip -9 -k {} + && \
    printf 'gzip_static on;\ngzip on;\ngzip_vary on;\ngzip_proxied any;\ngzip_types application/wasm application/javascript text/css application/json application/xml text/xml model/gltf-binary model/stl application/octet-stream image/svg+xml;\n' > /build/gzip.conf

FROM nginxinc/nginx-unprivileged:alpine
COPY --from=build /build/dist /usr/share/nginx/html
COPY --from=build /build/gzip.conf /etc/nginx/conf.d/gzip.conf
EXPOSE 8080
