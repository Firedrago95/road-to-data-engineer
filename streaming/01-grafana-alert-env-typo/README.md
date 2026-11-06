# 01. Grafana 알람 프로비저닝 환경 변수 오타와 조기 실패 검증

- 일시: 2026-11-06
- 목표: Grafana 알람 설정(`alerting.yaml`)에서 환경 변수 오타 및 누락 발생 시 프로비저닝 엔진의 동작 검증과 조기 실패(Fail-Fast) 원리 확인

## 1. 실험 전 예측
코드를 실행하기 전 세운 가설과 예측입니다.

1. `alerting.yaml`에 환경 변수 오타가 나더라도 컨테이너는 정상 기동될 것이다.
2. 변수 매핑이 안 되므로 URL 칸은 빈칸으로 채워지고, 테스트 알람을 누르면 빈칸으로 전송되었다고 뜰 것이다.
3. `.env`에 값이 빈 상태로 넘어가면 마찬가지로 빈 문자열이 들어갈 것이다.

## 2. 실험 환경
- 실행 환경: Grafana OSS 11.1.3 기반 Docker 컨테이너 (`lab-grafana`)
- 설정 파일:
  - `docker-compose.yml`: 환경 변수(`TEAMS_WEBHOOK_URL`) 주입 및 프로비저닝 디렉토리 마운트
  - `alerting.yaml`: Contact Point(Teams 웹후크 수신처) 정의

## 3. 실험 및 실측 결과

### 실험 1: 정상 환경 변수 주입 시
정상 변수(`TEAMS_WEBHOOK_URL=https://httpbin.org/post`) 설정 후 기동.

```bash
curl -s -u admin:admin http://localhost:3000/api/v1/provisioning/contact-points
```
```json
[{"uid":"teams-receiver-1","name":"Teams-Alert-Channel","type":"webhook","settings":{"url":"https://httpbin.org/post"}}]
```
- 결과: Grafana가 정상 기동(`Up`)되며, Contact Point URL에 환경 변수 값이 치환되어 등록됨.

### 실험 2: YAML 파일 내부 환경 변수명 오타 시
`alerting.yaml`에 정의되지 않은 변수명(`${TEAMS_WEBHOOK_URL_TYPO}`)을 지정하고 재기동.

```bash
docker ps -a --filter "name=lab-grafana"
docker logs lab-grafana --tail 10
```
```text
CONTAINER ID   IMAGE                        STATUS                     NAMES
b769cf5c4632   grafana/grafana-oss:11.1.3   Exited (1) 3 seconds ago   lab-grafana

logger=provisioning level=error msg="Failed to provision alerting" 
error="failure to map file alerting.yaml: failure parsing contact points: Teams-Channel: failed to validate integration of type 'teams': could not find url property in settings"
Error: ✗ failure to map file alerting.yaml: could not find url property in settings
```
- 결과: Grafana가 기동되지 않고 즉시 비정상 종료(`Exited 1`)됨.
- 원인 분석: Grafana는 정의되지 않은 환경 변수를 빈 문자열(`""`)로 치환함. 알람 수신처 검증기(Validator)에서 필수 필드인 `url`이 누락된 것으로 판단하여 전체 프로세스를 강제 중단시킴.

### 실험 3: `.env` 변수 값이 비어있는 경우
`TEAMS_WEBHOOK_URL=""` 상태로 주입한 경우.
- 결과: 실험 2와 완전히 동일하게 `could not find url property in settings` 에러를 뿜으며 기동 거부(`Exited 1`).

## 4. 결론 및 배운 점
1. Grafana는 알람 설정(`alerting.yaml`)만큼은 실제 장애 상황에서 알람이 무시되는 침묵 실패를 막기 위해, 오타나 빈 값이 발생하면 즉시 기동을 실패(Fail-Fast)시켜 배포 단계에서 문제를 드러내도록 설계되었다.
2. 조기 실패는 나중에 진짜 장애가 터졌을 때 알람이 조용히 누락되는 것보다 훨씬 안전하다.
3. 모든 컴포넌트가 무조건 조기 실패하도록 구성되어야 하는 것은 아니다. Grafana의 경우 Alerting은 조기 실패하지만, Datasources나 Dashboards는 오타가 나더라도 다른 DB 연결이 끊어지지 않고 지표 시각화가 유지되도록 부분 가용성을 제공한다. 컴포넌트의 중요도와 성격에 따라 실패 처리 전략을 달리해야 한다.

## 5. 이 실험으로 확인하지 못한 것
- Unified Alerting의 `alerting.yaml`에 들어가는 복잡한 라우팅 규칙(Notification Policies) 및 알람 조건(Alert Rules)의 구체적인 스키마 코드 규칙.
- AWS SSM Parameter Store나 실제 Teams 웹후크로 실제 알람 메시지를 송수신하는 네트워크 통신 과정.
