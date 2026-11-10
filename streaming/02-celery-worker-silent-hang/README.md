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

## 6. 결론 및 한계점 (1차 실험: 2026-11-09)

1. 워커와 큐 사이의 물리적 네트워크 단절 시 네트워크 연결이 복귀되어도, Celery 워커와의 ping/pong 연결만 복구되고 실제 작업 전달 연결은 끊긴 채로 무한히 대기하는 사일런트 장애가 발생한다.
2. 제어 통로와 데이터 통로가 분리된 구조에서, 데이터 통로는 정상 종료 신호(FIN/RST)가 없으면 '종료'를 인식하지 못하고 ESTABLISHED 상태로 무한 대기하는 TCP Half-Open에 빠진다.
3. 이 실험에서는 SO_KEEPALIVE 설정이 실제로 동작하여 Half-Open 연결을 스스로 강제 종료하고 워커가 자동 재연결에 성공하는 원리까지는 실측으로 검증하지 못했다.

## 7. 2차 심화 실험: 굳은 소켓의 커널 타이머 해부와 `socket_keepalive` 자가 복구 실측 (2026-11-10)

### 1. 2차 실험 전 예측 (사용자 사전 작성)
1. 연결 개수와 복구 예상: 워커는 컨트롤 라인과 데이터 라인 2개를 쓸 것이고, 컨트롤 라인만 확인하면 안 살아날 것 같다.
2. 차단 직후 타이머 변화: 1초마다 말을 거는 그룹 A는 `02`(Keepalive)가 될 것 같고, 아무 말 안 하는 그룹 B는 계속 `00`일 것이다.
3. 15분(15회 재시도) 경과 후: 재전송하던 소켓은 커널이 끊을 것 같고, 아무 말 안 하던 소켓은 그대로 그냥 있을 것이다.
4. `socket_keepalive` 활성화 후: 타이머 번호가 `02`로 바뀌고 잠자던 연결도 커널이 끊어줄 것 같다.

### 2. 실험 및 실측 결과

#### 실험 2-1: 워커의 Redis 연결 구조와 기본 타이머(`tr`) 확인
`redis-cli CLIENT LIST`와 워커의 `/proc/net/tcp`를 대조하여 워커 1대(`172.23.0.6`)가 브로커와 맺는 실제 소켓 구성을 확인합니다.

```bash
docker exec airflow-redis redis-cli CLIENT LIST | grep 172.23.0.6
docker exec airflow-worker-1 cat /proc/net/tcp
```
```text
# [그룹 A] 주기적으로 패킷을 주고받는 활성 소켓 (idle=1초)
addr=172.23.0.6:48508 ... idle=1     flags=b cmd=brpop    (데이터 수신 라인)
addr=172.23.0.6:48560 ... idle=1     flags=N cmd=publish  (워커 하트비트 발행 라인)
addr=172.23.0.6:48542 ... idle=1     flags=P cmd=ping     (Pub/Sub 제어 수신 라인)
addr=172.23.0.6:48576 ... idle=1     flags=P cmd=ping     (Pub/Sub 제어 수신 라인)

# [그룹 B] 부팅 시 초기 등록 후 커넥션 풀에 보관된 유휴 소켓 (idle=82905초)
addr=172.23.0.6:48520 ... idle=82905 flags=N cmd=ping
addr=172.23.0.6:48528 ... idle=82905 flags=N cmd=ping
addr=172.23.0.6:48536 ... idle=82638 flags=N cmd=smembers
addr=172.23.0.6:48554 ... idle=82904 flags=N cmd=sadd
addr=172.23.0.6:48590 ... idle=82904 flags=N cmd=sadd

# [/proc/net/tcp 타이머(tr) 상태]
 8: 060017AC:ACEA 020017AC:1538 01 00000000:00000000 02:0005318B  (Postgres 5432는 tr=02 Keepalive 켜짐)
22: 060017AC:BD7C 030017AC:18EB 01 00000000:00000000 00:00000000  (Redis 6379는 10개 모두 tr=00 타이머 꺼짐)
```
- 실측: 워커 1대는 커넥션 풀을 포함해 총 10개의 소켓을 열어두며, 메타DB(Postgres)와 달리 Redis 연결 10개는 모두 `tr = 00`(타이머 없음) 상태임.

#### 실험 2-2: 패킷 블랙홀 주입 후 5분 vs 18분 경과 시 양측 상태 비교
방화벽으로 Redis 트래픽을 차단한 뒤 5분 시점과 18분(`tcp_retries2 = 15` 초과) 시점의 워커 소켓 표와 Redis 클라이언트 명부를 비교합니다.

