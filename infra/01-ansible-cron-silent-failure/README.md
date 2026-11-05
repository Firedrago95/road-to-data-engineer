# 01. cron과 Ansible의 침묵의 실패 원인 분석

- 일시: 2026-11-05
- 목표: 스케줄러(cron)와 자동화 도구(Ansible) 연동 시 일부 서버 실패가 누락되는 원인 규명 및 감시 분리 검증

## 1. 실험 전 예측
코드를 실행하기 전 세운 가설과 예측입니다.

1. Ansible은 일부 서버가 죽어 있더라도 살아있는 서버는 성공시키고, 실패한 서버는 따로 기록할 것이다.
2. cron 명령어의 `> /dev/null 2>&1` 설정은 정상 출력과 에러 출력을 모두 버리므로, cron은 작업의 실제 성공 여부를 알지 못하고 단순히 정해진 시간에 스크립트가 실행되었다는 사실만 기록할 것이다.

## 2. 실험 환경
- 실행 환경: Alpine Linux 기반 Docker 컨테이너 (`lab-ansible:latest`)
- 대상 인벤토리 (`inventory.ini`):
  - `server-healthy`: 정상 연결 서버 (로컬 연결)
  - `server-dead`: 연결 불가 서버 (테스트용 비라우팅 IP `192.0.2.1`, 타임아웃 2초)
- 실행 플레이북 (`playbook.yml`): 간단한 헬스체크 명령 수행

## 3. 실험 및 실측 결과

### 실험 1: Ansible 실행 결과 요약과 종료 코드 확인
Ansible을 실행하고 요약표와 프로세스 종료 코드를 확인합니다.

```bash
ansible-playbook -i inventory.ini playbook.yml
echo "종료코드: $?"
```
```text
PLAY RECAP *********************************************************************
server-dead    : ok=0    changed=0    unreachable=0    failed=1    skipped=0    rescued=0    ignored=0   
server-healthy : ok=1    changed=1    unreachable=0    failed=0    skipped=0    rescued=0    ignored=0   

종료코드: 2
```
- PLAY RECAP의 수치: `server-dead`의 실패 작업 수가 `failed=1`로 기록됨.
- 종료 코드: Ansible 프로세스는 일부 호스트 실패 시 운영체제에 비정상 종료 코드 `2`를 반환함.

### 실험 2: cron 환경의 출력 제거 재현
cron 등록 시 자주 사용되는 출력 리다이렉션을 적용합니다.

```bash
ansible-playbook -i inventory.ini playbook.yml > /dev/null 2>&1
echo "종료코드: $?"
```
```text
종료코드: 2
```
- 화면 및 로그 출력: `> /dev/null`로 1번 통로(표준 출력)가 버려지고, `2>&1`로 2번 통로(표준 에러)까지 1번 통로로 합쳐져 버려짐.
- 터미널이나 일반 로그 파일에는 어떠한 실패 메시지나 PLAY RECAP도 남지 않음.

### 실험 3: 실패 코드 전파를 통한 정상 감시 검증
Ansible의 종료 코드를 즉시 검사하여 실패 시 비상 메시지를 출력하고 스크립트 자체도 비정상 종료하도록 구성합니다.

```bash
ansible-playbook -i inventory.ini playbook.yml > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "🚨 [경고] Ansible 작업 중 실패한 서버가 있습니다!"
    exit 1
fi
```
```text
🚨 [경고] Ansible 작업 중 실패한 서버가 있습니다!
최종 스크립트 종료코드: 1
```
- 출력이 버려지더라도 종료 코드(`$?`)를 검사하여 실패를 감지함.
- `exit 1`을 통해 스크립트 자체가 비정상 종료를 뿜어냄으로써 cron과 상위 모니터링 시스템이 실패를 인지할 수 있게 됨.

## 4. 결론 및 배운 점
1. `> /dev/null 2>&1`의 의미: 1번 통로(표준 출력)와 2번 통로(표준 에러)의 모든 화면 글자를 버리는 설정이다.
2. `$?`와 `PLAY RECAP`의 차이: `PLAY RECAP`은 각 서버별 작업 성공/실패 개수를 적어둔 기록지이고, `$?`는 프로그램이 끝난 뒤 운영체제에 남기는 최종 상태 번호(0=성공, 0 외=실패)이다.
3. 감시의 분리: 스크립트가 단순히 실행된 것("돌았다")과 작업이 성공한 것("성공했다")은 다르다. 실패 시 쉘 스크립트가 `exit 1` 또는 `exit $?`로 실패 코드를 상위 프로세스에 명확히 전달해야만 cron이 실패를 정상적으로 인식한다.

## 5. 이 실험으로 확인하지 못한 것
- 실제 운영 환경의 `crontab` 설정 문법 및 cron 데몬의 시스템 로깅 동작.
- 실무 환경에서 다루는 복잡한 Ansible 인벤토리 구성(SSH 키 인증, ansible.cfg 설정, 역할별 플레이북 분리).
- 슬랙 웹훅이나 외부 모니터링 도구와 연동한 실제 알람 발송 과정.
