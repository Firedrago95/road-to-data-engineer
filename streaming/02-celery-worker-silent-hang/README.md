# 02. Celery 워커 네트워크 단절 후 침묵의 장애 원인 분석

- 일시: 2026-11-09
- 목표: 물리적 랜선 단절 시 Celery 워커가 복구되지 않고 일 0건으로 침묵하는 원인을 TCP 소켓 수준에서 규명하고, 배치 성공 착시와 모니터링 해법 검증

## 1. 실험 전 예측
코드를 실행하기 전 세운 가설과 예측입니다. (사용자 사전 작성)

1. 워커 서버의 네트워크 단절 10초 후 다시 떴을 때, 도커 안에 떠 있는 워커는 꺼지지는 않았을 것이다. 그냥 네트워크만 단절된 것이다. 그리고 다시 복구됐을 때 연결을 회복하지 못하는 것 같다.
2. 스케줄러 입장에서는 worker-2(살아있는 워커)가 처리만 하면 되니 알람이 발생하지 않는 것 같다.
3. 프로세스가 죽은 것은 아니었으니까 한 번도 컨테이너가 꺼진 적은 없을 것이다. Airflow 메타 DB 같이 컨트롤타워가 인식해야 할 것 같다. 끊긴 워커는 스스로 알람을 발생시킬 수 없다.

## 2. 실험 환경
- 실행 환경: Docker Compose 기반 Airflow 2.10.3 클러스터
- 브로커: Redis 7.2 (Celery 메시지 큐)
- 메타데이터 DB: PostgreSQL 16
- 실행 구성:
  - `airflow-scheduler`: 매분 태스크 발행 스케줄러
  - `airflow-worker-1`: hostname `worker-1`, NET_ADMIN 권한 부여
  - `airflow-worker-2`: hostname `worker-2`
  - `airflow-flower`: Celery 대시보드 (포트 5555)
- 계측 DAG (`dags/check_worker.py`): 매분 호스트명을 로그에 출력하는 `BashOperator` 태스크

## 3. 실험 및 실측 결과

### 실험 1: 정상 상태에서의 작업 분산 처리 확인
스케줄러가 매분 발행하는 작업을 두 워커가 Redis 큐에서 번갈아 가져가는지 확인합니다.

```bash
docker exec airflow-scheduler airflow dags trigger check_worker_hostname
docker logs airflow-worker-1 --tail 10
docker logs airflow-worker-2 --tail 10
```
```text
[worker-1 로그]
[2026-11-09 11:20:00] Running <TaskInstance: check_worker_hostname.print_hostname> on host worker-1
Task succeeded in 0.278s

[worker-2 로그]
[2026-11-09 11:19:00] Running <TaskInstance: check_worker_hostname.print_hostname> on host worker-2
Task succeeded in 0.271s
```
- 실측: 두 워커가 경쟁 소비자(Competing Consumers) 패턴에 따라 큐의 작업을 정상적으로 분배받아 처리함을 확인.

### 실험 2: 소프트웨어적 네트워크 단절 (`docker network disconnect`)
컨테이너 가상 네트워크 카드를 뗐다가 15초 후 다시 붙여봅니다.

```bash
docker network disconnect airflow-lab-net airflow-worker-1
sleep 15
docker network connect airflow-lab-net airflow-worker-1
```
```text
[worker-1 로그]
[2026-11-09 11:22:18] missed heartbeat from celery@worker-2
[2026-11-09 11:26:00] Running <TaskInstance: check_worker_hostname.print_hostname> on host worker-1
Task succeeded in 0.291s
```
- 실측: 단절 직후(11:21~11:24)에는 일감이 들어오지 않았으나, 약 4분 뒤 `worker-1`이 스스로 새 작업을 수신하기 시작함.
- 원인: 도커가 인터페이스를 제거할 때 OS 커널이 `ENETUNREACH` 에러를 프로세스에 즉시 전달하므로, Celery 네트워크 라이브러리(`kombu`)가 에러를 인지하고 재연결 루프를 수행함.

