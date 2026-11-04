# road-to-data-engineer

백엔드 및 인프라 운영 경험을 기반으로, 장애 상황에서의 **데이터 정합성(Consistency), 멱등성(Idempotency), 시스템 신뢰성(Reliability), 관측 가능성(Observability)**을 로컬 Docker 환경에서 실측 검증하는 데이터 엔지니어링 연구 저장소입니다.

모든 실험은 순수 컴퓨터 과학 및 데이터 엔지니어링 일반 개념으로 추상화하여 진행되며, **[사전 가설 수립 → 장애/지연 격리 재현 → 로그 및 쿼리 실측 → 한계 도출]**의 프로세스를 따릅니다.

---

## 📂 분야별 연구 디렉토리 구조

| 디렉토리 | 다루는 핵심 엔지니어링 주제 |
|---|---|
| **[`pipeline-consistency/`](./pipeline-consistency)** | 데이터 파이프라인 정합성, 배치 멱등성, 재시도/실패 복구, 스키마 변경 격리 |
| **[`infra-reliability/`](./infra-reliability)** | 분산 시스템 고가용성(HA), 자동 페일오버(Failover), 네트워크 지연/단절, 컨테이너 리소스 고갈 |
| **[`storage-optimization/`](./storage-optimization)** | 분산 DB 샤딩(Citus Co-location), 파티셔닝, 인덱스 부하, NoSQL 데이터 수명주기(TTL) |
| **[`streaming-observability/`](./streaming-observability)** | 메시지 큐(Kafka/MQ), 고아 작업 및 컨슈머 Lag 병목, 메트릭 수집 및 알람 정밀화 |

---

## 🧪 실험 목록 (Labs)

| 분류 | No. | Lab | 핵심 검증 내용 | 기술 스택 | 링크 |
|:---:|:---:|:---|:---|:---:|:---:|
| `pipeline` | **01** | **멱등한 데이터 파이프라인 설계** | `NOW()` 시계 의존성 배제, `DO NOTHING` 침묵 실패 실측, 트랜잭션 기반 Delete-Insert 멱등성 검증 | PostgreSQL 16, Docker | [바로가기](./pipeline-consistency/01-idempotent-batch/README.md) |

---

## 📌 실험 진행 원칙
1. **예측 우선 (Prediction First)**: 코드를 실행하기 전 시스템 동작 결과와 이유를 먼저 서술한다.
2. **실측 기반 검증 (Empirical Verification)**: 실제 데이터베이스/파이프라인 로그와 쿼리 출력을 수치로 기록한다.
3. **한계 인식 (Boundary)**: 해당 실험으로 확인하지 못한 분산 환경의 한계(Lock, WAL, 런타임 오버헤드 등)를 반드시 명시한다.

---

## 📜 누적 세션 로그
- 매 세션의 요약(날짜, 주제, 소요 시간, 막힌 지점, 다음 질문)은 [`log.md`](./log.md)에 한 줄로 누적됩니다.
