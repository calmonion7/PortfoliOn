# 빌드 컨텍스트 = 레포 루트(docker-compose.yml 의 nginx.build). 루트 .dockerignore 가 frontend·nginx.conf 만 들인다.
# 프론트를 이미지에 굽는다 — 실행 자리에는 dist 가 없고, 롤백은 이미지만 되돌린다(계약 v5 4절).
FROM node:24-alpine AS build
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# VITE_API_BASE_URL 은 빈 값(같은 출처 /api) — 빌드 인자 불필요
RUN npm run build

FROM nginx:alpine
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /src/dist /usr/share/nginx/html