### 실험 3: 물리적 단절(블랙홀) 재현과 영구 침묵 관측
랜선 접촉 불량이나 스위치 장애처럼, 인터페이스는 살아있으나 패킷만 조용히 증발하는 상황을 `iptables DROP`으로 재현합니다.

```bash
# worker-1의 Redis(6379) 트래픽을 조용히 DROP
docker exec -u 0 airflow-worker-1 iptables -A OUTPUT -p tcp --dport 6379 -j DROP
docker exec -u 0 airflow-worker-1 iptables -A INPUT -p tcp --sport 6379 -j DROP
```

소켓 테이블과 작업 처리 상태를 확인합니다.

```bash
# worker-1 커널 소켓 상태 확인
docker exec airflow-worker-1 cat /proc/net/tcp | grep 18EB
```
```text
sl  local_address rem_address   st tx_queue
10: 060017AC:BDB0 030017AC:18EB 01 000002F1
```
- `st 01`: 소켓 상태가 여전히 `TCP_ESTABLISHED`로 유지됨.
- `tx_queue`: 송신 버퍼에 `000002F1` (753바이트)가 갇힌 채 빠져나가지 못함.
- `docker logs airflow-worker-1`: 에러 로그조차 단 한 줄도 남기지 않고 침묵(Hang).

스케줄러에서 작업을 2회 추가 실행합니다.

```bash
docker exec airflow-scheduler airflow dags trigger check_worker_hostname
docker logs airflow-worker-1 --tail 3
docker logs airflow-worker-2 --tail 3
docker ps --filter "name=airflow-worker"
```
```text
[worker-1 로그]
11:42:11 실행 이후 새로운 작업 수신 0건 (완전 침묵)

[worker-2 로그]
11:43:22, 11:44:43 작업을 worker-2 혼자 도맡아 처리 완료

[컨테이너 상태]
airflow-worker-1   Up 2 minutes
airflow-worker-2   Up 45 minutes
```
- 실측: `worker-1`은 일 0건으로 마비되었으나, `worker-2`가 모든 작업을 대신 처리하여 전체 배치는 100% 성공함.
- 컨테이너 감시: `docker ps` 상으로는 두 컨테이너 모두 정상 `Up` 상태로 표시되어 장애가 완전히 은폐됨.

### 실험 4: 네트워크 복구 후 워커 복구 여부 확인
랜선을 다시 꽂은 상황을 가정하여 방화벽 규칙을 초기화합니다.

```bash
docker exec -u 0 airflow-worker-1 iptables -F
docker exec airflow-scheduler airflow dags trigger check_worker_hostname
```
```text
[worker-1 로그]
11:42:11 이후 여전히 작업 수신 0건

[worker-2 로그]
11:44:43 작업 수신 및 실행 완료 (on host worker-2)
```
- 실측: 방화벽을 풀고 물리적 연결이 복구되었음에도, `worker-1`은 스스로 소켓을 회복하지 못하고 영구히 일 0건 상태를 유지함.

## 4. 원인 분석

### 1. TCP Half-Open과 `SO_KEEPALIVE`의 부재
물리적 랜선 접촉 불량이나 패킷 DROP 상황에서는 상대방(Redis)이 정상 종료 신호(`FIN`/`RST`)를 보낼 수 없습니다.
리눅스 전역 커널의 `tcp_keepalive_time` 기본값은 7,200초(2시간)이지만, 소켓 생성 시 `SO_KEEPALIVE` 옵션을 명시하지 않으면 커널은 확인 패킷을 전혀 보내지 않습니다. 결국 소켓은 무한정 `ESTABLISHED` 상태로 굳어버립니다.

### 2. Redis `BRPOP 0` 블로킹 호출의 덫
Celery 워커는 큐에서 작업을 가져올 때 `BRPOP queue 0` 명령으로 무한 대기합니다. 워커도 Redis도 먼저 데이터를 보내지 않으므로, 유령 소켓이 생성된 사실을 양측 커널 모두 알아차리지 못합니다.

