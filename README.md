# road-to-data-engineer

견고한 데이터 파이프라인을 구축하는 데이터 엔지니어로 성장하기 위한 학습과 실험 기록입니다.

이론으로만 접한 개념을 로컬 도커 환경에서 직접 구현하고, 장애나 예외 상황을 만들어 결과를 검증합니다.

## 디렉토리 구조

- `pipeline/`: 데이터 정합성, 배치 멱등성, 재시도 및 스키마 변경 대응
- `infra/`: 고가용성, 자동 장애 조치, 네트워크 지연 및 자원 부족 대응
- `storage/`: 데이터베이스 샤딩, 파티셔닝, 인덱스 및 데이터 수명 관리
- `streaming/`: 메시지 큐, 처리 지연 병목, 모니터링 및 알람

## 실험 목록

| 번호 | 분류 | 주제 | 핵심 내용 | 기술 스택 | 링크 |
|:---:|---|---|---|---|:---:|
| 01 | `pipeline` | 멱등한 데이터 파이프라인 설계 | 실행 날짜 고정과 한 트랜잭션 지우고 넣기로 재실행 시 데이터 꼬임 방지 | PostgreSQL | [보기](./pipeline/01-idempotent-batch/README.md) |
| 02 | `infra` | cron과 Ansible의 침묵 실패 분석 | 로그 파일에 가려진 실패를 종료 코드($?)로 잡고, cron 대신 스크립트 안에서 감시 | Ansible, Bash | [보기](./infra/01-ansible-cron-silent-failure/README.md) |
| 03 | `streaming` | Grafana 알람 설정 오타와 조기 실패 | 알람 주소 환경변수 오타 시 조용히 넘기지 않고 서버를 바로 멈추는 동작 확인 | Grafana | [보기](./streaming/01-grafana-alert-env-typo/README.md) |
| 04 | `streaming` | Celery 워커 네트워크 단절과 침묵의 행 (1·2차) | 랜선 단절 뒤 워커가 영구 대기하는 원인과 Keepalive로 소켓을 끊어 자동 복구하는 과정 확인 | Airflow, Celery, Redis | [보기](./streaming/02-celery-worker-silent-hang/README.md) |
| 05 | `storage` | MongoDB `$or` 전체 스캔과 복합 인덱스 조건 설계 | `$or` 조건 중 하나만 인덱스 없어도 전체 스캔되는 원인과, 15가지 조합 모두 인덱스 타게 개선 | MongoDB, Node.js | [보기](./storage/01-mongo-or-collscan/README.md) |

## 기록 원칙

1. 코드를 실행하기 전 결과를 먼저 예상하고 이유를 적습니다.
2. 데이터 정합성, 트랜잭션, SQL 등 꼭 알아야 하는 핵심 코드는 직접 작성합니다.
3. 도커 환경에서 실제 쿼리와 출력 결과로 검증합니다.
4. 실험으로 확인하지 못한 기술적 한계를 명시합니다.
5. 매일의 진행 요약은 `log.md`에 한 줄로 기록합니다.
