# 딥다이브 세션 로그

형식: `YYYY-MM-DD | 주제 | 소요 시간 | 막힌 지점 | 다음 질문`

2026-11-04 | 멱등한 파이프라인 설계 (NOW() 배제 및 트랜잭션 Delete-Insert) | 40분 | UPDATE가 멱등성을 깨뜨리는 상황(Ghost Row) 이해 | 대량 데이터 DELETE 시 발생하는 DB 락과 파티션 단위 덮어쓰기 비교
2026-11-05 | cron과 Ansible 침묵의 실패 분석 (cron 한계와 스크립트 레벨 종료 코드 감시) | 45분 | PLAY RECAP 숫자(개수)와 OS 종료 코드($?)의 차이 | 실제 crontab 로깅 동작 및 Ansible SSH 키 인증 구성
2026-11-06 | Grafana 알람 프로비저닝 환경변수 오타와 조기 실패(Fail-Fast) | 35분 | Alerting(즉사)과 Datasource/Dashboard(부분 가용)의 실패 전략 차이 이해 | Alerting.yaml의 세부 라우팅 및 템플릿 스키마 규칙
2026-11-09 | Celery 워커 네트워크 단절 후 침묵의 장애 원인 분석 (TCP Half-Open과 사일런트 행) | 60분 | 단순 disconnect와 물리 패킷 DROP(블랙홀) 간의 커널 에러 유무 차이 | SO_KEEPALIVE 및 socket_timeout 적용 시 Half-Open 소켓 자동 복구 실측
2026-11-10 | Celery 굳은 소켓 커널 타이머(재전송 vs Keepalive) 해부 및 socket_keepalive 자가 복구 검증 | 85분 | 커널 Keepalive의 역할(재연결이 아니라 소켓 강제 종료를 통한 워커 재연결 루프 깨우기)과 송신 버퍼 유무별 타이머 차이 | 워커가 작업을 한창 실행 중일 때 네트워크 단절이 발생하면 실행 중인 작업은 어떻게 처리되는가
2026-11-11 | MongoDB $or 전체 스캔(COLLSCAN) 원리 확인 및 15조합 검증 환경 구축 (1부) | 65분 | Node.js 첫 작성 부담과 피로로 인해 개선 조건 함수·검증 테스트 구현을 다음 세션으로 분할 | 15가지 입력 조합 중 복합 인덱스를 탈 수 있는 조건 설계와 거절 조합 검증(hasCollscan, buildSafeOrQuery 구현)
2026-11-12 | MongoDB $or 전체 스캔 검증 및 복합 인덱스 조건 설계 완성 (2부) | 95분 | Node.js 문법(hasCollscan, try/catch) 적응과 문서 내 다중 키 스키마(id/ids/key_object) 맥락 이해 | NoSQL이 한 문서 안의 중첩 필드(ids.*) 일부만 골라 B-Tree 인덱스를 저장하고 탐색하는 내부 구조

