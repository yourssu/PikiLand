# PikiLand Deployment & Integration Guide

이 문서는 Nginx 리버스 프록시 환경 뒤에 PikiLand Docker 서버를 배치하고, GitHub App을 등록하여 대상 저장소에 연동하는 배포 및 설치 가이드입니다.

---

## 1. Architecture Overview

```text
[ GitHub / Webhook ]
         │
         │ (HTTPS:443)
         ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Nginx Reverse Proxy (SSL/TLS - Certbot / Let's Encrypt)     │
 │  - Server Name: pikiland.yourdomain.com                    │
 │  - Pass Headers: Host, X-Forwarded-For, X-Forwarded-Proto   │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                │ (HTTP:8080)
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Docker: pikiland-server (포트 8080)                         │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Docker: pikiland-postgres (포트 5432)                       │
 └──────────────────────────────┴──────────────────────────────┘
```

---

## 2. Step 1: Nginx Reverse Proxy & SSL Setup

도메인(예: `pikiland.yourdomain.com`)을 Nginx 서버의 IP로 DNS 연결(A 레코드)한 뒤 아래와 같이 Nginx 설정을 적용합니다.

### 1) Nginx 사이트 설정 파일 작성 (`/etc/nginx/sites-available/pikiland.conf`)

```nginx
server {
    listen 80;
    server_name pikiland.yourdomain.com;

    # Cloudflare Edge에서 HTTPS 리다이렉트를 처리하거나 Nginx에서 리다이렉트
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name pikiland.yourdomain.com;

    # Cloudflare Origin Server Certificate 경로 예시
    # (Cloudflare Dashboard > SSL/TLS > Origin Server에서 발급받은 인증서 및 개인키)
    ssl_certificate /etc/ssl/certs/cloudflare_pikiland.pem;
    ssl_certificate_key /etc/ssl/private/cloudflare_pikiland.key;

    # SSL 보안 옵션 (Cloudflare Full (Strict) 모드 권장)
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # 요청 크기 제한 (빌드 로그 수신 고려)
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:8080;
        
        # 헤더 전달 설정 (Cloudflare 클라이언트 실제 IP 및 OAuth/Webhook HTTPS 유지)
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $http_cf_connecting_ip;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;

        # 비동기 장시간 연결 설정 (웹훅 및 대시보드 지원)
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
        proxy_send_timeout 300s;
    }
}
```

### 2) Nginx 설정 적용 및 재로드

```bash
# 설정 심볼릭 링크 생성
sudo ln -s /etc/nginx/sites-available/pikiland.conf /etc/nginx/sites-enabled/

# Nginx 구문 검사
sudo nginx -t

# Nginx 재로드
sudo systemctl reload nginx
```

---

## 3. Step 2: Register New GitHub App

1. [GitHub Settings ➔ Developer Settings ➔ GitHub Apps](https://github.com/settings/apps)로 이동합니다.
2. **`New GitHub App`** 버튼을 클릭합니다.

### 1) 기본 정보 설정 (Basic Info)

| 항목 | 입력 값 예시 |
| --- | --- |
| **GitHub App name** | `PikiLand-AutoFix` (유니크한 이름) |
| **Homepage URL** | `https://pikiland.yourdomain.com` |
| **Callback URL** | `https://pikiland.yourdomain.com/login/oauth2/code/github` |
| **Setup URL** | `https://pikiland.yourdomain.com/dashboard` |
| **Webhook URL** | `https://pikiland.yourdomain.com/api/webhook` |
| **Webhook Secret** | 보안 비밀번호 생성 (예: `pikiland_secret_key_12345!`) |

### 2) 권한 설정 (Repository Permissions)
- **Actions**: `Read & Write` (Workflow dispatch 및 빌드 로그 다운로드)
- **Checks**: `Read & Write` (CI 상태 확인)
- **Contents**: `Read & Write` (자가치유 워크플로 파일 커밋 및 코드 확인)
- **Issues**: `Read & Write` (이슈 수신 및 라벨/댓글)
- **Pull requests**: `Read & Write` (자동 수정 PR 생성)
- **Workflows**: `Read & Write` (`.github/workflows/pikiland.yml` 워크플로 파일 작성)

### 3) 이벤트 구독 (Subscribe to Events)
- [x] **`Workflow run`**
- [x] **`Issues`**

### 4) 자격 증명(Credentials) 수집
App 생성 완료 후 아래 5개 값을 기록해 둡니다:
1. **App ID**: (예: `1029384`)
2. **Private Key**: `Generate a private key` 클릭 후 다운로드받은 `.pem` 파일 내용 전체
3. **Webhook Secret**: 생성한 웹훅 비밀번호
4. **Client ID**: App 개요 페이지의 Client ID
5. **Client Secret**: `Generate a new client secret` 클릭 후 생성된 Secret

---

## 4. Step 3: Docker & Docker Compose Deployment

### 1) `.env` 파일 설정
프로젝트 루트 디렉터리에 `.env` 파일을 생성하고 작성합니다.

```env
# 중앙 어드민 사용자 (본인의 GitHub 사용자명)
PIKILAND_ADMIN_USERS="your_github_username"

# PostgreSQL 데이터베이스 설정
DATABASE_URL="jdbc:postgresql://postgres:5432/pikilanddb"
DATABASE_USER="postgres"
DATABASE_PASSWORD="pikiland_secure_password_123!"

DEBUG="false"
```

### 2) Docker 컨테이너 빌드 및 실행

```bash
docker compose up -d --build
```

### 3) 실행 상태 및 로그 확인

```bash
docker compose ps
docker compose logs -f pikiland-server
```

---

## 5. Step 4: Central Admin Dashboard Settings

1. 웹 브라우저에서 `https://pikiland.yourdomain.com/dashboard` 접속.
2. **GitHub OAuth 로그인** 진행 (`PIKILAND_ADMIN_USERS`에 포함된 계정).
3. **`Central System Settings`** 메뉴(또는 `/dashboard` 내 시스템 설정) 이동.
4. Step 2에서 수집한 자격 증명을 등록:
   - **GitHub App ID**
   - **GitHub App Private Key** (`.pem` 내용 전체)
   - **GitHub Webhook Secret**
   - **GitHub OAuth Client ID**
   - **GitHub OAuth Client Secret**
5. **저장(Save)** 클릭.

---

## 6. Step 5: Install App on Target Repository

1. GitHub Apps 관리 페이지에서 **`Install App`** 클릭.
2. PikiLand를 적용할 **대상 리포지토리(Target Repository)** 선택 후 설치.
3. **대상 리포지토리 설정**:
   - 대상 리포지토리 루트 디렉터리에 **`AGENTS.md`** 파일 추가 (LLM 가이드라인):
     ```markdown
     # AGENTS.md
     This repository is enabled for PikiLand AI Self-Healing.
     ```
   - PikiLand 대시보드에서 해당 저장소 선택:
     - **Active**: `ON`
     - **Harness Command**: (예시)`./gradlew test` (프로젝트 빌드/테스트 명령)
     - **AI Provider Key**: OpenAI API Key 또는 Anthropic Key 설정
     - **Slack Webhook URL**: (선택) 알림용 Slack Webhook URL
