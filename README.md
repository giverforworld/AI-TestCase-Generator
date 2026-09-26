<div align="center">

# TestPlanner

**Git diff를 AI로 분석하여 QA 테스트케이스를 자동 생성하는 웹 애플리케이션**

코드 변경사항을 입력하면 Claude AI 또는 KT AI Codi가 변경 영향 범위를 분석하고,
QA 팀이 바로 사용할 수 있는 마크다운 테스트케이스 문서를 실시간으로 생성합니다.

<br/>

![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)

![버전](https://img.shields.io/badge/버전-1.0.0-blue?style=flat-square)
![라이선스](https://img.shields.io/badge/라이선스-MIT-green?style=flat-square)
![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-brightgreen?style=flat-square)

</div>

---

## 목차

- [왜 만들었나](#왜-만들었나)
- [AI 파이프라인 설계](#ai-파이프라인-설계)
- [프롬프트를 고친 기록](#프롬프트를-고친-기록)
- [AI 출력을 그대로 믿지 않는 장치](#ai-출력을-그대로-믿지-않는-장치)
- [한계와 다음 단계](#한계와-다음-단계)
- [주요 기능](#주요-기능)
- [기술 스택](#기술-스택)
- [빠른 시작](#빠른-시작)
- [사용 방법](#사용-방법)
- [프로젝트 구조](#프로젝트-구조)
- [API 레퍼런스](#api-레퍼런스)
- [환경변수](#환경변수)
- [AI 모델 선택 가이드](#ai-모델-선택-가이드)
- [개발자 가이드](#개발자-가이드)

---

## 왜 만들었나

코드가 바뀌면 QA 는 "이번에 **무엇을** 테스트해야 하나"부터 막힌다.
개발자는 diff 를 읽을 수 있지만, 수동 테스터는 브라우저를 열고 버튼을 눌러 확인하는 사람이다.
diff 와 테스터 사이에는 **"이 변경이 어느 화면의 어떤 동작에 영향을 주는가"** 라는 번역이 빠져 있다.

TestPlanner 는 그 번역을 AI 에게 맡긴다 — diff 를 넣으면 영향 범위를 먼저 판단하고,
그 판단을 근거로 **비개발자가 그대로 따라 할 수 있는** 테스트케이스를 쓴다.

---

## AI 파이프라인 설계

한 번의 호출로 "분석하고 테스트케이스까지 써라"고 하지 않는다. 역할을 둘로 나눴다.

```
git diff ─┬─▶ [1단계] 영향도 분석가 ── JSON ──┐
          │    messages.create · max 2,048     │   사람이 결과를 확인하고
          │    diff 15,000자까지                ▼   "생성" 을 누른다
          └─────────────────────────────▶ [2단계] 테스트케이스 작성가 ── SSE 스트리밍 ──▶ MD / PDF
                                           messages.stream · max 8,192
                                           diff 10,000자 + 1단계 결과
```

| 단계 | 역할 | 출력 | 왜 이렇게 |
|---|---|---|---|
| 1. 영향도 분석 | QA 전문가 | `overallRisk` · `affectedAreas[]` · `recommendations` **JSON** | 구조화된 중간 결과가 있어야 사람이 중간에 검토할 수 있고, 2단계 입력이 흔들리지 않는다 |
| 2. TC 작성 | QA 엔지니어 | P1(필수) 2개+ · P2(중요) 2개+ · P3(회귀) 1개+ **마크다운** | 우선순위 하한을 두어 "핵심만 쓰고 끝내는" 출력을 막는다 |

- **컨텍스트 주입** — diff 만으로는 "이 파일이 어느 화면인지" 알 수 없다. 대상 저장소의 `package.json`, 2단계 깊이 디렉터리 트리, README 앞 3,000자를 묶어 프롬프트 앞에 붙인다 (`project-context.service.ts`, 5분 캐시).
- **컨텍스트를 만드는 에이전트** — 대상 저장소의 README 가 부실하면 위 주입도 소용없다. 그래서 README 를 "AI 가 화면·메뉴·클릭 경로를 파악하기 쉽게" 다시 쓰는 에이전트를 따로 뒀다 (`README_MAKER_FOR_TESTCASE_MAKING.md`, `.cursor/agents/testcase-readme-maker.md`).
- **모델 선택** — 기본은 Claude Haiku 4.5(빠른 초안), 필요하면 Sonnet 4.6 / Opus 4.6. 사내 LLM(KT AI Codi) 도 같은 인터페이스로 붙는다.

---

## 프롬프트를 고친 기록

처음부터 잘 된 게 아니다. 출력이 틀린 방식을 보고 프롬프트와 코드를 같이 고쳤다.

| 무엇이 문제였나 | 원인 | 고친 것 | 커밋 |
|---|---|---|---|
| TC 가 개발 용어(API·컴포넌트·diff) 중심이라 수동 테스터가 따라 하기 어려움 | 독자를 정하지 않았다 | **대상 독자를 "마우스로 클릭하며 테스트하는 비개발자"로 명시.** '화면·버튼·입력칸·메뉴'로 쓰고 "어디를 클릭하고, 무엇을 입력하고, 무엇이 보이면 되는지" 적게 했다. 영향 영역 이름도 "로그인 화면, 결제 버튼" 식으로 | [4da19a4][4da19a4] |
| 보고서의 "3. 테스트케이스" 섹션이 **제목만 있고 비어서** 나옴 | 섹션 제목을 다시 쓰거나 제목만 내고 끝나는 출력, 긴 출력의 잘림 | system 지시로 **첫 줄을 `### TC-001:` 로 강제**, 제목 재작성 금지, 최소 5개. `max_tokens` 4,096 → 8,192 | [d441350][d441350] |
| 영향도 JSON 파싱이 가끔 실패해 **파이프라인 전체가 멈춤** | 닫는 코드펜스 누락, 문자열 안의 `{}` 를 정규식이 오인 | 코드펜스 제거 → **문자열을 인식하는 균형 괄호 탐색**으로 JSON 추출. 그래도 실패하면 `overallRisk: medium` 기본값으로 **TC 생성은 계속** | [9308516][9308516] |

---

## AI 출력을 그대로 믿지 않는 장치

- **중간 검토 지점** — 1단계 결과(위험도·영향 영역)를 화면에 먼저 보여주고, 사람이 확인한 뒤 2단계를 실행한다.
- **실패해도 멈추지 않는 파싱** — `utils/json-extract.util.ts`. 파싱에 실패하면 원문 앞부분을 요약에 남겨 사람이 판단할 수 있게 한다.
- **형식 강제** — TC 번호·우선순위·관련 영역을 고정 포맷으로 요구해, 누락이 눈에 띄게 한다.
- **입력 한도** — diff 를 단계별로 자른다(15,000 / 10,000자).
- **오류를 사람 말로** — 크레딧 부족·인증 실패·429 를 한국어 안내로 바꾼다 (`utils/claude-error.util.ts`).

---

## 한계와 다음 단계

- **품질을 숫자로 재지 못했다.** 지금은 사람이 결과를 읽고 판단한다. 다음은 변경 이력이 알려진 diff 몇 개로 **골든셋**을 만들어, 모델별로 "실제로 영향받은 화면을 몇 개나 짚었는가"를 비교하는 것.
- **E2E 시나리오는 문서로만 있다** (`markdown/E2E_TEST_SCENARIOS.md`). 실행 결과 기록과 자동화가 남아 있다.
- diff 가 한도를 넘으면 뒷부분이 분석에서 빠진다 — 파일 단위로 나눠 보내는 방식이 다음 과제다.

---

## 주요 기능

- **다양한 저장소 연동** — 로컬 경로 직접 입력, macOS 폴더 선택 다이얼로그, GitHub URL 자동 클론 지원
- **3가지 비교 방식** — 브랜치 간 비교, 특정 커밋 2개 지정, 최근 N개 커밋 일괄 비교
- **AI 영향도 분석** — 변경 파일을 분석해 기능별 위험도(low / medium / high / critical)와 권고사항을 JSON으로 반환
- **테스트케이스 실시간 생성** — SSE(Server-Sent Events) 스트리밍으로 TC 마크다운이 화면에 실시간 타이핑
- **AI 모델 선택** — Claude Haiku 4.5 / Sonnet 4.6 / Opus 4.6 / KT AI Codi 중 선택
- **MD / PDF 내보내기** — 생성된 테스트케이스를 Markdown 또는 PDF 파일로 즉시 저장 및 다운로드
- **프로젝트 구조 문서 자동 생성** — 저장소 로드 시 디렉토리 구조를 분석해 AI 프롬프트 컨텍스트로 활용

---

## 기술 스택

| 구분 | 기술 | 버전 | 역할 |
|------|------|------|------|
| **Frontend** | React | 18 | UI 컴포넌트 |
| | TypeScript | 5 | 타입 안전성 |
| | Vite | 5 | 번들러 / 개발 서버 |
| | TailwindCSS | 3 | 스타일링 |
| | Zustand | 4 | 전역 상태 관리 |
| | Axios | - | HTTP 클라이언트 |
| | react-markdown | 9 | TC 마크다운 렌더링 |
| **Backend** | Node.js | 20 | 런타임 |
| | Express | 4 | REST API 서버 |
| | TypeScript | 5 | 타입 안전성 |
| | simple-git | 3 | Git diff / 클론 추출 |
| | Zod | 3 | 환경변수 스키마 검증 |
| | Puppeteer | 24 | MD → PDF 변환 |
| | marked | 17 | Markdown HTML 변환 |
| **AI** | Anthropic Claude SDK | 0.36 | 영향도 분석 / TC 생성 |
| | KT AI Codi REST API | - | 대체 AI 모델 연동 |
| | SSE | - | 실시간 스트리밍 |
| **인프라** | pnpm workspaces | - | 모노레포 관리 |
| | concurrently | 8 | 서버/클라이언트 동시 실행 |

---

## 빠른 시작

### 사전 준비

```bash
node --version   # v18 이상
pnpm --version   # v8 이상 (없으면: npm install -g pnpm)
git --version    # 임의 버전
```

Anthropic API 키 또는 KT AI Codi API 키 중 하나가 반드시 필요합니다.

- Claude 모델 사용: [console.anthropic.com](https://console.anthropic.com) 에서 API 키 발급
- KT AI Codi 사용: KT 내부 발급 키 및 엔드포인트 URL 준비

### 설치

```bash
# 1. 저장소 클론
git clone https://github.com/giverforworld/AI-TestCase-Generator.git
cd AI-TestCase-Generator

# 2. 전체 의존성 설치 (server + client 동시)
pnpm install
```

### 환경변수 설정

```bash
cp server/.env.example server/.env
```

`server/.env` 파일을 열고 사용할 AI 서비스의 키를 입력합니다.

```env
# Claude 모델을 사용하는 경우 (필수)
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxx

# KT AI Codi를 사용하는 경우 (선택)
CODI_API_KEY=your-codi-api-key
CODI_API_BASE_URL=https://api.codi.kt.co.kr/v1

# 서버 설정 (선택 — 기본값 사용 가능)
PORT=3000
OUTPUT_DIR=../output
MAX_DIFF_SIZE=50000
NODE_ENV=development
```

> ANTHROPIC_API_KEY와 CODI_API_KEY 중 하나 이상이 설정되지 않으면 서버가 시작되지 않습니다.

### 실행

```bash
# 서버(포트 3000)와 클라이언트(포트 5173)를 동시에 실행
pnpm dev
```

브라우저에서 [http://localhost:5173](http://localhost:5173) 을 열면 바로 사용할 수 있습니다.

서버 또는 클라이언트를 개별 실행하는 경우:

```bash
pnpm dev:server   # Express 서버만 실행 (포트 3000)
pnpm dev:client   # Vite 개발 서버만 실행 (포트 5173)
```

프로덕션 빌드:

```bash
pnpm build   # server + client 모두 빌드
```

---

## 사용 방법

TestPlanner는 3단계 위저드(Wizard) 구조로 동작합니다.

### Step 1 — 저장소 설정

저장소를 연결하고 비교 대상을 지정합니다.

**저장소 입력 방식 (택 1)**

| 방식 | 입력 예시 |
|------|-----------|
| 로컬 경로 직접 입력 | `/Users/me/projects/my-app` |
| macOS 폴더 선택 다이얼로그 | 폴더 선택 버튼 클릭 |
| GitHub URL 자동 클론 | `https://github.com/user/repo.git` |

**비교 방식 (택 1)**

| 방식 | 설명 | 예시 |
|------|------|------|
| 브랜치 비교 | 두 브랜치 사이의 모든 변경 추출 | `main` vs `feature/login` |
| 커밋 비교 | 두 커밋 해시 지정 | `a1841ae` vs `8238e26` |
| 최근 N개 커밋 | 최근 N개 커밋의 변경 일괄 추출 | 최근 5개 |

저장소가 로드되면 AI 모델을 선택하고 "분석 시작"을 클릭합니다.

### Step 2 — 영향도 분석 결과 확인

"분석 시작" 클릭 즉시 두 가지가 자동으로 수행됩니다.

1. Git diff 추출 — 변경된 파일 목록과 추가/삭제 라인 수 표시
2. AI 영향도 분석 — Claude AI가 변경 내용의 기능적 영향 범위를 분석해 다음 항목을 반환합니다.
   - 전체 위험도 (low / medium / high / critical)
   - 영향 받는 기능 영역별 위험도와 설명
   - 수동 테스트 시 확인해야 할 권고사항

결과 확인 후 "테스트케이스 생성" 버튼을 클릭합니다.

### Step 3 — 테스트케이스 생성 및 내보내기

SSE 스트리밍으로 QA 테스트케이스 마크다운이 실시간으로 화면에 생성됩니다. 생성 완료 후 다음 작업이 가능합니다.

| 동작 | 설명 |
|------|------|
| MD 저장 | `output/` 디렉토리에 마크다운 파일 저장 |
| MD 다운로드 | 저장된 `.md` 파일 즉시 다운로드 |
| PDF 다운로드 | Puppeteer로 변환한 PDF 파일 즉시 다운로드 |
| 처음으로 | 상태 초기화 후 Step 1로 복귀 |

---

## 프로젝트 구조

```
testplanner/
├── package.json                    # pnpm workspaces 루트
├── pnpm-workspace.yaml             # 워크스페이스 정의
│
├── server/                         # Node.js + Express 백엔드 (포트 3000)
│   ├── .env                        # 환경변수 (gitignore됨)
│   ├── .env.example                # 환경변수 템플릿
│   └── src/
│       ├── index.ts                # 서버 진입점 (CORS, 라우터, 에러 핸들러)
│       ├── config/
│       │   └── env.ts              # Zod 환경변수 스키마 검증
│       ├── routes/
│       │   ├── git.routes.ts       # /api/git/*
│       │   ├── analysis.routes.ts  # /api/analysis/*
│       │   └── testcase.routes.ts  # /api/testcase/*
│       ├── controllers/
│       │   ├── git.controller.ts
│       │   ├── analysis.controller.ts
│       │   └── testcase.controller.ts   # AI 모델 분기 로직 포함
│       ├── services/
│       │   ├── git.service.ts           # simple-git diff/브랜치/커밋/클론
│       │   ├── claude.service.ts        # Anthropic SDK 연동 (분석 + SSE 스트리밍)
│       │   ├── kt-codi.service.ts       # KT AI Codi REST API 연동 (SSE)
│       │   ├── analysis.service.ts      # 영향도 분석 오케스트레이션
│       │   ├── testcase.service.ts      # TC 생성 오케스트레이션 + MD/PDF 저장
│       │   ├── file.service.ts          # MD 파일 저장/다운로드
│       │   └── project-context.service.ts  # 저장소 디렉토리 구조 문서 생성
│       ├── utils/
│       │   ├── prompt.util.ts           # Claude / Codi 프롬프트 빌더
│       │   ├── markdown.util.ts         # MD 보고서 포맷터
│       │   ├── pdf.util.ts              # Markdown → PDF 변환 (Puppeteer)
│       │   ├── codi-sse.util.ts         # KT Codi SSE 응답 파서
│       │   ├── claude-error.util.ts     # LLM 에러 메시지 정규화
│       │   ├── log-payload.util.ts      # 개발 환경 payload 로깅
│       │   ├── json-extract.util.ts     # JSON 추출 유틸
│       │   └── logger.util.ts           # 구조화 로거
│       └── types/                       # 공유 TypeScript 타입
│
├── client/                         # React + Vite 프론트엔드 (포트 5173)
│   └── src/
│       ├── App.tsx                 # 루트 컴포넌트 (3단계 스텝 UI)
│       ├── main.tsx
│       ├── api/
│       │   └── client.ts           # Axios 기반 API 클라이언트
│       ├── store/
│       │   └── useAppStore.ts      # Zustand 전역 상태 (Step 간 데이터 공유)
│       └── components/
│           ├── GitConfig/          # Step 1: 저장소 연결 & 비교 설정
│           ├── Analysis/           # Step 2: 영향도 분석 결과 표시
│           └── TestCase/           # Step 3: TC 실시간 생성 & 내보내기
│
└── output/                         # 생성된 MD/PDF 파일 저장 (자동 생성)
```

---

## API 레퍼런스

모든 API 응답은 아래 통일된 형식을 따릅니다.

```typescript
{ success: boolean, data?: T, error?: string }
```

### Git

| Method | Endpoint | 설명 | 요청 Body |
|--------|----------|------|-----------|
| `GET` | `/health` | 서버 상태 확인 | - |
| `POST` | `/api/git/validate` | 저장소 경로 유효성 검사 | `{ repoPath: string }` |
| `POST` | `/api/git/branches` | 브랜치 및 커밋 목록 조회 | `{ repoPath: string }` |
| `POST` | `/api/git/diff` | Git diff 추출 | `{ repoPath, compareType, base?, head?, recentCount? }` |
| `POST` | `/api/git/clone` | GitHub URL에서 저장소 클론 | `{ githubUrl: string }` |

**diff 요청 예시 — 브랜치 비교**

```json
{
  "repoPath": "/tmp/testplanner-repo-xxx",
  "compareType": "branch",
  "base": "main",
  "head": "feature/login"
}
```

**diff 요청 예시 — 최근 N개 커밋**

```json
{
  "repoPath": "/tmp/testplanner-repo-xxx",
  "compareType": "recent",
  "recentCount": 5
}
```

### 분석 및 테스트케이스

| Method | Endpoint | 설명 | 요청 Body |
|--------|----------|------|-----------|
| `POST` | `/api/analysis/impact` | AI 영향도 분석 | `{ diff, model }` |
| `POST` | `/api/testcase/generate` | TC 생성 (SSE 스트리밍) | `{ diff, analysis, projectName, compareSummary, model }` |
| `POST` | `/api/testcase/save` | MD 파일 저장 | `{ content, diff, analysis, projectName, compareSummary }` |
| `POST` | `/api/testcase/save-pdf` | PDF 파일 저장 | `{ content, projectName }` |
| `POST` | `/api/testcase/pdf-download` | PDF 즉시 다운로드 (서버 저장 없음) | `{ content, projectName }` |
| `GET` | `/api/testcase/list` | 저장된 MD / PDF 목록 | - |
| `GET` | `/api/testcase/download/:filename` | MD / PDF 파일 다운로드 | - |

### SSE 스트리밍 이벤트 형식

`/api/testcase/generate` 엔드포인트는 `Content-Type: text/event-stream` 으로 응답합니다.

```
data: {"type": "header", "text": "# 테스트케이스\n\n- 비교: main...feature/login\n"}

data: {"type": "delta", "text": "## 1. 로그인\n\n| 단계 | 기대 결과 |"}

data: {"type": "delta", "text": "| --- | --- |"}

data: {"type": "done", "usage": {"inputTokens": 1234, "outputTokens": 567}}

data: {"type": "error", "error": "오류 메시지"}
```

| 이벤트 type | 의미 |
|-------------|------|
| `header` | 보고서 상단 고정 텍스트 (1~2절: 문서 정보 · 영향도 분석) |
| `delta` | TC 본문 조각, 연속 전송 |
| `done` | 스트림 종료 + 토큰 사용량 |
| `error` | 오류 발생 시 |

---

## 환경변수

`server/.env` 파일에 설정합니다. `server/.env.example`을 복사해 사용하세요.

| 변수명 | 필수 여부 | 기본값 | 설명 |
|--------|-----------|--------|------|
| `ANTHROPIC_API_KEY` | Claude 사용 시 필수 | - | Anthropic API 키 (`sk-ant-...` 형식) |
| `CODI_API_KEY` | KT Codi 사용 시 필수 | - | KT AI Codi API 키 |
| `CODI_API_BASE_URL` | KT Codi 사용 시 필수 | `https://api.codi.kt.co.kr/v1` | KT Codi API 엔드포인트 |
| `PORT` | 선택 | `3000` | Express 서버 포트 |
| `OUTPUT_DIR` | 선택 | `../output` | MD / PDF 파일 저장 경로 |
| `MAX_DIFF_SIZE` | 선택 | `50000` | diff 최대 크기(문자 수). 초과 시 자동으로 잘림 |
| `NODE_ENV` | 선택 | `development` | 실행 환경 (`development` / `production`) |
| `FRONTEND_URL` | 프로덕션 시 권장 | - | CORS 허용 프론트엔드 URL |

> `ANTHROPIC_API_KEY`와 `CODI_API_KEY` 중 하나 이상이 반드시 설정되어야 합니다. 둘 다 없으면 서버 기동 시 Zod 검증 오류가 발생하고 프로세스가 종료됩니다.

---

## AI 모델 선택 가이드

| 모델 | 속도 | 품질 | 추천 상황 |
|------|------|------|----------|
| **Haiku 4.5** (기본) | 빠름 | 보통 | 빠른 초안 확인, 비용 절감 |
| **Sonnet 4.6** | 보통 | 좋음 | 일반 업무용 |
| **Opus 4.6** | 느림 | 최고 | 복잡한 레거시 코드 심층 분석 |
| **KT AI Codi** | - | - | 사내 환경 |

가격은 [Anthropic 공식 가격표](https://www.anthropic.com/pricing#api)를 따른다.

---

## 개발자 가이드

### 서버 헬스체크

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"2026-03-30T00:00:00.000Z"}
```

### AI 모델 분기 구조

`testcase.controller.ts` 내부에서 선택된 모델 ID로 서비스를 분기합니다.

```
isKtAiCodiModel(modelId) → KtCodiService  (KT AI Codi REST API + SSE)
else                      → ClaudeService (Anthropic SDK + SSE 스트리밍)
```

### 주의사항

- `server/.env` 파일은 절대 Git에 커밋하지 마세요. `.gitignore`에 이미 등록되어 있습니다.
- `output/` 디렉토리는 서버 최초 실행 시 자동으로 생성됩니다.
- `MAX_DIFF_SIZE` 초과 시 diff가 잘려 분석 품질이 저하될 수 있습니다. 대규모 PR은 범위를 나눠서 분석하는 것을 권장합니다.
- GitHub URL 클론은 시스템 임시 디렉토리(`/tmp`)에 저장되며, 2시간 후 자동 정리됩니다.
- PDF 변환은 Puppeteer(Chromium)를 사용하므로 최초 실행 시 브라우저 바이너리 다운로드가 발생할 수 있습니다.

---

## 라이선스

MIT License — 자유롭게 사용, 수정, 배포할 수 있습니다.

---

<div align="center">
  <sub>TestPlanner v1.0.0 · Powered by Claude AI & KT AI Codi</sub>
</div>

[4da19a4]: https://github.com/giverforworld/AI-TestCase-Generator/commit/4da19a4
[d441350]: https://github.com/giverforworld/AI-TestCase-Generator/commit/d441350
[9308516]: https://github.com/giverforworld/AI-TestCase-Generator/commit/9308516
