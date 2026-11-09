# 딥다이브 세션 로그

형식: `YYYY-MM-DD | 주제 | 소요 시간 | 막힌 지점 | 다음 질문`

2026-11-04 | 멱등한 파이프라인 설계 (NOW() 배제 및 트랜잭션 Delete-Insert) | 40분 | UPDATE가 멱등성을 깨뜨리는 상황(Ghost Row) 이해 | 대량 데이터 DELETE 시 발생하는 DB 락과 파티션 단위 덮어쓰기 비교
2026-11-05 | cron과 Ansible 침묵의 실패 분석 (cron 한계와 스크립트 레벨 종료 코드 감시) | 45분 | PLAY RECAP 숫자(개수)와 OS 종료 코드($?)의 차이 | 실제 crontab 로깅 동작 및 Ansible SSH 키 인증 구성
2026-11-06 | Grafana 알람 프로비저닝 환경변수 오타와 조기 실패(Fail-Fast) | 35분 | Alerting(즉사)과 Datasource/Dashboard(부분 가용)의 실패 전략 차이 이해 | Alerting.yaml의 세부 라우팅 및 템플릿 스키마 규칙
2026-11-09 | Celery 워커 네트워크 단절 후 침묵의 장애 원인 분석 (TCP Half-Open과 사일런트 행) | 60분 | 단순 disconnect와 물리 패킷 DROP(블랙홀) 간의 커널 에러 유무 차이 | SO_KEEPALIVE 및 socket_timeout 적용 시 Half-Open 소켓 자동 복구 실측