### 3. 통신 채널의 분리와 모니터링 착시
Celery는 관리/제어 명령(Ping/Pong)용 Pub/Sub 채널과 실제 작업 수신용 큐(`BRPOP`) 채널을 분리하여 운용합니다. 제어 채널은 능동적으로 재연결되어 `celery inspect ping`에 `pong`으로 응답하고 Flower 대시보드에 `Online`으로 표시되지만, 실제 작업 채널은 굳어있는 침묵의 부분 장애가 발생합니다.

### 4. 경쟁 소비자(Competing Consumers) 패턴의 장애 은폐
동일한 큐를 공유하는 다른 정상 워커(`worker-2`)가 작업을 모두 흡수하여 실행하므로, 스케줄러와 메타 DB 기준 배치 성공률은 100%를 유지합니다. 이로 인해 파이프라인 실패 알람이 전혀 울리지 않습니다.

## 5. 해결 방법 비교

### 1. 소켓 레벨 해결책: TCP Keepalive 활성화 (사전 자동 복구)
- **방식**: Celery 브로커 연결 옵션에 `socket_keepalive: True`, `socket_timeout: 30` 적용 및 워커 OS의 커널 파라미터 단축(`net.ipv4.tcp_keepalive_time = 60`).
- **장점**: 물리 랜선이 끊겨도 90초 이내에 OS 커널이 소켓을 강제 종료(`ETIMEDOUT`)시키므로, Celery가 소켓 사망을 인지하고 자동으로 재연결을 수행함. (사람의 재시작 불필요)
- **적용 대상**: Celery Worker 설정 및 호스트 OS sysctl.

### 2. 관측 지표 기반 해결책: Prometheus/Grafana 처리량 편중 알람 (사후 감시)
- **방식**: Flower 또는 `statsd-exporter`가 노출하는 워커별 태스크 처리량(`celery_tasks_total`)을 Prometheus가 스크랩(Pull)하여 알람 규칙 설정.
  ```promql
  sum by (worker) (rate(celery_tasks_total[10m])) == 0 and sum(rate(celery_tasks_total[10m])) > 0
  ```
- **장점**: 전체 배치는 성공하더라도 "혼자서 10분 이상 일 0건인 워커"를 정확히 포착하여 슬랙/이메일 알람 발송 가능.
- **적용 대상**: 기존 모니터링 인프라 보유 환경.

### 3. 종단간 검증 해결책: 카나리 태스크 (Canary Task / 전용 큐 헬스체크)
- **방식**: 각 워커마다 전용 큐(`worker-1-health`)를 할당하고, 스케줄러/감시 데몬이 5분마다 1초짜리 더미 핑 태스크를 발행.
- **장점**: Flower나 프로세스가 "정상"이라고 보고하더라도, 실제 작업 수신 채널이 굳었는지를 100% 확증할 수 있는 가장 확실한 방식. 미수행 시 컨테이너 자동 재시작 연계 가능.
- **단점**: 별도의 카나리 DAG 또는 스케줄러 로직 구현 필요.

## 6. 결론 및 한계점

1. 워커와 큐 사이의 물리적 네트워크 단절 시 네트워크 연결이 복귀되어도, Celery 워커와의 ping/pong 연결만 복구되고 실제 작업 전달 연결은 끊긴 채로 무한히 대기하는 사일런트 장애가 발생한다.
2. 제어 통로와 데이터 통로가 분리된 구조에서, 데이터 통로는 정상 종료 신호(FIN/RST)가 없으면 '종료'를 인식하지 못하고 ESTABLISHED 상태로 무한 대기하는 TCP Half-Open에 빠진다.
3. 이 실험에서는 SO_KEEPALIVE 설정이 실제로 동작하여 Half-Open 연결을 스스로 강제 종료하고 워커가 자동 재연결에 성공하는 원리까지는 실측으로 검증하지 못했다.