```bash
docker exec -u 0 airflow-worker-1 iptables -A OUTPUT -p tcp --dport 6379 -j DROP
docker exec -u 0 airflow-worker-1 iptables -A INPUT -p tcp --sport 6379 -j DROP
```
```text
# [차단 5분 후 /proc/net/tcp]
 1: 060017AC:BDAA 030017AC:18EB 01 00000000:00000000 00:00000000 ... timeout 0   (유휴 소켓: tr=00 방치)
 8: 060017AC:BD7C 030017AC:18EB 01 00000056:00000000 04:00001EB0 ... timeout 11  (brpop: 86B 막힘, 11회째 재전송)
10: 060017AC:BDB0 030017AC:18EB 01 000002F5:00000000 04:00001516 ... timeout 11  (publish: 757B 막힘, 11회째 재전송)

# [차단 18분 후 /proc/net/tcp]
- BD7C(brpop)와 BDB0(publish)는 15회 재전송 후 커널이 강제 종료하여 목록에서 소멸함.
- 나머지 유휴 소켓 7개(tx_queue=0, tr=00)는 여전히 st=01(ESTABLISHED)로 남아 있음.

# [차단 18분 후 Redis CLIENT LIST]
- Redis 자체 tcp-keepalive(300초)에 의해 172.23.0.6(worker-1) 연결 10개가 모두 정리되어 0건 조회됨.
```
- 실측: 송신 버퍼에 데이터가 남은(`Send-Q > 0`) 소켓은 재전송 타이머(`01`/`04`)가 작동해 약 15분 뒤 소멸하지만, `Send-Q = 0`인 소켓들은 Redis에서 이미 삭제되었음에도 워커 혼자 `ESTABLISHED`로 붙들고 있는 반쪽 연결(Half-Open)로 영구 방치됨.

#### 실험 2-3: `socket_keepalive` 활성화 및 자가 복구 확인
Airflow는 `[celery_broker_transport_options]` 섹션을 별도로 읽으므로(`conf.getsection("celery_broker_transport_options")`), `docker-compose.yaml`에 `AIRFLOW__CELERY_BROKER_TRANSPORT_OPTIONS__SOCKET_KEEPALIVE: 'true'`와 커널 Keepalive 단축 설정(15초 대기 + 5초 간격 × 3회 = 30초)을 적용하고 재현합니다.

```bash
docker exec airflow-worker-1 ss -tno state established dport = :6379
```
```text
# [적용 직후 ss -tno: 10개 소켓 모두 keepalive 타이머(tr=02) 활성화]
Recv-Q Send-Q Local Address:Port  Peer Address:Port
0      0         172.23.0.6:46866   172.23.0.3:6379 timer:(keepalive,2.399ms,0)
... (10개 모두 timer:(keepalive) 작동)

# [iptables DROP 차단 35초 후 ss -tno]
Recv-Q Send-Q Local Address:Port  Peer Address:Port
0      753       172.23.0.6:46864   172.23.0.3:6379 timer:(persist,20sec,8)
0      86        172.23.0.6:46824   172.23.0.3:6379 timer:(persist,46sec,8)
- Send-Q = 0 이던 유휴 소켓 8개는 30초 만에 keepalive 타이머가 모두 강제 종료시켜 소멸함.

# [iptables -F 해제 후 워커 로그 및 소켓 복구]
[2026-11-10 11:29:08,275: INFO/MainProcess] Connected to redis://redis:6379/0
[2026-11-10 11:29:09,291: INFO/MainProcess] mingle: sync complete
[2026-11-10 11:31:00,533: INFO/ForkPoolWorker-15] Running <TaskInstance: check_worker_hostname.print_hostname> on host worker-1
[2026-11-10 11:31:00,743: INFO/ForkPoolWorker-15] Task succeeded in 0.351s
```

### 3. 2차 실험 결론 및 한계점 (사용자 작성)

1. keepAlive 설정이 켜져있으면 소켓 응답이 일정시간이 없으면 다시 패킷을 보내 '재연결'을 시도 하는것으로 예측했지만, 실제로는 연결을 '끊는다.'는걸 알게되었다. 워커단(코드)에서 소켓 연결이 끊어지면 재연결을 시도하도록 되어있기때문에 재연결 되는것
2. 서버간 정기적인 연결을 유지하는 상황에선 keepAlive 연결을 켜 예상치못한 네트워크 단절에도 연결이 복구되면 자연스럽게 재 연결된다.
3. 워커가 쉴때 이런 상황이 생긴건데 작업이 있을때는 어떻게 되려나 (한창 작업을 실행하는 도중 네트워크 단절과 재연결이 일어났을 때 실행 중이던 작업이 어떻게 처리되는지는 이번 실험으로 확인하지 못했다.)

### 4. 운영 적용 시 권장 조합: `socket_keepalive` + 처리량 편중 알람

1. **사전 자동 복구 (`socket_keepalive` 활성화)**:
   - 일시적인 네트워크 단절 시 커널이 유휴 반쪽 연결(`Send-Q = 0`)을 강제 종료하여 워커가 사람 개입 없이 스스로 재연결하도록 만듭니다.
   - 단, 너무 짧은 주기는 일시적 네트워크 지연에도 재연결 폭풍(Connection Storm)을 유발할 수 있으므로 운영 환경에서는 수분 단위(예: 대기 120초, 간격 15초, 재시도 5회)로 설정합니다.
2. **사후 증상 감시 (전체 처리량 대비 특정 워커 처리량 0건 알람)**:
   - 네트워크 연결은 정상이지만 워커 내부 데드락, 디스크 가득 참, 작업 슬롯 고갈 등으로 인해 일을 가져가지 못하는 좀비 상태는 `socket_keepalive`만으로 복구할 수 없습니다.
   - 이때 단순히 특정 워커의 처리량이 0건인 조건만 걸면 배치가 없는 시간대에 거짓 알람(오탐)이 발생하므로, **"클러스터 전체 처리량이 기준치 이상인데 특정 워커만 처리량이 0건인 상태"**를 복합 조건으로 걸어두는 것이 실무 표준입니다.
